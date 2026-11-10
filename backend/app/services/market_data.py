import asyncio
import calendar
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

# Broker ticker -> Yahoo ticker for one-off differences the rules in to_yahoo_symbol miss.
YAHOO_OVERRIDES: dict[str, str] = {}
# Broker exchange suffix -> Yahoo suffix. Questrade writes TSX Venture as .VN; Yahoo uses .V.
# Foreign listings use Yahoo's own suffixes; without them a dot would read as a share class.
_SUFFIXES = {".TO": ".TO", ".V": ".V", ".VN": ".V", ".CN": ".CN", ".NE": ".NE"} | {
    s: s for s in (".L", ".DE", ".F", ".PA", ".AS", ".BR", ".LS", ".MI", ".MC", ".SW", ".VI", ".ST",
                   ".OL", ".CO", ".HE", ".IR", ".HK", ".T", ".AX", ".NZ", ".SI", ".KS", ".TW", ".SA", ".MX")
}
# Yahoo quotes some listings in a currency's minor unit (LSE in pence, JSE in cents).
_MINOR_UNITS = {"GBp": ("GBP", 100), "GBX": ("GBP", 100), "ZAc": ("ZAR", 100), "ILA": ("ILS", 100)}
# Yahoo quoteType -> our asset class.
_ASSET_CLASSES = {"EQUITY": "stock", "ETF": "etf", "MUTUALFUND": "fund"}


@dataclass
class Quote:
    symbol: str  # the broker symbol that was asked for
    price: Decimal
    currency: str
    as_of: datetime  # naive UTC time we fetched it


def day_timestamp(day: date) -> int:
    """Unix seconds of the day's midnight UTC (what daily charts key bars on)."""
    return calendar.timegm(day.timetuple())


@dataclass
class Candle:
    day: date  # the trading day (exchange-local date)
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int

    @property
    def time(self) -> int:
        return day_timestamp(self.day)


@dataclass
class PriceHistory:
    symbol: str
    currency: str
    candles: list[Candle]


def to_yahoo_symbol(symbol: str) -> str:
    """Map a broker ticker to Yahoo's: exchange suffix as Yahoo spells it, share-class dots as dashes
    (BRK.B -> BRK-B, BBD.B.TO -> BBD-B.TO)."""
    symbol = symbol.upper()
    if symbol in YAHOO_OVERRIDES:
        return YAHOO_OVERRIDES[symbol]
    base, suffix = symbol, ""
    for broker_suffix, yahoo_suffix in _SUFFIXES.items():
        if symbol.endswith(broker_suffix):
            base, suffix = symbol[: -len(broker_suffix)], yahoo_suffix
            break
    return base.replace(".", "-") + suffix


def to_major_unit(price: Decimal, currency: str) -> tuple[Decimal, str]:
    """Convert a minor-unit quote (GBp) to its ISO currency (GBP). Case matters: GBp is not GBP."""
    if currency in _MINOR_UNITS:
        iso, divisor = _MINOR_UNITS[currency]
        return price / divisor, iso
    return price, currency


class QuoteProvider(ABC):
    """Source of real-time prices. Swap implementations without touching the pipeline."""

    @abstractmethod
    async def get_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        """Return quotes for the symbols that could be priced; unknown symbols are omitted."""

    async def get_asset_classes(self, symbols: list[str]) -> dict[str, str]:
        """stock | etf | fund | other per symbol; symbols it can't classify may be omitted (other)."""
        return {}


class HistoryProvider(ABC):
    """Source of historical OHLC bars."""

    @abstractmethod
    async def get_history(self, symbol: str, start: date, end: date, interval: str) -> PriceHistory:
        """Bars from start to end inclusive; interval is "1d", "1wk" or "1mo". Empty candles if unknown."""


class YFinanceProvider(QuoteProvider, HistoryProvider):
    """Unofficial Yahoo Finance via yfinance. Fine for prototyping, may rate-limit or break."""

    # Charts refetch on every range switch; keep Yahoo calls down without serving stale bars long.
    HISTORY_TTL_SECONDS = 60
    # Ticker.info is slow (a full quote-summary call) and a listing's type doesn't change.
    CLASS_TTL_SECONDS = 24 * 3600
    CLASS_FAILURE_TTL_SECONDS = 600

    def __init__(self, ticker_factory=None):
        if ticker_factory is None:
            import yfinance

            ticker_factory = yfinance.Ticker
        self._ticker = ticker_factory
        self._history_cache: dict[tuple, tuple[float, PriceHistory]] = {}
        self._class_cache: dict[str, tuple[float, str]] = {}  # symbol -> (expires, class)

    def _fetch_class(self, symbol: str) -> tuple[str, bool]:
        try:
            quote_type = (self._ticker(to_yahoo_symbol(symbol)).info or {}).get("quoteType") or ""
        except Exception:
            return "other", False
        return _ASSET_CLASSES.get(quote_type.upper(), "other"), True

    async def get_asset_classes(self, symbols: list[str]) -> dict[str, str]:
        now = time.monotonic()
        missing = sorted({s for s in symbols if self._class_cache.get(s, (0.0, ""))[0] <= now})
        results = await asyncio.gather(*(asyncio.to_thread(self._fetch_class, s) for s in missing))
        for symbol, (asset_class, ok) in zip(missing, results):
            ttl = self.CLASS_TTL_SECONDS if ok else self.CLASS_FAILURE_TTL_SECONDS
            self._class_cache[symbol] = (now + ttl, asset_class)
        return {s: self._class_cache[s][1] for s in symbols}

    def _fetch(self, symbol: str) -> Quote | None:
        try:
            info = self._ticker(to_yahoo_symbol(symbol)).fast_info
            price = info["last_price"]
            currency = info["currency"]
        except Exception:
            return None
        if price is None or price != price or price <= 0:  # None, NaN, or nonsense
            return None
        price, currency = to_major_unit(Decimal(str(price)), currency or "")
        return Quote(
            symbol=symbol,
            price=price,
            currency=currency,
            as_of=datetime.now(timezone.utc).replace(tzinfo=None),
        )

    async def get_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        unique = sorted(set(symbols))
        results = await asyncio.gather(*(asyncio.to_thread(self._fetch, s) for s in unique))
        return {s: q for s, q in zip(unique, results) if q is not None}

    def _fetch_history(self, symbol: str, start: date, end: date, interval: str) -> PriceHistory:
        empty = PriceHistory(symbol, "", [])
        try:
            ticker = self._ticker(to_yahoo_symbol(symbol))
            # yfinance's end is exclusive.
            frame = ticker.history(start=start, end=end + timedelta(days=1), interval=interval, auto_adjust=False)
            currency = ticker.fast_info["currency"] or ""
        except Exception:
            return empty
        candles = []
        for when, row in frame.iterrows():
            values = [row["Open"], row["High"], row["Low"], row["Close"]]
            if any(v is None or v != v for v in values):  # NaN rows for halted days
                continue
            ohlc = [to_major_unit(Decimal(str(v)), currency)[0] for v in values]
            candles.append(Candle(when.date(), *ohlc, int(row["Volume"] or 0)))
        return PriceHistory(symbol, to_major_unit(Decimal(0), currency)[1], candles)

    async def get_history(self, symbol: str, start: date, end: date, interval: str) -> PriceHistory:
        key = (symbol, start, end, interval)
        cached = self._history_cache.get(key)
        if cached and time.monotonic() - cached[0] < self.HISTORY_TTL_SECONDS:
            return cached[1]
        history = await asyncio.to_thread(self._fetch_history, symbol, start, end, interval)
        if history.candles:
            self._history_cache[key] = (time.monotonic(), history)
        return history

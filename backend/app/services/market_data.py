import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

# Broker ticker -> Yahoo ticker for one-off differences the rules in to_yahoo_symbol miss.
YAHOO_OVERRIDES: dict[str, str] = {}
# Broker exchange suffix -> Yahoo suffix. Questrade writes TSX Venture as .VN; Yahoo uses .V.
_SUFFIXES = {".TO": ".TO", ".V": ".V", ".VN": ".V", ".CN": ".CN", ".NE": ".NE"}
# Yahoo quotes some listings in a currency's minor unit (LSE in pence, JSE in cents).
_MINOR_UNITS = {"GBp": ("GBP", 100), "GBX": ("GBP", 100), "ZAc": ("ZAR", 100), "ILA": ("ILS", 100)}


@dataclass
class Quote:
    symbol: str  # the broker symbol that was asked for
    price: Decimal
    currency: str
    as_of: datetime  # naive UTC time we fetched it


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


class YFinanceProvider(QuoteProvider):
    """Unofficial Yahoo Finance via yfinance. Fine for prototyping, may rate-limit or break."""

    def __init__(self, ticker_factory=None):
        if ticker_factory is None:
            import yfinance

            ticker_factory = yfinance.Ticker
        self._ticker = ticker_factory

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

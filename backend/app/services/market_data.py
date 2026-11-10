import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

# Broker ticker -> Yahoo ticker where they differ. TSX (.TO), TSXV (.V), CSE (.CN) and NEO (.NE)
# suffixes are identical on both sides, so the map starts empty.
YAHOO_OVERRIDES: dict[str, str] = {}


@dataclass
class Quote:
    symbol: str  # the broker symbol that was asked for
    price: Decimal
    currency: str
    as_of: datetime  # naive UTC time we fetched it


def to_yahoo_symbol(symbol: str) -> str:
    return YAHOO_OVERRIDES.get(symbol.upper(), symbol.upper())


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
        return Quote(
            symbol=symbol,
            price=Decimal(str(price)),
            currency=currency or "",
            as_of=datetime.now(timezone.utc).replace(tzinfo=None),
        )

    async def get_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        unique = sorted(set(symbols))
        results = await asyncio.gather(*(asyncio.to_thread(self._fetch, s) for s in unique))
        return {s: q for s, q in zip(unique, results) if q is not None}

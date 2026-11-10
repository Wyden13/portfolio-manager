from abc import ABC, abstractmethod
from decimal import Decimal

from app.services.market_data import QuoteProvider


class FxProvider(ABC):
    """Spot exchange rates."""

    @abstractmethod
    async def get_rates(self, currencies: list[str], base: str) -> dict[str, Decimal]:
        """Units of `base` per one unit of each currency; currencies without a rate are omitted."""


class QuoteFxProvider(FxProvider):
    """Rates from a quote provider that understands Yahoo FX tickers (USDCAD=X)."""

    def __init__(self, quotes: QuoteProvider):
        self.quotes = quotes

    async def get_rates(self, currencies: list[str], base: str) -> dict[str, Decimal]:
        base = base.upper()
        foreign = sorted({c.upper() for c in currencies if c and c.upper() != base})
        rates = {base: Decimal(1)} if base in {c.upper() for c in currencies} else {}
        if foreign:
            tickers = {f"{c}{base}=X": c for c in foreign}
            quotes = await self.quotes.get_quotes(list(tickers))
            rates.update({tickers[t]: q.price for t, q in quotes.items()})
        return rates

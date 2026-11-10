from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from app.models.transaction import Transaction, TransactionKind
from app.services.market_data import Quote

ZERO = Decimal(0)


@dataclass
class Holding:
    account_id: int
    symbol: str
    currency: str
    quantity: Decimal = ZERO
    cost_basis: Decimal = ZERO  # total cost of the shares still held, buy fees included
    first_buy_at: datetime | None = None
    last_trade_at: datetime | None = None
    incomplete_history: bool = False  # sold more than the stored buys cover

    @property
    def average_cost(self) -> Decimal:
        return self.cost_basis / self.quantity if self.quantity else ZERO


@dataclass
class PositionPnL:
    account_id: int
    symbol: str
    currency: str
    quantity: Decimal
    average_cost: Decimal
    cost_basis: Decimal
    price: Decimal | None
    market_value: Decimal | None
    unrealized_pnl: Decimal | None
    unrealized_pct: Decimal | None
    first_buy_at: datetime | None
    quote_as_of: datetime | None
    status: str  # ok | no_quote | currency_mismatch
    incomplete_history: bool = False


@dataclass
class CurrencyTotal:
    currency: str
    cost_basis: Decimal
    market_value: Decimal
    unrealized_pnl: Decimal
    unrealized_pct: Decimal | None


@dataclass
class PnLSnapshot:
    as_of: datetime
    positions: list[PositionPnL] = field(default_factory=list)
    totals: list[CurrencyTotal] = field(default_factory=list)


def compute_holdings(transactions: list[Transaction]) -> list[Holding]:
    """Average-cost holdings per (account, symbol) from buys and sells, oldest first."""
    holdings: dict[tuple[int, str], Holding] = {}
    ordered = sorted(transactions, key=lambda t: (t.trade_date, t.id or 0))
    for t in ordered:
        if t.kind not in (TransactionKind.BUY, TransactionKind.SELL) or not t.symbol:
            continue
        h = holdings.setdefault((t.account_id, t.symbol), Holding(t.account_id, t.symbol, t.currency))
        h.last_trade_at = t.trade_date
        if t.kind == TransactionKind.BUY:
            h.quantity += t.quantity
            h.cost_basis += t.quantity * t.price + t.fee
            h.first_buy_at = h.first_buy_at or t.trade_date
        else:
            sold = min(t.quantity, h.quantity)
            if sold < t.quantity:
                h.incomplete_history = True
            if h.quantity:
                h.cost_basis -= h.cost_basis * sold / h.quantity
            h.quantity -= sold
    return [h for h in holdings.values() if h.quantity > 0]


def compute_pnl(holdings: list[Holding], quotes: dict[str, Quote], now: datetime) -> PnLSnapshot:
    """Compare cost basis with live prices. Each position stays in its own currency."""
    snapshot = PnLSnapshot(as_of=now)
    sums: dict[str, list[Decimal]] = {}
    for h in holdings:
        quote = quotes.get(h.symbol)
        price = market_value = pnl = pct = quote_as_of = None
        status = "ok"
        if quote is None:
            status = "no_quote"
        elif quote.currency and h.currency and quote.currency.upper() != h.currency.upper():
            status = "currency_mismatch"
        else:
            price, quote_as_of = quote.price, quote.as_of
            market_value = h.quantity * price
            pnl = market_value - h.cost_basis
            pct = pnl / h.cost_basis * 100 if h.cost_basis else None
            total = sums.setdefault(h.currency, [ZERO, ZERO])
            total[0] += h.cost_basis
            total[1] += market_value
        snapshot.positions.append(PositionPnL(
            h.account_id, h.symbol, h.currency, h.quantity, h.average_cost, h.cost_basis,
            price, market_value, pnl, pct, h.first_buy_at, quote_as_of, status, h.incomplete_history,
        ))
    for currency, (cost, value) in sorted(sums.items()):
        snapshot.totals.append(CurrencyTotal(
            currency, cost, value, value - cost, (value - cost) / cost * 100 if cost else None,
        ))
    return snapshot

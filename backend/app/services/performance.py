from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from app.models.position import Position
from app.models.transaction import Transaction, TransactionKind
from app.services.market_data import Quote

ZERO = Decimal(0)
# Stored quantities pass through floats on SQLite; treat differences below this as equal.
QUANTITY_TOLERANCE = Decimal("0.000001")


@dataclass
class Holding:
    account_id: int
    symbol: str
    currency: str
    quantity: Decimal = ZERO
    # Total cost of the shares still held, buy fees included. None when the broker gives no cost.
    cost_basis: Decimal | None = ZERO
    first_buy_at: datetime | None = None
    last_trade_at: datetime | None = None
    incomplete_history: bool = False  # sold more than the stored buys cover
    source: str = "transactions"  # transactions | broker (see reconcile)

    @property
    def average_cost(self) -> Decimal | None:
        if self.cost_basis is None:
            return None
        return self.cost_basis / self.quantity if self.quantity else ZERO


@dataclass
class PositionPnL:
    account_id: int
    symbol: str
    currency: str
    quantity: Decimal
    average_cost: Decimal | None
    cost_basis: Decimal | None
    price: Decimal | None
    market_value: Decimal | None
    unrealized_pnl: Decimal | None
    unrealized_pct: Decimal | None
    first_buy_at: datetime | None
    quote_as_of: datetime | None
    status: str  # ok | no_quote | currency_mismatch | no_cost
    incomplete_history: bool = False
    source: str = "transactions"


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
    # All totals converted at spot FX; None when some currency had no rate.
    base_total: CurrencyTotal | None = None
    fx_rates: dict[str, Decimal] = field(default_factory=dict)


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


def reconcile(derived: list[Holding], snapshot: list[Position]) -> list[Holding]:
    """The broker's position snapshot decides what is held and how much.

    Transaction-derived cost is used only when those transactions reproduce the broker's quantity.
    Otherwise (history older than the lookback, transfers in, splits...) the broker's own average
    cost is used. Derived holdings the broker no longer reports are dropped.
    """
    by_key = {(h.account_id, h.symbol): h for h in derived}
    result = []
    for p in snapshot:
        if not p.quantity:
            continue
        h = by_key.get((p.account_id, p.symbol))
        if h and not h.incomplete_history and abs(h.quantity - p.quantity) < QUANTITY_TOLERANCE:
            result.append(h)
            continue
        result.append(Holding(
            account_id=p.account_id, symbol=p.symbol, currency=p.currency or (h.currency if h else ""),
            quantity=p.quantity,
            cost_basis=p.average_cost * p.quantity if p.average_cost is not None else None,
            first_buy_at=h.first_buy_at if h else None, last_trade_at=h.last_trade_at if h else None,
            incomplete_history=h.incomplete_history if h else False, source="broker",
        ))
    return result


def _pct(pnl: Decimal, cost: Decimal) -> Decimal | None:
    return pnl / cost * 100 if cost else None


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
            if h.cost_basis is None:
                status = "no_cost"  # value is known but P&L isn't; kept out of totals
            else:
                pnl = market_value - h.cost_basis
                pct = _pct(pnl, h.cost_basis)
                total = sums.setdefault(h.currency, [ZERO, ZERO])
                total[0] += h.cost_basis
                total[1] += market_value
        snapshot.positions.append(PositionPnL(
            h.account_id, h.symbol, h.currency, h.quantity, h.average_cost, h.cost_basis,
            price, market_value, pnl, pct, h.first_buy_at, quote_as_of, status, h.incomplete_history,
            h.source,
        ))
    for currency, (cost, value) in sorted(sums.items()):
        snapshot.totals.append(CurrencyTotal(currency, cost, value, value - cost, _pct(value - cost, cost)))
    return snapshot


def convert_totals(totals: list[CurrencyTotal], rates: dict[str, Decimal], base: str) -> CurrencyTotal | None:
    """Sum per-currency totals into `base` at the given spot rates (cost and value alike)."""
    if not totals or any(t.currency.upper() not in rates for t in totals):
        return None
    cost = sum((t.cost_basis * rates[t.currency.upper()] for t in totals), ZERO)
    value = sum((t.market_value * rates[t.currency.upper()] for t in totals), ZERO)
    return CurrencyTotal(base, cost, value, value - cost, _pct(value - cost, cost))

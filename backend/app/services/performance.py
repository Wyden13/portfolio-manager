from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import date, datetime
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
    asset_class: str = "other"  # stock | etf | fund | other


@dataclass
class CashBalance:
    account_id: int
    currency: str
    amount: Decimal
    # The stored history may not reach back to the account's opening, so the sum may be off.
    estimated: bool = False


@dataclass
class AccountSummary:
    """One account in the base currency at spot FX: priced holdings plus computed cash."""
    account_id: int
    market_value: Decimal  # holdings with a live price, cost basis or not
    cost_basis: Decimal  # of the holdings that have one
    unrealized_pnl: Decimal
    unrealized_pct: Decimal | None
    cash: list[CashBalance]
    cash_value: Decimal
    total: Decimal  # market_value + cash_value
    holdings: int
    complete: bool = True  # False when a currency had no FX rate and was left out


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
    accounts: list[AccountSummary] = field(default_factory=list)
    # Base-currency cash, and holdings plus cash across all accounts; None when a rate is missing.
    base_currency: str = ""
    cash_base: Decimal | None = None
    total_assets_base: Decimal | None = None


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


def value_history(
    holdings: list[Holding], transactions: list[Transaction], closes: dict[str, dict[date, Decimal]],
) -> list[tuple[date, Decimal]]:
    """Daily market value of today's holdings, replayed backwards through the stored ledger.

    See `_Replay` for how a holding's quantity on a past day is worked out. Values use each
    symbol's close, carried forward over days it didn't trade. A symbol counts from its first close.
    """
    replay = _Replay(holdings, transactions)
    points = []
    for day, last_close in _closes_by_day(closes):
        value = ZERO
        for h in holdings:
            close = last_close.get(h.symbol)
            if close is not None:
                value += replay.quantity_on(h, day) * close
        points.append((day, value))
    return points


class _Replay:
    """A holding's quantity on a past day: the stored buys and sells up to that day, plus the part of
    today's (reconciled) quantity the stored trades don't explain.

    That unexplained part (shares transferred in, or bought before the sync lookback) only counts
    from when it can have arrived: its first stored non-trade activity (a transfer row), else the
    account's first stored activity. Before that the account has no history we know of, so nothing
    is shown as held. An account with no stored activity at all keeps today's quantity throughout.
    """

    def __init__(self, holdings: list[Holding], ledger: list[Transaction]):
        self.trades: dict[tuple[int, str], list[tuple[date, Decimal]]] = {}
        self.first_activity: dict[int, date] = {}
        moved_in: dict[tuple[int, str], date] = {}
        for t in ledger:
            day = t.trade_date.date()
            self.first_activity[t.account_id] = min(self.first_activity.get(t.account_id, day), day)
            if not t.symbol:
                continue
            key = (t.account_id, t.symbol)
            if t.kind in (TransactionKind.BUY, TransactionKind.SELL):
                signed = t.quantity if t.kind == TransactionKind.BUY else -t.quantity
                self.trades.setdefault(key, []).append((day, signed))
            elif t.quantity:
                moved_in[key] = min(moved_in.get(key, day), day)
        self.unexplained: dict[tuple[int, str], tuple[Decimal, date | None]] = {}
        for h in holdings:
            key = (h.account_id, h.symbol)
            rest = h.quantity - sum((q for _, q in self.trades.get(key, [])), ZERO)
            self.unexplained[key] = (rest, moved_in.get(key, self.first_activity.get(h.account_id)))

    def quantity_on(self, h: Holding, day: date) -> Decimal:
        key = (h.account_id, h.symbol)
        held = sum((q for d, q in self.trades.get(key, []) if d <= day), ZERO)
        rest, since = self.unexplained.get(key, (ZERO, None))
        if since is None or day >= since:
            held += rest
        return max(held, ZERO)


def _closes_by_day(closes: dict[str, dict[date, Decimal]]):
    """Each day any symbol traded, with every symbol's latest close so far (carried forward)."""
    last_close: dict[str, Decimal] = {}
    for day in sorted({d for series in closes.values() for d in series}):
        for symbol, series in closes.items():
            if day in series:
                last_close[symbol] = series[day]
        yield day, last_close


CASH_TOLERANCE = Decimal("0.005")


def cash_balances(transactions: list[Transaction], holdings: list[Holding] = ()) -> list[CashBalance]:
    """Cash per account and currency: the sum of every stored activity's signed net amount
    (buys, fees and withdrawals negative; sells, deposits and dividends positive).

    It is only as good as the stored history, so it is flagged estimated when the account's oldest
    activity day has no deposit (history older than the sync lookback, or an account transferred in),
    when an activity had no currency, or when a holding sold more than its stored buys cover.
    """
    sums: dict[tuple[int, str], Decimal] = {}
    first_day: dict[int, date] = {}
    first_deposit: dict[int, date] = {}
    unsure = {h.account_id for h in holdings if h.incomplete_history}
    for t in transactions:
        day = t.trade_date.date()
        first_day[t.account_id] = min(first_day.get(t.account_id, day), day)
        if t.kind == TransactionKind.DEPOSIT:
            first_deposit[t.account_id] = min(first_deposit.get(t.account_id, day), day)
        if not t.currency:
            unsure.add(t.account_id)
            continue
        key = (t.account_id, t.currency.upper())
        sums[key] = sums.get(key, ZERO) + (t.net_amount or ZERO)
    unsure |= {a for a, day in first_day.items() if first_deposit.get(a) != day}
    return [
        CashBalance(a, c, amount, a in unsure)
        for (a, c), amount in sorted(sums.items()) if abs(amount) >= CASH_TOLERANCE
    ]


def summarize_accounts(
    positions: list[PositionPnL], cash: list[CashBalance], rates: dict[str, Decimal],
) -> list[AccountSummary]:
    """Per-account holdings value, P&L and cash in the base currency at the given spot rates."""
    summaries = []
    for account_id in sorted({p.account_id for p in positions} | {c.account_id for c in cash}):
        s = AccountSummary(account_id, ZERO, ZERO, ZERO, None, [c for c in cash if c.account_id == account_id],
                           ZERO, ZERO, 0)
        for p in positions:
            if p.account_id != account_id:
                continue
            s.holdings += 1
            if p.market_value is None:
                continue
            rate = rates.get(p.currency.upper())
            if rate is None:
                s.complete = False
                continue
            s.market_value += p.market_value * rate
            if p.unrealized_pnl is not None:
                s.cost_basis += p.cost_basis * rate
                s.unrealized_pnl += p.unrealized_pnl * rate
        for c in s.cash:
            rate = rates.get(c.currency.upper())
            if rate is None:
                s.complete = False
            else:
                s.cash_value += c.amount * rate
        s.unrealized_pct = _pct(s.unrealized_pnl, s.cost_basis)
        s.total = s.market_value + s.cash_value
        summaries.append(s)
    return summaries


def account_value_history(
    holdings: list[Holding], transactions: list[Transaction], closes: dict[str, dict[date, Decimal]],
    rates: dict[str, Decimal],
) -> dict[int, list[tuple[date, Decimal]]]:
    """Daily value of each account in the base currency: today's holdings replayed backwards through
    the stored trades (as in value_history), plus the cash its stored activity had built up by then.

    Everything is converted at today's spot `rates`; holdings and cash in a currency without a rate
    are left out. `transactions` is the whole ledger (cash comes from every kind of activity). An
    account's series starts at its first stored activity: there is nothing to show before it.
    """
    replay = _Replay(holdings, transactions)
    flows: dict[int, list[tuple[date, Decimal]]] = {}
    for t in transactions:
        rate = rates.get((t.currency or "").upper())
        if rate is not None:
            flows.setdefault(t.account_id, []).append((t.trade_date.date(), (t.net_amount or ZERO) * rate))
    cash_days: dict[int, list[date]] = {}
    cash_sums: dict[int, list[Decimal]] = {}
    for account_id, rows in flows.items():
        rows.sort(key=lambda r: r[0])
        running, sums = ZERO, []
        for _, amount in rows:
            running += amount
            sums.append(running)
        cash_days[account_id], cash_sums[account_id] = [d for d, _ in rows], sums

    accounts = sorted({h.account_id for h in holdings} | set(flows))
    series: dict[int, list[tuple[date, Decimal]]] = {a: [] for a in accounts}
    for day, last_close in _closes_by_day(closes):
        values = dict.fromkeys(accounts, ZERO)
        for h in holdings:
            close, rate = last_close.get(h.symbol), rates.get(h.currency.upper())
            if close is not None and rate is not None:
                values[h.account_id] += replay.quantity_on(h, day) * close * rate
        for account_id in flows:
            i = bisect_right(cash_days[account_id], day)
            if i:
                values[account_id] += cash_sums[account_id][i - 1]
        for account_id, value in values.items():
            opened = replay.first_activity.get(account_id)
            if opened is None or day >= opened:
                series[account_id].append((day, value))
    return {a: points for a, points in series.items() if points}

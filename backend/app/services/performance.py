from bisect import bisect_right
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from decimal import Decimal

from app.models.position import Position
from app.models.transaction import Transaction
from app.services.ledger import LedgerRow, RowType, normalize
from app.services.market_data import Quote

ZERO = Decimal(0)
# Stored quantities pass through floats on SQLite; treat differences below this as equal.
QUANTITY_TOLERANCE = Decimal("0.000001")


def _rows(ledger: list[Transaction] | list[LedgerRow]) -> list[LedgerRow]:
    """Accept stored transactions or already-normalized rows."""
    ledger = list(ledger)
    return ledger if all(isinstance(r, LedgerRow) for r in ledger) else normalize(ledger)


@dataclass
class Holding:
    account_id: int
    symbol: str
    currency: str  # listing (quote) currency once reconciled; the trades' currency before that
    quantity: Decimal = ZERO
    # Total cost of the shares still held, buy fees included, in cost_currency. None when the broker gives no cost.
    cost_basis: Decimal | None = ZERO
    first_buy_at: datetime | None = None
    last_trade_at: datetime | None = None
    incomplete_history: bool = False  # sold more than the stored buys cover
    source: str = "transactions"  # transactions | broker (see reconcile)
    # Currency the shares were paid in (e.g. CAD for a US stock bought in a CAD account).
    cost_currency: str = ""
    realized_pnl: Decimal = ZERO  # in cost_currency, from average-cost sells
    opening_shares: Decimal = ZERO  # held before the stored history, inferred from dividends
    ledger_quantity: Decimal | None = None  # what the stored trades account for (set by reconcile)

    def __post_init__(self):
        self.cost_currency = (self.cost_currency or self.currency or "").upper()

    @property
    def average_cost(self) -> Decimal | None:
        if self.cost_basis is None:
            return None
        return self.cost_basis / self.quantity if self.quantity else ZERO


@dataclass
class OptionPosition:
    """Option contracts on one underlying, by premiums (no option quotes: open contracts stay at cost)."""
    account_id: int
    underlying: str
    currency: str
    contracts: Decimal = ZERO  # open long contracts
    cost: Decimal = ZERO  # premium paid for the open contracts
    realized_pnl: Decimal = ZERO  # premiums received - premiums paid on closed/expired contracts
    premiums_paid: Decimal = ZERO
    premiums_received: Decimal = ZERO

    @property
    def estimated(self) -> bool:
        return self.contracts > 0


@dataclass
class Check:
    """One failed (or informational) item of the ledger validation checklist."""
    code: str
    account_id: int
    message: str
    symbol: str | None = None
    day: date | None = None
    severity: str = "warning"  # warning | info


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
    # The cost as paid (cost_basis above is that converted to `currency` at spot when they differ).
    cost_currency: str = ""
    settled_cost_basis: Decimal | None = None
    realized_pnl: Decimal = ZERO  # in cost_currency


@dataclass
class CashBalance:
    account_id: int
    currency: str
    amount: Decimal
    # The stored history may not reach back to the account's opening, so the sum may be off.
    estimated: bool = False
    # Cash that must have been there before the stored history (or borrowed on margin): the deepest
    # end-of-day shortfall of the ledger alone. Reported only, not included in amount.
    opening: Decimal = ZERO
    negative_on: date | None = None  # first day the ledger alone ends below zero


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
    total: Decimal  # market_value + cash_value + options_value
    holdings: int
    complete: bool = True  # False when a currency had no FX rate and was left out
    options_value: Decimal = ZERO  # open option contracts at the premium paid


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


def _book(rows: list[LedgerRow]) -> dict[tuple[int, str], Holding]:
    """Average-cost (ACB) book per (account, symbol) over equity trades and corporate actions,
    closed positions included (they carry realized P&L)."""
    holdings: dict[tuple[int, str], Holding] = {}
    for r in rows:
        if r.type not in (RowType.EQUITY_TRADE, RowType.CORPORATE_ACTION) or not r.symbol:
            continue
        t = r.txn
        h = holdings.setdefault((r.account_id, r.symbol), Holding(r.account_id, r.symbol, r.currency))
        if r.type == RowType.CORPORATE_ACTION:
            # Split shares: total cost unchanged. Shares arriving on nothing we know of were held before
            # the stored history, so the book can't be complete.
            if h.quantity <= 0:
                h.incomplete_history = True
            h.quantity += r.shares
            continue
        h.last_trade_at = t.trade_date
        if r.side > 0:
            h.quantity += t.quantity
            h.cost_basis += abs(t.net_amount) if t.net_amount else t.quantity * t.price + t.fee
            h.first_buy_at = h.first_buy_at or t.trade_date
        else:
            sold = min(t.quantity, h.quantity)
            if sold < t.quantity:
                h.incomplete_history = True
            proceeds = t.net_amount if t.net_amount else t.quantity * t.price - t.fee
            acb_sold = h.cost_basis * sold / h.quantity if h.quantity else ZERO
            # Proceeds of shares beyond the book (oversold) have no known cost: leave them out.
            h.realized_pnl += proceeds * sold / t.quantity - acb_sold if t.quantity else ZERO
            h.cost_basis -= acb_sold
            h.quantity -= sold
    return holdings


def compute_holdings(transactions: list[Transaction] | list[LedgerRow]) -> list[Holding]:
    """Average-cost holdings per (account, symbol) from equity buys, sells and splits, oldest first.
    Option trades on the same symbol are not shares and are left to compute_options."""
    return [h for h in _book(_rows(transactions)).values() if h.quantity > 0]


def realized_by_account(transactions: list[Transaction] | list[LedgerRow]) -> dict[tuple[int, str], Decimal]:
    """Realized equity P&L per (account, cost currency), closed positions included."""
    totals: dict[tuple[int, str], Decimal] = {}
    for h in _book(_rows(transactions)).values():
        key = (h.account_id, h.cost_currency)
        totals[key] = totals.get(key, ZERO) + h.realized_pnl
    return totals


def compute_options(transactions: list[Transaction] | list[LedgerRow]) -> list[OptionPosition]:
    """Option premiums per (account, underlying, currency).

    Buys open contracts at their premium; sells close them at average premium (a sell with nothing
    open is a written option: the premium counts as received); an expiry closes them worthless.
    """
    book: dict[tuple[int, str, str], OptionPosition] = {}
    for r in _rows(transactions):
        if r.type not in (RowType.OPTION_TRADE, RowType.OPTION_EXPIRY) or not r.symbol:
            continue
        t = r.txn
        o = book.setdefault((r.account_id, r.symbol, r.currency), OptionPosition(r.account_id, r.symbol, r.currency))
        quantity = t.quantity or ZERO
        if r.type == RowType.OPTION_TRADE and r.side > 0:
            premium = abs(t.net_amount) if t.net_amount else quantity * t.price * (r.multiplier or 1) + t.fee
            o.contracts += quantity
            o.cost += premium
            o.premiums_paid += premium
            continue
        closed = min(quantity, o.contracts)
        average = o.cost / o.contracts if o.contracts else ZERO
        if r.type == RowType.OPTION_TRADE:
            proceeds = t.net_amount or ZERO
            o.premiums_received += proceeds
            o.realized_pnl += proceeds - average * closed
        else:
            o.realized_pnl -= average * closed
        o.cost -= average * closed
        o.contracts -= closed
    return list(book.values())


def infer_opening_shares(
    transactions: list[Transaction] | list[LedgerRow],
) -> tuple[dict[tuple[int, str], Decimal], list[Check]]:
    """Shares held before the stored history, audited from dividends.

    A dividend row's net amount over its per-share rate (`price`) gives the shares it was paid on;
    less what the stored trades (and splits) account for at that date is the pre-ledger holding.
    Accepted only when at least two dividend dates agree; disagreement is reported as a check.
    """
    ledger_shares: dict[tuple[int, str], Decimal] = {}
    # (day, shares implied, pre-ledger estimate, tolerance): 2% plus a cent of rounding on each side.
    estimates: dict[tuple[int, str], list[tuple[date, Decimal, Decimal, Decimal]]] = {}
    for r in _rows(transactions):
        if not r.symbol:
            continue
        key = (r.account_id, r.symbol)
        if r.type in (RowType.EQUITY_TRADE, RowType.CORPORATE_ACTION):
            ledger_shares[key] = ledger_shares.get(key, ZERO) + r.shares
        elif r.type == RowType.DIVIDEND and (r.txn.price or ZERO) > 0 and (r.txn.net_amount or ZERO) > 0:
            implied = r.txn.net_amount / r.txn.price
            estimates.setdefault(key, []).append((
                r.txn.trade_date.date(), implied, implied - ledger_shares.get(key, ZERO),
                implied * Decimal("0.02") + Decimal("0.01") / r.txn.price,
            ))
    opening: dict[tuple[int, str], Decimal] = {}
    checks: list[Check] = []
    for (account_id, symbol), points in estimates.items():
        values = [e for _, _, e, _ in points]
        if len(points) < 2:
            continue
        if max(values) - min(values) > max(tol for *_, tol in points):
            day = max(points, key=lambda p: abs(p[2] - values[-1]))[0]
            checks.append(Check(
                "dividend_shares_mismatch", account_id,
                f"Dividends imply {_fmt(min(values))} to {_fmt(max(values))} shares held before the stored "
                f"history; they should agree", symbol, day))
            continue
        latest = values[-1]
        if latest > points[-1][3]:
            opening[(account_id, symbol)] = latest
        elif latest < -Decimal("0.01"):
            checks.append(Check(
                "dividend_shares_mismatch", account_id,
                f"Dividends imply {_fmt(-latest)} fewer shares than the stored trades", symbol, points[-1][0]))
    return opening, checks


def _fmt(value: Decimal) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".")


def reconcile(
    derived: list[Holding], snapshot: list[Position], opening: dict[tuple[int, str], Decimal] | None = None,
) -> list[Holding]:
    """The broker's position snapshot decides what is held and how much.

    Transaction-derived cost is used only when those transactions reproduce the broker's quantity,
    alone or with the shares inferred to predate the stored history (`opening`, an estimate: the
    broker's quantity settles it, and those shares are costed at the broker's average). Otherwise (transfers in, history older than the lookback...) the broker's own
    average cost is used. Derived holdings the broker no longer reports are dropped. The listing
    currency comes from the broker; the derived cost keeps the currency it was paid in.
    """
    opening = opening or {}
    by_key = {(h.account_id, h.symbol): h for h in derived}
    result = []
    for p in snapshot:
        if not p.quantity:
            continue
        key = (p.account_id, p.symbol)
        h = by_key.get(key)
        extra = opening.get(key, ZERO)
        if h and extra and abs(h.quantity + extra - p.quantity) <= max(extra * Decimal("0.02"), QUANTITY_TOLERANCE):
            extra = p.quantity - h.quantity  # the dividends' estimate, settled by the broker's count
        currency = p.currency or (h.currency if h else "")
        if h and not h.incomplete_history:
            if abs(h.quantity - p.quantity) < QUANTITY_TOLERANCE:
                result.append(replace(h, currency=currency, ledger_quantity=h.quantity))
                continue
            if (extra and abs(h.quantity + extra - p.quantity) < QUANTITY_TOLERANCE and p.average_cost is not None
                    and h.cost_currency == (p.currency or h.cost_currency).upper()):
                result.append(replace(
                    h, currency=currency, quantity=p.quantity, cost_basis=h.cost_basis + extra * p.average_cost,
                    opening_shares=extra, ledger_quantity=h.quantity,
                ))
                continue
        result.append(Holding(
            account_id=p.account_id, symbol=p.symbol, currency=currency,
            quantity=p.quantity,
            cost_basis=p.average_cost * p.quantity if p.average_cost is not None else None,
            first_buy_at=h.first_buy_at if h else None, last_trade_at=h.last_trade_at if h else None,
            incomplete_history=h.incomplete_history if h else False, source="broker",
            cost_currency=currency, realized_pnl=h.realized_pnl if h else ZERO, opening_shares=extra,
            ledger_quantity=h.quantity if h else None,
        ))
    return result


def _pct(pnl: Decimal, cost: Decimal) -> Decimal | None:
    return pnl / cost * 100 if cost else None


def compute_pnl(
    holdings: list[Holding], quotes: dict[str, Quote], now: datetime, rates: dict[str, Decimal] | None = None,
) -> PnLSnapshot:
    """Compare cost basis with live prices. Each position stays in its listing currency.

    A cost paid in another currency (a US stock bought with CAD) is converted to the listing currency
    at the spot `rates` (units of base per unit); without both rates the position is a currency_mismatch.
    """
    rates = rates or {}
    snapshot = PnLSnapshot(as_of=now)
    sums: dict[str, list[Decimal]] = {}
    for h in holdings:
        quote = quotes.get(h.symbol)
        price = market_value = pnl = pct = quote_as_of = cost = average = None
        status = "ok"
        currency, cost_currency = h.currency.upper(), h.cost_currency.upper()
        to_listing = Decimal(1)
        if h.cost_basis is not None and cost_currency and currency and cost_currency != currency:
            if cost_currency in rates and currency in rates:
                to_listing = rates[cost_currency] / rates[currency]
            else:
                to_listing = None
        if quote is None:
            status = "no_quote"
        elif (quote.currency and h.currency and quote.currency.upper() != currency) or to_listing is None:
            status = "currency_mismatch"
        else:
            price, quote_as_of = quote.price, quote.as_of
            market_value = h.quantity * price
            if h.cost_basis is None:
                status = "no_cost"  # value is known but P&L isn't; kept out of totals
            else:
                cost = h.cost_basis * to_listing
                average = cost / h.quantity if h.quantity else ZERO
                pnl = market_value - cost
                pct = _pct(pnl, cost)
                total = sums.setdefault(h.currency, [ZERO, ZERO])
                total[0] += cost
                total[1] += market_value
        if cost is None and h.cost_basis is not None and to_listing is not None:
            cost = h.cost_basis * to_listing
            average = cost / h.quantity if h.quantity else ZERO
        snapshot.positions.append(PositionPnL(
            h.account_id, h.symbol, h.currency, h.quantity, average, cost,
            price, market_value, pnl, pct, h.first_buy_at, quote_as_of, status, h.incomplete_history,
            h.source, cost_currency=h.cost_currency, settled_cost_basis=h.cost_basis, realized_pnl=h.realized_pnl,
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
    holdings: list[Holding], transactions: list[Transaction] | list[LedgerRow],
    closes: dict[str, dict[date, Decimal]],
) -> list[tuple[date, Decimal]]:
    """Daily market value of today's holdings, replayed backwards through the stored ledger.

    See `_Replay` for how a holding's quantity on a past day is worked out. Values use each
    symbol's close, carried forward over days it didn't trade. A symbol counts from its first close.
    """
    replay = _Replay(holdings, _rows(transactions))
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
    """A holding's quantity on a past day: the stored equity trades and splits up to that day, plus
    the part of today's (reconciled) quantity they don't explain.

    That unexplained part (shares transferred in, or bought before the sync lookback) only counts
    from when it can have arrived: its first stored non-trade activity with a quantity (a transfer
    row), else the account's first stored activity. Before that the account has no history we know
    of, so nothing is shown as held. An account with no stored activity at all keeps today's
    quantity throughout. Option trades and expiries on the same symbol are not shares.
    """

    def __init__(self, holdings: list[Holding], rows: list[LedgerRow]):
        self.trades: dict[tuple[int, str], list[tuple[date, Decimal]]] = {}
        self.first_activity: dict[int, date] = {}
        moved_in: dict[tuple[int, str], date] = {}
        for r in rows:
            day = r.txn.trade_date.date()
            self.first_activity[r.account_id] = min(self.first_activity.get(r.account_id, day), day)
            if not r.symbol:
                continue
            key = (r.account_id, r.symbol)
            if r.type in (RowType.EQUITY_TRADE, RowType.CORPORATE_ACTION):
                self.trades.setdefault(key, []).append((day, r.shares))
            elif r.type == RowType.OTHER and r.txn.quantity:
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


def _cash_flows(rows: list[LedgerRow]) -> tuple[dict[tuple[int, str], Decimal], dict[tuple[int, str], date]]:
    """Inferred opening cash per (account, currency): the deepest end-of-day shortfall of the stored
    ledger, and the first day it went short. End of day, so a deposit stamped after the buys it funded
    the same day doesn't count as a shortfall."""
    daily: dict[tuple[int, str], dict[date, Decimal]] = {}
    for r in rows:
        if r.currency:
            days = daily.setdefault((r.account_id, r.currency), {})
            day = r.txn.trade_date.date()
            days[day] = days.get(day, ZERO) + r.cash
    opening, negative_on = {}, {}
    for key, days in daily.items():
        running, lowest = ZERO, ZERO
        for day in sorted(days):
            running += days[day]
            if running <= -CASH_TOLERANCE and key not in negative_on:
                negative_on[key] = day
            lowest = min(lowest, running)
        if lowest <= -CASH_TOLERANCE:
            opening[key] = -lowest
    return opening, negative_on


def cash_balances(
    transactions: list[Transaction] | list[LedgerRow], holdings: list[Holding] = (),
) -> list[CashBalance]:
    """Cash per account and currency: the sum of every stored activity's signed cash effect
    (buys, fees and withdrawals negative; sells, deposits, dividends and interest positive; corporate
    actions and option expiries move shares, not cash).

    When the stored ledger alone runs below zero, cash held before it (or margin) must have covered
    the shortfall: that is reported as `opening` but not added, since a margin account may really be
    negative. The balance is flagged estimated then, and when the account's oldest activity day has no deposit (history older than the sync
    lookback, or an account transferred in), when an activity had no currency, or when a holding
    sold more than its stored buys cover.
    """
    rows = _rows(transactions)
    sums: dict[tuple[int, str], Decimal] = {}
    first_day: dict[int, date] = {}
    first_deposit: dict[int, date] = {}
    unsure = {h.account_id for h in holdings if h.incomplete_history}
    for r in rows:
        day = r.txn.trade_date.date()
        first_day[r.account_id] = min(first_day.get(r.account_id, day), day)
        if r.type == RowType.DEPOSIT:
            first_deposit[r.account_id] = min(first_deposit.get(r.account_id, day), day)
        if not r.currency:
            unsure.add(r.account_id)
            continue
        key = (r.account_id, r.currency)
        sums[key] = sums.get(key, ZERO) + r.cash
    unsure |= {a for a, day in first_day.items() if first_deposit.get(a) != day}
    opening, negative_on = _cash_flows(rows)
    balances = []
    for (a, c), amount in sorted(sums.items()):
        extra = opening.get((a, c), ZERO)
        if abs(amount) >= CASH_TOLERANCE:
            balances.append(CashBalance(a, c, amount, a in unsure or bool(extra), extra, negative_on.get((a, c))))
    return balances


def summarize_accounts(
    positions: list[PositionPnL], cash: list[CashBalance], rates: dict[str, Decimal],
    options: list[OptionPosition] = (),
) -> list[AccountSummary]:
    """Per-account holdings value, P&L, open options (at cost) and cash in the base currency at the
    given spot rates."""
    open_options = [o for o in options if o.contracts > 0]
    summaries = []
    accounts = {p.account_id for p in positions} | {c.account_id for c in cash} | {o.account_id for o in open_options}
    for account_id in sorted(accounts):
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
        for o in open_options:
            if o.account_id != account_id:
                continue
            rate = rates.get(o.currency.upper())
            if rate is None:
                s.complete = False
            else:
                s.options_value += o.cost * rate
        s.unrealized_pct = _pct(s.unrealized_pnl, s.cost_basis)
        s.total = s.market_value + s.cash_value + s.options_value
        summaries.append(s)
    return summaries


@dataclass
class AccountPerformance:
    """Where an account's balance came from, in the base currency at spot FX.

    pnl_from_balance (balance - net deposits - opening value) must equal pnl_from_parts
    (unrealized + realized + income + other cash) when the ledger is complete; `gap` is the difference.
    """
    account_id: int
    balance: Decimal = ZERO
    holdings_value: Decimal = ZERO
    options_value: Decimal = ZERO
    cash_value: Decimal = ZERO
    net_deposits: Decimal = ZERO
    opening_value: Decimal = ZERO  # shares inferred to predate the stored history, at their average cost
    unrealized: Decimal = ZERO
    realized_equity: Decimal = ZERO
    realized_options: Decimal = ZERO
    dividends: Decimal = ZERO
    interest: Decimal = ZERO
    fees: Decimal = ZERO  # fees and withholding tax, negative
    other: Decimal = ZERO  # FX conversions and unclassified cash movements
    pnl_from_balance: Decimal = ZERO
    pnl_from_parts: Decimal = ZERO
    gap: Decimal = ZERO
    complete: bool = True  # False when a currency had no FX rate and was left out
    checks: list[Check] = field(default_factory=list)

    @property
    def income(self) -> Decimal:
        return self.dividends + self.interest + self.fees


_FLOW_FIELDS = {
    RowType.DEPOSIT: "net_deposits", RowType.WITHDRAWAL: "net_deposits",
    RowType.DIVIDEND: "dividends", RowType.INTEREST: "interest", RowType.FEE: "fees",
    RowType.FX_CONVERSION: "other", RowType.OTHER: "other",
}


def summarize_performance(
    transactions: list[Transaction] | list[LedgerRow], accounts: list[AccountSummary], holdings: list[Holding],
    options: list[OptionPosition], rates: dict[str, Decimal], extra_checks: list[Check] = (),
) -> list[AccountPerformance]:
    """Per-account balance, deposits, realized/unrealized P&L and income, with the validation checklist.

    `accounts` are summarize_accounts' output (balance, unrealized). Realized equity P&L includes
    positions closed since; option P&L is premiums. Everything is at today's spot `rates`.
    """
    rows = _rows(transactions)
    perf: dict[int, AccountPerformance] = {}

    def get(account_id: int) -> AccountPerformance:
        return perf.setdefault(account_id, AccountPerformance(account_id))

    def add(p: AccountPerformance, name: str, amount: Decimal, currency: str) -> None:
        rate = rates.get(currency.upper())
        if rate is None:
            if amount:
                p.complete = False
            return
        setattr(p, name, getattr(p, name) + amount * rate)

    for r in rows:
        name = _FLOW_FIELDS.get(r.type)
        if name and r.cash:
            add(get(r.account_id), name, r.cash, r.currency)
    for (account_id, currency), amount in realized_by_account(rows).items():
        add(get(account_id), "realized_equity", amount, currency)
    for o in options:
        add(get(o.account_id), "realized_options", o.realized_pnl, o.currency)
    for a in accounts:
        p = get(a.account_id)
        p.balance, p.holdings_value, p.options_value, p.cash_value = a.total, a.market_value, a.options_value, a.cash_value
        p.unrealized = a.unrealized_pnl
        p.complete = p.complete and a.complete
        for c in a.cash:
            if c.negative_on:
                p.checks.append(Check(
                    "negative_cash", a.account_id,
                    f"The stored ledger leaves {c.currency} cash below zero from this day: at least "
                    f"{c.opening:.2f} {c.currency} was held before it (missing opening balance) or borrowed on margin",
                    day=c.negative_on))
    for h in holdings:
        p = get(h.account_id)
        if h.opening_shares and h.average_cost is not None:
            add(p, "opening_value", h.opening_shares * h.average_cost, h.cost_currency)
            p.checks.append(Check(
                "opening_shares_inferred", h.account_id,
                f"{_fmt(h.opening_shares)} shares were held before the stored history (from dividends)",
                h.symbol, severity="info"))
        if h.incomplete_history:
            p.checks.append(Check(
                "negative_shares", h.account_id, "Sold or split more shares than the stored trades hold", h.symbol))
        explained = h.ledger_quantity is not None and abs(h.ledger_quantity + h.opening_shares - h.quantity) < QUANTITY_TOLERANCE
        if h.source == "broker" and not explained:
            if h.ledger_quantity is None:
                message = f"The broker holds {_fmt(h.quantity)} shares with no stored trades (transfer or older history)"
            else:
                message = f"Stored trades give {_fmt(h.ledger_quantity)} shares, the broker holds {_fmt(h.quantity)}"
            p.checks.append(Check("broker_quantity_mismatch", h.account_id, message, h.symbol))
    for c in extra_checks:
        get(c.account_id).checks.append(c)
    for p in perf.values():
        p.pnl_from_balance = p.balance - p.net_deposits - p.opening_value
        p.pnl_from_parts = (p.unrealized + p.realized_equity + p.realized_options + p.dividends + p.interest
                            + p.fees + p.other)
        p.gap = p.pnl_from_balance - p.pnl_from_parts
        if abs(p.gap) > max(Decimal(1), abs(p.balance) * Decimal("0.005")):
            p.checks.append(Check(
                "pnl_identity_gap", p.account_id,
                f"Balance minus deposits differs from unrealized + realized + income by {p.gap:.2f}: a row is "
                "misclassified, history is missing, or costs come from the broker"))
        if not p.complete:
            p.checks.append(Check("missing_fx_rate", p.account_id, "Some amounts had no FX rate and were left out"))
    return [perf[a] for a in sorted(perf)]


def account_value_history(
    holdings: list[Holding], transactions: list[Transaction] | list[LedgerRow],
    closes: dict[str, dict[date, Decimal]], rates: dict[str, Decimal],
) -> dict[int, list[tuple[date, Decimal]]]:
    """Daily value of each account in the base currency: today's holdings replayed backwards through
    the stored trades (as in value_history), plus the cash its stored activity had built up by then.

    Everything is converted at today's spot `rates`; holdings and cash in a currency without a rate
    are left out. `transactions` is the whole ledger (cash comes from every kind of activity). An
    account's series starts at its first stored activity: there is nothing to show before it.
    """
    rows = _rows(transactions)
    replay = _Replay(holdings, rows)
    flows: dict[int, list[tuple[date, Decimal]]] = {}
    for r in rows:
        rate = rates.get(r.currency)
        if rate is not None:
            flows.setdefault(r.account_id, []).append((r.txn.trade_date.date(), r.cash * rate))
    cash_days: dict[int, list[date]] = {}
    cash_sums: dict[int, list[Decimal]] = {}
    for account_id, flow in flows.items():
        flow.sort(key=lambda f: f[0])
        running, sums = ZERO, []
        for _, amount in flow:
            running += amount
            sums.append(running)
        cash_days[account_id], cash_sums[account_id] = [d for d, _ in flow], sums

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

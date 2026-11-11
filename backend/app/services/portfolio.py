from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.account import AccountRecord
from app.models.position import Position
from app.models.transaction import Transaction
from app.services.currency import FxProvider
from app.services.ledger import LedgerRow, RowType, normalize
from app.services.market_data import QuoteProvider
from app.services.performance import (
    ZERO, CashBalance, Check, Holding, OptionPosition, PnLSnapshot, cash_balances, compute_holdings, compute_options,
    compute_pnl, convert_totals, infer_opening_shares, reconcile, summarize_accounts,
)


def _counted(user_id: int):
    """The user's live, non-duplicate accounts."""
    return (
        select(AccountRecord.id)
        .where(AccountRecord.user_id == user_id, AccountRecord.removed_at.is_(None),
               AccountRecord.duplicate_of_id.is_(None))
    )


def load_ledger(db: Session, user_id: int) -> list[Transaction]:
    """Every stored activity in the user's counted accounts (cash comes from all kinds)."""
    return list(db.scalars(select(Transaction).where(Transaction.account_id.in_(_counted(user_id)))))


def reconciled_holdings(
    db: Session, user_id: int, ledger: list[Transaction] | list[LedgerRow],
) -> tuple[list[Holding], list[Transaction]]:
    """Holdings from the ledger's equity trades, reconciled against the broker snapshot; and those trades."""
    rows = ledger if all(isinstance(r, LedgerRow) for r in ledger) else normalize(ledger)
    opening, _ = infer_opening_shares(rows)
    snapshot = db.scalars(select(Position).where(Position.account_id.in_(_counted(user_id)))).all()
    trades = [r.txn for r in rows if r.type == RowType.EQUITY_TRADE]
    return reconcile(compute_holdings(rows), list(snapshot), opening), trades


def load_trades(db: Session, user_id: int) -> tuple[list[Holding], list[Transaction]]:
    """Reconciled holdings in the user's counted accounts, and the trades behind them."""
    return reconciled_holdings(db, user_id, load_ledger(db, user_id))


def load_holdings(db: Session, user_id: int) -> list[Holding]:
    return load_trades(db, user_id)[0]


@dataclass
class Book:
    """Everything derived from the stored ledger and the broker snapshot, before pricing."""
    rows: list[LedgerRow]
    holdings: list[Holding]
    cash: list[CashBalance]
    options: list[OptionPosition]
    checks: list[Check] = field(default_factory=list)


def load_book(db: Session, user_id: int) -> Book:
    rows = normalize(load_ledger(db, user_id))
    holdings, _ = reconciled_holdings(db, user_id, rows)
    _, checks = infer_opening_shares(rows)
    return Book(rows, holdings, cash_balances(rows, holdings), compute_options(rows), checks)


def load_portfolio(db: Session, user_id: int) -> tuple[list[Holding], list[CashBalance], list[OptionPosition]]:
    """Reconciled holdings, the cash computed from the stored ledger, and option positions."""
    book = load_book(db, user_id)
    return book.holdings, book.cash, book.options


async def build_pnl(
    holdings: list[Holding], provider: QuoteProvider, fx: FxProvider | None = None,
    base: str | None = None, cash: list[CashBalance] | None = None, options: list[OptionPosition] | None = None,
) -> PnLSnapshot:
    """Price the held symbols (deduplicated across accounts) and compute unrealized P&L.

    With an FX provider, costs paid in another currency than the listing's are converted at spot,
    the per-currency totals are rolled up into `base` at spot, and each account (holdings plus `cash`
    and open `options` at cost) is summarized in `base`.
    """
    cash = cash or []
    options = [o for o in options or [] if o.contracts > 0]
    symbols = sorted({h.symbol for h in holdings})
    quotes = await provider.get_quotes(symbols) if holdings else {}
    currencies = ({h.currency for h in holdings} | {h.cost_currency for h in holdings} | {c.currency for c in cash}
                  | {o.currency for o in options}) - {""}
    rates = {}
    if fx is not None and currencies:
        base = (base or settings.BASE_CURRENCY).upper()
        rates = await fx.get_rates(sorted(currencies), base)
    snapshot = compute_pnl(holdings, quotes, datetime.now(timezone.utc).replace(tzinfo=None), rates)
    classes = await provider.get_asset_classes(symbols) if holdings else {}
    for p in snapshot.positions:
        p.asset_class = classes.get(p.symbol, "other")
    if fx is not None and currencies:
        snapshot.base_currency = base
        snapshot.fx_rates = rates
        if snapshot.totals:
            snapshot.base_total = convert_totals(snapshot.totals, rates, base)
        snapshot.accounts = summarize_accounts(snapshot.positions, cash, rates, options)
        if all(a.complete for a in snapshot.accounts):
            snapshot.cash_base = sum((a.cash_value for a in snapshot.accounts), ZERO)
            snapshot.total_assets_base = sum((a.total for a in snapshot.accounts), ZERO)
    return snapshot

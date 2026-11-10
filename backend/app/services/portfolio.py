from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.account import AccountRecord
from app.models.position import Position
from app.models.transaction import Transaction, TransactionKind
from app.services.currency import FxProvider
from app.services.market_data import QuoteProvider
from app.services.performance import (
    ZERO, CashBalance, Holding, PnLSnapshot, cash_balances, compute_holdings, compute_pnl, convert_totals, reconcile,
    summarize_accounts,
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
    db: Session, user_id: int, ledger: list[Transaction],
) -> tuple[list[Holding], list[Transaction]]:
    """Holdings from the ledger's trades, reconciled against the broker snapshot; and those trades."""
    trades = [t for t in ledger if t.kind in (TransactionKind.BUY, TransactionKind.SELL)]
    snapshot = db.scalars(select(Position).where(Position.account_id.in_(_counted(user_id)))).all()
    return reconcile(compute_holdings(trades), list(snapshot)), trades


def load_trades(db: Session, user_id: int) -> tuple[list[Holding], list[Transaction]]:
    """Reconciled holdings in the user's counted accounts, and the trades behind them."""
    return reconciled_holdings(db, user_id, load_ledger(db, user_id))


def load_holdings(db: Session, user_id: int) -> list[Holding]:
    return load_trades(db, user_id)[0]


def load_portfolio(db: Session, user_id: int) -> tuple[list[Holding], list[CashBalance]]:
    """Reconciled holdings plus the cash computed from the stored ledger."""
    ledger = load_ledger(db, user_id)
    holdings, _ = reconciled_holdings(db, user_id, ledger)
    return holdings, cash_balances(ledger, holdings)


async def build_pnl(
    holdings: list[Holding], provider: QuoteProvider, fx: FxProvider | None = None,
    base: str | None = None, cash: list[CashBalance] | None = None,
) -> PnLSnapshot:
    """Price the held symbols (deduplicated across accounts) and compute unrealized P&L.

    With an FX provider, the per-currency totals are also rolled up into `base` at spot, and each
    account (holdings plus `cash`) is summarized in `base`.
    """
    cash = cash or []
    symbols = sorted({h.symbol for h in holdings})
    quotes = await provider.get_quotes(symbols) if holdings else {}
    snapshot = compute_pnl(holdings, quotes, datetime.now(timezone.utc).replace(tzinfo=None))
    classes = await provider.get_asset_classes(symbols) if holdings else {}
    for p in snapshot.positions:
        p.asset_class = classes.get(p.symbol, "other")
    currencies = {p.currency for p in snapshot.positions if p.market_value is not None} | {c.currency for c in cash}
    if fx is not None and currencies:
        base = (base or settings.BASE_CURRENCY).upper()
        snapshot.base_currency = base
        snapshot.fx_rates = await fx.get_rates(sorted(currencies), base)
        if snapshot.totals:
            snapshot.base_total = convert_totals(snapshot.totals, snapshot.fx_rates, base)
        snapshot.accounts = summarize_accounts(snapshot.positions, cash, snapshot.fx_rates)
        if all(a.complete for a in snapshot.accounts):
            snapshot.cash_base = sum((a.cash_value for a in snapshot.accounts), ZERO)
            snapshot.total_assets_base = sum((a.total for a in snapshot.accounts), ZERO)
    return snapshot

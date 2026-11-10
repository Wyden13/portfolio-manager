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
    Holding, PnLSnapshot, compute_holdings, compute_pnl, convert_totals, reconcile,
)


def load_trades(db: Session, user_id: int) -> tuple[list[Holding], list[Transaction]]:
    """Reconciled holdings in the user's live, non-duplicate accounts, and the trades behind them."""
    counted = (
        select(AccountRecord.id)
        .where(AccountRecord.user_id == user_id, AccountRecord.removed_at.is_(None),
               AccountRecord.duplicate_of_id.is_(None))
    )
    transactions = list(db.scalars(
        select(Transaction).where(
            Transaction.account_id.in_(counted),
            Transaction.kind.in_([TransactionKind.BUY.value, TransactionKind.SELL.value]),
        )
    ))
    snapshot = db.scalars(select(Position).where(Position.account_id.in_(counted))).all()
    return reconcile(compute_holdings(transactions), list(snapshot)), transactions


def load_holdings(db: Session, user_id: int) -> list[Holding]:
    return load_trades(db, user_id)[0]


async def build_pnl(
    holdings: list[Holding], provider: QuoteProvider, fx: FxProvider | None = None,
    base: str | None = None,
) -> PnLSnapshot:
    """Price the held symbols (deduplicated across accounts) and compute unrealized P&L.

    With an FX provider, the per-currency totals are also rolled up into `base` at spot.
    """
    quotes = await provider.get_quotes(sorted({h.symbol for h in holdings})) if holdings else {}
    snapshot = compute_pnl(holdings, quotes, datetime.now(timezone.utc).replace(tzinfo=None))
    if fx is not None and snapshot.totals:
        base = (base or settings.BASE_CURRENCY).upper()
        snapshot.fx_rates = await fx.get_rates([t.currency for t in snapshot.totals], base)
        snapshot.base_total = convert_totals(snapshot.totals, snapshot.fx_rates, base)
    return snapshot

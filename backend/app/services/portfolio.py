from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.account import AccountRecord
from app.models.transaction import Transaction, TransactionKind
from app.services.market_data import QuoteProvider
from app.services.performance import PnLSnapshot, Holding, compute_holdings, compute_pnl


def load_holdings(db: Session, user_id: int) -> list[Holding]:
    transactions = db.scalars(
        select(Transaction)
        .join(AccountRecord, Transaction.account_id == AccountRecord.id)
        .where(
            AccountRecord.user_id == user_id,
            Transaction.kind.in_([TransactionKind.BUY.value, TransactionKind.SELL.value]),
        )
    ).all()
    return compute_holdings(list(transactions))


async def build_pnl(holdings: list[Holding], provider: QuoteProvider) -> PnLSnapshot:
    """Price the held symbols (deduplicated across accounts) and compute unrealized P&L."""
    quotes = await provider.get_quotes(sorted({h.symbol for h in holdings})) if holdings else {}
    return compute_pnl(holdings, quotes, datetime.now(timezone.utc).replace(tzinfo=None))

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.accounts import current_user_id
from app.database import get_db
from app.models.account import AccountRecord
from app.models.transaction import Transaction

router = APIRouter(prefix="/api")


@router.get("/transactions")
def list_transactions(
    account_id: int | None = None,
    symbol: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    query = (
        select(Transaction)
        .join(AccountRecord, Transaction.account_id == AccountRecord.id)
        .where(AccountRecord.user_id == user_id)
        .order_by(Transaction.trade_date.desc(), Transaction.id.desc())
        .limit(limit).offset(offset)
    )
    if account_id is not None:
        query = query.where(Transaction.account_id == account_id)
    if symbol:
        query = query.where(Transaction.symbol == symbol)
    return [
        {
            "id": t.id, "account_id": t.account_id, "kind": t.kind, "symbol": t.symbol,
            "trade_date": t.trade_date.isoformat(), "quantity": float(t.quantity),
            "price": float(t.price), "fee": float(t.fee), "net_amount": float(t.net_amount),
            "currency": t.currency, "description": t.description,
        }
        for t in db.scalars(query)
    ]

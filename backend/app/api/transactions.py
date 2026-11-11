import csv
import io
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.api.accounts import current_user_id
from app.database import get_db
from app.models.account import AccountRecord
from app.models.transaction import Transaction, TransactionKind

router = APIRouter(prefix="/api")

CSV_COLUMNS = [
    "trade_date", "institution", "account_type", "account_number", "kind", "symbol", "quantity",
    "price", "fee", "gross_amount", "net_amount", "currency", "description",
]


def mask_number(number: str) -> str:
    return f"••{number[-4:]}" if len(number) > 4 else number


class LedgerFilters:
    """Query filters shared by the JSON and CSV ledger. Each list filter matches any of its values."""

    def __init__(
        self,
        institution: list[str] | None = Query(None),
        account_id: list[int] | None = Query(None),
        kind: list[TransactionKind] | None = Query(None),
        symbol: str | None = None,
        start: date | None = None,
        end: date | None = None,
    ):
        self.institution, self.account_id, self.kind = institution, account_id, kind
        self.symbol, self.start, self.end = symbol, start, end

    def apply(self, query: Select, user_id: int) -> Select:
        # Duplicate (aggregator-mirrored) accounts would show every row twice; removed accounts
        # keep their history.
        query = query.where(AccountRecord.user_id == user_id, AccountRecord.duplicate_of_id.is_(None))
        if self.institution:
            query = query.where(AccountRecord.institution.in_(self.institution))
        if self.account_id:
            query = query.where(Transaction.account_id.in_(self.account_id))
        if self.kind:
            query = query.where(Transaction.kind.in_([k.value for k in self.kind]))
        if self.symbol:
            query = query.where(func.upper(Transaction.symbol) == self.symbol.upper())
        if self.start:
            query = query.where(Transaction.trade_date >= self.start)
        if self.end:
            query = query.where(Transaction.trade_date < self.end + timedelta(days=1))
        return query


def _rows(db: Session, user_id: int, filters: LedgerFilters, limit: int | None = None, offset: int = 0):
    query = filters.apply(
        select(Transaction, AccountRecord).join(AccountRecord, Transaction.account_id == AccountRecord.id),
        user_id,
    ).order_by(Transaction.trade_date.desc(), Transaction.id.desc()).offset(offset)
    if limit is not None:
        query = query.limit(limit)
    return db.execute(query).all()


def _plain(value: Decimal) -> str:
    """Exact decimal without trailing zeros or exponent (10.50000000 -> 10.5)."""
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


@router.get("/transactions")
def list_transactions(
    filters: LedgerFilters = Depends(),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    """All institutions' transactions in one ledger, newest first."""
    total = db.scalar(filters.apply(
        select(func.count(Transaction.id)).join(AccountRecord, Transaction.account_id == AccountRecord.id),
        user_id,
    ))
    items = [
        {
            "id": t.id, "account_id": t.account_id, "institution": a.institution, "platform": a.platform,
            "account_type": a.account_type, "account_number": mask_number(a.account_number),
            "kind": t.kind, "symbol": t.symbol, "trade_date": t.trade_date.isoformat(),
            "quantity": float(t.quantity), "price": float(t.price), "fee": float(t.fee),
            "gross_amount": float(t.gross_amount), "net_amount": float(t.net_amount),
            "currency": t.currency, "description": t.description,
        }
        for t, a in _rows(db, user_id, filters, limit, offset)
    ]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/transactions.csv")
def export_transactions(
    filters: LedgerFilters = Depends(),
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    """Every transaction matching the filters, as CSV with exact decimals."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)
    for t, a in _rows(db, user_id, filters):
        writer.writerow([
            t.trade_date.date().isoformat(), a.institution, a.account_type, mask_number(a.account_number),
            t.kind, t.symbol or "", _plain(t.quantity), _plain(t.price), _plain(t.fee),
            _plain(t.gross_amount), _plain(t.net_amount), t.currency, t.description,
        ])
    return StreamingResponse(
        iter([buffer.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="investiq-ledger.csv"'},
    )


@router.get("/ledger/accounts")
def ledger_accounts(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    """Stored accounts across institutions, for the ledger's filters."""
    accounts = db.scalars(
        select(AccountRecord)
        .where(AccountRecord.user_id == user_id, AccountRecord.duplicate_of_id.is_(None))
        .order_by(AccountRecord.institution, AccountRecord.account_type, AccountRecord.id)
    )
    return [
        {
            "id": a.id, "institution": a.institution, "platform": a.platform, "account_type": a.account_type,
            "account_number": mask_number(a.account_number), "removed": a.removed_at is not None,
        }
        for a in accounts
    ]

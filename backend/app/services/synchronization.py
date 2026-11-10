from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.integrations.base import BrokerageAdapter
from app.models.account import AccountRecord
from app.models.position import Position
from app.models.transaction import Transaction

# Re-fetch this much before the newest stored transaction. Upserts make the overlap harmless
# and it covers activities the broker back-fills late.
SYNC_OVERLAP = timedelta(days=1)


@dataclass
class SyncResult:
    accounts: int = 0
    transactions_added: int = 0
    positions: int = 0


def _upsert_account(db: Session, account) -> AccountRecord:
    record = db.scalar(select(AccountRecord).filter_by(
        user_id=account.user_id, platform=account.platform, account_number=account.account_number))
    if record is None:
        record = AccountRecord(user_id=account.user_id, platform=account.platform,
                               account_number=account.account_number)
        db.add(record)
    record.external_id = str(account.account_id)
    record.account_type = account.account_type
    record.status = account.status.value
    record.is_primary = account.is_primary
    record.client_account_type = account.client_account_type
    db.flush()
    return record


def _sync_positions(db: Session, record: AccountRecord, raw_positions) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    existing = {p.symbol: p for p in db.scalars(select(Position).filter_by(account_id=record.id))}
    current = {p.symbol: p for p in raw_positions}
    for symbol, position in existing.items():
        if symbol not in current:
            db.delete(position)  # no longer held
    for symbol, raw in current.items():
        row = existing.get(symbol) or Position(account_id=record.id, symbol=symbol)
        row.quantity, row.average_cost, row.currency, row.synced_at = (
            raw.quantity, raw.average_cost, raw.currency, now)
        db.add(row)


def _sync_transactions(db: Session, record: AccountRecord, raw_transactions) -> int:
    ids = [t.external_id for t in raw_transactions]
    known = set(db.scalars(
        select(Transaction.external_id).where(
            Transaction.account_id == record.id, Transaction.external_id.in_(ids))
    )) if ids else set()
    added = 0
    for raw in raw_transactions:
        if raw.external_id in known:
            continue
        known.add(raw.external_id)  # guards duplicates within one batch too
        db.add(Transaction(
            account_id=record.id, external_id=raw.external_id, kind=raw.kind.value, symbol=raw.symbol,
            trade_date=raw.trade_date, quantity=raw.quantity, price=raw.price,
            gross_amount=raw.gross_amount, fee=raw.fee, net_amount=raw.net_amount,
            currency=raw.currency, raw_type=raw.raw_type, description=raw.description,
        ))
        added += 1
    return added


async def sync_connection(db: Session, adapter: BrokerageAdapter) -> SyncResult:
    """Pull accounts, positions and new transactions from the broker into the database."""
    result = SyncResult()
    for account in await adapter.get_accounts():
        record = _upsert_account(db, account)
        result.accounts += 1

        raw_positions = await adapter.get_positions(record.external_id)
        _sync_positions(db, record, raw_positions)
        result.positions += len(raw_positions)

        latest = db.scalar(select(func.max(Transaction.trade_date)).filter_by(account_id=record.id))
        start = latest - SYNC_OVERLAP if latest else None
        result.transactions_added += _sync_transactions(
            db, record, await adapter.get_transactions(record.external_id, start=start))
        db.commit()
    return result

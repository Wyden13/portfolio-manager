import asyncio
import contextlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.integrations.base import BrokerageAdapter, ReauthRequired
from app.models.account import AccountRecord
from app.models.connection import BrokerConnection, ConnectionStatus
from app.models.position import Position
from app.models.transaction import Transaction

# Re-fetch this much before the previous sync's end. Inserts skip known ids, so the overlap is
# harmless, and it picks up activities the broker posts late (e.g. after settlement).
SYNC_OVERLAP = timedelta(days=7)

# Aggregators whose accounts may mirror a directly connected one.
AGGREGATORS = ("snaptrade",)

# One sync per connection at a time (single process). Concurrent syncs would insert the same
# transactions twice and race Questrade's single-use refresh token.
_locks: dict[int, asyncio.Lock] = {}


class SyncInProgress(Exception):
    pass


@dataclass
class SyncResult:
    accounts: int = 0
    transactions_added: int = 0
    positions: int = 0


@contextlib.asynccontextmanager
async def connection_lock(connection: BrokerConnection):
    """Hold the connection's sync lock; SyncInProgress if a sync (or disconnect) already holds it."""
    lock = _locks.setdefault(connection.id, asyncio.Lock())
    if lock.locked():
        raise SyncInProgress(f"{connection.platform} sync already running")
    async with lock:
        yield


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _upsert_account(db: Session, account, record: AccountRecord | None) -> AccountRecord:
    if record is None:
        record = AccountRecord(user_id=account.user_id, platform=account.platform,
                               external_id=str(account.account_id))
        db.add(record)
    record.account_number = account.account_number
    record.account_type = account.account_type
    record.status = account.status.value
    record.is_primary = account.is_primary
    record.client_account_type = account.client_account_type
    record.institution = account.institution
    record.removed_at = None
    db.flush()
    return record


def _sync_positions(db: Session, record: AccountRecord, raw_positions, now: datetime) -> None:
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


def _normalize_number(value: str) -> str:
    return "".join(c for c in value if c.isalnum()).upper()


def mark_duplicates(db: Session, user_id: int) -> None:
    """Flag aggregator accounts that mirror a direct connection (same institution and number)."""
    accounts = db.scalars(select(AccountRecord).filter_by(user_id=user_id, removed_at=None)).all()
    direct = {
        (a.institution.casefold(), _normalize_number(a.account_number)): a.id
        for a in accounts if a.platform not in AGGREGATORS and a.institution
    }
    for a in accounts:
        if a.platform in AGGREGATORS:
            a.duplicate_of_id = direct.get((a.institution.casefold(), _normalize_number(a.account_number)))


async def sync_connection(db: Session, connection: BrokerConnection, adapter: BrokerageAdapter) -> SyncResult:
    """Pull accounts, positions and new transactions from the broker into the database.

    All broker calls for an account happen before its writes, so the session holds no pending
    changes while the adapter may commit a rotated token. Each account commits on its own.
    """
    result = SyncResult()
    now = _utcnow()
    seen: set[int] = set()
    for account in await adapter.get_accounts():
        external_id = str(account.account_id)
        record = db.scalar(select(AccountRecord).filter_by(
            user_id=connection.user_id, platform=adapter.platform, external_id=external_id))
        synced_through = record.transactions_synced_through if record else None
        start = synced_through - SYNC_OVERLAP if synced_through else None

        raw_positions = await adapter.get_positions(external_id)
        raw_transactions = await adapter.get_transactions(external_id, start=start, end=now)

        record = _upsert_account(db, account, record)
        _sync_positions(db, record, raw_positions, now)
        result.transactions_added += _sync_transactions(db, record, raw_transactions)
        record.transactions_synced_through = now
        db.commit()
        seen.add(record.id)
        result.accounts += 1
        result.positions += len(raw_positions)

    for record in db.scalars(select(AccountRecord).filter_by(
            user_id=connection.user_id, platform=adapter.platform, removed_at=None)):
        if record.id not in seen:
            record.removed_at = now
    mark_duplicates(db, connection.user_id)
    db.commit()
    return result


async def run_sync(db: Session, connection: BrokerConnection, adapter: BrokerageAdapter) -> SyncResult:
    """sync_connection plus the connection's state transitions, one sync per connection at a time.

    pending/active/error --sync ok--> active (pending while no account is linked)
                         --credentials rejected--> needs_reauth (left by connecting again)
                         --other failure--> error
    """
    async with connection_lock(connection):
        try:
            result = await sync_connection(db, connection, adapter)
        except ReauthRequired as exc:
            db.rollback()
            connection.status, connection.last_error = ConnectionStatus.NEEDS_REAUTH.value, str(exc)
            db.commit()
            raise
        except Exception as exc:
            db.rollback()
            connection.status, connection.last_error = ConnectionStatus.ERROR.value, repr(exc)[:500]
            db.commit()
            raise
        connection.status = (ConnectionStatus.ACTIVE if result.accounts else ConnectionStatus.PENDING).value
        connection.last_error = None
        connection.last_synced_at = _utcnow()
        db.commit()
        return result

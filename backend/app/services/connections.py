from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models.account import AccountRecord
from app.models.connection import BrokerConnection, ConnectionStatus
from app.models.position import Position
from app.models.transaction import Transaction


def delete_accounts(db: Session, records: list[AccountRecord]) -> None:
    """Delete accounts with their transactions and positions (not committed).

    Aggregator accounts that mirrored one of them stop being duplicates, so they count again.
    """
    ids = [r.id for r in records]
    if not ids:
        return
    db.execute(update(AccountRecord).where(AccountRecord.duplicate_of_id.in_(ids)).values(duplicate_of_id=None))
    db.execute(delete(Transaction).where(Transaction.account_id.in_(ids)))
    db.execute(delete(Position).where(Position.account_id.in_(ids)))
    db.execute(delete(AccountRecord).where(AccountRecord.id.in_(ids)))


def _accounts(db: Session, connection: BrokerConnection, institution: str | None = None) -> list[AccountRecord]:
    query = select(AccountRecord).filter_by(user_id=connection.user_id, platform=connection.platform)
    if institution is not None:
        query = query.filter_by(institution=institution)
    return list(db.scalars(query))


def disconnect(db: Session, connection: BrokerConnection) -> None:
    """Forget the connection's credentials and everything synced through it."""
    delete_accounts(db, _accounts(db, connection))
    db.delete(connection)
    db.commit()


def disconnect_institution(db: Session, connection: BrokerConnection, institution: str) -> None:
    """Delete one institution's synced data from an aggregator connection, which stays registered."""
    delete_accounts(db, _accounts(db, connection, institution))
    if not _accounts(db, connection):
        connection.status = ConnectionStatus.PENDING.value
        connection.last_error = None
    db.commit()

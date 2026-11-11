import asyncio
import logging

import httpx
from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.integrations import questrade, snaptrade
from app.integrations.questrade import QuestradeAdapter
from app.integrations.snaptrade import SnapTradeAdapter
from app.models.connection import BrokerConnection, ConnectionStatus
from app.services.synchronization import SyncInProgress, run_sync

log = logging.getLogger(__name__)

# needs_reauth connections are skipped: only the user connecting again can fix them.
SCHEDULED_STATUSES = (ConnectionStatus.PENDING.value, ConnectionStatus.ACTIVE.value, ConnectionStatus.ERROR.value)


async def sync_all(session_factory=SessionLocal, snaptrade_client_factory=snaptrade.make_client) -> None:
    """Sync every schedulable connection once. A failing connection doesn't stop the others."""
    with session_factory() as db:
        ids = db.scalars(select(BrokerConnection.id).where(BrokerConnection.status.in_(SCHEDULED_STATUSES))).all()
    snaptrade_client = None
    async with httpx.AsyncClient() as http:
        for connection_id in ids:
            with session_factory() as db:
                connection = db.get(BrokerConnection, connection_id)
                try:
                    if connection.platform == questrade.PLATFORM:
                        adapter = QuestradeAdapter(connection, db, http)
                    elif connection.platform == snaptrade.PLATFORM:
                        snaptrade_client = snaptrade_client or snaptrade_client_factory()
                        adapter = SnapTradeAdapter(connection, snaptrade_client)
                    else:
                        continue
                    await run_sync(db, connection, adapter)
                except SyncInProgress:
                    pass
                except Exception:
                    # Sync failures are recorded on the connection by run_sync; setup failures
                    # (e.g. SnapTrade keys missing) only show up here.
                    log.exception("scheduled sync of connection %s failed", connection_id)


async def run_scheduler(interval_minutes: float) -> None:
    """Sync everything every interval, starting one interval after startup."""
    while True:
        await asyncio.sleep(interval_minutes * 60)
        try:
            await sync_all()
        except Exception:
            log.exception("scheduled sync pass failed")

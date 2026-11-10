import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.accounts import current_user_id
from app.database import get_db
from app.integrations import questrade, snaptrade
from app.integrations.questrade import QuestradeAdapter
from app.integrations.snaptrade import SnapTradeAdapter
from app.models.connection import BrokerConnection
from app.services.synchronization import sync_connection

router = APIRouter(prefix="/api")


def get_snaptrade_client():
    return snaptrade.make_client()


def _connection(db: Session, user_id: int, platform: str) -> BrokerConnection:
    connection = db.query(BrokerConnection).filter_by(user_id=user_id, platform=platform).one_or_none()
    if connection is None:
        raise HTTPException(status_code=404, detail=f"{platform} is not connected")
    return connection


@router.post("/sync/questrade")
async def sync_questrade(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    connection = _connection(db, user_id, questrade.PLATFORM)
    async with httpx.AsyncClient() as client:
        result = await sync_connection(db, QuestradeAdapter(connection, db, client))
    return vars(result)


@router.post("/snaptrade/connect")
def snaptrade_connect(
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    client=Depends(get_snaptrade_client),
):
    """Register with SnapTrade and return the read-only connection portal URL."""
    connection = snaptrade.register_user(client, db, user_id)
    return {"redirect_uri": snaptrade.portal_url(client, connection)}


@router.post("/sync/snaptrade")
async def sync_snaptrade(
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    client=Depends(get_snaptrade_client),
):
    connection = _connection(db, user_id, snaptrade.PLATFORM)
    return vars(await sync_connection(db, SnapTradeAdapter(connection, client)))

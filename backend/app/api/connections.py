import asyncio
import logging
import re
from itertools import groupby

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from snaptrade_client import ApiException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.accounts import connections_page, current_user_id, get_http_client
from app.api.sync import _connection, get_snaptrade_client
from app.api.transactions import mask_number
from app.config import settings
from app.database import get_db
from app.integrations import questrade, snaptrade
from app.models.account import AccountRecord
from app.models.connection import BrokerConnection
from app.services import connections
from app.services.synchronization import connection_lock

router = APIRouter(prefix="/api")
log = logging.getLogger(__name__)


def _snaptrade_configured() -> bool:
    return bool(settings.SNAPTRADE_CLIENT_ID and settings.SNAPTRADE_CONSUMER_KEY)


def _iso(value) -> str | None:
    return value.isoformat() + "Z" if value else None


@router.get("/connections/overview")
def overview(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    """Each connection with its accounts grouped by institution, plus which sign-in flows are available."""
    accounts = db.scalars(
        select(AccountRecord).where(AccountRecord.user_id == user_id)
        .order_by(AccountRecord.platform, AccountRecord.institution, AccountRecord.account_type, AccountRecord.id)
    ).all()
    by_platform = {p: list(rows) for p, rows in groupby(accounts, key=lambda a: a.platform)}
    return {
        "options": {"questrade_oauth": questrade.oauth_configured(), "snaptrade": _snaptrade_configured()},
        "connections": [
            {
                "platform": c.platform, "status": c.status, "last_error": c.last_error,
                "last_synced_at": _iso(c.last_synced_at),
                "institutions": [
                    {
                        "name": name,
                        "accounts": [
                            {
                                "id": a.id, "account_type": a.account_type,
                                "account_number": mask_number(a.account_number),
                                "removed": a.removed_at is not None, "duplicate": a.duplicate_of_id is not None,
                            }
                            for a in rows
                        ],
                    }
                    for name, rows in groupby(by_platform.get(c.platform, []), key=lambda a: a.institution)
                ],
            }
            for c in db.query(BrokerConnection).filter_by(user_id=user_id).order_by(BrokerConnection.platform)
        ],
    }


def get_optional_snaptrade_client():
    """SnapTrade client, or None when it is not configured (for endpoints that work without it)."""
    return snaptrade.make_client() if _snaptrade_configured() else None


def _norm(value) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def _logo(brokerage) -> str | None:
    url = brokerage.get("aws_s3_square_logo_url") or brokerage.get("aws_s3_logo_url")
    return str(url) if url else None


def _match(brokerages, name: str):
    """The SnapTrade brokerage called `name`: same name, else one name extending the other
    (an institution stored as "Wealthsimple" is SnapTrade's "Wealthsimple Trade")."""
    wanted = _norm(name)
    names = [(b, {_norm(b.get(k)) for k in ("slug", "name", "display_name")} - {""}) for b in brokerages]
    return (
        next((b for b, ns in names if wanted in ns), None)
        or next((b for b, ns in names if any(n.startswith(wanted) or wanted.startswith(n) for n in ns)), None)
    )


@router.get("/brokerages")
def brokerages(
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    client=Depends(get_optional_snaptrade_client),
):
    """The brokerages the connect picker offers, with SnapTrade's official logos when it is reachable."""
    catalogue = []
    if client is not None:
        try:
            catalogue = [b for b in snaptrade.list_brokerages(client) if b.get("enabled", True)]
        except Exception:  # logos are decoration: the picker still works without them
            log.warning("Could not load the SnapTrade brokerage list", exc_info=True)

    platforms = {c.platform for c in db.query(BrokerConnection).filter_by(user_id=user_id)}
    institutions = sorted(set(db.scalars(
        select(AccountRecord.institution).where(AccountRecord.user_id == user_id, AccountRecord.institution != "")
    )))
    questrade_listing = _match(catalogue, "Questrade")
    wealthsimple = _match(catalogue, "Wealthsimple")
    logos = {name: _logo(b) for name in institutions if (b := _match(catalogue, name)) and _logo(b)}
    return {
        "options": [
            {
                "id": "questrade", "name": "Questrade", "method": "direct",
                "logo_url": questrade_listing and _logo(questrade_listing), "available": True,
                "connected": questrade.PLATFORM in platforms, "oauth": questrade.oauth_configured(),
            },
            {
                "id": "wealthsimple", "name": "Wealthsimple", "method": "snaptrade",
                "snaptrade_slug": str(wealthsimple["slug"]) if wealthsimple else None,
                "logo_url": wealthsimple and _logo(wealthsimple),
                # Without the catalogue the portal can't preselect Wealthsimple, but it can still link it.
                "available": client is not None,
                "connected": any(_norm(i).startswith("WEALTHSIMPLE") for i in institutions),
            },
        ],
        "institution_logos": logos,
    }


class QuestradeToken(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)


@router.post("/questrade/token")
async def questrade_token(
    body: QuestradeToken,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    client: httpx.AsyncClient = Depends(get_http_client),
):
    """Connect Questrade with a refresh token from its App Hub (alternative to the OAuth sign-in)."""
    try:
        connection = await questrade.connect_with_refresh_token(body.refresh_token.strip(), user_id, db, client)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code not in (400, 401):
            raise HTTPException(status_code=502, detail="Questrade could not be reached") from exc
        raise HTTPException(status_code=400, detail="Questrade rejected this token") from exc
    return {"platform": connection.platform, "status": connection.status}


class SnapTradeConnect(BaseModel):
    broker: str | None = None  # SnapTrade broker slug, e.g. WEALTHSIMPLE
    reconnect_institution: str | None = None


@router.post("/snaptrade/connect")
def snaptrade_connect(
    body: SnapTradeConnect | None = None,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    client=Depends(get_snaptrade_client),
):
    """Register with SnapTrade and return the read-only connection portal URL.

    Wealthsimple (no public API) and other institutions are linked through this portal too.
    """
    body = body or SnapTradeConnect()
    connection = snaptrade.register_user(client, db, user_id)
    reconnect = None
    if body.reconnect_institution:
        ids = snaptrade.authorization_ids(client, connection, body.reconnect_institution)
        if not ids:
            raise HTTPException(status_code=404, detail=f"{body.reconnect_institution} is not linked")
        reconnect = ids[0]
    url = snaptrade.portal_url(
        client, connection, broker=body.broker, reconnect=reconnect,
        custom_redirect=connections_page(linked=snaptrade.PLATFORM),
    )
    return {"redirect_uri": url}


@router.delete("/connections/questrade", status_code=204)
async def disconnect_questrade(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    connection = _connection(db, user_id, questrade.PLATFORM)
    async with connection_lock(connection):
        connections.disconnect(db, connection)


@router.delete("/connections/snaptrade", status_code=204)
async def disconnect_snaptrade_institution(
    institution: str,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    client=Depends(get_snaptrade_client),
):
    """Unlink one institution from SnapTrade and delete its synced data; other institutions stay."""
    connection = _connection(db, user_id, snaptrade.PLATFORM)
    async with connection_lock(connection):
        try:
            ids = await asyncio.to_thread(snaptrade.authorization_ids, client, connection, institution)
            for authorization_id in ids:
                await asyncio.to_thread(snaptrade.remove_authorization, client, connection, authorization_id)
        except ApiException as exc:
            # A rejected user secret means SnapTrade no longer lets us see the link: still forget it here.
            if exc.status != 401:
                raise
        connections.disconnect_institution(db, connection, institution)

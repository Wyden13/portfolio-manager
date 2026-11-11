import secrets
from dataclasses import asdict
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.integrations import questrade
from app.integrations.questrade import QuestradeAdapter
from app.models.connection import BrokerConnection

router = APIRouter(prefix="/api")

STATE_COOKIE = "questrade_oauth_state"


def current_user_id() -> int:
    # Placeholder until a login system exists.
    return 1


async def get_http_client():
    """HTTP client for broker REST calls (a dependency so it can be swapped out)."""
    async with httpx.AsyncClient() as client:
        yield client


def connections_page(**params: str) -> str:
    """The frontend's Connections tab, with the outcome of a broker sign-in in its query."""
    return f"{settings.FRONTEND_URL}/#/connections?{urlencode(params)}"


@router.get("/questrade/connect")
def connect():
    if not questrade.oauth_configured():
        raise HTTPException(status_code=503, detail="Questrade sign-in is not configured")
    state = secrets.token_urlsafe(32)
    response = RedirectResponse(questrade.build_authorize_url(state))
    response.set_cookie(STATE_COOKIE, state, httponly=True, samesite="lax", max_age=600)
    return response


@router.get("/questrade/callback")
async def callback(
    code: str,
    state: str,
    oauth_state: str | None = Cookie(default=None, alias=STATE_COOKIE),
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    client: httpx.AsyncClient = Depends(get_http_client),
):
    if not oauth_state or not secrets.compare_digest(state, oauth_state):
        target = connections_page(error="questrade_state")
    else:
        try:
            await questrade.exchange_code(code, user_id, db, client)
            target = connections_page(linked=questrade.PLATFORM)
        except httpx.HTTPStatusError:
            target = connections_page(error="questrade_rejected")

    response = RedirectResponse(target)
    response.delete_cookie(STATE_COOKIE)
    return response


@router.get("/accounts")
async def list_accounts(
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    client: httpx.AsyncClient = Depends(get_http_client),
):
    connection = (
        db.query(BrokerConnection).filter_by(user_id=user_id, platform=questrade.PLATFORM).one_or_none()
    )
    if connection is None:
        raise HTTPException(status_code=404, detail="Questrade is not connected")

    accounts = await QuestradeAdapter(connection, db, client).get_accounts()
    return [{**asdict(a), "status": a.status.value} for a in accounts]

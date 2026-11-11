from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx
from cryptography.fernet import Fernet

from app.config import settings
from app.integrations import questrade
from app.integrations.questrade import QuestradeAdapter
from app.models.account import AccountStatus
from app.models.connection import BrokerConnection
from app.security import decrypt

LOGIN = "https://login.questrade.com"
API = "https://api01.iq.questrade.com/"


@pytest.fixture(autouse=True)
def config(monkeypatch):
    monkeypatch.setattr(settings, "TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "QUESTRADE_CLIENT_ID", "cid")
    monkeypatch.setattr(settings, "QUESTRADE_REDIRECT_URI", "http://localhost/cb")


def token_payload(n=1):
    return {
        "access_token": f"access{n}",
        "refresh_token": f"refresh{n}",
        "api_server": API,
        "expires_in": 1800,
    }


ACCOUNTS = {
    "accounts": [{
        "type": "TFSA", "number": "26598145", "status": "Active",
        "isPrimary": True, "isBilling": True, "clientAccountType": "Individual",
    }],
    "userId": 1,
}


@respx.mock
async def test_exchange_code_stores_encrypted_tokens(db):
    respx.get(f"{LOGIN}/oauth2/token").respond(json=token_payload())
    async with httpx.AsyncClient() as client:
        connection = await questrade.exchange_code("code", 1, db, client)

    assert connection.encrypted_refresh_token != "refresh1"
    assert decrypt(connection.encrypted_refresh_token) == "refresh1"
    assert connection.api_server == API


@respx.mock
async def test_get_accounts_maps_fields(db):
    respx.get(f"{LOGIN}/oauth2/token").respond(json=token_payload())
    respx.get(f"{API}v1/accounts").respond(json=ACCOUNTS)
    async with httpx.AsyncClient() as client:
        connection = await questrade.exchange_code("code", 1, db, client)
        accounts = await QuestradeAdapter(connection, db, client).get_accounts()

    assert len(accounts) == 1
    assert accounts[0].account_number == "26598145"
    assert accounts[0].status is AccountStatus.Active
    assert accounts[0].is_primary is True


@respx.mock
async def test_refresh_rotates_and_persists_refresh_token(db):
    route = respx.get(f"{LOGIN}/oauth2/token").respond(json=token_payload(1))
    respx.get(f"{API}v1/accounts").respond(json=ACCOUNTS)
    async with httpx.AsyncClient() as client:
        connection = await questrade.exchange_code("code", 1, db, client)
        connection.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)

        route.respond(json=token_payload(2))
        await QuestradeAdapter(connection, db, client).get_accounts()

    db.refresh(connection)
    assert decrypt(connection.encrypted_refresh_token) == "refresh2"
    assert route.calls.last.request.url.params["refresh_token"] == "refresh1"


@respx.mock
async def test_retries_once_on_401(db):
    token = respx.get(f"{LOGIN}/oauth2/token").respond(json=token_payload(1))
    respx.get(f"{API}v1/accounts").mock(side_effect=[
        httpx.Response(401),
        httpx.Response(200, json=ACCOUNTS),
    ])
    async with httpx.AsyncClient() as client:
        connection = await questrade.exchange_code("code", 1, db, client)
        token.respond(json=token_payload(2))
        accounts = await QuestradeAdapter(connection, db, client).get_accounts()

    assert len(accounts) == 1
    assert connection.access_token == "access2"

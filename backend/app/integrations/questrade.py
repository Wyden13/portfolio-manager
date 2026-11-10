from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.integrations.base import BrokerageAdapter
from app.models.account import Account, AccountStatus
from app.models.connection import BrokerConnection
from app.security import decrypt, encrypt

PLATFORM = "questrade"
EXPIRY_BUFFER = timedelta(seconds=60)

def build_authorize_url(state: str) -> str:
    params = {
        "client_id": settings.QUESTRADE_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": settings.QUESTRADE_REDIRECT_URI,
        "state": state,
    }
    return f"{settings.QUESTRADE_LOGIN_URL}/oauth2/authorize?{urlencode(params)}"


async def _token_request(client: httpx.AsyncClient, params: dict) -> dict:
    response = await client.get(f"{settings.QUESTRADE_LOGIN_URL}/oauth2/token", params=params)
    response.raise_for_status()
    return response.json()


async def exchange_code(
    code: str, user_id: int, db: Session, client: httpx.AsyncClient
) -> BrokerConnection:
    """Trade an authorization code for tokens and store them for the user."""
    data = await _token_request(client, {
        "client_id": settings.QUESTRADE_CLIENT_ID,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.QUESTRADE_REDIRECT_URI,
    })

    connection = (
        db.query(BrokerConnection).filter_by(user_id=user_id, platform=PLATFORM).one_or_none()
        or BrokerConnection(user_id=user_id, platform=PLATFORM)
    )
    _store_tokens(connection, data)
    db.add(connection)
    db.commit()
    return connection


def _store_tokens(connection: BrokerConnection, data: dict) -> None:
    connection.encrypted_refresh_token = encrypt(data["refresh_token"])
    connection.access_token = data["access_token"]
    connection.api_server = data["api_server"]
    connection.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(
        seconds=data["expires_in"]
    )


class QuestradeAdapter(BrokerageAdapter):

    def __init__(self, connection: BrokerConnection, db: Session, client: httpx.AsyncClient):
        self.connection = connection
        self.db = db
        self.client = client

    def _is_expired(self) -> bool:
        expires_at = self.connection.expires_at
        if not self.connection.access_token or expires_at is None:
            return True
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        return now + EXPIRY_BUFFER >= expires_at

    async def _refresh(self) -> None:
        # The refresh token rotates on every use, so commit the new one right away.
        data = await _token_request(self.client, {
            "grant_type": "refresh_token",
            "refresh_token": decrypt(self.connection.encrypted_refresh_token),
        })
        _store_tokens(self.connection, data)
        self.db.add(self.connection)
        self.db.commit()

    async def _get(self, path: str) -> dict:
        if self._is_expired():
            await self._refresh()

        for attempt in range(2):
            response = await self.client.get(
                f"{self.connection.api_server}{path}",
                headers={"Authorization": f"Bearer {self.connection.access_token}"},
            )
            if response.status_code == 401 and attempt == 0:
                await self._refresh()
                continue
            response.raise_for_status()
            return response.json()

    async def get_accounts(self) -> list[Account]:
        data = await self._get("v1/accounts")
        return [
            Account(
                platform=PLATFORM,
                user_id=self.connection.user_id,
                account_id=int(item["number"]),
                account_type=item["type"],
                account_number=item["number"],
                status=AccountStatus(item["status"]),
                is_primary=item["isPrimary"],
                client_account_type=item["clientAccountType"],
            )
            for item in data["accounts"]
        ]

    async def get_balances(self, account_id):
        raise NotImplementedError

    async def get_positions(self, account_id):
        raise NotImplementedError

    async def get_transactions(self, account_id):
        raise NotImplementedError

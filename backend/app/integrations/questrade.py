import hashlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.integrations.base import BrokerageAdapter, RawBalance, RawPosition, RawTransaction
from app.models.account import Account, AccountStatus
from app.models.connection import BrokerConnection
from app.models.transaction import TransactionKind
from app.security import decrypt, encrypt

PLATFORM = "questrade"
EXPIRY_BUFFER = timedelta(seconds=60)
ACTIVITY_WINDOW = timedelta(days=30)  # Questrade rejects activity queries spanning more than 31 days
CAD_SUFFIXES = (".TO", ".V", ".CN", ".NE")

_TYPE_KINDS = {
    "dividends": TransactionKind.DIVIDEND,
    "deposits": TransactionKind.DEPOSIT,
    "withdrawals": TransactionKind.WITHDRAWAL,
    "fees and rebates": TransactionKind.FEE,
}


def _dec(value) -> Decimal:
    return Decimal(str(value)) if value is not None else Decimal(0)


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _kind(item: dict) -> TransactionKind:
    activity_type = (item.get("type") or "").lower()
    if activity_type == "trades":
        action = (item.get("action") or "").lower()
        return {"buy": TransactionKind.BUY, "sell": TransactionKind.SELL}.get(action, TransactionKind.OTHER)
    return _TYPE_KINDS.get(activity_type, TransactionKind.OTHER)


def parse_activities(items: list[dict]) -> list[RawTransaction]:
    """Map Questrade activities to RawTransactions.

    Activities carry no id, so the external id is a hash of the row plus an occurrence
    counter for genuinely identical rows. This stays stable across overlapping re-fetches.
    """
    seen: dict[str, int] = {}
    result = []
    for item in items:
        fingerprint = "|".join(
            str(item.get(k)) for k in (
                "tradeDate", "transactionDate", "settlementDate", "action", "symbolId",
                "symbol", "quantity", "price", "grossAmount", "commission", "netAmount",
                "currency", "type", "description",
            )
        )
        digest = hashlib.sha1(fingerprint.encode()).hexdigest()
        seen[digest] = seen.get(digest, 0) + 1
        result.append(RawTransaction(
            external_id=f"{digest}:{seen[digest]}",
            kind=_kind(item),
            symbol=item.get("symbol") or None,
            trade_date=_parse_time(item["tradeDate"]),
            quantity=abs(_dec(item.get("quantity"))),
            price=_dec(item.get("price")),
            gross_amount=_dec(item.get("grossAmount")),
            fee=abs(_dec(item.get("commission"))),
            net_amount=_dec(item.get("netAmount")),
            currency=item.get("currency") or "",
            raw_type=f'{item.get("type") or ""}/{item.get("action") or ""}',
            description=item.get("description") or "",
        ))
    return result


def currency_for_symbol(symbol: str) -> str:
    # Questrade positions carry no currency; Canadian listings use these suffixes.
    return "CAD" if symbol.upper().endswith(CAD_SUFFIXES) else "USD"

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

    platform = PLATFORM

    async def get_balances(self, account_id) -> list[RawBalance]:
        data = await self._get(f"v1/accounts/{account_id}/balances")
        return [
            RawBalance(b["currency"], _dec(b.get("cash")), _dec(b.get("marketValue")))
            for b in data["perCurrencyBalances"]
        ]

    async def get_positions(self, account_id) -> list[RawPosition]:
        data = await self._get(f"v1/accounts/{account_id}/positions")
        return [
            RawPosition(
                symbol=p["symbol"],
                quantity=_dec(p["openQuantity"]),
                average_cost=_dec(p["averageEntryPrice"]) if p.get("averageEntryPrice") else None,
                currency=currency_for_symbol(p["symbol"]),
            )
            for p in data["positions"]
            if _dec(p["openQuantity"]) != 0
        ]

    async def get_transactions(
        self, account_id, start: datetime | None = None, end: datetime | None = None
    ) -> list[RawTransaction]:
        end = end or datetime.now(timezone.utc).replace(tzinfo=None)
        start = start or end - timedelta(days=settings.SYNC_INITIAL_LOOKBACK_DAYS)
        items: list[dict] = []
        cursor = start
        while cursor < end:
            window_end = min(cursor + ACTIVITY_WINDOW, end)
            query = urlencode({
                "startTime": cursor.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                "endTime": window_end.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
            })
            data = await self._get(f"v1/accounts/{account_id}/activities?{query}")
            items.extend(data["activities"])
            cursor = window_end + timedelta(seconds=1)  # windows must not share an instant
        return parse_activities(items)

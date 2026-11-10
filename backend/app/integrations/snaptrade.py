import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.config import settings
from app.integrations.base import BrokerageAdapter, RawBalance, RawPosition, RawTransaction, ReauthRequired
from app.models.account import Account, AccountStatus
from app.models.connection import BrokerConnection, ConnectionStatus
from app.models.transaction import TransactionKind
from app.security import decrypt, encrypt

PLATFORM = "snaptrade"
PAGE_SIZE = 1000

_KINDS = {
    "BUY": TransactionKind.BUY,
    "REI": TransactionKind.BUY,  # dividend reinvestment is a purchase
    "SELL": TransactionKind.SELL,
    "DIVIDEND": TransactionKind.DIVIDEND,
    "STOCK_DIVIDEND": TransactionKind.DIVIDEND,
    "CONTRIBUTION": TransactionKind.DEPOSIT,
    "DEPOSIT": TransactionKind.DEPOSIT,
    "WITHDRAWAL": TransactionKind.WITHDRAWAL,
    "FEE": TransactionKind.FEE,
    "TAX": TransactionKind.FEE,
}
_STATUS = {
    "open": AccountStatus.Active,
    "closed": AccountStatus.Closed,
    "archived": AccountStatus.Closed,
}


def make_client():
    from snaptrade_client import SnapTrade, SnapTradeAuth

    return SnapTrade(auth=SnapTradeAuth.commercial_api_key(
        consumer_key=settings.SNAPTRADE_CONSUMER_KEY, client_id=settings.SNAPTRADE_CLIENT_ID,
    ))


def _dec(value) -> Decimal:
    return Decimal(str(value)) if value is not None else Decimal(0)


def _to_naive_utc(value) -> datetime:
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _currency(value) -> str:
    return value.get("code", "") if value else ""


def parse_activity(item) -> RawTransaction:
    symbol = item.get("symbol")
    when = item.get("trade_date") or item["settlement_date"]
    return RawTransaction(
        external_id=item["id"],
        kind=_KINDS.get((item.get("type") or "").upper(), TransactionKind.OTHER),
        symbol=symbol["symbol"] if symbol else None,
        trade_date=_to_naive_utc(when),
        quantity=abs(_dec(item.get("units"))),
        price=_dec(item.get("price")),
        gross_amount=_dec(item.get("amount")),
        fee=abs(_dec(item.get("fee"))),
        net_amount=_dec(item.get("amount")),
        currency=_currency(item.get("currency")),
        raw_type=item.get("type") or "",
        description=item.get("description") or "",
    )


def register_user(client, db: Session, user_id: int) -> BrokerConnection:
    """Register this user with SnapTrade and store the (encrypted) user secret."""
    existing = db.query(BrokerConnection).filter_by(user_id=user_id, platform=PLATFORM).one_or_none()
    if existing:
        return existing
    # Random suffix: SnapTrade user ids are global to our client id, so a fixed id would collide
    # across environments (and with itself after a local database reset).
    external_id = f"investiq-{user_id}-{uuid.uuid4().hex}"
    body = client.authentication.register_snap_trade_user(user_id=external_id).body
    connection = BrokerConnection(
        user_id=user_id, platform=PLATFORM, external_user_id=body["userId"],
        encrypted_refresh_token=encrypt(body["userSecret"]), status=ConnectionStatus.PENDING.value,
    )
    db.add(connection)
    db.commit()
    return connection


def portal_url(client, connection: BrokerConnection) -> str:
    """URL where the user links a brokerage with read-only permissions."""
    body = client.authentication.login_snap_trade_user(
        user_id=connection.external_user_id,
        user_secret=decrypt(connection.encrypted_refresh_token),
        connection_type="read",
    ).body
    return body["redirectURI"]


class SnapTradeAdapter(BrokerageAdapter):
    platform = PLATFORM

    def __init__(self, connection: BrokerConnection, client):
        self.connection = connection
        self.client = client
        self._creds = {
            "user_id": connection.external_user_id,
            "user_secret": decrypt(connection.encrypted_refresh_token),
        }

    async def _call(self, method, **kwargs):
        from snaptrade_client import ApiException

        try:
            response = await asyncio.to_thread(method, **kwargs, **self._creds)
        except ApiException as exc:
            if exc.status == 401:
                raise ReauthRequired("SnapTrade rejected the user secret") from exc
            raise
        return response.body

    async def get_accounts(self) -> list[Account]:
        body = await self._call(self.client.account_information.list_user_accounts)
        return [
            Account(
                platform=PLATFORM,
                user_id=self.connection.user_id,
                account_id=item["id"],
                account_type=item.get("raw_type") or item.get("account_category") or "",
                account_number=item["number"],
                status=_STATUS.get(item.get("status"), AccountStatus.Unknown),
                is_primary=False,
                client_account_type="",
                institution=item.get("institution_name") or "",
            )
            for item in body
        ]

    async def _holdings(self, account_id):
        return await self._call(self.client.account_information.get_user_holdings, account_id=account_id)

    async def get_balances(self, account_id) -> list[RawBalance]:
        holdings = await self._holdings(account_id)
        return [
            RawBalance(_currency(b.get("currency")), _dec(b.get("cash")), Decimal(0))
            for b in holdings.get("balances") or []
        ]

    async def get_positions(self, account_id) -> list[RawPosition]:
        holdings = await self._holdings(account_id)
        return [
            RawPosition(
                symbol=p["symbol"]["symbol"]["symbol"],
                quantity=_dec(p.get("units")),
                average_cost=_dec(p["average_purchase_price"]) if p.get("average_purchase_price") else None,
                currency=_currency(p.get("currency")),
            )
            for p in holdings.get("positions") or []
            if _dec(p.get("units")) != 0
        ]

    async def get_transactions(
        self, account_id, start: datetime | None = None, end: datetime | None = None
    ) -> list[RawTransaction]:
        end_day = (end or datetime.now(timezone.utc).replace(tzinfo=None)).date()
        start_day = (start.date() if start else end_day - timedelta(days=settings.SYNC_INITIAL_LOOKBACK_DAYS))
        result: list[RawTransaction] = []
        offset = 0
        while True:
            body = await self._call(
                self.client.account_information.get_account_activities,
                account_id=account_id, start_date=start_day, end_date=end_day, offset=offset, limit=PAGE_SIZE,
            )
            rows = body if isinstance(body, list) else body.get("data") or []
            result.extend(parse_activity(row) for row in rows)
            total = None if isinstance(body, list) else (body.get("pagination") or {}).get("total")
            offset += len(rows)
            if not rows or total is None or offset >= total:
                return result

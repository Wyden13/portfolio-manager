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


def is_personal_key() -> bool:
    """Personal keys (client id PERS-...) belong to one SnapTrade user: no registration, no user secret."""
    return settings.SNAPTRADE_CLIENT_ID.startswith("PERS-")


def make_client():
    from snaptrade_client import SnapTrade, SnapTradeAuth

    auth = SnapTradeAuth.personal_api_key if is_personal_key() else SnapTradeAuth.commercial_api_key
    return SnapTrade(auth=auth(consumer_key=settings.SNAPTRADE_CONSUMER_KEY, client_id=settings.SNAPTRADE_CLIENT_ID))


BROKERAGES_TTL = timedelta(hours=24)
_brokerages: dict = {}  # {"at": datetime, "data": list}; the catalogue rarely changes


def list_brokerages(client) -> list:
    """Brokerages SnapTrade supports (names, slugs, official logos). Client-level call, cached."""
    now = datetime.now(timezone.utc)
    if not _brokerages or now - _brokerages["at"] > BROKERAGES_TTL:
        _brokerages.update(at=now, data=list(client.reference_data.list_all_brokerages().body))
    return _brokerages["data"]


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
    if is_personal_key():
        # The key itself identifies the SnapTrade user; there is nothing to register.
        connection = BrokerConnection(
            user_id=user_id, platform=PLATFORM, external_user_id=None,
            encrypted_refresh_token=encrypt(""), status=ConnectionStatus.PENDING.value,
        )
        db.add(connection)
        db.commit()
        return connection
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


def _credentials(connection: BrokerConnection) -> dict:
    if connection.external_user_id is None:  # personal key: the client signs as the user
        return {}
    return {"user_id": connection.external_user_id, "user_secret": decrypt(connection.encrypted_refresh_token)}


def portal_url(
    client, connection: BrokerConnection, broker: str | None = None, reconnect: str | None = None,
    custom_redirect: str | None = None,
) -> str:
    """URL where the user links a brokerage with read-only permissions.

    broker preselects an institution (e.g. WEALTHSIMPLE); reconnect is the brokerage authorization
    to repair; the portal sends the user to custom_redirect when done.
    """
    options = {"broker": broker, "reconnect": reconnect, "custom_redirect": custom_redirect}
    body = client.authentication.login_snap_trade_user(
        **_credentials(connection), connection_type="read", **{k: v for k, v in options.items() if v},
    ).body
    return body["redirectURI"]


def authorization_ids(client, connection: BrokerConnection, institution: str) -> list[str]:
    """SnapTrade brokerage authorizations (linked logins) holding this institution's accounts."""
    accounts = client.account_information.list_user_accounts(**_credentials(connection)).body
    return sorted({
        a["brokerage_authorization"] for a in accounts
        if (a.get("institution_name") or "") == institution and a.get("brokerage_authorization")
    })


def remove_authorization(client, connection: BrokerConnection, authorization_id: str) -> None:
    """Unlink one brokerage login from SnapTrade (account access only; nothing is traded)."""
    client.connections.delete_connection(connection_id=authorization_id, **_credentials(connection))


class SnapTradeAdapter(BrokerageAdapter):
    platform = PLATFORM

    def __init__(self, connection: BrokerConnection, client):
        self.connection = connection
        self.client = client
        self._creds = _credentials(connection)

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

    async def get_balances(self, account_id) -> list[RawBalance]:
        body = await self._call(self.client.account_information.get_user_account_balance, account_id=account_id)
        return [RawBalance(_currency(b.get("currency")), _dec(b.get("cash")), Decimal(0)) for b in body or []]

    async def get_positions(self, account_id) -> list[RawPosition]:
        body = await self._call(self.client.account_information.get_all_account_positions, account_id=account_id)
        positions = []
        for p in body.get("results") or []:
            instrument = p.get("instrument") or {}
            # Cash rows have no symbol and are reported as balances instead.
            if instrument.get("kind") == "cash" or not instrument.get("symbol") or _dec(p.get("units")) == 0:
                continue
            positions.append(RawPosition(
                symbol=instrument["symbol"],
                quantity=_dec(p.get("units")),
                average_cost=_dec(p["cost_basis"]) if p.get("cost_basis") else None,  # per unit
                currency=p.get("currency") or instrument.get("currency") or "",
            ))
        return positions

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

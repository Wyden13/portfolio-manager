from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

from cryptography.fernet import Fernet

import pytest
from fastapi.testclient import TestClient
from snaptrade_client import ApiException
from sqlalchemy.orm import sessionmaker

from app.api.accounts import current_user_id
from app.api.sync import get_snaptrade_client
from app.config import settings
from app.database import get_db
from app.integrations import snaptrade
from app.integrations.base import ReauthRequired
from app.integrations.snaptrade import SnapTradeAdapter
from app.main import app
from app.models.account import AccountStatus
from app.models.connection import ConnectionStatus
from app.models.transaction import TransactionKind


def resp(body):
    return SimpleNamespace(body=body)


class FakeClient:
    def __init__(self):
        self.calls = []
        self.authentication = SimpleNamespace(
            register_snap_trade_user=lambda user_id: resp({"userId": user_id, "userSecret": "s3cret"}),
            login_snap_trade_user=lambda **kw: resp({"redirectURI": f"https://portal/{kw['connection_type']}"}),
        )
        self.account_information = SimpleNamespace(
            list_user_accounts=self.list_user_accounts,
            get_all_account_positions=self.get_all_account_positions,
            get_user_account_balance=self.get_user_account_balance,
            get_account_activities=self.get_account_activities,
        )

    def list_user_accounts(self, **kw):
        return resp([{"id": "uuid-1", "number": "123", "raw_type": "TFSA", "status": "open",
                      "institution_name": "Wealthsimple"}])

    def get_all_account_positions(self, **kw):
        return resp({"results": [
            {"instrument": {"kind": "etf", "symbol": "XEQT.TO", "raw_symbol": "XEQT"}, "units": "3",
             "cost_basis": "30.1", "currency": "CAD"},
            {"instrument": {"kind": "stock", "symbol": "OLD"}, "units": "0", "currency": "USD"},
            {"instrument": {"kind": "cash", "code": "CAD"}, "units": "5", "currency": "CAD", "cash_equivalent": True},
        ]})

    def get_user_account_balance(self, **kw):
        return resp([{"currency": {"code": "CAD"}, "cash": 5}])

    def get_account_activities(self, **kw):
        self.calls.append(kw)
        page = [{"id": f"a{kw['offset']}", "symbol": {"symbol": "XEQT.TO"}, "price": 30, "units": 2,
                 "amount": -60, "currency": {"code": "CAD"}, "type": "BUY", "description": "d",
                 "trade_date": "2026-02-03T15:00:00Z", "settlement_date": "2026-02-05T00:00:00Z", "fee": 0}]
        return resp({"data": page, "pagination": {"offset": kw["offset"], "limit": 1, "total": 2}})


@pytest.fixture
def conn(db, monkeypatch):
    monkeypatch.setattr(settings, "TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    return snaptrade.register_user(FakeClient(), db, 7)


def test_register_stores_encrypted_secret_and_portal_is_read_only(db, conn):
    assert conn.encrypted_refresh_token != "s3cret"
    assert conn.status == ConnectionStatus.PENDING.value
    assert conn.external_user_id.startswith("investiq-7-") and len(conn.external_user_id) > len("investiq-7-")
    assert snaptrade.portal_url(FakeClient(), conn) == "https://portal/read"
    assert snaptrade.register_user(FakeClient(), db, 7) is conn  # idempotent


async def test_accounts_positions_balances(conn):
    adapter = SnapTradeAdapter(conn, FakeClient())
    accounts = await adapter.get_accounts()
    assert accounts[0].account_id == "uuid-1" and accounts[0].status is AccountStatus.Active
    assert accounts[0].institution == "Wealthsimple"
    positions = await adapter.get_positions("uuid-1")
    assert [(p.symbol, p.quantity, p.average_cost) for p in positions] == [("XEQT.TO", 3, Decimal("30.1"))]
    assert (await adapter.get_balances("uuid-1"))[0].currency == "CAD"


async def test_activities_paginate_and_normalize(conn):
    client = FakeClient()
    txs = await SnapTradeAdapter(conn, client).get_transactions("uuid-1", start=datetime(2026, 1, 1))
    assert [t.external_id for t in txs] == ["a0", "a1"]
    assert txs[0].kind is TransactionKind.BUY and txs[0].trade_date == datetime(2026, 2, 3, 15)
    assert [c["offset"] for c in client.calls] == [0, 1]


async def test_rejected_user_secret_raises_reauth(conn):
    client = FakeClient()

    def unauthorized(**kw):
        raise ApiException(status=401, reason="Unauthorized")

    client.account_information.list_user_accounts = unauthorized
    with pytest.raises(ReauthRequired):
        await SnapTradeAdapter(conn, client).get_accounts()


class RecordingClient(FakeClient):
    """Records the keyword arguments of every SnapTrade call."""

    def __init__(self):
        super().__init__()
        self.kwargs = []

        def record(method):
            def call(**kw):
                self.kwargs.append(kw)
                return method(**kw)
            return call

        for group in (self.authentication, self.account_information):
            for name, method in vars(group).items():
                setattr(group, name, record(method))


def test_make_client_picks_auth_mode_from_key(monkeypatch):
    monkeypatch.setattr(settings, "SNAPTRADE_CONSUMER_KEY", "k")
    monkeypatch.setattr(settings, "SNAPTRADE_CLIENT_ID", "PERS-ABC")
    assert snaptrade.make_client().account_information.api_client.configuration.auth_mode == "personalApiKey"
    monkeypatch.setattr(settings, "SNAPTRADE_CLIENT_ID", "PARTNER-ABC")
    assert snaptrade.make_client().account_information.api_client.configuration.auth_mode == "commercialApiKey"


async def test_personal_key_skips_registration_and_user_credentials(db, monkeypatch):
    monkeypatch.setattr(settings, "TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "SNAPTRADE_CLIENT_ID", "PERS-ABC")
    client = RecordingClient()
    conn = snaptrade.register_user(client, db, 7)
    assert conn.external_user_id is None and client.kwargs == []
    assert snaptrade.portal_url(client, conn) == "https://portal/read"
    adapter = SnapTradeAdapter(conn, client)
    await adapter.get_accounts()
    await adapter.get_positions("uuid-1")
    await adapter.get_balances("uuid-1")
    assert client.kwargs and all("user_id" not in kw and "user_secret" not in kw for kw in client.kwargs)


@pytest.fixture
def api(db_engine):
    factory = sessionmaker(bind=db_engine, expire_on_commit=False)

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides.update({get_db: override_db, current_user_id: lambda: 1})
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_connect_without_credentials_is_503_and_calls_nothing(api, monkeypatch):
    monkeypatch.setattr(settings, "SNAPTRADE_CLIENT_ID", "")
    monkeypatch.setattr(snaptrade, "make_client", lambda: pytest.fail("must not build a client"))
    response = api.post("/api/snaptrade/connect")
    assert response.status_code == 503 and response.json()["detail"] == "SnapTrade is not configured"


def test_snaptrade_api_error_is_502(api):
    client = FakeClient()

    def unavailable(user_id):
        raise ApiException(status=500, reason="Internal Server Error")

    client.authentication.register_snap_trade_user = unavailable
    app.dependency_overrides[get_snaptrade_client] = lambda: client
    response = api.post("/api/snaptrade/connect")
    assert response.status_code == 502
    assert response.json() == {"detail": "SnapTrade request failed (500)", "code": "broker_error"}

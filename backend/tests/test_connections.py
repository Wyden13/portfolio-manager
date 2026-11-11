from datetime import datetime
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
import respx
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from snaptrade_client import ApiException
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.api.accounts import STATE_COOKIE, current_user_id
from app.api.connections import get_optional_snaptrade_client
from app.api.sync import get_snaptrade_client
from app.config import settings
from app.database import get_db
from app.integrations import snaptrade
from app.main import app
from app.models.account import AccountRecord
from app.models.connection import BrokerConnection, ConnectionStatus
from app.models.position import Position
from app.models.transaction import Transaction
from app.security import decrypt
from app.services.synchronization import SyncInProgress, connection_lock
from tests.test_questrade import LOGIN, token_payload
from tests.test_snaptrade import FakeClient, resp

NOW = datetime(2026, 3, 1)


class LinkingClient(FakeClient):
    """FakeClient whose accounts belong to two brokerage logins, with unlinking."""

    def __init__(self):
        super().__init__()
        self.logins = []
        self.deleted = []
        self.authentication.login_snap_trade_user = self.login_snap_trade_user
        self.account_information.list_user_accounts = lambda **kw: resp([
            {"id": "ws-1", "number": "WS1", "institution_name": "Wealthsimple", "brokerage_authorization": "auth-ws"},
            {"id": "ib-1", "number": "IB1", "institution_name": "Interactive Brokers", "brokerage_authorization": "auth-ib"},
        ])
        self.connections = SimpleNamespace(delete_connection=lambda **kw: self.deleted.append(kw["connection_id"]))
        self.catalogue_calls = 0
        self.reference_data = SimpleNamespace(list_all_brokerages=self.list_all_brokerages)

    def list_all_brokerages(self):
        self.catalogue_calls += 1
        return resp([
            {"slug": "QUESTRADE", "name": "Questrade", "display_name": "Questrade", "enabled": True,
             "aws_s3_logo_url": "https://logos/qt-wide.png", "aws_s3_square_logo_url": "https://logos/qt.png"},
            {"slug": "WEALTHSIMPLETRADE", "name": "Wealthsimple Trade", "display_name": "Wealthsimple",
             "enabled": True, "aws_s3_logo_url": "https://logos/ws-wide.png", "aws_s3_square_logo_url": None},
            {"slug": "INTERACTIVE-BROKERS", "name": "Interactive Brokers", "display_name": "IBKR", "enabled": True,
             "aws_s3_logo_url": "https://logos/ib.png"},
            {"slug": "WEALTHSIMPLE-OLD", "name": "Wealthsimple Legacy", "enabled": False, "aws_s3_logo_url": "x"},
        ])

    def login_snap_trade_user(self, **kw):
        self.logins.append(kw)
        return resp({"redirectURI": "https://portal"})


@pytest.fixture
def factory(db_engine, monkeypatch):
    monkeypatch.setattr(settings, "TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "QUESTRADE_CLIENT_ID", "cid")
    monkeypatch.setattr(settings, "QUESTRADE_REDIRECT_URI", "http://localhost/cb")
    monkeypatch.setattr(settings, "SNAPTRADE_CLIENT_ID", "sid")
    monkeypatch.setattr(settings, "SNAPTRADE_CONSUMER_KEY", "skey")
    monkeypatch.setattr(settings, "FRONTEND_URL", "http://front")
    return sessionmaker(bind=db_engine, expire_on_commit=False)


@pytest.fixture
def client(factory):
    snap = LinkingClient()

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides.update({get_db: override_db, current_user_id: lambda: 1,
                                     get_snaptrade_client: lambda: snap, get_optional_snaptrade_client: lambda: snap})
    snaptrade._brokerages.clear()
    test_client = TestClient(app)
    test_client.snap = snap
    yield test_client
    app.dependency_overrides.clear()


def add_account(db, platform, institution, number, duplicate_of=None) -> AccountRecord:
    record = AccountRecord(user_id=1, platform=platform, external_id=number, account_number=number,
                           account_type="TFSA", status="Active", institution=institution,
                           duplicate_of_id=duplicate_of)
    db.add(record)
    db.flush()
    db.add(Transaction(account_id=record.id, external_id=f"t-{number}", kind="BUY", symbol="XEQT.TO",
                       trade_date=NOW, quantity=1, price=30, currency="CAD"))
    db.add(Position(account_id=record.id, symbol="XEQT.TO", quantity=1, average_cost=30, currency="CAD",
                    synced_at=NOW))
    return record


@pytest.fixture
def linked(factory, client):
    """Questrade direct, plus Wealthsimple and IBKR through SnapTrade; one SnapTrade account mirrors Questrade."""
    with factory() as db:
        db.add(BrokerConnection(user_id=1, platform="questrade", encrypted_refresh_token="x", status="active"))
        snaptrade.register_user(client.snap, db, 1)
        qt = add_account(db, "questrade", "Questrade", "11112222")
        add_account(db, "snaptrade", "Questrade", "11112222", duplicate_of=qt.id)
        add_account(db, "snaptrade", "Wealthsimple", "WS1")
        add_account(db, "snaptrade", "Interactive Brokers", "IB1")
        db.commit()


def counts(factory):
    with factory() as db:
        return {
            "accounts": sorted(db.execute(select(AccountRecord.platform, AccountRecord.institution,
                                                 AccountRecord.duplicate_of_id)).all()),
            "transactions": db.scalar(select(func.count(Transaction.id))),
            "positions": db.scalar(select(func.count(Position.id))),
            "connections": dict(db.execute(select(BrokerConnection.platform, BrokerConnection.status)).all()),
        }


def test_overview_groups_accounts_by_institution(client, linked):
    body = client.get("/api/connections/overview").json()
    assert body["options"] == {"questrade_oauth": True, "snaptrade": True}
    by_platform = {c["platform"]: c for c in body["connections"]}
    assert [i["name"] for i in by_platform["snaptrade"]["institutions"]] == [
        "Interactive Brokers", "Questrade", "Wealthsimple"]
    [qt] = by_platform["questrade"]["institutions"]
    assert qt["accounts"][0]["account_number"] == "••2222" and not qt["accounts"][0]["duplicate"]
    assert by_platform["snaptrade"]["institutions"][1]["accounts"][0]["duplicate"]


def test_overview_without_configuration(client, monkeypatch):
    monkeypatch.setattr(settings, "QUESTRADE_CLIENT_ID", "")
    monkeypatch.setattr(settings, "SNAPTRADE_CONSUMER_KEY", "")
    body = client.get("/api/connections/overview").json()
    assert body == {"options": {"questrade_oauth": False, "snaptrade": False}, "connections": []}
    assert client.get("/api/questrade/connect", follow_redirects=False).status_code == 503


@respx.mock
def test_questrade_token_connects(client, factory):
    route = respx.get(f"{LOGIN}/oauth2/token").respond(json=token_payload())
    response = client.post("/api/questrade/token", json={"refresh_token": " pasted \n"})
    assert response.status_code == 200 and "pasted" not in response.text
    assert route.calls[0].request.url.params["refresh_token"] == "pasted"
    with factory() as db:
        connection = db.query(BrokerConnection).filter_by(platform="questrade").one()
        assert decrypt(connection.encrypted_refresh_token) == "refresh1"  # rotated token stored
        assert connection.status == ConnectionStatus.ACTIVE.value


@respx.mock
def test_questrade_token_rejected(client, factory):
    respx.get(f"{LOGIN}/oauth2/token").respond(400)
    response = client.post("/api/questrade/token", json={"refresh_token": "wrong-token"})
    assert response.status_code == 400 and response.json()["detail"] == "Questrade rejected this token"
    assert "wrong-token" not in response.text
    assert counts(factory)["connections"] == {}
    assert client.post("/api/questrade/token", json={"refresh_token": ""}).status_code == 422


def hash_query(location: str) -> dict:
    fragment = urlsplit(location).fragment
    assert fragment.startswith("/connections?")
    return parse_qs(fragment.split("?", 1)[1])


@respx.mock
def test_oauth_callback_returns_to_connections_page(client):
    respx.get(f"{LOGIN}/oauth2/token").respond(json=token_payload())
    client.cookies.set(STATE_COOKIE, "s")
    ok = client.get("/api/questrade/callback", params={"code": "c", "state": "s"}, follow_redirects=False)
    assert ok.headers["location"].startswith("http://front/#") and hash_query(ok.headers["location"]) == {
        "linked": ["questrade"]}

    client.cookies.set(STATE_COOKIE, "s")
    forged = client.get("/api/questrade/callback", params={"code": "c", "state": "other"}, follow_redirects=False)
    assert hash_query(forged.headers["location"]) == {"error": ["questrade_state"]}

    respx.get(f"{LOGIN}/oauth2/token").respond(400)
    client.cookies.set(STATE_COOKIE, "s")
    rejected = client.get("/api/questrade/callback", params={"code": "c", "state": "s"}, follow_redirects=False)
    assert hash_query(rejected.headers["location"]) == {"error": ["questrade_rejected"]}


def test_snaptrade_portal_options(client, linked):
    assert client.post("/api/snaptrade/connect").json() == {"redirect_uri": "https://portal"}
    client.post("/api/snaptrade/connect", json={"broker": "WEALTHSIMPLE"})
    client.post("/api/snaptrade/connect", json={"reconnect_institution": "Interactive Brokers"})
    plain, ws, reconnect = client.snap.logins
    assert plain["connection_type"] == "read" and "broker" not in plain
    assert plain["custom_redirect"] == "http://front/#/connections?linked=snaptrade"
    assert ws["broker"] == "WEALTHSIMPLE"
    assert reconnect["reconnect"] == "auth-ib"
    assert client.post("/api/snaptrade/connect", json={"reconnect_institution": "Nope"}).status_code == 404


def test_disconnect_questrade_deletes_its_data_and_promotes_mirror(client, factory, linked):
    assert client.delete("/api/connections/questrade").status_code == 204
    after = counts(factory)
    assert after["accounts"] == [("snaptrade", "Interactive Brokers", None), ("snaptrade", "Questrade", None),
                                 ("snaptrade", "Wealthsimple", None)]
    assert after["transactions"] == 3 and after["positions"] == 3
    assert after["connections"] == {"snaptrade": "pending"}
    assert client.delete("/api/connections/questrade").status_code == 404


def test_disconnect_snaptrade_institution_keeps_the_others(client, factory, linked):
    assert client.delete("/api/connections/snaptrade", params={"institution": "Wealthsimple"}).status_code == 204
    assert client.snap.deleted == ["auth-ws"]
    after = counts(factory)
    assert [(p, i) for p, i, _ in after["accounts"]] == [
        ("questrade", "Questrade"), ("snaptrade", "Interactive Brokers"), ("snaptrade", "Questrade")]
    assert after["transactions"] == 3 and "snaptrade" in after["connections"]


def test_disconnect_last_snaptrade_institution_returns_to_pending(client, factory):
    with factory() as db:
        connection = snaptrade.register_user(client.snap, db, 1)
        connection.status = "active"
        add_account(db, "snaptrade", "Wealthsimple", "WS1")
        db.commit()
    client.delete("/api/connections/snaptrade", params={"institution": "Wealthsimple"})
    assert counts(factory)["connections"] == {"snaptrade": "pending"}


def test_disconnect_with_rejected_secret_still_forgets_locally(client, factory, linked):
    def unauthorized(**kw):
        raise ApiException(status=401, reason="Unauthorized")

    client.snap.account_information.list_user_accounts = unauthorized
    assert client.delete("/api/connections/snaptrade", params={"institution": "Wealthsimple"}).status_code == 204
    assert "Wealthsimple" not in [i for _, i, _ in counts(factory)["accounts"]]


async def test_connection_lock_blocks_a_concurrent_disconnect(db):
    connection = BrokerConnection(id=99, user_id=1, platform="questrade", encrypted_refresh_token="x")
    async with connection_lock(connection):
        with pytest.raises(SyncInProgress):
            async with connection_lock(connection):
                pass
    async with connection_lock(connection):  # released afterwards
        pass


def test_brokerages_offer_questrade_and_wealthsimple_with_logos(client, linked):
    body = client.get("/api/brokerages").json()
    questrade_option, wealthsimple_option = body["options"]
    assert questrade_option == {"id": "questrade", "name": "Questrade", "method": "direct",
                                "logo_url": "https://logos/qt.png", "available": True, "connected": True,
                                "oauth": True}
    assert wealthsimple_option["snaptrade_slug"] == "WEALTHSIMPLETRADE"
    assert wealthsimple_option["logo_url"] == "https://logos/ws-wide.png"  # no square logo
    assert wealthsimple_option["available"] and wealthsimple_option["connected"]
    assert body["institution_logos"] == {"Interactive Brokers": "https://logos/ib.png",
                                         "Questrade": "https://logos/qt.png",
                                         "Wealthsimple": "https://logos/ws-wide.png"}
    client.get("/api/brokerages")
    assert client.snap.catalogue_calls == 1  # cached


def test_brokerages_without_snaptrade(client):
    app.dependency_overrides[get_optional_snaptrade_client] = lambda: None
    questrade_option, wealthsimple_option = client.get("/api/brokerages").json()["options"]
    assert questrade_option["available"] and not questrade_option["connected"] and questrade_option["logo_url"] is None
    assert not wealthsimple_option["available"] and wealthsimple_option["snaptrade_slug"] is None


def test_brokerages_when_snaptrade_catalogue_fails(client):
    def unavailable():
        raise ApiException(status=503, reason="Service Unavailable")

    client.snap.reference_data.list_all_brokerages = unavailable
    questrade_option, wealthsimple_option = client.get("/api/brokerages").json()["options"]
    assert questrade_option["logo_url"] is None
    assert wealthsimple_option["available"] and wealthsimple_option["snaptrade_slug"] is None

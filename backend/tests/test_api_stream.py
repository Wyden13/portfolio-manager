import base64
from datetime import datetime
from decimal import Decimal as D

import httpx
import pytest
import respx
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.api import positions as positions_api, stream as stream_api, sync as sync_api
from app.api.accounts import current_user_id
from app.config import settings
from app.database import get_db
from app.main import app
from app.models.account import AccountRecord
from app.models.position import Position
from app.models.transaction import Transaction, TransactionKind
from app.proto import pnl_pb2
from app.services.currency import FxProvider
from app.services.market_data import Quote, QuoteProvider, SecurityProfile
from app.services.streaming import pnl_events
from tests.test_questrade import API, LOGIN, token_payload


class FakeProvider(QuoteProvider):
    def __init__(self, price="110"):
        self.price = price

    async def get_quotes(self, symbols):
        return {s: Quote(s, D(self.price), "CAD", datetime(2026, 6, 1), previous_close=D(100), volume=500) for s in symbols}

    async def get_profiles(self, symbols):
        return {"RY.TO": SecurityProfile("stock", "Royal Bank of Canada", "Financial Services", "Banks - Diversified",
                                         "Canada", D(250_000_000_000), "CAD", D("14.5"), "https://www.rbc.com")}


class FakeFx(FxProvider):
    async def get_rates(self, currencies, base):
        return {"CAD": D(1)}


@pytest.fixture
def seeded(db_engine):
    factory = sessionmaker(bind=db_engine, expire_on_commit=False)
    with factory() as db:
        db.add(AccountRecord(id=1, user_id=1, platform="questrade", external_id="1", account_number="1",
                             account_type="TFSA", status="Active"))
        db.add(Transaction(account_id=1, external_id="x", kind=TransactionKind.BUY.value, symbol="RY.TO",
                           trade_date=datetime(2026, 1, 2), quantity=D(10), price=D(100), fee=D(0), currency="CAD"))
        db.add(Position(account_id=1, symbol="RY.TO", quantity=D(10), average_cost=D(99), currency="CAD",
                        synced_at=datetime(2026, 1, 3)))
        db.commit()
    return factory


def decode(frame: str) -> pnl_pb2.PnLUpdate:
    assert frame.startswith("event: pnl\ndata: ") and frame.endswith("\n\n")
    message = pnl_pb2.PnLUpdate()
    message.ParseFromString(base64.b64decode(frame.split("data: ")[1].strip()))
    return message


async def test_events_are_base64_protobuf(seeded):
    frames = [f async for f in pnl_events(seeded, FakeProvider(), 1, 0, max_events=2, fx=FakeFx())]
    assert len(frames) == 2
    update = decode(frames[0])
    p = update.positions[0]
    assert (p.symbol, p.unrealized_pnl, p.unrealized_pct, p.status) == ("RY.TO", 100.0, 10.0, pnl_pb2.STATUS_OK)
    assert p.source == pnl_pb2.SOURCE_TRANSACTIONS
    assert update.totals[0].currency == "CAD" and update.totals[0].market_value == 1100.0
    assert update.HasField("base_total") and update.base_total.unrealized_pnl == 100.0
    assert p.asset_class == "stock"
    assert p.HasField("day_change_pct") and (p.day_change_pct, p.volume) == (10.0, 500)
    assert [(a.account_id, a.total, a.holdings, a.complete) for a in update.accounts] == [(1, 1100.0, 1, True)]
    assert update.HasField("total_assets_base") and update.total_assets_base == 1100.0
    assert p.first_buy_ms == int(datetime(2026, 1, 2).replace(tzinfo=__import__("datetime").timezone.utc).timestamp() * 1000)


async def test_events_survive_provider_errors(seeded):
    class Boom(QuoteProvider):
        async def get_quotes(self, symbols):
            raise RuntimeError("yahoo down")

    frames = [f async for f in pnl_events(seeded, Boom(), 1, 0, max_events=1)]
    assert frames == [": pnl update failed\n\n"]


async def test_stream_endpoint_is_sse_and_polls_at_configured_interval(seeded, monkeypatch):
    monkeypatch.setattr(stream_api, "SessionLocal", seeded)
    monkeypatch.setattr(settings, "PNL_STREAM_INTERVAL_SECONDS", 5)
    response = await stream_api.stream_pnl(user_id=1, provider=FakeProvider(), fx=FakeFx())
    assert response.media_type == "text/event-stream"
    first = await response.body_iterator.__anext__()
    assert decode(first).positions[0].symbol == "RY.TO"
    await response.body_iterator.aclose()


def test_rest_endpoints(seeded):
    def override_db():
        with seeded() as db:
            yield db

    app.dependency_overrides.update({
        get_db: override_db, current_user_id: lambda: 1,
        positions_api.get_quote_provider: lambda: FakeProvider("90"),
        positions_api.get_fx_provider: FakeFx,
    })
    try:
        client = TestClient(app)
        body = client.get("/api/positions").json()
        assert body["positions"][0]["unrealized_pnl"] == -100.0
        assert body["totals"][0]["unrealized_pct"] == -10.0
        assert body["base_total"]["currency"] == "CAD" and body["positions"][0]["source"] == "transactions"
        assert body["positions"][0]["asset_class"] == "stock"
        assert (body["positions"][0]["day_change_pct"], body["positions"][0]["volume"]) == (-10.0, 500)
        profiles = client.get("/api/holdings/profiles").json()
        assert profiles == {"RY.TO": {
            "asset_class": "stock", "name": "Royal Bank of Canada", "sector": "Financial Services",
            "industry": "Banks - Diversified", "country": "Canada", "market_cap": 250_000_000_000.0,
            "market_cap_currency": "CAD", "pe": 14.5, "website": "https://www.rbc.com"}}
        assert body["accounts"][0]["total"] == 900.0 and body["accounts"][0]["cash"] == []
        assert (body["base_currency"], body["cash_base"], body["total_assets_base"]) == ("CAD", 0.0, 900.0)
        txs = client.get("/api/transactions", params={"symbol": "RY.TO"}).json()
        assert [t["kind"] for t in txs["items"]] == ["BUY"] and txs["total"] == 1
        assert client.get("/api/transactions", params={"symbol": "NOPE"}).json()["items"] == []
    finally:
        app.dependency_overrides.clear()


@respx.mock
def test_sync_endpoint_end_to_end(seeded, monkeypatch):
    monkeypatch.setattr(settings, "TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "QUESTRADE_CLIENT_ID", "cid")
    monkeypatch.setattr(settings, "QUESTRADE_REDIRECT_URI", "http://localhost/cb")
    respx.get(f"{LOGIN}/oauth2/token").respond(json=token_payload())
    respx.get(f"{API}v1/accounts").respond(json={"accounts": [{
        "type": "TFSA", "number": "1", "status": "Active", "isPrimary": True, "clientAccountType": "Individual"}]})
    respx.get(f"{API}v1/accounts/1/positions").respond(json={"positions": []})
    activity = ({
        "tradeDate": "2026-03-02T00:00:00.000000-05:00", "action": "Buy", "symbol": "RY.TO", "symbolId": 1,
        "description": "d", "currency": "CAD", "quantity": 1, "price": 10, "grossAmount": -10,
        "commission": 0, "netAmount": -10, "type": "Trades"})
    # The sync walks 30-day windows; only the first one has the activity.
    pages = iter([{"activities": [activity]}])
    respx.get(f"{API}v1/accounts/1/activities").mock(
        side_effect=lambda request: httpx.Response(200, json=next(pages, {"activities": []})))

    import asyncio
    from app.integrations import questrade

    async def connect():
        with seeded() as db:
            async with httpx.AsyncClient() as c:
                await questrade.exchange_code("code", 1, db, c)
    asyncio.run(connect())

    def override_db():
        with seeded() as db:
            yield db

    app.dependency_overrides.update({get_db: override_db, current_user_id: lambda: 1})
    try:
        client = TestClient(app)
        first = client.post("/api/sync/questrade").json()
        assert first["accounts"] == 1 and first["transactions_added"] == 1
        assert client.post("/api/sync/questrade").json()["transactions_added"] == 0
        assert client.post("/api/sync/snaptrade").status_code == 404
        [conn] = client.get("/api/connections").json()
        assert conn["status"] == "active" and conn["last_synced_at"]

        respx.get(f"{LOGIN}/oauth2/token").respond(400)
        respx.get(f"{API}v1/accounts").respond(401)
        response = client.post("/api/sync/questrade")
        assert response.status_code == 409 and response.json()["code"] == "needs_reauth"
        assert client.get("/api/connections").json()[0]["status"] == "needs_reauth"
    finally:
        app.dependency_overrides.clear()

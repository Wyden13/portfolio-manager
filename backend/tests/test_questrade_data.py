from datetime import datetime
from decimal import Decimal

import httpx
import respx

from app.integrations import questrade
from app.integrations.questrade import QuestradeAdapter, parse_activities
from app.models.transaction import TransactionKind
from tests.test_questrade import API, LOGIN, config, token_payload  # noqa: F401

BUY = {
    "tradeDate": "2026-03-02T00:00:00.000000-05:00", "transactionDate": "2026-03-02T00:00:00.000000-05:00",
    "settlementDate": "2026-03-04T00:00:00.000000-05:00", "action": "Buy", "symbol": "RY.TO",
    "symbolId": 34658, "description": "BUY RY", "currency": "CAD", "quantity": 10, "price": 100.5,
    "grossAmount": -1005, "commission": -4.95, "netAmount": -1009.95, "type": "Trades",
}
SELL = {**BUY, "action": "Sell", "quantity": -4, "price": 110, "grossAmount": 440, "commission": -4.95, "netAmount": 435.05}
DIV = {**BUY, "action": "DIV", "type": "Dividends", "quantity": 0, "price": 0, "grossAmount": 12, "commission": 0, "netAmount": 12}


def test_parse_activities_normalizes_sign_kind_and_time():
    buy, sell, div = parse_activities([BUY, SELL, DIV])
    assert (buy.kind, sell.kind, div.kind) == (TransactionKind.BUY, TransactionKind.SELL, TransactionKind.DIVIDEND)
    assert sell.quantity == Decimal(4) and buy.fee == Decimal("4.95")
    assert buy.trade_date == datetime(2026, 3, 2, 5, 0)  # UTC


def test_identical_rows_get_distinct_stable_ids():
    first = parse_activities([BUY, BUY])
    again = parse_activities([BUY, BUY])
    assert first[0].external_id != first[1].external_id
    assert [t.external_id for t in first] == [t.external_id for t in again]


@respx.mock
async def test_positions_and_balances(db):
    respx.get(f"{LOGIN}/oauth2/token").respond(json=token_payload())
    respx.get(f"{API}v1/accounts/1/positions").respond(json={"positions": [
        {"symbol": "RY.TO", "openQuantity": 6, "averageEntryPrice": 100.5},
        {"symbol": "AAPL", "openQuantity": 0, "averageEntryPrice": 1},
    ]})
    respx.get(f"{API}v1/accounts/1/balances").respond(json={"perCurrencyBalances": [
        {"currency": "CAD", "cash": 10.5, "marketValue": 600}]})
    async with httpx.AsyncClient() as client:
        conn = await questrade.exchange_code("c", 1, db, client)
        adapter = QuestradeAdapter(conn, db, client)
        positions = await adapter.get_positions(1)
        balances = await adapter.get_balances(1)
    assert [(p.symbol, p.currency, p.average_cost) for p in positions] == [("RY.TO", "CAD", Decimal("100.5"))]
    assert balances[0].cash == Decimal("10.5")


@respx.mock
async def test_transactions_split_into_31_day_windows(db):
    respx.get(f"{LOGIN}/oauth2/token").respond(json=token_payload())
    route = respx.get(f"{API}v1/accounts/1/activities").respond(json={"activities": []})
    async with httpx.AsyncClient() as client:
        conn = await questrade.exchange_code("c", 1, db, client)
        await QuestradeAdapter(conn, db, client).get_transactions(
            1, start=datetime(2026, 1, 1), end=datetime(2026, 3, 15))
    assert route.call_count == 3
    assert route.calls[0].request.url.params["startTime"] == "2026-01-01T00:00:00+00:00"
    assert route.calls[1].request.url.params["startTime"] > route.calls[0].request.url.params["endTime"]

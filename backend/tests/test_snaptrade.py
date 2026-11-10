from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

from cryptography.fernet import Fernet

import pytest
from snaptrade_client import ApiException

from app.config import settings
from app.integrations import snaptrade
from app.integrations.base import ReauthRequired
from app.integrations.snaptrade import SnapTradeAdapter
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
            get_user_holdings=self.get_user_holdings,
            get_account_activities=self.get_account_activities,
        )

    def list_user_accounts(self, **kw):
        return resp([{"id": "uuid-1", "number": "123", "raw_type": "TFSA", "status": "open",
                      "institution_name": "Wealthsimple"}])

    def get_user_holdings(self, **kw):
        return resp({
            "balances": [{"currency": {"code": "CAD"}, "cash": 5}],
            "positions": [
                {"symbol": {"symbol": {"symbol": "XEQT.TO"}}, "units": 3, "average_purchase_price": 30.1,
                 "currency": {"code": "CAD"}},
                {"symbol": {"symbol": {"symbol": "OLD"}}, "units": 0, "currency": {"code": "USD"}},
            ],
        })

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

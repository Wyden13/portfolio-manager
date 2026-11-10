from datetime import datetime
from decimal import Decimal as D

from sqlalchemy import select

from app.integrations.base import BrokerageAdapter, RawPosition, RawTransaction
from app.models.account import Account, AccountRecord, AccountStatus
from app.models.position import Position
from app.models.transaction import Transaction, TransactionKind
from app.services.synchronization import sync_connection


def raw(id, day):
    return RawTransaction(id, TransactionKind.BUY, "RY.TO", datetime(2026, 1, day), D(1), D(10), D(-10), D(0), D(-10), "CAD")


class FakeAdapter(BrokerageAdapter):
    platform = "fake"

    def __init__(self):
        self.txs = [raw("a", 1), raw("b", 5)]
        self.positions = [RawPosition("RY.TO", D(2), D(10), "CAD")]
        self.starts = []

    async def get_accounts(self):
        return [Account("fake", 1, 99, "TFSA", "99", AccountStatus.Active, True, "Individual")]

    async def get_balances(self, account_id):
        return []

    async def get_positions(self, account_id):
        return self.positions

    async def get_transactions(self, account_id, start=None, end=None):
        self.starts.append(start)
        return [t for t in self.txs if start is None or t.trade_date >= start]


async def test_sync_is_idempotent_and_incremental(db):
    adapter = FakeAdapter()
    first = await sync_connection(db, adapter)
    assert (first.accounts, first.transactions_added, first.positions) == (1, 2, 1)

    adapter.txs.append(raw("c", 9))
    second = await sync_connection(db, adapter)
    assert second.transactions_added == 1
    assert adapter.starts == [None, datetime(2026, 1, 4)]  # newest stored (Jan 5) minus 1 day

    third = await sync_connection(db, adapter)
    assert third.transactions_added == 0
    assert len(db.scalars(select(Transaction)).all()) == 3
    assert len(db.scalars(select(AccountRecord)).all()) == 1


async def test_sync_updates_and_removes_positions(db):
    adapter = FakeAdapter()
    await sync_connection(db, adapter)
    adapter.positions = [RawPosition("XEQT.TO", D(1), None, "CAD")]
    await sync_connection(db, adapter)
    assert [p.symbol for p in db.scalars(select(Position))] == ["XEQT.TO"]

import asyncio
from datetime import datetime, timedelta
from decimal import Decimal as D

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.integrations.base import BrokerageAdapter, RawPosition, RawTransaction, ReauthRequired
from app.models.account import Account, AccountRecord, AccountStatus
from app.models.connection import BrokerConnection, ConnectionStatus
from app.models.position import Position
from app.models.transaction import Transaction, TransactionKind
from app.services import scheduler, synchronization
from app.services.synchronization import SyncInProgress, mark_duplicates, run_sync, sync_connection


def raw(id, day):
    when = day if isinstance(day, datetime) else datetime(2026, 1, day)
    return RawTransaction(id, TransactionKind.BUY, "RY.TO", when, D(1), D(10), D(-10), D(0), D(-10), "CAD")


def account(id="99", number="99", institution="Fake"):
    return Account("fake", 1, id, "TFSA", number, AccountStatus.Active, True, "Individual", institution)


class FakeAdapter(BrokerageAdapter):
    platform = "fake"

    def __init__(self):
        self.accounts = [account()]
        self.txs = [raw("a", 1), raw("b", 5)]
        self.positions = [RawPosition("RY.TO", D(2), D(10), "CAD")]
        self.windows = []
        self.error = None

    async def get_accounts(self):
        if self.error:
            raise self.error
        return self.accounts

    async def get_balances(self, account_id):
        return []

    async def get_positions(self, account_id):
        return self.positions

    async def get_transactions(self, account_id, start=None, end=None):
        self.windows.append((start, end))
        return [t for t in self.txs if start is None or t.trade_date >= start]


@pytest.fixture
def conn(db):
    connection = BrokerConnection(user_id=1, platform="fake", encrypted_refresh_token="x")
    db.add(connection)
    db.commit()
    return connection


async def test_sync_is_idempotent_and_resumes_from_previous_end(db, conn):
    adapter = FakeAdapter()
    first = await sync_connection(db, conn, adapter)
    assert (first.accounts, first.transactions_added, first.positions) == (1, 2, 1)
    first_end = adapter.windows[0][1]
    assert adapter.windows[0][0] is None
    assert db.scalar(select(AccountRecord)).transactions_synced_through == first_end

    adapter.txs.append(raw("c", first_end - timedelta(days=2)))  # posted late, inside the overlap
    second = await sync_connection(db, conn, adapter)
    assert second.transactions_added == 1
    assert adapter.windows[1][0] == first_end - synchronization.SYNC_OVERLAP

    third = await sync_connection(db, conn, adapter)
    assert third.transactions_added == 0
    assert len(db.scalars(select(Transaction)).all()) == 3
    assert len(db.scalars(select(AccountRecord)).all()) == 1


async def test_sync_updates_and_removes_positions(db, conn):
    adapter = FakeAdapter()
    await sync_connection(db, conn, adapter)
    adapter.positions = [RawPosition("XEQT.TO", D(1), None, "CAD")]
    await sync_connection(db, conn, adapter)
    assert [p.symbol for p in db.scalars(select(Position))] == ["XEQT.TO"]


async def test_accounts_the_broker_stops_returning_are_marked_removed_and_can_return(db, conn):
    adapter = FakeAdapter()
    adapter.accounts = [account("1", "1"), account("2", "2")]
    await sync_connection(db, conn, adapter)
    adapter.accounts = [account("1", "1")]
    await sync_connection(db, conn, adapter)
    removed = {a.external_id: a.removed_at is not None for a in db.scalars(select(AccountRecord))}
    assert removed == {"1": False, "2": True}

    adapter.accounts = [account("1", "1"), account("2", "2")]
    await sync_connection(db, conn, adapter)
    assert all(a.removed_at is None for a in db.scalars(select(AccountRecord)))


def test_aggregator_accounts_mirroring_a_direct_one_are_marked_duplicate(db):
    direct = AccountRecord(user_id=1, platform="questrade", external_id="123", account_number="123",
                           account_type="TFSA", status="Active", institution="Questrade")
    mirror = AccountRecord(user_id=1, platform="snaptrade", external_id="uuid", account_number="12-3",
                           account_type="TFSA", status="Active", institution="QUESTRADE")
    other = AccountRecord(user_id=1, platform="snaptrade", external_id="uuid2", account_number="999",
                          account_type="TFSA", status="Active", institution="Wealthsimple")
    db.add_all([direct, mirror, other])
    db.flush()
    mark_duplicates(db, 1)
    assert (mirror.duplicate_of_id, other.duplicate_of_id) == (direct.id, None)


async def test_run_sync_state_transitions(db, conn):
    adapter = FakeAdapter()
    adapter.accounts = []
    await run_sync(db, conn, adapter)
    assert conn.status == ConnectionStatus.PENDING.value  # nothing linked yet

    adapter.accounts = [account()]
    await run_sync(db, conn, adapter)
    assert (conn.status, conn.last_error) == (ConnectionStatus.ACTIVE.value, None) and conn.last_synced_at

    adapter.error = RuntimeError("broker down")
    with pytest.raises(RuntimeError):
        await run_sync(db, conn, adapter)
    assert conn.status == ConnectionStatus.ERROR.value and "broker down" in conn.last_error

    adapter.error = ReauthRequired("token rejected")
    with pytest.raises(ReauthRequired):
        await run_sync(db, conn, adapter)
    assert conn.status == ConnectionStatus.NEEDS_REAUTH.value


async def test_run_sync_rejects_a_concurrent_sync_of_the_same_connection(db, conn):
    gate = asyncio.Event()

    class Slow(FakeAdapter):
        async def get_accounts(self):
            await gate.wait()
            return []

    first = asyncio.create_task(run_sync(db, conn, Slow()))
    await asyncio.sleep(0)
    with pytest.raises(SyncInProgress):
        await run_sync(db, conn, FakeAdapter())
    gate.set()
    await first


async def test_scheduler_skips_needs_reauth_and_unknown_platforms(db_engine, monkeypatch):
    factory = sessionmaker(bind=db_engine, expire_on_commit=False)
    with factory() as db:
        db.add_all([
            BrokerConnection(user_id=1, platform="questrade", encrypted_refresh_token="x",
                             status=ConnectionStatus.NEEDS_REAUTH.value),
            BrokerConnection(user_id=2, platform="snaptrade", encrypted_refresh_token="x",
                             status=ConnectionStatus.ERROR.value),
            BrokerConnection(user_id=3, platform="other", encrypted_refresh_token="x"),
        ])
        db.commit()
    synced = []

    async def fake_run_sync(db, connection, adapter):
        synced.append(connection.platform)
        raise RuntimeError("one failure must not stop the pass")

    monkeypatch.setattr(scheduler, "run_sync", fake_run_sync)
    monkeypatch.setattr(scheduler, "SnapTradeAdapter", lambda connection, client: object())
    await scheduler.sync_all(factory, snaptrade_client_factory=lambda: None)
    assert synced == ["snaptrade"]

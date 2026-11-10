"""Connect the demo institutions through the app's real connect + sync code paths."""
from dataclasses import dataclass

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.integrations import questrade, snaptrade
from app.integrations.questrade import QuestradeAdapter
from app.integrations.snaptrade import SnapTradeAdapter
from app.models.account import AccountRecord
from app.models.transaction import Transaction
from app.services.synchronization import run_sync
from demo.catalog import IBKR_ACCOUNTS, QUESTRADE_ACCOUNTS, WEALTHSIMPLE_ACCOUNTS
from demo.fake_questrade import FakeQuestrade
from demo.fake_snaptrade import FakeSnapTrade
from demo.market import Market
from demo.world import build_books

DEMO_USER_ID = 1  # matches the app's current_user_id placeholder


@dataclass
class DemoBrokers:
    questrade: FakeQuestrade
    snaptrade: FakeSnapTrade

    def http_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self.questrade.transport())


def build_brokers(market: Market, seed: int) -> DemoBrokers:
    return DemoBrokers(
        FakeQuestrade(build_books(QUESTRADE_ACCOUNTS, market, seed), market),
        FakeSnapTrade(build_books(WEALTHSIMPLE_ACCOUNTS + IBKR_ACCOUNTS, market, seed + 1), market),
    )


async def connect_and_sync(session_factory, brokers: DemoBrokers) -> None:
    """What a user would do: authorize Questrade, link brokerages via SnapTrade, then sync both."""
    async with brokers.http_client() as http:
        with session_factory() as db:
            connection = await questrade.exchange_code("demo-authorization-code", DEMO_USER_ID, db, http)
            await run_sync(db, connection, QuestradeAdapter(connection, db, http))
    with session_factory() as db:
        connection = snaptrade.register_user(brokers.snaptrade, db, DEMO_USER_ID)
        snaptrade.portal_url(brokers.snaptrade, connection)
        await run_sync(db, connection, SnapTradeAdapter(connection, brokers.snaptrade))


def summary(db: Session) -> list[tuple[str, str, int]]:
    """(institution, account type, transaction count) per stored account."""
    rows = db.execute(
        select(AccountRecord.institution, AccountRecord.account_type, func.count(Transaction.id))
        .join(Transaction, Transaction.account_id == AccountRecord.id, isouter=True)
        .group_by(AccountRecord.id).order_by(AccountRecord.institution, AccountRecord.account_type)
    )
    return [tuple(r) for r in rows]

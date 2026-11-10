"""The demo drives the real connect/sync/P&L code with simulated brokers; check it end to end."""
from cryptography.fernet import Fernet
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.connection import BrokerConnection
from app.models.transaction import Transaction
from app.services.currency import QuoteFxProvider
from app.services.market_data import YFinanceProvider
from app.services.portfolio import build_pnl, load_holdings
from demo.market import HISTORY_DAYS, Market
from demo.seed import build_brokers, connect_and_sync, summary


async def test_demo_seed_flows_through_real_sync_and_reconciles(db_engine, monkeypatch):
    monkeypatch.setattr(settings, "TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "SYNC_INITIAL_LOOKBACK_DAYS", HISTORY_DAYS + 7)
    factory = sessionmaker(bind=db_engine, expire_on_commit=False)
    market = Market(3)
    brokers = build_brokers(market, 3)
    await connect_and_sync(factory, brokers)

    with factory() as db:
        assert {c.status for c in db.scalars(select(BrokerConnection))} == {"active"}
        institutions = {(i, t) for i, t, n in summary(db) if n > 0}
        assert institutions == {("Questrade", "TFSA"), ("Questrade", "Margin"), ("Wealthsimple", "TFSA"),
                                ("Wealthsimple", "RRSP"), ("Interactive Brokers", "Individual")}
        broker_rows = sum(len(b.activities) for b in brokers.questrade.books.values()) + \
            sum(len(b.activities) for b in brokers.snaptrade.books.values())
        assert db.scalar(select(func.count(Transaction.id))) == broker_rows

        holdings = load_holdings(db, 1)
    by_symbol = {(h.symbol, h.source) for h in holdings}
    assert ("TD.TO", "broker") in by_symbol  # transferred in: no purchase on record
    assert all(src == "transactions" for sym, src in by_symbol if sym != "TD.TO")

    provider = YFinanceProvider(ticker_factory=market.ticker)
    snapshot = await build_pnl(holdings, provider, QuoteFxProvider(provider), "CAD")
    assert {p.status for p in snapshot.positions} == {"ok"}
    assert {t.currency for t in snapshot.totals} == {"CAD", "USD", "GBP"}
    assert snapshot.base_total is not None and snapshot.base_total.currency == "CAD"
    vod = next(p for p in snapshot.positions if p.symbol == "VOD.L")
    assert vod.currency == "GBP" and vod.price < 5  # pence converted to pounds

    before = snapshot.base_total.market_value
    for _ in range(20):
        market.tick()
    after = (await build_pnl(holdings, provider, QuoteFxProvider(provider), "CAD")).base_total.market_value
    assert after != before  # the simulated feed moves the live numbers

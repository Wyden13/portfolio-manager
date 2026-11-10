from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D

import pandas as pd
from fastapi.testclient import TestClient

from app.api import positions as positions_api
from app.api.accounts import current_user_id
from app.database import get_db
from app.main import app
from app.models.transaction import TransactionKind
from app.services.market_data import Candle, HistoryProvider, PriceHistory, YFinanceProvider, day_timestamp
from app.services.performance import Holding, account_value_history, value_history
from tests.test_api_stream import FakeFx, seeded  # noqa: F401
from tests.test_pnl import cash_tx, tx


async def test_yfinance_history_parses_frame_skips_nan_and_converts_pence():
    calls = []

    class T:
        def __init__(self, symbol):
            self.fast_info = {"currency": "GBp"}

        def history(self, **kw):
            calls.append(kw)
            index = pd.DatetimeIndex(["2026-03-02", "2026-03-03"]).tz_localize("Europe/London")
            return pd.DataFrame({"Open": [200.0, float("nan")], "High": [210.0, 1.0], "Low": [190.0, 1.0],
                                 "Close": [205.0, 1.0], "Volume": [1000, 5]}, index=index)

    provider = YFinanceProvider(ticker_factory=T)
    history = await provider.get_history("VOD.L", date(2026, 3, 1), date(2026, 3, 3), "1d")
    assert history.currency == "GBP" and len(history.candles) == 1
    c = history.candles[0]
    assert (c.day, c.close, c.volume, c.time) == (date(2026, 3, 2), D("2.05"), 1000, day_timestamp(date(2026, 3, 2)))
    assert calls[0]["end"] == date(2026, 3, 4)  # exclusive end
    await provider.get_history("VOD.L", date(2026, 3, 1), date(2026, 3, 3), "1d")
    assert len(calls) == 1  # cached


def test_value_history_replays_trades_backwards_from_todays_quantity():
    # Holds 15 today (broker figure); stored trades: buy 10 on Jan 5, buy 5 on Jan 7.
    holding = Holding(1, "RY.TO", "CAD", quantity=D(15), cost_basis=D(1500))
    trades = [tx(1, TransactionKind.BUY, 10, 100, 5), tx(2, TransactionKind.BUY, 5, 100, 7)]
    closes = {"RY.TO": {date(2026, 1, 2): D(10), date(2026, 1, 5): D(11), date(2026, 1, 8): D(12)}}
    assert value_history([holding], trades, closes) == [
        (date(2026, 1, 2), D(0)),        # before any stored buy, the 15 shares were bought later
        (date(2026, 1, 5), D(110)),      # 10 held after Jan 5 trade
        (date(2026, 1, 8), D(180)),      # 15 held
    ]


def test_account_value_history_adds_cash_and_converts_at_spot():
    # Account 1: deposit 2000 CAD on Jan 2, buy 10 RY.TO at 100 on Jan 5 (cash -1000).
    # Account 2: deposit 100 USD on Jan 6 only (no holdings).
    ry = Holding(1, "RY.TO", "CAD", quantity=D(10), cost_basis=D(1000))
    ledger = [
        cash_tx(1, TransactionKind.DEPOSIT, 2000, 2), tx(2, TransactionKind.BUY, 10, 100, 5),
        cash_tx(3, TransactionKind.DEPOSIT, 100, 6, cur="USD", account=2),
    ]
    ledger[1].net_amount = D(-1000)
    closes = {"RY.TO": {date(2026, 1, 2): D(90), date(2026, 1, 5): D(100), date(2026, 1, 8): D(120)}}
    series = account_value_history([ry], ledger, closes, {"CAD": D(1), "USD": D("1.5")})
    assert series[1] == [(date(2026, 1, 2), D(2000)), (date(2026, 1, 5), D(2000)), (date(2026, 1, 8), D(2200))]
    assert series[2] == [(date(2026, 1, 8), D(150))]  # nothing before its first activity on Jan 6
    # Without a USD rate the USD cash is left out rather than mixed in unconverted.
    assert account_value_history([ry], ledger, closes, {"CAD": D(1)}).get(2) is None


def test_shares_the_trades_dont_explain_only_count_from_when_they_can_have_arrived():
    # Broker reports 40 TD.TO in account 1 with no stored buy: transferred in on Jan 7 (an OTHER row).
    # Account 2 holds 15 RY.TO but only 5 were bought on Jan 6; its stored history starts Jan 5
    # (the rest predate the sync lookback). Neither may show value before those dates.
    td = Holding(1, "TD.TO", "CAD", quantity=D(40), cost_basis=None, source="broker")
    ry = Holding(2, "RY.TO", "CAD", quantity=D(15), cost_basis=D(1500), source="broker")
    transfer = tx(3, TransactionKind.OTHER, 40, 0, 7, symbol="TD.TO")
    ledger = [
        cash_tx(1, TransactionKind.DEPOSIT, 100, 3), transfer,
        cash_tx(2, TransactionKind.DIVIDEND, 0, 5, account=2), tx(4, TransactionKind.BUY, 5, 10, 6, account=2),
    ]
    ledger[3].net_amount = D(-50)
    days = [date(2026, 1, d) for d in (2, 5, 6, 7, 8)]
    closes = {"TD.TO": {d: D(1) for d in days}, "RY.TO": {d: D(10) for d in days}}
    series = account_value_history([td, ry], ledger, closes, {"CAD": D(1)})
    assert series[1] == [(date(2026, 1, 5), D(100)), (date(2026, 1, 6), D(100)), (date(2026, 1, 7), D(140)),
                         (date(2026, 1, 8), D(140))]
    # Jan 5: the 10 pre-lookback shares; Jan 6: plus the 5 bought (and the 50 paid for them).
    assert series[2] == [(date(2026, 1, 5), D(100)), (date(2026, 1, 6), D(100)), (date(2026, 1, 7), D(100)),
                         (date(2026, 1, 8), D(100))]
    assert value_history([td, ry], ledger, closes)[:3] == [
        (date(2026, 1, 2), D(0)), (date(2026, 1, 5), D(100)), (date(2026, 1, 6), D(150))]


class FakeHistory(HistoryProvider):
    async def get_history(self, symbol, start, end, interval):
        FakeHistory.asked.append((start, end, interval))
        days = [end - timedelta(days=1), end]
        return PriceHistory(symbol, "CAD", [Candle(d, D(100), D(101), D(99), D(100 + i), 7) for i, d in enumerate(days)])


def test_history_and_value_endpoints(seeded):  # noqa: F811
    def override_db():
        with seeded() as db:
            yield db

    app.dependency_overrides.update({
        get_db: override_db, current_user_id: lambda: 1, positions_api.get_history_provider: FakeHistory,
        positions_api.get_fx_provider: FakeFx,
    })
    FakeHistory.asked = []
    try:
        client = TestClient(app)
        body = client.get("/api/history/RY.TO", params={"range": "1M", "interval": "1wk"}).json()
        assert body["currency"] == "CAD" and body["interval"] == "1wk" and body["candles"][1]["close"] == 101.0
        today = datetime.now(timezone.utc).date()
        assert body["candles"][1]["time"] == day_timestamp(today)
        assert client.get("/api/history/RY.TO", params={"range": "1W"}).status_code == 422
        assert client.get("/api/history/RY.TO", params={"range": "5Y", "interval": "1mo"}).status_code == 200
        assert FakeHistory.asked[-1][0] == today - timedelta(days=1826)
        assert client.get("/api/history/RY.TO", params={"range": "ALL"}).json()["range"] == "ALL"
        assert FakeHistory.asked[-1][0] == date(1970, 1, 2)

        value = client.get("/api/portfolio/value", params={"currency": "CAD", "range": "1M"}).json()
        assert value["points"][-1] == {"time": day_timestamp(today), "value": 1010.0}  # 10 sh x 101
        assert client.get("/api/portfolio/value", params={"currency": "USD"}).json()["points"] == []
        # ALL starts at the first stored activity (Jan 2, 2026 in the seed), weekly past ~13 months.
        client.get("/api/portfolio/value", params={"currency": "CAD", "range": "ALL"})
        start, _, interval = FakeHistory.asked[-1]
        assert start == date(2026, 1, 2) and interval == ("1d" if (today - start).days <= 400 else "1wk")

        accounts = client.get("/api/portfolio/value/accounts", params={"range": "1M"}).json()
        assert accounts["currency"] == "CAD" and accounts["fx"] == "spot"
        assert [a["account_id"] for a in accounts["accounts"]] == [1]
        assert accounts["accounts"][0]["points"][-1] == {"time": day_timestamp(today), "value": 1010.0}
        assert accounts["total"] == accounts["accounts"][0]["points"]
        assert client.get("/api/portfolio/value/accounts", params={"range": "5Y"}).json()["interval"] == "1wk"
    finally:
        app.dependency_overrides.clear()

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
from app.services.performance import Holding, value_history
from tests.test_api_stream import seeded  # noqa: F401
from tests.test_pnl import tx


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


class FakeHistory(HistoryProvider):
    async def get_history(self, symbol, start, end, interval):
        days = [end - timedelta(days=1), end]
        return PriceHistory(symbol, "CAD", [Candle(d, D(100), D(101), D(99), D(100 + i), 7) for i, d in enumerate(days)])


def test_history_and_value_endpoints(seeded):  # noqa: F811
    def override_db():
        with seeded() as db:
            yield db

    app.dependency_overrides.update({
        get_db: override_db, current_user_id: lambda: 1, positions_api.get_history_provider: FakeHistory,
    })
    try:
        client = TestClient(app)
        body = client.get("/api/history/RY.TO", params={"range": "1M", "interval": "1wk"}).json()
        assert body["currency"] == "CAD" and body["interval"] == "1wk" and body["candles"][1]["close"] == 101.0
        today = datetime.now(timezone.utc).date()
        assert body["candles"][1]["time"] == day_timestamp(today)
        assert client.get("/api/history/RY.TO", params={"range": "5Y"}).status_code == 422

        value = client.get("/api/portfolio/value", params={"currency": "CAD", "range": "1M"}).json()
        assert value["points"][-1] == {"time": day_timestamp(today), "value": 1010.0}  # 10 sh x 101
        assert client.get("/api/portfolio/value", params={"currency": "USD"}).json()["points"] == []
    finally:
        app.dependency_overrides.clear()

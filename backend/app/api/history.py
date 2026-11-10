import asyncio
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.accounts import current_user_id
from app.api.positions import get_history_provider
from app.database import get_db
from app.services.market_data import HistoryProvider, day_timestamp
from app.services.performance import value_history
from app.services.portfolio import load_trades

router = APIRouter(prefix="/api")

Range = Literal["1M", "3M", "6M", "1Y"]
RANGE_DAYS = {"1M": 30, "3M": 91, "6M": 182, "1Y": 365}


def _window(range_: str):
    end = datetime.now(timezone.utc).date()
    return end - timedelta(days=RANGE_DAYS[range_]), end


@router.get("/history/{symbol}")
async def price_history(
    symbol: str,
    range: Range = "6M",
    interval: Literal["1d", "1wk"] = "1d",
    provider: HistoryProvider = Depends(get_history_provider),
):
    """OHLC bars for one ticker; `time` is the bar's day at midnight UTC, in unix seconds."""
    start, end = _window(range)
    history = await provider.get_history(symbol, start, end, interval)
    return {
        "symbol": symbol, "currency": history.currency, "range": range, "interval": interval,
        "candles": [
            {"time": c.time, "open": float(c.open), "high": float(c.high), "low": float(c.low),
             "close": float(c.close), "volume": c.volume}
            for c in history.candles
        ],
    }


@router.get("/portfolio/value")
async def portfolio_value(
    currency: str,
    range: Range = "3M",
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    provider: HistoryProvider = Depends(get_history_provider),
):
    """Daily market value of today's holdings in one currency, replayed back through stored trades."""
    holdings, transactions = load_trades(db, user_id)
    holdings = [h for h in holdings if h.currency.upper() == currency.upper()]
    symbols = sorted({h.symbol for h in holdings})
    start, end = _window(range)
    histories = await asyncio.gather(*(provider.get_history(s, start, end, "1d") for s in symbols))
    closes = {
        h.symbol: {c.day: c.close for c in h.candles}
        for h in histories
        if h.candles and h.currency.upper() == currency.upper()  # skip mismatched listings
    }
    points = value_history(holdings, transactions, closes)
    return {
        "currency": currency, "range": range,
        "points": [{"time": day_timestamp(d), "value": round(float(v), 2)} for d, v in points],
    }

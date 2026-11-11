import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.accounts import current_user_id
from app.api.positions import get_fx_provider, get_history_provider
from app.config import settings
from app.database import get_db
from app.services.currency import FxProvider
from app.services.market_data import HistoryProvider, PriceHistory, day_timestamp
from app.services.performance import account_value_history, value_history
from app.services.portfolio import load_ledger, reconciled_holdings

router = APIRouter(prefix="/api")

Range = Literal["1M", "3M", "6M", "1Y", "5Y", "ALL"]
RANGE_DAYS = {"1M": 30, "3M": 91, "6M": 182, "1Y": 365, "5Y": 1826}
# ALL for a ticker: from before any listing; Yahoo returns what it has.
LISTING_START = date(1970, 1, 2)
# Value charts switch to weekly closes past this span to keep the replay and Yahoo calls small.
DAILY_MAX_DAYS = 400


def _window(range_: str, earliest: date | None = None):
    """[start, end] of a range ending today. ALL starts at `earliest` (or a year back without one)."""
    end = datetime.now(timezone.utc).date()
    if range_ == "ALL":
        return min(earliest or end - timedelta(days=RANGE_DAYS["1Y"]), end), end
    return end - timedelta(days=RANGE_DAYS[range_]), end


def _value_interval(start: date, end: date) -> str:
    return "1d" if (end - start).days <= DAILY_MAX_DAYS else "1wk"


def _first_activity(transactions) -> date | None:
    return min((t.trade_date.date() for t in transactions), default=None)


def _closes(histories: list[PriceHistory], currency_of: dict[str, str], interval: str, end: date):
    """Closes per symbol, skipping listings whose quote currency isn't the holding's.

    A weekly bar is keyed on its Monday but closes on the Friday, so it is moved to the Friday (or
    today, for this week's): trades and cash from that week then count with the close they produced.
    """
    shift = timedelta(days=4) if interval == "1wk" else timedelta(0)
    return {
        h.symbol: {min(c.day + shift, end): c.close for c in h.candles}
        for h in histories
        if h.candles and h.currency.upper() == currency_of[h.symbol].upper()
    }


@router.get("/history/{symbol}")
async def price_history(
    symbol: str,
    range: Range = "6M",
    interval: Literal["1d", "1wk", "1mo"] = "1d",
    provider: HistoryProvider = Depends(get_history_provider),
):
    """OHLC bars for one ticker; `time` is the bar's day at midnight UTC, in unix seconds."""
    start, end = _window(range, LISTING_START)
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
    """Daily market value of today's holdings in one currency, replayed back through the stored ledger."""
    ledger = load_ledger(db, user_id)
    holdings, _ = reconciled_holdings(db, user_id, ledger)
    holdings = [h for h in holdings if h.currency.upper() == currency.upper()]
    symbols = sorted({h.symbol for h in holdings})
    start, end = _window(range, _first_activity(ledger))
    interval = _value_interval(start, end)
    histories = await asyncio.gather(*(provider.get_history(s, start, end, interval) for s in symbols))
    closes = _closes(list(histories), {s: currency for s in symbols}, interval, end)
    points = value_history(holdings, ledger, closes)
    return {
        "currency": currency, "range": range,
        "points": [{"time": day_timestamp(d), "value": round(float(v), 2)} for d, v in points],
    }


@router.get("/portfolio/value/accounts")
async def account_values(
    range: Range = "1Y",
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    provider: HistoryProvider = Depends(get_history_provider),
    fx: FxProvider = Depends(get_fx_provider),
):
    """Value of each account (holdings replayed through stored trades, plus computed cash) in the
    base currency. Every day is converted at today's spot rates, not that day's."""
    ledger = load_ledger(db, user_id)
    holdings, _ = reconciled_holdings(db, user_id, ledger)
    currency_of = {h.symbol: h.currency for h in holdings}
    symbols = sorted(currency_of)
    start, end = _window(range, _first_activity(ledger))
    interval = _value_interval(start, end)
    base = settings.BASE_CURRENCY.upper()
    histories, rates = await asyncio.gather(
        asyncio.gather(*(provider.get_history(s, start, end, interval) for s in symbols)),
        fx.get_rates(sorted({*currency_of.values(), *(t.currency for t in ledger if t.currency)}), base),
    )
    series = account_value_history(holdings, ledger, _closes(list(histories), currency_of, interval, end), rates)
    total: dict[date, float] = {}
    accounts = []
    for account_id, points in series.items():
        accounts.append({
            "account_id": account_id,
            "points": [{"time": day_timestamp(d), "value": round(float(v), 2)} for d, v in points],
        })
        for d, v in points:
            total[d] = total.get(d, 0.0) + float(v)
    return {
        "currency": base, "range": range, "interval": interval, "fx": "spot",
        "accounts": accounts,
        "total": [{"time": day_timestamp(d), "value": round(v, 2)} for d, v in sorted(total.items())],
    }

"""Simulated market: seeded daily OHLC history plus a live random walk, exposed through objects
shaped like yfinance's Ticker (fast_info + history()) so the real YFinanceProvider can consume them.
"""
import asyncio
import math
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import pandas as pd

from demo.catalog import FX_PAIRS, INSTRUMENTS

HISTORY_DAYS = 760
TRADING_DAYS_PER_YEAR = 252
# Per-second volatility of the live walk; exaggerated so a dashboard visibly moves within seconds.
LIVE_TICK_VOL = 0.0012
# Pull of the live price back towards the last close, per tick, so a long demo doesn't wander off.
LIVE_MEAN_REVERSION = 0.002
HISTORY_COLUMNS = ["Open", "High", "Low", "Close", "Volume", "Dividends", "Stock Splits"]


@dataclass
class Bar:
    day: date
    open: float
    high: float
    low: float
    close: float
    volume: int


@dataclass
class Series:
    yahoo: str
    currency: str  # as Yahoo reports it
    timezone: str
    bars: list[Bar]  # completed days, oldest first
    live: float
    live_high: float
    live_low: float
    live_volume: int


def today() -> date:
    return datetime.now(timezone.utc).date()


def trading_days(end: date, days: int) -> list[date]:
    start = end - timedelta(days=days)
    return [start + timedelta(days=i) for i in range(days) if (start + timedelta(days=i)).weekday() < 5]


def _walk(rng: random.Random, days: list[date], start: float, drift: float, vol: float, volume: int) -> list[Bar]:
    bars, close = [], start
    daily_vol = vol / math.sqrt(TRADING_DAYS_PER_YEAR)
    for day in days:
        open_ = close * math.exp(rng.gauss(0, daily_vol * 0.25))
        close = open_ * math.exp((drift - vol * vol / 2) / TRADING_DAYS_PER_YEAR + rng.gauss(0, daily_vol))
        high = max(open_, close) * (1 + abs(rng.gauss(0, daily_vol * 0.4)))
        low = min(open_, close) * (1 - abs(rng.gauss(0, daily_vol * 0.4)))
        bars.append(Bar(day, open_, high, low, close, int(volume * rng.uniform(0.5, 1.6))))
    return bars


class Market:
    def __init__(self, seed: int = 7):
        rng = random.Random(seed)
        self._rng = random.Random(seed + 1)
        days = trading_days(today(), HISTORY_DAYS)
        self.series: dict[str, Series] = {}
        for i in INSTRUMENTS.values():
            bars = _walk(rng, days, i.start_price, i.drift, i.vol, rng.randint(400_000, 9_000_000))
            self.series[i.yahoo] = Series(i.yahoo, i.quote_currency, i.timezone, bars, *([bars[-1].close] * 3), 0)
        for pair, (rate, vol) in FX_PAIRS.items():
            bars = _walk(rng, days, rate, 0.0, vol, 0)
            self.series[pair] = Series(pair, pair[3:6], "Europe/London", bars, *([bars[-1].close] * 3), 0)
        self.days = days
        self._closes = {y: {b.day: b.close for b in s.bars} for y, s in self.series.items()}

    def close_on(self, yahoo: str, day: date) -> float | None:
        """Close in Yahoo's quote currency on a completed trading day."""
        return self._closes[yahoo].get(day)

    def last_price(self, yahoo: str) -> float:
        return self.series[yahoo].live

    def tick(self) -> None:
        for s in self.series.values():
            anchor = s.bars[-1].close
            vol = LIVE_TICK_VOL / (4 if s.yahoo.endswith("=X") else 1)
            s.live *= math.exp(self._rng.gauss(0, vol) - LIVE_MEAN_REVERSION * math.log(s.live / anchor))
            s.live_high, s.live_low = max(s.live_high, s.live), min(s.live_low, s.live)
            s.live_volume += self._rng.randint(0, 4_000)

    async def run(self, interval: float) -> None:
        while True:
            await asyncio.sleep(interval)
            self.tick()

    def ticker(self, yahoo: str) -> "Ticker":
        return Ticker(self, yahoo)


class FastInfo:
    """The parts of yfinance's FastInfo the app reads (dict-style and attribute access)."""

    def __init__(self, market: Market, yahoo: str):
        self._market, self._yahoo = market, yahoo

    @property
    def last_price(self) -> float:
        return self._market.last_price(self._yahoo)

    @property
    def currency(self) -> str:
        return self._market.series[self._yahoo].currency

    def __getitem__(self, key: str):
        if key in ("last_price", "lastPrice"):
            return self.last_price
        if key == "currency":
            return self.currency
        raise KeyError(key)


class Ticker:
    """Stand-in for yfinance.Ticker backed by the simulated market."""

    def __init__(self, market: Market, symbol: str):
        if symbol not in market.series:
            raise KeyError(f"{symbol}: possibly delisted; no price data found")
        self._market, self.ticker = market, symbol

    @property
    def fast_info(self) -> FastInfo:
        return FastInfo(self._market, self.ticker)

    def history(self, start=None, end=None, interval: str = "1d", auto_adjust: bool = True, **_) -> pd.DataFrame:
        s = self._market.series[self.ticker]
        bars = list(s.bars)
        if today().weekday() < 5:  # today's bar is still forming
            bars.append(Bar(today(), s.bars[-1].close, s.live_high, s.live_low, s.live, s.live_volume))
        start = pd.Timestamp(start).date() if start is not None else bars[0].day
        end = pd.Timestamp(end).date() if end is not None else today() + timedelta(days=1)
        bars = [b for b in bars if start <= b.day < end]  # end is exclusive, as in yfinance
        frame = pd.DataFrame(
            [[b.open, b.high, b.low, b.close, b.volume, 0.0, 0.0] for b in bars],
            index=pd.DatetimeIndex([pd.Timestamp(b.day) for b in bars], name="Date").tz_localize(s.timezone),
            columns=HISTORY_COLUMNS,
        )
        if interval == "1wk" and not frame.empty:
            frame = frame.resample("W-MON", label="left", closed="left").agg({
                "Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum",
                "Dividends": "sum", "Stock Splits": "sum",
            }).dropna(subset=["Close"])
        return frame

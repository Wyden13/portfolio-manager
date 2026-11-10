"""Broker-side books for the demo accounts: what each institution would have on record.

Activities are generated month by month from the simulated closes, and positions are kept the way
a broker keeps them (average cost including commissions), independently of the app's own logic.
"""
import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from itertools import groupby

from demo.catalog import INSTRUMENTS, DemoAccount
from demo.market import Market

QUARTER_END_MONTHS = (3, 6, 9, 12)


@dataclass
class Activity:
    id: str
    kind: str  # BUY | SELL | DIVIDEND | DEPOSIT | TRANSFER
    day: date
    symbol: str | None
    quantity: float  # positive; kind gives direction
    price: float  # per share, in `currency`
    currency: str
    commission: float  # positive
    amount: float  # cash effect, signed (buys negative)
    description: str


@dataclass
class BrokerPosition:
    symbol: str
    quantity: float = 0.0
    total_cost: float = 0.0

    @property
    def average_cost(self) -> float:
        return self.total_cost / self.quantity if self.quantity else 0.0


@dataclass
class Book:
    account: DemoAccount
    activities: list[Activity] = field(default_factory=list)
    positions: dict[str, BrokerPosition] = field(default_factory=dict)
    cash: dict[str, float] = field(default_factory=lambda: defaultdict(float))

    def record(self, activity: Activity) -> None:
        self.activities.append(activity)
        self.cash[activity.currency] += activity.amount
        if activity.kind in ("BUY", "TRANSFER"):
            p = self.positions.setdefault(activity.symbol, BrokerPosition(activity.symbol))
            p.quantity += activity.quantity
            p.total_cost += activity.quantity * activity.price + activity.commission
        elif activity.kind == "SELL":
            p = self.positions[activity.symbol]
            p.total_cost -= p.average_cost * activity.quantity
            p.quantity -= activity.quantity
            if p.quantity <= 1e-9:
                del self.positions[activity.symbol]


def _price(market: Market, symbol: str, day: date) -> float | None:
    instrument = INSTRUMENTS[symbol]
    close = market.close_on(instrument.yahoo, day)
    return round(close / instrument.minor_unit, 4) if close is not None else None


def build_book(account: DemoAccount, market: Market, rng: random.Random) -> Book:
    book = Book(account)
    seq = iter(range(1, 1_000_000))

    def add(kind, day, symbol, qty, price, currency, commission, amount, description):
        book.record(Activity(f"{account.number}-{next(seq):06d}", kind, day, symbol, qty, price, currency,
                             round(commission, 2), round(amount, 2), description))

    months = [list(days) for _, days in groupby(market.days, key=lambda d: (d.year, d.month))]
    transfers = {len(months) - 1 - t.months_ago: t for t in account.transfers}
    for month_index, days in enumerate(months):
        if len(days) < 4:
            continue
        # Buys in the first half of the month, sells in the second, so the book stays chronological.
        buy_days, sell_days = days[1:len(days) // 2], days[len(days) // 2:]
        needs: dict[str, float] = defaultdict(float)
        for h in account.holdings:
            needs[INSTRUMENTS[h.symbol].currency] += h.monthly_budget
        for currency, amount in sorted(needs.items()):
            add("DEPOSIT", days[0], None, 0, 0, currency, 0, round(amount * rng.uniform(1.0, 1.15), -1),
                "Contribution" if account.type in ("TFSA", "RRSP") else "Deposit")

        if month_index in transfers:
            t = transfers[month_index]
            add("TRANSFER", days[1], t.symbol, t.quantity, t.average_cost, INSTRUMENTS[t.symbol].currency, 0, 0,
                f"Transfer in of {INSTRUMENTS[t.symbol].name} from another institution")

        for h in account.holdings:
            instrument = INSTRUMENTS[h.symbol]
            day = rng.choice(buy_days)
            price = _price(market, h.symbol, day)
            budget = h.monthly_budget * rng.uniform(0.8, 1.2)
            qty = round(budget / price, 4) if h.fractional else float(int(budget / price))
            if qty > 0:
                add("BUY", day, h.symbol, qty, price, instrument.currency, account.commission,
                    -(qty * price + account.commission), f"Bought {qty:g} {instrument.name}")

            held = book.positions.get(h.symbol)
            if held and rng.random() < account.sell_probability:
                sell_day = rng.choice(sell_days)
                sell_price = _price(market, h.symbol, sell_day)
                fraction = rng.uniform(0.2, 0.4)
                qty = round(held.quantity * fraction, 4) if h.fractional else float(int(held.quantity * fraction))
                if qty > 0:
                    add("SELL", sell_day, h.symbol, qty, sell_price, instrument.currency, account.commission,
                        qty * sell_price - account.commission, f"Sold {qty:g} {instrument.name}")

        if days[0].month in QUARTER_END_MONTHS:
            pay_day = days[-1]
            for symbol, held in sorted(book.positions.items()):
                instrument = INSTRUMENTS[symbol]
                if instrument.dividend_yield and held.quantity:
                    amount = held.quantity * _price(market, symbol, pay_day) * instrument.dividend_yield / 4
                    add("DIVIDEND", pay_day, symbol, 0, 0, instrument.currency, 0, amount,
                        f"{instrument.name} dividend")

    book.activities.sort(key=lambda a: (a.day, a.id))
    return book


def build_books(accounts: list[DemoAccount], market: Market, seed: int) -> list[Book]:
    rng = random.Random(seed)
    return [build_book(a, market, rng) for a in accounts]

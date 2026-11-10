from datetime import datetime
from decimal import Decimal as D

from app.models.account import AccountRecord
from app.models.transaction import Transaction, TransactionKind
from app.services.market_data import Quote, QuoteProvider, YFinanceProvider
from app.services.performance import compute_holdings, compute_pnl
from app.services.portfolio import build_pnl, load_holdings

NOW = datetime(2026, 6, 1)


def tx(id, kind, qty, price, day, fee=0, symbol="RY.TO", cur="CAD", account=1):
    return Transaction(id=id, account_id=account, external_id=str(id), kind=kind.value, symbol=symbol,
                       trade_date=datetime(2026, 1, day), quantity=D(qty), price=D(price), fee=D(fee), currency=cur)


def q(price, cur="CAD", symbol="RY.TO"):
    return Quote(symbol, D(price), cur, NOW)


def test_average_cost_with_fees_and_partial_sell():
    holdings = compute_holdings([
        tx(2, TransactionKind.BUY, 10, 120, 5, fee=5),   # out of order on purpose
        tx(1, TransactionKind.BUY, 10, 100, 2, fee=5),
        tx(3, TransactionKind.SELL, 5, 130, 9),
    ])
    h = holdings[0]
    # cost 1005 + 1205 = 2210 over 20 sh; selling 5 removes a quarter
    assert h.quantity == 15 and h.cost_basis == D("1657.5")
    assert h.first_buy_at == datetime(2026, 1, 2)


def test_closed_position_dropped_and_oversell_flagged():
    assert compute_holdings([tx(1, TransactionKind.BUY, 5, 10, 1), tx(2, TransactionKind.SELL, 5, 12, 2)]) == []
    over = compute_holdings([tx(1, TransactionKind.BUY, 5, 10, 1), tx(2, TransactionKind.SELL, 8, 12, 2),
                             tx(3, TransactionKind.BUY, 1, 10, 3)])
    assert over[0].quantity == 1 and over[0].incomplete_history


def test_unrealized_pnl_per_currency():
    holdings = compute_holdings([
        tx(1, TransactionKind.BUY, 10, 100, 1),
        tx(2, TransactionKind.BUY, 2, 50, 1, symbol="AAPL", cur="USD"),
    ])
    snap = compute_pnl(holdings, {"RY.TO": q(110), "AAPL": q(40, "USD", "AAPL")}, NOW)
    ry = next(p for p in snap.positions if p.symbol == "RY.TO")
    assert (ry.unrealized_pnl, ry.unrealized_pct) == (D(100), D(10))
    totals = {t.currency: t for t in snap.totals}
    assert totals["USD"].unrealized_pnl == D(-20) and totals["CAD"].market_value == D(1100)


def test_missing_and_mismatched_quotes_excluded_from_totals():
    holdings = compute_holdings([tx(1, TransactionKind.BUY, 1, 10, 1),
                                 tx(2, TransactionKind.BUY, 1, 10, 1, symbol="X.TO")])
    snap = compute_pnl(holdings, {"RY.TO": q(10, "USD")}, NOW)
    assert {p.status for p in snap.positions} == {"currency_mismatch", "no_quote"}
    assert snap.totals == []


async def test_load_holdings_scopes_to_user_and_build_pnl_dedupes_symbols(db):
    db.add_all([AccountRecord(id=1, user_id=1, platform="p", external_id="a", account_number="a", account_type="t", status="Active"),
                AccountRecord(id=2, user_id=2, platform="p", external_id="b", account_number="b", account_type="t", status="Active")])
    db.add_all([tx(1, TransactionKind.BUY, 1, 10, 1, account=1), tx(2, TransactionKind.BUY, 1, 10, 1, account=1, symbol="Z"),
                tx(3, TransactionKind.BUY, 9, 10, 1, account=2)])
    db.commit()
    holdings = load_holdings(db, 1)
    assert len(holdings) == 2

    asked = []

    class Fake(QuoteProvider):
        async def get_quotes(self, symbols):
            asked.append(symbols)
            return {"RY.TO": q(11)}

    snap = await build_pnl(holdings + holdings, Fake())
    assert asked == [["RY.TO", "Z"]] and len(snap.positions) == 4


async def test_yfinance_provider_skips_failures_and_bad_prices():
    class T:
        def __init__(self, s):
            self.fast_info = {"RY.TO": {"last_price": 120.5, "currency": "CAD"},
                              "NAN": {"last_price": float("nan"), "currency": "USD"}}[s]  # KeyError for BAD

    quotes = await YFinanceProvider(ticker_factory=T).get_quotes(["RY.TO", "NAN", "BAD"])
    assert list(quotes) == ["RY.TO"] and quotes["RY.TO"].price == D("120.5")

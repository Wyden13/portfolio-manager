from datetime import datetime
from decimal import Decimal as D

from app.models.account import AccountRecord
from app.models.position import Position
from app.models.transaction import Transaction, TransactionKind
from app.services.currency import QuoteFxProvider
from app.services.market_data import Quote, QuoteProvider, YFinanceProvider, to_yahoo_symbol
from app.services.performance import (
    CashBalance, CurrencyTotal, Holding, cash_balances, compute_holdings, compute_pnl, convert_totals, reconcile,
    summarize_accounts,
)
from app.services.portfolio import build_pnl, load_holdings, load_portfolio

NOW = datetime(2026, 6, 1)


def tx(id, kind, qty, price, day, fee=0, symbol="RY.TO", cur="CAD", account=1):
    return Transaction(id=id, account_id=account, external_id=str(id), kind=kind.value, symbol=symbol,
                       trade_date=datetime(2026, 1, day), quantity=D(qty), price=D(price), fee=D(fee), currency=cur)


def cash_tx(id, kind, amount, day, cur="CAD", account=1):
    return Transaction(id=id, account_id=account, external_id=str(id), kind=kind.value, symbol=None,
                       trade_date=datetime(2026, 1, day), quantity=D(0), price=D(0), fee=D(0),
                       net_amount=D(amount), currency=cur)


def q(price, cur="CAD", symbol="RY.TO"):
    return Quote(symbol, D(price), cur, NOW)


def pos(qty, avg, symbol="RY.TO", account=1, cur="CAD"):
    return Position(account_id=account, symbol=symbol, quantity=D(qty),
                    average_cost=D(avg) if avg is not None else None, currency=cur, synced_at=NOW)


def account(id, user, **kw):
    return AccountRecord(id=id, user_id=user, platform="p", external_id=str(id), account_number=str(id),
                         account_type="t", status="Active", **kw)


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


def test_reconcile_prefers_transactions_only_when_they_match_the_broker():
    derived = compute_holdings([
        tx(1, TransactionKind.BUY, 10, 100, 1),
        tx(2, TransactionKind.BUY, 5, 10, 1, symbol="OLD.TO"),
        tx(3, TransactionKind.BUY, 1, 10, 1, symbol="GONE.TO"),
    ])
    held = {h.symbol: h for h in reconcile(derived, [
        pos("10.00000000", 90),         # matches the transactions
        pos(8, 7, symbol="OLD.TO"),     # bought partly before the lookback
        pos(3, None, symbol="XFER.TO"),  # transferred in, broker knows no cost
    ])}
    assert set(held) == {"RY.TO", "OLD.TO", "XFER.TO"}  # GONE.TO isn't held per the broker
    assert (held["RY.TO"].source, held["RY.TO"].cost_basis) == ("transactions", D(1000))
    assert (held["OLD.TO"].source, held["OLD.TO"].cost_basis) == ("broker", D(56))
    assert held["OLD.TO"].first_buy_at == datetime(2026, 1, 1)
    assert held["XFER.TO"].cost_basis is None and held["XFER.TO"].average_cost is None


def test_holding_without_cost_is_priced_but_left_out_of_totals():
    [h] = reconcile([], [pos(3, None)])
    snap = compute_pnl([h], {"RY.TO": q(10)}, NOW)
    p = snap.positions[0]
    assert (p.status, p.market_value, p.unrealized_pnl, p.source) == ("no_cost", D(30), None, "broker")
    assert snap.totals == []


def test_convert_totals_needs_every_rate():
    totals = [CurrencyTotal("CAD", D(100), D(110), D(10), D(10)), CurrencyTotal("USD", D(100), D(120), D(20), D(20))]
    base = convert_totals(totals, {"CAD": D(1), "USD": D("1.5")}, "CAD")
    assert (base.cost_basis, base.market_value, base.unrealized_pnl, base.unrealized_pct) == (D(250), D(290), D(40), D(16))
    assert convert_totals(totals, {"CAD": D(1)}, "CAD") is None


async def test_quote_fx_provider_uses_yahoo_fx_tickers():
    class Fake(QuoteProvider):
        async def get_quotes(self, symbols):
            assert symbols == ["USDCAD=X"]
            return {"USDCAD=X": q("1.37", symbol="USDCAD=X")}

    assert await QuoteFxProvider(Fake()).get_rates(["CAD", "USD"], "CAD") == {"CAD": D(1), "USD": D("1.37")}


async def test_load_holdings_scopes_to_user_and_build_pnl_dedupes_symbols(db):
    db.add_all([account(1, 1), account(2, 2), account(3, 1, removed_at=NOW), account(4, 1, duplicate_of_id=1)])
    db.add_all([tx(1, TransactionKind.BUY, 1, 10, 1, account=1), tx(2, TransactionKind.BUY, 1, 10, 1, account=1, symbol="Z"),
                tx(3, TransactionKind.BUY, 9, 10, 1, account=2)])
    db.add_all([pos(1, 10, account=1), pos(1, 10, symbol="Z", account=1), pos(9, 10, account=2),
                pos(5, 10, account=3), pos(5, 10, account=4)])
    db.commit()
    holdings = load_holdings(db, 1)
    assert {(h.account_id, h.symbol) for h in holdings} == {(1, "RY.TO"), (1, "Z")}

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


async def test_minor_unit_quotes_are_converted_not_mistaken_for_the_major_unit():
    class T:
        def __init__(self, s):
            self.fast_info = {"last_price": 250.0, "currency": "GBp"}

    quote = (await YFinanceProvider(ticker_factory=T).get_quotes(["VOD.L"]))["VOD.L"]
    assert (quote.price, quote.currency) == (D("2.5"), "GBP")


def test_yahoo_symbols():
    assert [to_yahoo_symbol(s) for s in ("ry.to", "BRK.B", "BBD.B.TO", "ABC.VN", "ABC.V", "AAPL", "VOD.L", "REI.UN.TO")] == [
        "RY.TO", "BRK-B", "BBD-B.TO", "ABC.V", "ABC.V", "AAPL", "VOD.L", "REI-UN.TO"]


def test_cash_is_the_signed_sum_of_the_ledger_per_currency():
    buy = tx(2, TransactionKind.BUY, 10, 100, 3)
    buy.net_amount = D(-1005)
    ledger = [
        cash_tx(1, TransactionKind.DEPOSIT, 2000, 2), buy, cash_tx(3, TransactionKind.DIVIDEND, 12.5, 9),
        cash_tx(4, TransactionKind.FEE, -2.5, 9), cash_tx(5, TransactionKind.DEPOSIT, 300, 2, cur="usd"),
        cash_tx(6, TransactionKind.WITHDRAWAL, -300, 4, cur="USD"),  # back to zero: no USD line
    ]
    assert cash_balances(ledger) == [CashBalance(1, "CAD", D(1005), False)]


def test_cash_is_estimated_when_the_history_may_be_partial():
    # Account 2's oldest stored activity is a buy: its deposit predates the sync lookback.
    buy = tx(2, TransactionKind.BUY, 1, 100, 3, account=2)
    buy.net_amount = D(-100)
    ledger = [cash_tx(1, TransactionKind.DEPOSIT, 500, 2), buy, cash_tx(3, TransactionKind.DEPOSIT, 50, 4, account=2),
              cash_tx(4, TransactionKind.DIVIDEND, 1, 5, account=3)]
    oversold = Holding(1, "RY.TO", "CAD", quantity=D(1), incomplete_history=True)
    flags = {(c.account_id, c.estimated) for c in cash_balances(ledger)}
    assert flags == {(1, False), (2, True), (3, True)}
    assert {(c.account_id, c.estimated) for c in cash_balances(ledger, [oversold])} == {(1, True), (2, True), (3, True)}


def test_account_summary_converts_holdings_and_cash_and_flags_missing_rates():
    holdings = compute_holdings([
        tx(1, TransactionKind.BUY, 10, 100, 1),
        tx(2, TransactionKind.BUY, 2, 50, 1, symbol="AAPL", cur="USD"),
    ])
    holdings.append(Holding(1, "TD.TO", "CAD", quantity=D(1), cost_basis=None, source="broker"))
    snap = compute_pnl(holdings, {"RY.TO": q(110), "AAPL": q(60, "USD", "AAPL"), "TD.TO": q(80, symbol="TD.TO")}, NOW)
    cash = [CashBalance(1, "CAD", D(20)), CashBalance(1, "USD", D(10), True), CashBalance(2, "CAD", D(5))]
    a1, a2 = summarize_accounts(snap.positions, cash, {"CAD": D(1), "USD": D(2)})
    # holdings: 1100 + 2*60*2 + 80 (no cost: value only); P&L: 100 + 20*2
    assert (a1.market_value, a1.cost_basis, a1.unrealized_pnl, a1.holdings) == (D(1420), D(1200), D(140), 3)
    assert (a1.cash_value, a1.total, a1.complete) == (D(40), D(1460), True)
    assert (a2.holdings, a2.total, a2.unrealized_pct) == (0, D(5), None)
    partial = summarize_accounts(snap.positions, cash, {"CAD": D(1)})[0]
    assert not partial.complete and partial.market_value == D(1180)


async def test_build_pnl_rolls_cash_into_total_assets_and_tags_asset_classes(db):
    db.add(account(1, 1))
    buy = tx(2, TransactionKind.BUY, 10, 100, 3)
    buy.net_amount = D(-1000)
    db.add_all([cash_tx(1, TransactionKind.DEPOSIT, 1500, 2), buy, pos(10, 100)])
    db.commit()
    holdings, cash = load_portfolio(db, 1)
    assert cash == [CashBalance(1, "CAD", D(500), False)]

    class Fake(QuoteProvider):
        async def get_quotes(self, symbols):
            return {"RY.TO": q(110)}

        async def get_asset_classes(self, symbols):
            return {"RY.TO": "stock"}

    snap = await build_pnl(holdings, Fake(), QuoteFxProvider(Fake()), "CAD", cash=cash)
    assert snap.positions[0].asset_class == "stock"
    assert (snap.cash_base, snap.total_assets_base) == (D(500), D(1600))
    assert snap.accounts[0].total == D(1600) and snap.base_total.market_value == D(1100)


async def test_yfinance_asset_classes_are_cached_and_failures_read_as_other():
    calls = []

    class T:
        def __init__(self, s):
            calls.append(s)
            if s == "BAD":
                raise RuntimeError("no data")
            self.info = {"XEQT.TO": {"quoteType": "ETF"}, "RY.TO": {"quoteType": "EQUITY"}, "X": {}}[s]

    provider = YFinanceProvider(ticker_factory=T)
    assert await provider.get_asset_classes(["XEQT.TO", "RY.TO", "X", "BAD"]) == {
        "XEQT.TO": "etf", "RY.TO": "stock", "X": "other", "BAD": "other"}
    await provider.get_asset_classes(["RY.TO"])
    assert sorted(calls) == ["BAD", "RY.TO", "X", "XEQT.TO"]

"""Ledger normalization and the balance identity built on it (row shapes from a Wealthsimple export)."""
from datetime import date, datetime
from decimal import Decimal as D

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.api import positions as positions_api
from app.api.accounts import current_user_id
from app.database import get_db
from app.main import app
from app.models.account import AccountRecord
from app.models.position import Position
from app.models.transaction import Transaction, TransactionKind
from app.services.ledger import RowType, classify, normalize
from app.services.currency import FxProvider
from app.services.market_data import Quote, QuoteProvider
from app.services.performance import (
    Holding, cash_balances, compute_holdings, compute_options, compute_pnl, infer_opening_shares, reconcile,
    summarize_accounts, summarize_performance,
)

NOW = datetime(2026, 6, 1)


def row(id, kind, day, qty=0, price=0, gross=0, net=0, symbol=None, cur="CAD", raw_type="", desc="", account=1):
    return Transaction(id=id, account_id=account, external_id=str(id), kind=kind.value, symbol=symbol,
                       trade_date=datetime(2026, 1, day, 12), quantity=D(qty), price=D(price), gross_amount=D(gross),
                       fee=D(0), net_amount=D(net), currency=cur, raw_type=raw_type, description=desc)


def buy(id, day, qty, price, symbol="NVDA", **kw):
    amount = D(qty) * D(price)
    return row(id, TransactionKind.BUY, day, qty, price, -amount, -amount, symbol, raw_type="BUY", **kw)


def sell(id, day, qty, price, symbol="NVDA", **kw):
    amount = D(qty) * D(price)
    return row(id, TransactionKind.SELL, day, qty, price, amount, amount, symbol, raw_type="SELL", **kw)


def option_buy(id, day, contracts, premium, symbol="NVDA"):
    amount = D(contracts) * D(premium) * 100
    return row(id, TransactionKind.BUY, day, contracts, premium, -amount, -amount, symbol, raw_type="BUY")


def expiry(id, day, contracts, symbol="NVDA"):
    return row(id, TransactionKind.OTHER, day, contracts, symbol=symbol, raw_type="OPTIONEXPIRATION",
               desc=f"Option expired: {symbol}")


def deposit(id, day, amount, **kw):
    return row(id, TransactionKind.DEPOSIT, day, net=amount, gross=amount, raw_type="CONTRIBUTION", **kw)


def split(id, day, shares, symbol="NVDL"):
    return row(id, TransactionKind.OTHER, day, gross=shares, net=shares, symbol=symbol, raw_type="CORPORATE_ACTION",
               desc="CORPORATE_ACTION")


def dividend(id, day, net, rate, symbol="VFV.TO"):
    return row(id, TransactionKind.DIVIDEND, day, price=rate, gross=net, net=net, symbol=symbol, raw_type="DIVIDEND")


def test_classification():
    assert classify(buy(1, 1, D("0.2244"), D("259.6257"))) == RowType.EQUITY_TRADE
    assert classify(option_buy(2, 1, 5, D("0.0139"))) == RowType.OPTION_TRADE  # m = 100
    assert classify(expiry(3, 1, 5)) == RowType.OPTION_EXPIRY
    assert classify(split(4, 1, 22)) == RowType.CORPORATE_ACTION
    assert classify(row(5, TransactionKind.OTHER, 1, net=D("0.26"), symbol="USD", cur="USD",
                        raw_type="INTEREST")) == RowType.INTEREST
    assert classify(row(6, TransactionKind.OTHER, 1, net=-45, raw_type="FX conversion/FXT")) == RowType.FX_CONVERSION
    assert classify(row(7, TransactionKind.FEE, 1, net=D("-0.15"), raw_type="TAX")) == RowType.FEE
    # No gross recorded: can't be told apart, so shares.
    assert classify(Transaction(kind="BUY", quantity=D(1), price=D(1))) == RowType.EQUITY_TRADE


def test_normalize_orders_oldest_first_and_moves_shares_not_cash():
    rows = normalize([split(3, 5, 22), expiry(2, 4, 5), deposit(1, 2, 100)])
    assert [r.type for r in rows] == [RowType.DEPOSIT, RowType.OPTION_EXPIRY, RowType.CORPORATE_ACTION]
    assert [(r.shares, r.cash) for r in rows] == [(0, 100), (0, 0), (22, 0)]


def test_options_are_not_shares_and_their_premiums_are_realized():
    ledger = [
        deposit(1, 1, 1000), buy(2, 2, 2, 100), option_buy(3, 3, 5, D("0.02")), expiry(4, 5, 5),
        option_buy(5, 6, 2, D("0.10"), symbol="IONQ"),
        row(6, TransactionKind.SELL, 7, 1, D("0.35"), 35, 35, "IONQ", raw_type="SELL"),
    ]
    [nvda] = compute_holdings(ledger)
    assert (nvda.symbol, nvda.quantity, nvda.cost_basis) == ("NVDA", 2, 200)
    options = {o.underlying: o for o in compute_options(ledger)}
    assert (options["NVDA"].realized_pnl, options["NVDA"].contracts) == (-10, 0)  # expired worthless
    # Bought 2 for 20, sold 1 for 35: realized 35 - 10; one still open, carried at its 10 premium.
    assert (options["IONQ"].realized_pnl, options["IONQ"].contracts, options["IONQ"].cost) == (25, 1, 10)
    [cash] = cash_balances(ledger)
    assert cash.amount == 1000 - 200 - 10 - 20 + 35
    summary = summarize_accounts([], [cash], {"CAD": D(1)}, list(options.values()))[0]
    assert (summary.options_value, summary.total) == (10, cash.amount + 10)


def test_split_adds_shares_keeps_cost_and_sells_realize_average_cost():
    ledger = [deposit(1, 1, 1000), buy(2, 2, 10, 50, "NVDL"), split(3, 3, 20), sell(4, 4, 15, 30, "NVDL")]
    [h] = compute_holdings(ledger)
    # 30 shares after the split for 500 (avg 16.67); selling half realizes 450 - 250.
    assert (h.quantity, h.cost_basis, h.realized_pnl) == (15, 250, 200)
    [cash] = cash_balances(ledger)
    assert cash.amount == 1000 - 500 + 450  # the 20 split shares are not money


def test_us_stock_bought_in_cad_keeps_cad_cost_and_is_priced_at_spot():
    [h] = reconcile(compute_holdings([buy(1, 2, 2, 140)]), [
        Position(account_id=1, symbol="NVDA", quantity=D(2), average_cost=D(100), currency="USD", synced_at=NOW)])
    assert (h.source, h.currency, h.cost_currency, h.cost_basis) == ("transactions", "USD", "CAD", 280)
    quotes = {"NVDA": Quote("NVDA", D(110), "USD", NOW)}
    assert compute_pnl([h], quotes, NOW).positions[0].status == "currency_mismatch"  # no rates to convert
    rates = {"CAD": D(1), "USD": D("1.4")}
    [p] = compute_pnl([h], quotes, NOW, rates).positions
    assert (p.status, p.currency, p.cost_basis, p.market_value, p.unrealized_pnl) == ("ok", "USD", 200, 220, 20)
    assert (p.cost_currency, p.settled_cost_basis) == ("CAD", 280)
    [a] = summarize_accounts([p], [], rates)
    assert (a.cost_basis, a.market_value, a.unrealized_pnl) == (280, 308, 28)  # exactly the CAD ACB


def test_dividends_reveal_shares_held_before_the_ledger():
    ledger = [buy(1, 2, 5, 160, "VFV.TO"), dividend(2, 10, D("2.77"), D("0.3957")),
              dividend(3, 20, D("2.80"), D("0.40"))]
    opening, checks = infer_opening_shares(ledger)
    assert checks == [] and abs(opening[(1, "VFV.TO")] - 2) < D("0.01")
    [h] = reconcile(compute_holdings(ledger), [
        Position(account_id=1, symbol="VFV.TO", quantity=D(7), average_cost=D(150), currency="CAD", synced_at=NOW)],
        opening)
    # The broker's count settles the estimate; those 2 are costed at the broker's average.
    assert (h.source, h.opening_shares, h.cost_basis) == ("transactions", 2, 800 + 300)

    _, checks = infer_opening_shares([buy(1, 2, 5, 160, "VFV.TO"), dividend(2, 10, 2, D("0.4")),
                                      dividend(3, 20, 4, D("0.4"))])
    assert [(c.code, c.day) for c in checks] == [("dividend_shares_mismatch", date(2026, 1, 10))]
    assert infer_opening_shares([dividend(2, 10, 2, D("0.4"))])[0] == {}  # one date proves nothing


def test_negative_cash_is_reported_not_papered_over():
    ledger = [buy(1, 2, 1, 100), deposit(2, 2, 50), deposit(3, 3, 100)]  # same-day deposit after the buy
    [c] = cash_balances(ledger)
    assert (c.amount, c.opening, c.negative_on, c.estimated) == (50, 50, date(2026, 1, 2), True)
    ledger = [deposit(1, 2, 150, account=2), buy(2, 2, 1, 100, account=2)]
    [c] = cash_balances(ledger)
    assert (c.opening, c.negative_on) == (0, None)  # end of day is what counts


def test_pnl_identity_holds_for_a_complete_ledger_and_flags_a_gap():
    ledger = [
        deposit(1, 1, 1000), buy(2, 2, 10, 50, "XEQT.TO"), sell(3, 3, 5, 60, "XEQT.TO"),
        dividend(4, 4, 5, D("0.5"), "XEQT.TO"), row(5, TransactionKind.FEE, 4, net=-1, raw_type="TAX"),
        row(6, TransactionKind.OTHER, 5, net=2, raw_type="INTEREST", desc="INTEREST"),
        option_buy(7, 6, 1, D("0.3")), expiry(8, 7, 1),
        row(9, TransactionKind.WITHDRAWAL, 8, net=-100, raw_type="WITHDRAWAL"),
    ]
    holdings = reconcile(compute_holdings(ledger), [
        Position(account_id=1, symbol="XEQT.TO", quantity=D(5), average_cost=D(50), currency="CAD", synced_at=NOW)])
    rates = {"CAD": D(1)}
    snap = compute_pnl(holdings, {"XEQT.TO": Quote("XEQT.TO", D(70), "CAD", NOW)}, NOW, rates)
    options = compute_options(ledger)
    accounts = summarize_accounts(snap.positions, cash_balances(ledger), rates, options)
    [p] = summarize_performance(ledger, accounts, holdings, options, rates)
    # cash 1000 - 500 + 300 + 5 - 1 + 2 - 30 - 100 = 676; holdings 350
    assert (p.balance, p.net_deposits, p.unrealized, p.realized_equity, p.realized_options) == (1026, 900, 100, 50, -30)
    assert (p.dividends, p.interest, p.fees, p.income) == (5, 2, -1, 6)
    assert p.pnl_from_balance == p.pnl_from_parts == 126 and p.gap == 0 and p.checks == []

    # A broker holding with no stored history: its value isn't explained by the ledger.
    extra = Holding(1, "PLTR", "CAD", quantity=D(1), cost_basis=D(100), source="broker")
    snap = compute_pnl(holdings + [extra], {"XEQT.TO": Quote("XEQT.TO", D(70), "CAD", NOW),
                                            "PLTR": Quote("PLTR", D(100), "CAD", NOW)}, NOW, rates)
    accounts = summarize_accounts(snap.positions, cash_balances(ledger), rates, options)
    [p] = summarize_performance(ledger, accounts, holdings + [extra], options, rates)
    assert p.gap == 100
    assert {c.code for c in p.checks} == {"broker_quantity_mismatch", "pnl_identity_gap"}


class Provider(QuoteProvider):
    async def get_quotes(self, symbols):
        return {s: Quote(s, D(110), "USD", NOW) for s in symbols}


class Fx(FxProvider):
    async def get_rates(self, currencies, base):
        return {"CAD": D(1), "USD": D("1.5")}


def test_performance_summary_endpoint(db_engine):
    factory = sessionmaker(bind=db_engine, expire_on_commit=False)
    with factory() as db:
        db.add(AccountRecord(id=1, user_id=1, platform="snaptrade", external_id="1", account_number="1",
                             account_type="TFSA", status="Active"))
        db.add_all([deposit(1, 1, 1000), buy(2, 2, 2, 140), option_buy(3, 3, 1, D("0.5")), expiry(4, 4, 1)])
        db.add(Position(account_id=1, symbol="NVDA", quantity=D(2), average_cost=D(100), currency="USD", synced_at=NOW))
        db.commit()

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides.update({
        get_db: override_db, current_user_id: lambda: 1,
        positions_api.get_quote_provider: Provider, positions_api.get_fx_provider: Fx,
    })
    try:
        body = TestClient(app).get("/api/performance/summary").json()
        [a] = body["accounts"]
        # holdings 2 x 110 USD x 1.5 = 330; cash 1000 - 280 - 50 = 670
        assert (a["balance"], a["holdings_value"], a["cash_value"], a["net_deposits"]) == (1000, 330, 670, 1000)
        assert (a["unrealized"], a["realized_options"], a["gap"], a["checks"]) == (50, -50, 0, [])
        assert body["total"]["balance"] == 1000 and body["options"][0]["realized_pnl"] == -50
        positions = TestClient(app).get("/api/positions").json()["positions"]
        assert (positions[0]["cost_currency"], positions[0]["settled_cost_basis"]) == ("CAD", 280)
    finally:
        app.dependency_overrides.clear()

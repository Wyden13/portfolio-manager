from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.accounts import current_user_id
from app.database import get_db
from app.services.currency import FxProvider, QuoteFxProvider
from app.services.market_data import HistoryProvider, QuoteProvider, YFinanceProvider
from app.services.performance import AccountSummary, CurrencyTotal
from app.services.portfolio import build_pnl, load_portfolio

router = APIRouter(prefix="/api")

_provider: YFinanceProvider | None = None


def _yfinance() -> YFinanceProvider:
    global _provider
    if _provider is None:
        _provider = YFinanceProvider()
    return _provider

def get_quote_provider() -> QuoteProvider:
    return _yfinance()


def get_history_provider() -> HistoryProvider:
    return _yfinance()


def get_fx_provider(quotes: QuoteProvider = Depends(get_quote_provider)) -> FxProvider:
    return QuoteFxProvider(quotes)


def _num(value):
    return float(value) if value is not None else None


def _total(t: CurrencyTotal) -> dict:
    return {
        "currency": t.currency, "cost_basis": _num(t.cost_basis), "market_value": _num(t.market_value),
        "unrealized_pnl": _num(t.unrealized_pnl), "unrealized_pct": _num(t.unrealized_pct),
    }


def _account(a: AccountSummary) -> dict:
    return {
        "account_id": a.account_id, "market_value": float(a.market_value), "cost_basis": float(a.cost_basis),
        "unrealized_pnl": float(a.unrealized_pnl), "unrealized_pct": _num(a.unrealized_pct),
        "cash": [{"currency": c.currency, "amount": float(c.amount), "estimated": c.estimated,
                  "opening": float(c.opening)} for c in a.cash],
        "cash_value": float(a.cash_value), "total": float(a.total), "holdings": a.holdings,
        "complete": a.complete, "options_value": float(a.options_value),
    }


@router.get("/positions")
async def list_positions(
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    provider: QuoteProvider = Depends(get_quote_provider),
    fx: FxProvider = Depends(get_fx_provider),
):
    """Holdings reconciled against the broker snapshot, priced with live quotes (unrealized P&L)."""
    holdings, cash, options = load_portfolio(db, user_id)
    snapshot = await build_pnl(holdings, provider, fx, cash=cash, options=options)
    return {
        "as_of": snapshot.as_of.isoformat() + "Z",
        "positions": [
            {
                "account_id": p.account_id, "symbol": p.symbol, "currency": p.currency,
                "quantity": _num(p.quantity), "average_cost": _num(p.average_cost),
                "cost_basis": _num(p.cost_basis), "price": _num(p.price),
                "market_value": _num(p.market_value), "unrealized_pnl": _num(p.unrealized_pnl),
                "unrealized_pct": _num(p.unrealized_pct), "status": p.status,
                "first_buy_at": p.first_buy_at.isoformat() if p.first_buy_at else None,
                "incomplete_history": p.incomplete_history, "source": p.source,
                "asset_class": p.asset_class, "cost_currency": p.cost_currency,
                "day_change_pct": _num(p.day_change_pct), "volume": p.volume,
                "settled_cost_basis": _num(p.settled_cost_basis), "realized_pnl": _num(p.realized_pnl),
            }
            for p in snapshot.positions
        ],
        "totals": [_total(t) for t in snapshot.totals],
        "base_total": _total(snapshot.base_total) if snapshot.base_total else None,
        "fx_rates": {c: float(r) for c, r in snapshot.fx_rates.items()},
        "accounts": [_account(a) for a in snapshot.accounts],
        "base_currency": snapshot.base_currency or None,
        "cash_base": _num(snapshot.cash_base),
        "total_assets_base": _num(snapshot.total_assets_base),
    }

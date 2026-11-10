from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.accounts import current_user_id
from app.database import get_db
from app.services.market_data import QuoteProvider, YFinanceProvider
from app.services.portfolio import build_pnl, load_holdings

router = APIRouter(prefix="/api")

_provider: QuoteProvider | None = None


def get_quote_provider() -> QuoteProvider:
    global _provider
    if _provider is None:
        _provider = YFinanceProvider()
    return _provider


def _num(value):
    return float(value) if value is not None else None


@router.get("/positions")
async def list_positions(
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    provider: QuoteProvider = Depends(get_quote_provider),
):
    """Holdings derived from stored transactions, priced with live quotes (unrealized P&L)."""
    snapshot = await build_pnl(load_holdings(db, user_id), provider)
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
                "incomplete_history": p.incomplete_history,
            }
            for p in snapshot.positions
        ],
        "totals": [
            {
                "currency": t.currency, "cost_basis": _num(t.cost_basis),
                "market_value": _num(t.market_value), "unrealized_pnl": _num(t.unrealized_pnl),
                "unrealized_pct": _num(t.unrealized_pct),
            }
            for t in snapshot.totals
        ],
    }

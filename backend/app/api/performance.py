from dataclasses import fields
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.accounts import current_user_id
from app.api.positions import get_fx_provider, get_quote_provider
from app.config import settings
from app.database import get_db
from app.services.currency import FxProvider
from app.services.market_data import QuoteProvider
from app.services.performance import AccountPerformance, Check, summarize_performance
from app.services.portfolio import build_pnl, load_book

router = APIRouter(prefix="/api")

# AccountPerformance amounts that add up across accounts.
_AMOUNTS = [f.name for f in fields(AccountPerformance) if f.type in (Decimal, "Decimal")]


def _check(c: Check) -> dict:
    return {"code": c.code, "severity": c.severity, "account_id": c.account_id, "symbol": c.symbol,
            "day": c.day.isoformat() if c.day else None, "message": c.message}


def _amounts(p) -> dict:
    return {name: round(float(getattr(p, name)), 2) for name in _AMOUNTS} | {"income": round(float(p.income), 2)}


@router.get("/performance/summary")
async def performance_summary(
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    provider: QuoteProvider = Depends(get_quote_provider),
    fx: FxProvider = Depends(get_fx_provider),
):
    """Balance = holdings + open options (at cost) + cash per account, broken down into deposits,
    realized/unrealized P&L and income, with the ledger validation checks. Base currency, spot FX."""
    book = load_book(db, user_id)
    base = settings.BASE_CURRENCY.upper()
    snapshot = await build_pnl(book.holdings, provider, fx, base, cash=book.cash, options=book.options)
    rates = snapshot.fx_rates or {base: Decimal(1)}
    accounts = summarize_performance(book.rows, snapshot.accounts, book.holdings, book.options, rates, book.checks)
    total = AccountPerformance(0)
    for a in accounts:
        for name in _AMOUNTS:
            setattr(total, name, getattr(total, name) + getattr(a, name))
    return {
        "base_currency": base,
        "fx_rates": {c: float(r) for c, r in rates.items()},
        "complete": all(a.complete for a in accounts),
        "total": _amounts(total),
        "accounts": [
            {"account_id": a.account_id, "complete": a.complete, **_amounts(a), "checks": [_check(c) for c in a.checks]}
            for a in accounts
        ],
        "options": [
            {"account_id": o.account_id, "underlying": o.underlying, "currency": o.currency,
             "open_contracts": float(o.contracts), "open_cost": float(o.cost), "realized_pnl": float(o.realized_pnl),
             "premiums_paid": float(o.premiums_paid), "premiums_received": float(o.premiums_received),
             "estimated": o.estimated}
            for o in book.options
        ],
        "cash": [
            {"account_id": c.account_id, "currency": c.currency, "amount": float(c.amount),
             "opening": float(c.opening), "estimated": c.estimated,
             "negative_on": c.negative_on.isoformat() if c.negative_on else None}
            for c in book.cash
        ],
    }

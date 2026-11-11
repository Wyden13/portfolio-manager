from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.accounts import current_user_id
from app.api.positions import get_quote_provider
from app.database import get_db
from app.services.market_data import QuoteProvider, SecurityProfile
from app.services.portfolio import load_holdings

router = APIRouter(prefix="/api")


def _num(value):
    return float(value) if value is not None else None


def _profile(p: SecurityProfile) -> dict:
    return {
        "asset_class": p.asset_class, "name": p.name, "sector": p.sector, "industry": p.industry,
        "country": p.country, "market_cap": _num(p.market_cap), "market_cap_currency": p.market_cap_currency,
        "pe": _num(p.pe), "website": p.website,
    }


@router.get("/holdings/profiles")
async def holding_profiles(
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    provider: QuoteProvider = Depends(get_quote_provider),
):
    """Company profile per held symbol (name, sector, market cap...), cached a day by the provider."""
    symbols = sorted({h.symbol for h in load_holdings(db, user_id)})
    profiles = await provider.get_profiles(symbols) if symbols else {}
    return {s: _profile(profiles.get(s, SecurityProfile())) for s in symbols}

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.accounts import current_user_id
from app.api.positions import get_fx_provider, get_quote_provider
from app.config import settings
from app.database import SessionLocal
from app.services.currency import FxProvider
from app.services.market_data import QuoteProvider
from app.services.streaming import pnl_events

router = APIRouter(prefix="/api")


@router.get("/stream/pnl")
async def stream_pnl(
    user_id: int = Depends(current_user_id),
    provider: QuoteProvider = Depends(get_quote_provider),
    fx: FxProvider = Depends(get_fx_provider),
):
    """SSE of live unrealized P&L. Each `data:` is a base64 protobuf (proto/pnl.proto PnLUpdate)."""
    return StreamingResponse(
        pnl_events(SessionLocal, provider, user_id, settings.PNL_STREAM_INTERVAL_SECONDS, fx=fx),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

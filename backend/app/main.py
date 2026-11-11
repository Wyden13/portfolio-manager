import asyncio
import contextlib
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from snaptrade_client import ApiException as SnapTradeApiException

from app.api import accounts, connections, history, holdings, performance, positions, stream, sync, transactions
from app.config import settings
from app.integrations.base import ReauthRequired
from app.services.scheduler import run_scheduler
from app.services.synchronization import SyncInProgress

log = logging.getLogger(__name__)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    task = None
    if settings.SYNC_INTERVAL_MINUTES > 0:
        task = asyncio.create_task(run_scheduler(settings.SYNC_INTERVAL_MINUTES))
    yield
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


# Schema is managed by Alembic: run `alembic upgrade head` before starting.
app = FastAPI(title="InvestIQ", lifespan=lifespan)
for module in (accounts, connections, sync, transactions, positions, holdings, performance, history, stream):
    app.include_router(module.router)


@app.exception_handler(ReauthRequired)
async def reauth_required(request: Request, exc: ReauthRequired):
    return JSONResponse(status_code=409, content={"detail": str(exc), "code": "needs_reauth"})


@app.exception_handler(SyncInProgress)
async def sync_in_progress(request: Request, exc: SyncInProgress):
    return JSONResponse(status_code=409, content={"detail": str(exc), "code": "sync_in_progress"})


@app.exception_handler(SnapTradeApiException)
async def snaptrade_error(request: Request, exc: SnapTradeApiException):
    log.warning("SnapTrade %s on %s: %s", exc.status, request.url.path, exc.body)
    return JSONResponse(
        status_code=502, content={"detail": f"SnapTrade request failed ({exc.status})", "code": "broker_error"}
    )

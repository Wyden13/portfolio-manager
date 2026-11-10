import asyncio
import base64
from collections.abc import AsyncIterator, Callable
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.proto import pnl_pb2
from app.services.market_data import QuoteProvider
from app.services.performance import PnLSnapshot
from app.services.portfolio import build_pnl, load_holdings

_STATUS = {
    "ok": pnl_pb2.STATUS_OK,
    "no_quote": pnl_pb2.STATUS_NO_QUOTE,
    "currency_mismatch": pnl_pb2.STATUS_CURRENCY_MISMATCH,
}


def _ms(value: datetime | None) -> int:
    if value is None:
        return 0
    return int(value.replace(tzinfo=timezone.utc).timestamp() * 1000)  # stored datetimes are naive UTC


def _f(value) -> float:
    return float(value) if value is not None else 0.0


def snapshot_to_proto(snapshot: PnLSnapshot) -> pnl_pb2.PnLUpdate:
    return pnl_pb2.PnLUpdate(
        as_of_ms=_ms(snapshot.as_of),
        positions=[
            pnl_pb2.PositionPnL(
                account_id=p.account_id, symbol=p.symbol, currency=p.currency,
                quantity=_f(p.quantity), average_cost=_f(p.average_cost), cost_basis=_f(p.cost_basis),
                price=_f(p.price), market_value=_f(p.market_value),
                unrealized_pnl=_f(p.unrealized_pnl), unrealized_pct=_f(p.unrealized_pct),
                first_buy_ms=_ms(p.first_buy_at), quote_as_of_ms=_ms(p.quote_as_of),
                status=_STATUS[p.status], incomplete_history=p.incomplete_history,
            )
            for p in snapshot.positions
        ],
        totals=[
            pnl_pb2.CurrencyTotal(
                currency=t.currency, cost_basis=_f(t.cost_basis), market_value=_f(t.market_value),
                unrealized_pnl=_f(t.unrealized_pnl), unrealized_pct=_f(t.unrealized_pct),
            )
            for t in snapshot.totals
        ],
    )


def encode_event(snapshot: PnLSnapshot) -> str:
    """One SSE frame: the serialized protobuf, base64-encoded, in the data field."""
    payload = base64.b64encode(snapshot_to_proto(snapshot).SerializeToString()).decode("ascii")
    return f"event: pnl\ndata: {payload}\n\n"


async def pnl_events(
    session_factory: Callable[[], Session],
    provider: QuoteProvider,
    user_id: int,
    interval: float,
    max_events: int | None = None,
) -> AsyncIterator[str]:
    """Yield a P&L frame immediately, then one every `interval` seconds until cancelled."""
    sent = 0
    while True:
        try:
            with session_factory() as db:
                holdings = load_holdings(db, user_id)
            yield encode_event(await build_pnl(holdings, provider))
        except Exception:
            # Keep the stream alive through a flaky quote source; comments are ignored by clients.
            yield ": quote provider error\n\n"
        sent += 1
        if max_events is not None and sent >= max_events:
            return
        await asyncio.sleep(interval)

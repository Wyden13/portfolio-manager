"""Run the app against simulated brokers and a simulated market.

    cd backend && .venv/bin/python -m demo [--port 8000] [--seed 7] [--tick 1.0]

1. Creates a fresh demo.db through the Alembic migrations.
2. Connects Questrade (direct) and Wealthsimple + Interactive Brokers (via SnapTrade) through the
   app's real connect and sync code, fed by in-process fakes of those APIs.
3. Serves the real app with the quote, history and broker dependencies swapped for the
   simulated ones; prices move every --tick seconds and reach the dashboard over the SSE stream.

Nothing here is imported by the app; the only seams used are FastAPI dependency overrides.
"""
import argparse
import asyncio
import os
import socket
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
DEMO_DB = BACKEND / "demo.db"


def _port_free(host: str, port: int) -> bool:
    with socket.socket() as sock:
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def _configure_environment() -> None:
    """Must run before any `app` import: settings are read at import time."""
    from cryptography.fernet import Fernet

    from demo.market import HISTORY_DAYS

    os.environ.update({
        "DATABASE_URL": f"sqlite:///{DEMO_DB}",
        "TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode(),
        "QUESTRADE_CLIENT_ID": "demo-client",
        "QUESTRADE_REDIRECT_URI": "",  # no fake login page: the Connections tab offers the token form instead
        "SNAPTRADE_CLIENT_ID": "demo-client",
        "SNAPTRADE_CONSUMER_KEY": "demo-key",
        "SYNC_INTERVAL_MINUTES": "0",  # the scheduler would call the real brokers
        "SYNC_INITIAL_LOOKBACK_DAYS": str(HISTORY_DAYS + 7),
    })


def _migrate() -> None:
    from alembic import command
    from alembic.config import Config

    DEMO_DB.unlink(missing_ok=True)
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    command.upgrade(config, "head")


async def _main(args: argparse.Namespace) -> None:
    import uvicorn

    from app.api import accounts, connections, positions, sync
    from app.database import SessionLocal
    from app.main import app
    from app.services.market_data import YFinanceProvider
    from demo.market import Market
    from demo.seed import build_brokers, connect_and_sync, summary

    market = Market(args.seed)
    brokers = build_brokers(market, args.seed)
    await connect_and_sync(SessionLocal, brokers)
    with SessionLocal() as db:
        print("\nDemo portfolio synced into", DEMO_DB)
        for institution, account_type, count in summary(db):
            print(f"  {institution:<22} {account_type:<11} {count:>4} transactions")

    provider = YFinanceProvider(ticker_factory=market.ticker)

    async def http_client():
        async with brokers.http_client() as client:
            yield client

    app.dependency_overrides.update({
        positions.get_quote_provider: lambda: provider,
        positions.get_history_provider: lambda: provider,
        accounts.get_http_client: http_client,
        sync.get_snaptrade_client: lambda: brokers.snaptrade,
        connections.get_optional_snaptrade_client: lambda: brokers.snaptrade,
    })
    print("\nTo reconnect Questrade from the Connections tab, paste this App Hub token:",
          brokers.questrade.issue_personal_token())
    print(f"\nServing on http://{args.host}:{args.port} - prices tick every {args.tick:g}s\n")
    ticker = asyncio.create_task(market.run(args.tick))
    try:
        await uvicorn.Server(uvicorn.Config(app, host=args.host, port=args.port, log_level="info")).serve()
    finally:
        ticker.cancel()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m demo", description=__doc__.split("\n")[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--seed", type=int, default=7, help="same seed, same portfolio and price history")
    parser.add_argument("--tick", type=float, default=1.0, help="seconds between simulated price moves")
    args = parser.parse_args()
    # Check before resetting demo.db: another server may be using it.
    if not _port_free(args.host, args.port):
        sys.exit(f"Port {args.port} is already in use (another demo running?). Stop it or pass --port.")
    _configure_environment()
    _migrate()
    asyncio.run(_main(args))


if __name__ == "__main__":
    main()

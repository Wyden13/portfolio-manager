from fastapi import FastAPI

from app.api import accounts, positions, stream, sync, transactions

# Schema is managed by Alembic: run `alembic upgrade head` before starting.
app = FastAPI(title="InvestIQ")
for module in (accounts, sync, transactions, positions, stream):
    app.include_router(module.router)

from fastapi import FastAPI

from app.api import accounts

# Schema is managed by Alembic: run `alembic upgrade head` before starting.
app = FastAPI(title="InvestIQ")
app.include_router(accounts.router)

from fastapi import FastAPI

from app.api import accounts
from app.database import Base, engine
from app.models import connection  # noqa: F401  (registers the table)

Base.metadata.create_all(engine)

app = FastAPI(title="InvestIQ")
app.include_router(accounts.router)

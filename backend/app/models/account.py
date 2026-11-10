from dataclasses import dataclass
from enum import Enum

from sqlalchemy import Boolean, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AccountStatus(Enum):
    Active = "Active"
    Suspended_closed = "Suspended (Closed)"
    Suspended_readOnly = "Suspended (View Only)"
    Liquidate = "Liquidate Only"
    Closed = "Closed"

@dataclass
class Account:
    """Broker-agnostic account as returned by an adapter (not persisted directly)."""
    platform: str
    user_id:int
    account_id:int | str
    account_type:str
    account_number:str
    status: AccountStatus
    is_primary:bool
    client_account_type:str


class AccountRecord(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("user_id", "platform", "account_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    platform: Mapped[str] = mapped_column(String(32))
    # The id the broker uses in its API paths (SnapTrade: a UUID, Questrade: the number).
    external_id: Mapped[str] = mapped_column(String)
    account_number: Mapped[str] = mapped_column(String)
    account_type: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    client_account_type: Mapped[str] = mapped_column(String, default="")

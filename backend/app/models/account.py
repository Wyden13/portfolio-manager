from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AccountStatus(Enum):
    Active = "Active"
    Suspended_closed = "Suspended (Closed)"
    Suspended_readOnly = "Suspended (View Only)"
    Liquidate = "Liquidate Only"
    Closed = "Closed"
    Unknown = "Unknown"

    @classmethod
    def parse(cls, value) -> "AccountStatus":
        try:
            return cls(value)
        except ValueError:
            return cls.Unknown

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
    institution: str = ""


class AccountRecord(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "platform", "external_id", name="uq_accounts_user_id_platform_external_id"),
    )

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
    institution: Mapped[str] = mapped_column(String, default="")
    # End of the last transaction fetch; the next sync resumes a little before it.
    transactions_synced_through: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Set when the broker stopped returning the account; such accounts are left out of holdings.
    removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Set on an aggregator account that mirrors a directly connected one; left out of holdings.
    duplicate_of_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)

import enum
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ConnectionStatus(str, enum.Enum):
    PENDING = "pending"  # registered, but no brokerage account linked yet (SnapTrade)
    ACTIVE = "active"
    NEEDS_REAUTH = "needs_reauth"  # credentials rejected; the user must connect again
    ERROR = "error"  # last sync failed for another reason; retried on the next sync


class BrokerConnection(Base):
    __tablename__ = "broker_connections"
    __table_args__ = (UniqueConstraint("user_id", "platform"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    platform: Mapped[str] = mapped_column(String(32))
    # Questrade: the OAuth refresh token. SnapTrade: the SnapTrade userSecret.
    encrypted_refresh_token: Mapped[str] = mapped_column(String)
    access_token: Mapped[str | None] = mapped_column(String, nullable=True)
    api_server: Mapped[str | None] = mapped_column(String, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # SnapTrade: the userId registered with SnapTrade.
    external_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default=ConnectionStatus.ACTIVE.value)
    last_error: Mapped[str | None] = mapped_column(String, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

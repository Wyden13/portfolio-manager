from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BrokerConnection(Base):
    __tablename__ = "broker_connections"
    __table_args__ = (UniqueConstraint("user_id", "platform"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    platform: Mapped[str] = mapped_column(String(32))
    encrypted_refresh_token: Mapped[str] = mapped_column(String)
    access_token: Mapped[str | None] = mapped_column(String, nullable=True)
    api_server: Mapped[str | None] = mapped_column(String, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

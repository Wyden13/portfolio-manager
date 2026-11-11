import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

MONEY = Numeric(24, 8)


class TransactionKind(str, enum.Enum):
    BUY = "BUY"
    SELL = "SELL"
    DIVIDEND = "DIVIDEND"
    FEE = "FEE"
    DEPOSIT = "DEPOSIT"
    WITHDRAWAL = "WITHDRAWAL"
    OTHER = "OTHER"


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (UniqueConstraint("account_id", "external_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    external_id: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String(16))
    symbol: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    trade_date: Mapped[datetime] = mapped_column(DateTime, index=True)  # naive UTC
    quantity: Mapped[Decimal] = mapped_column(MONEY, default=0)  # always >= 0; kind gives direction
    price: Mapped[Decimal] = mapped_column(MONEY, default=0)
    gross_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    fee: Mapped[Decimal] = mapped_column(MONEY, default=0)  # always >= 0
    net_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="")
    raw_type: Mapped[str] = mapped_column(String, default="")
    description: Mapped[str] = mapped_column(String, default="")

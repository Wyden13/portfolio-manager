from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from app.models.account import Account
from app.models.transaction import TransactionKind


@dataclass
class RawTransaction:
    """Broker-agnostic transaction. Quantity and fee are non-negative; kind gives the direction."""
    external_id: str
    kind: TransactionKind
    symbol: str | None
    trade_date: datetime  # naive UTC
    quantity: Decimal
    price: Decimal
    gross_amount: Decimal
    fee: Decimal
    net_amount: Decimal
    currency: str
    raw_type: str = ""
    description: str = ""


@dataclass
class RawPosition:
    symbol: str
    quantity: Decimal
    average_cost: Decimal | None
    currency: str


@dataclass
class RawBalance:
    currency: str
    cash: Decimal
    market_value: Decimal


class BrokerageAdapter(ABC):
    """Read-only access to one brokerage connection."""

    platform: str

    @abstractmethod
    async def get_accounts(self) -> list[Account]:
        pass

    @abstractmethod
    async def get_balances(self, account_id) -> list[RawBalance]:
        pass

    @abstractmethod
    async def get_positions(self, account_id) -> list[RawPosition]:
        pass

    @abstractmethod
    async def get_transactions(
        self, account_id, start: datetime | None = None, end: datetime | None = None
    ) -> list[RawTransaction]:
        pass

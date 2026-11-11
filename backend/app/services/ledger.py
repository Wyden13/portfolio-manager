"""Read-time normalization of stored activities.

The stored `kind` alone doesn't say what a row does to cash and shares: option trades are stored as
BUY/SELL of the underlying, option expiries and corporate actions as OTHER, and a corporate action's
`net_amount` is a number of shares, not money. `normalize` classifies every row once so the
calculations in performance.py don't each have to.
"""
import enum
from dataclasses import dataclass
from decimal import Decimal

from app.models.transaction import Transaction, TransactionKind

ZERO = Decimal(0)
# |gross| / (quantity * price) at or above this is a contract multiplier (100 for equity options).
OPTION_MULTIPLIER = Decimal(50)


class RowType(str, enum.Enum):
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    EQUITY_TRADE = "equity_trade"
    OPTION_TRADE = "option_trade"
    OPTION_EXPIRY = "option_expiry"
    DIVIDEND = "dividend"
    INTEREST = "interest"
    FEE = "fee"
    CORPORATE_ACTION = "corporate_action"
    FX_CONVERSION = "fx_conversion"
    OTHER = "other"


_KINDS = {
    TransactionKind.DEPOSIT.value: RowType.DEPOSIT,
    TransactionKind.WITHDRAWAL.value: RowType.WITHDRAWAL,
    TransactionKind.DIVIDEND.value: RowType.DIVIDEND,
    TransactionKind.FEE.value: RowType.FEE,
}


@dataclass
class LedgerRow:
    txn: Transaction
    type: RowType
    side: int = 0  # +1 buy, -1 sell, 0 otherwise
    shares: Decimal = ZERO  # signed share delta: trades and corporate actions
    cash: Decimal = ZERO  # cash delta in txn.currency
    multiplier: Decimal | None = None

    @property
    def account_id(self) -> int:
        return self.txn.account_id

    @property
    def symbol(self) -> str | None:
        return self.txn.symbol

    @property
    def currency(self) -> str:
        return (self.txn.currency or "").upper()


def multiplier(t: Transaction) -> Decimal | None:
    """|gross| / (quantity * price): about 1 for shares, about 100 for option contracts."""
    quantity, price, gross = t.quantity or ZERO, t.price or ZERO, t.gross_amount or ZERO
    if not quantity or not price or not gross:
        return None
    return abs(gross) / (quantity * price)


def classify(t: Transaction) -> RowType:
    raw_type = (t.raw_type or "").upper()
    if raw_type == "OPTIONEXPIRATION" or (t.description or "").startswith("Option expired"):
        return RowType.OPTION_EXPIRY
    if raw_type == "CORPORATE_ACTION":
        return RowType.CORPORATE_ACTION
    if raw_type == "INTEREST":
        return RowType.INTEREST
    if raw_type.startswith("FX CONVERSION"):
        return RowType.FX_CONVERSION
    if t.kind in (TransactionKind.BUY.value, TransactionKind.SELL.value):
        m = multiplier(t)
        return RowType.OPTION_TRADE if m is not None and m >= OPTION_MULTIPLIER else RowType.EQUITY_TRADE
    return _KINDS.get(t.kind, RowType.OTHER)


def normalize(transactions: list[Transaction]) -> list[LedgerRow]:
    """Every activity classified, oldest first (stored order within the same timestamp)."""
    rows = []
    for t in sorted(transactions, key=lambda t: (t.trade_date, t.id or 0)):
        kind = classify(t)
        row = LedgerRow(t, kind, cash=t.net_amount or ZERO, multiplier=multiplier(t))
        if kind in (RowType.EQUITY_TRADE, RowType.OPTION_TRADE):
            row.side = 1 if t.kind == TransactionKind.BUY.value else -1
            row.shares = row.side * (t.quantity or ZERO)
        elif kind == RowType.CORPORATE_ACTION:
            row.shares, row.cash = t.net_amount or ZERO, ZERO  # shares received, not money
        elif kind == RowType.OPTION_EXPIRY:
            row.cash = ZERO
        rows.append(row)
    return rows

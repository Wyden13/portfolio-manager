from dataclasses import dataclass
from enum import Enum

class AccountStatus(Enum):
    Active = "Active"
    Suspended_closed = "Suspended (Closed)"
    Suspended_readOnly = "Suspended (View Only)"
    Liquidate = "Liquidate Only"
    Closed = "Closed"

@dataclass
class Account:
    platform: str
    user_id:int
    account_id:int
    account_type:str
    account_number:str
    status: AccountStatus
    is_primary:bool
    client_account_type:str

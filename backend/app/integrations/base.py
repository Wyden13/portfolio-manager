from abc import ABC, abstractmethod
from investiq.backend.app.models.account import Account

class BrokerageAdapter(ABC):

    @abstractmethod
    async def get_accounts(self) -> list[Account]:
        pass

    @abstractmethod
    async def get_balances(self, account_id):
        pass

    @abstractmethod
    async def get_positions(self, account_id):
        pass

    @abstractmethod
    async def get_transactions(self, account_id):
        pass

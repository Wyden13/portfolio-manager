from abc import ABC, abstractmethod

class BrokerageAdaptor(ABC):

    @abstractmethod
    async def get_accounts(self):
        pass

    @abstractmethod
    async def get_balances(self, account_id):
        pass

    @abstractmethod
    async def get_position(self,account_id):
        pass

    @abstractmethod
    async def get_transactions(self,account_id):
        pass

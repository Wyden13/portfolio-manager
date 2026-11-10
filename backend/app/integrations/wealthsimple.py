from app.integrations.base import BrokerageAdapter

class WealthsimpleAdapter(BrokerageAdapter):
    async def get_accounts(self):
        pass

    async def get_balances(self, account_id):
        pass

    async def get_positions(self, account_id):
        pass

    async def get_transactions(self, account_id):
        pass

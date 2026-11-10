"""In-process stand-in for Questrade's REST API (login server and api server), served through an
httpx MockTransport. Paths, payloads, auth and the 31-day activity window mirror the real API.
"""
import secrets
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx

from demo.catalog import INSTRUMENTS
from demo.market import Market
from demo.world import Book

API_SERVER = "https://api07.iq.questrade.com/"
EASTERN = ZoneInfo("America/Toronto")
MAX_ACTIVITY_WINDOW = timedelta(days=31)

_TYPES = {"BUY": "Trades", "SELL": "Trades", "DIVIDEND": "Dividends", "DEPOSIT": "Deposits", "TRANSFER": "Transfers"}
_ACTIONS = {"BUY": "Buy", "SELL": "Sell", "DIVIDEND": "DIV", "TRANSFER": "TF6"}


def _timestamp(day: date) -> str:
    return datetime.combine(day, time(0), EASTERN).isoformat(timespec="microseconds")


def _settlement(day: date) -> date:
    day += timedelta(days=1)  # T+1
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


class FakeQuestrade:
    def __init__(self, books: list[Book], market: Market):
        self.books = {b.account.number: b for b in books}
        self.market = market
        self.symbol_ids = {s: 10_000 + i for i, s in enumerate(sorted(INSTRUMENTS))}
        self.access_token: str | None = None
        self.refresh_token: str | None = None
        self.personal_tokens: set[str] = set()

    def issue_personal_token(self) -> str:
        """What App Hub's "Generate new token" gives a personal app. Real ones are single-use; this one
        stays valid so the demo can be reconnected more than once."""
        token = secrets.token_urlsafe(24)
        self.personal_tokens.add(token)
        return token

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.url.host == "login.questrade.com" and path == "/oauth2/token":
            return self._token(request)
        if request.headers.get("Authorization") != f"Bearer {self.access_token}":
            return httpx.Response(401, json={"code": 1017, "message": "Access token is invalid"})
        parts = path.strip("/").split("/")
        if parts == ["v1", "accounts"]:
            return httpx.Response(200, json=self._accounts())
        if parts == ["v1", "symbols"]:
            return httpx.Response(200, json=self._symbols(request.url.params.get("ids", "")))
        if len(parts) == 4 and parts[:2] == ["v1", "accounts"] and parts[2] in self.books:
            book = self.books[parts[2]]
            if parts[3] == "positions":
                return httpx.Response(200, json=self._positions(book))
            if parts[3] == "balances":
                return httpx.Response(200, json=self._balances(book))
            if parts[3] == "activities":
                return self._activities(book, request.url.params)
        return httpx.Response(404, json={"code": 1001, "message": "Invalid endpoint"})

    def _token(self, request: httpx.Request) -> httpx.Response:
        params = request.url.params
        grant = params.get("grant_type")
        if grant == "refresh_token":
            token = params.get("refresh_token")
            if token not in self.personal_tokens and token != self.refresh_token:
                return httpx.Response(400, text="Bad Request")
        if grant not in ("refresh_token", "authorization_code"):
            return httpx.Response(400, text="Bad Request")
        self.access_token, self.refresh_token = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
        return httpx.Response(200, json={
            "access_token": self.access_token, "token_type": "Bearer", "expires_in": 1800,
            "refresh_token": self.refresh_token, "api_server": API_SERVER,
        })

    def _accounts(self) -> dict:
        return {
            "accounts": [
                {"type": b.account.type, "number": b.account.number, "status": "Active",
                 "isPrimary": i == 0, "isBilling": i == 0, "clientAccountType": b.account.client_account_type}
                for i, b in enumerate(self.books.values())
            ],
            "userId": 3_141_592,
        }

    def _symbols(self, ids: str) -> dict:
        by_id = {v: k for k, v in self.symbol_ids.items()}
        symbols = []
        for raw in filter(None, ids.split(",")):
            symbol = by_id.get(int(raw))
            if symbol:
                i = INSTRUMENTS[symbol]
                symbols.append({
                    "symbol": symbol, "symbolId": int(raw), "description": i.name.upper(),
                    "securityType": "Stock", "listingExchange": i.exchange, "currency": i.currency,
                    "isTradable": True, "isQuotable": True, "hasOptions": False,
                })
        return {"symbols": symbols}

    def _price(self, symbol: str) -> float:
        i = INSTRUMENTS[symbol]
        return self.market.last_price(i.yahoo) / i.minor_unit

    def _positions(self, book: Book) -> dict:
        positions = []
        for symbol, p in sorted(book.positions.items()):
            price = self._price(symbol)
            value = p.quantity * price
            positions.append({
                "symbol": symbol, "symbolId": self.symbol_ids[symbol], "openQuantity": p.quantity,
                "closedQuantity": 0, "currentMarketValue": round(value, 2), "currentPrice": round(price, 4),
                "averageEntryPrice": round(p.average_cost, 6), "dayPnl": 0, "closedPnl": 0,
                "openPnl": round(value - p.total_cost, 2), "totalCost": round(p.total_cost, 2),
                "isRealTime": False, "isUnderReorg": False,
            })
        return {"positions": positions}

    def _balances(self, book: Book) -> dict:
        balances = []
        for currency in ("CAD", "USD"):
            value = sum(p.quantity * self._price(s) for s, p in book.positions.items()
                        if INSTRUMENTS[s].currency == currency)
            cash = round(book.cash.get(currency, 0.0), 2)
            balances.append({
                "currency": currency, "cash": cash, "marketValue": round(value, 2),
                "totalEquity": round(cash + value, 2), "buyingPower": cash, "maintenanceExcess": cash,
                "isRealTime": False,
            })
        return {"perCurrencyBalances": balances, "combinedBalances": balances,
                "sodPerCurrencyBalances": balances, "sodCombinedBalances": balances}

    def _activities(self, book: Book, params) -> httpx.Response:
        try:
            start = datetime.fromisoformat(params["startTime"])
            end = datetime.fromisoformat(params["endTime"])
        except (KeyError, ValueError):
            return httpx.Response(400, json={"code": 1002, "message": "Invalid or malformed argument: startTime"})
        if end - start > MAX_ACTIVITY_WINDOW:
            return httpx.Response(400, json={"code": 1003, "message": "Argument length exceeds imposed limit"})
        rows = []
        for a in book.activities:
            when = datetime.combine(a.day, time(0), EASTERN)
            if not start <= when <= end:
                continue
            sign = -1 if a.kind == "SELL" else 1
            gross = a.amount + a.commission if a.kind in ("BUY", "SELL") else a.amount
            rows.append({
                "tradeDate": _timestamp(a.day), "transactionDate": _timestamp(a.day),
                "settlementDate": _timestamp(_settlement(a.day)),
                "action": _ACTIONS.get(a.kind, "CON" if book.account.type == "TFSA" else "DEP"),
                "symbol": a.symbol or "", "symbolId": self.symbol_ids.get(a.symbol, 0),
                "description": a.description.upper(), "currency": a.currency,
                "quantity": sign * a.quantity, "price": a.price, "grossAmount": round(gross, 2),
                "commission": -a.commission, "netAmount": a.amount, "type": _TYPES[a.kind],
            })
        return httpx.Response(200, json={"activities": rows})

"""In-process stand-in for the SnapTrade Python SDK client. Method names, keyword arguments and
response bodies (`.body`) follow the SDK's API classes and TypedDicts (Account, AccountHoldingsAccount,
PaginatedUniversalActivity, ...). Wrong user secrets raise the SDK's ApiException(401).
"""
import hashlib
import secrets
import uuid
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace

from snaptrade_client import ApiException

from demo.catalog import INSTRUMENTS
from demo.market import Market
from demo.world import Book

_TYPE_NAMES = {"cs": "Common Stock", "et": "ETF"}
_EXCHANGES = {
    "TSX": ("TSX", "XTSE", "Toronto Stock Exchange", "America/Toronto", ".TO"),
    "NASDAQ": ("NASDAQ", "XNAS", "NASDAQ", "America/New_York", None),
    "NYSE": ("NYSE", "XNYS", "New York Stock Exchange", "America/New_York", None),
    "NYSE ARCA": ("ARCX", "ARCX", "NYSE ARCA", "America/New_York", None),
    "LSE": ("LSE", "XLON", "London Stock Exchange", "Europe/London", ".L"),
}


def _uuid(*parts: str) -> str:
    return str(uuid.UUID(hashlib.md5("|".join(parts).encode()).hexdigest()))


def _currency(code: str) -> dict:
    names = {"CAD": "Canadian Dollar", "USD": "US Dollar", "GBP": "British Pound"}
    return {"id": _uuid("currency", code), "code": code, "name": names.get(code, code)}


def _iso(day: date, hour: int = 14) -> str:
    return datetime.combine(day, time(hour), timezone.utc).isoformat().replace("+00:00", "Z")


def _universal_symbol(symbol: str) -> dict:
    i = INSTRUMENTS[symbol]
    code, mic, name, tz, suffix = _EXCHANGES[i.exchange]
    return {
        "id": _uuid("symbol", symbol), "symbol": symbol, "raw_symbol": symbol.split(".")[0] if suffix else symbol,
        "description": i.name, "currency": _currency(i.currency), "currencies": [_currency(i.currency)],
        "exchange": {"id": _uuid("exchange", code), "code": code, "mic_code": mic, "name": name, "timezone": tz,
                     "start_time": "09:30:00", "close_time": "16:00:00", "suffix": suffix},
        "type": {"id": _uuid("type", i.security_type), "code": i.security_type,
                 "description": _TYPE_NAMES[i.security_type], "is_supported": True},
        "figi_code": None,
    }


def _slug(institution: str) -> str:
    """SnapTrade's broker slug, e.g. WEALTHSIMPLE, INTERACTIVE-BROKERS."""
    return institution.upper().replace(" ", "-")


def _response(body):
    return SimpleNamespace(body=body, status=200)


class FakeSnapTrade:
    def __init__(self, books: list[Book], market: Market):
        self.market = market
        self.books = {_uuid("account", b.account.number): b for b in books}
        self.users: dict[str, str] = {}
        self.unlinked: dict[str, Book] = {}
        self.authentication = SimpleNamespace(
            register_snap_trade_user=self.register_snap_trade_user,
            login_snap_trade_user=self.login_snap_trade_user,
        )
        self.connections = SimpleNamespace(delete_connection=self.delete_connection)
        self.reference_data = SimpleNamespace(list_all_brokerages=self.list_all_brokerages)
        self.account_information = SimpleNamespace(
            list_user_accounts=self.list_user_accounts,
            get_all_account_positions=self.get_all_account_positions,
            get_user_account_balance=self.get_user_account_balance,
            get_account_activities=self.get_account_activities,
        )

    def _authorize(self, user_id: str, user_secret: str) -> None:
        if self.users.get(user_id) != user_secret:
            raise ApiException(status=401, reason="Unauthorized")

    def _book(self, account_id: str) -> Book:
        if account_id not in self.books:
            raise ApiException(status=404, reason="Not Found")
        return self.books[account_id]

    # authentication

    def register_snap_trade_user(self, user_id: str, **_):
        self.users[user_id] = secrets.token_hex(16)
        return _response({"userId": user_id, "userSecret": self.users[user_id]})

    def login_snap_trade_user(self, user_id: str, user_secret: str, broker: str | None = None, **kwargs):
        self._authorize(user_id, user_secret)
        # There is no portal to visit: (re)link the requested institution's accounts right away and
        # send the user straight to the custom redirect, as the portal does when it finishes.
        for account_id, book in list(self.unlinked.items()):
            if broker is None or broker.startswith(_slug(book.account.institution)):
                self.books[account_id] = self.unlinked.pop(account_id)
        token = secrets.token_urlsafe(16)
        return _response({
            "redirectURI": kwargs.get("custom_redirect")
                           or f"https://app.snaptrade.com/snapTrade/redeemToken?token={token}"
                              f"&connectionType={kwargs.get('connection_type', 'read')}",
            "sessionId": str(uuid.uuid4()),
        })

    # reference data

    def list_all_brokerages(self, **_):
        # Logo URLs are left out: the demo runs offline, so the app shows its monogram fallback.
        names = [("QUESTRADE", "Questrade"), ("WEALTHSIMPLETRADE", "Wealthsimple Trade"),
                 ("INTERACTIVE-BROKERS", "Interactive Brokers")]
        return _response([
            {"id": _uuid("brokerage", slug), "slug": slug, "name": name, "display_name": name,
             "aws_s3_logo_url": None, "aws_s3_square_logo_url": None, "enabled": True,
             "maintenance_mode": False, "is_degraded": False}
            for slug, name in names
        ])

    # connections

    def delete_connection(self, connection_id: str, user_id: str, user_secret: str, **_):
        self._authorize(user_id, user_secret)
        for account_id, book in list(self.books.items()):
            if _uuid("authorization", book.account.institution) == connection_id:
                self.unlinked[account_id] = self.books.pop(account_id)
        return _response({"detail": "deleted"})

    # account_information

    def _account(self, account_id: str, book: Book) -> dict:
        value = sum(p.quantity * self._price(s) for s, p in book.positions.items()) + sum(book.cash.values())
        opened = book.activities[0].day if book.activities else date.today()
        return {
            "id": account_id, "brokerage_authorization": _uuid("authorization", book.account.institution),
            "name": f"{book.account.institution} {book.account.type}", "number": book.account.number,
            "institution_name": book.account.institution,
            "created_date": _iso(opened), "opening_date": _iso(opened),
            "sync_status": {
                "transactions": {"initial_sync_completed": True, "last_successful_sync": _iso(date.today()),
                                 "first_transaction_date": opened.isoformat()},
                "holdings": {"initial_sync_completed": True, "last_successful_sync": _iso(date.today())},
            },
            "balance": {"total": {"amount": round(value, 2), "currency": "CAD"}},
            "status": "open", "raw_type": book.account.type, "account_category": "INVESTMENT",
            "is_paper": False, "meta": {"type": book.account.type, "institution_name": book.account.institution},
        }

    def list_user_accounts(self, user_id: str, user_secret: str, **_):
        self._authorize(user_id, user_secret)
        return _response([self._account(i, b) for i, b in self.books.items()])

    def _price(self, symbol: str) -> float:
        i = INSTRUMENTS[symbol]
        return self.market.last_price(i.yahoo) / i.minor_unit

    def get_all_account_positions(self, account_id: str, user_id: str, user_secret: str, **_):
        self._authorize(user_id, user_secret)
        book = self._book(account_id)
        results = []
        for symbol, p in sorted(book.positions.items()):
            i = INSTRUMENTS[symbol]
            u = _universal_symbol(symbol)
            results.append({
                "instrument": {"kind": "etf" if i.security_type == "et" else "stock", "id": u["id"],
                               "symbol": symbol, "raw_symbol": u["raw_symbol"], "description": i.name,
                               "currency": i.currency, "exchange": u["exchange"]["mic_code"]},
                "units": str(p.quantity), "price": str(round(self._price(symbol), 4)),
                "cost_basis": str(round(p.average_cost, 6)), "currency": i.currency, "cash_equivalent": False,
            })
        results += [{"instrument": {"kind": "cash", "code": c}, "units": str(round(v, 2)), "price": "1",
                     "currency": c, "cash_equivalent": True} for c, v in sorted(book.cash.items())]
        return _response({"results": results, "data_freshness": {"as_of": _iso(date.today())}})

    def get_user_account_balance(self, account_id: str, user_id: str, user_secret: str, **_):
        self._authorize(user_id, user_secret)
        book = self._book(account_id)
        return _response([{"currency": _currency(c), "cash": round(v, 2), "buying_power": round(v, 2)}
                          for c, v in sorted(book.cash.items())])

    def get_account_activities(self, account_id: str, user_id: str, user_secret: str, start_date=None,
                               end_date=None, offset: int = 0, limit: int = 1000, type=None, **_):
        self._authorize(user_id, user_secret)
        book = self._book(account_id)
        start = date.fromisoformat(str(start_date)) if start_date else date.min
        end = date.fromisoformat(str(end_date)) if end_date else date.max
        types = set(type.split(",")) if type else None
        kinds = {"DEPOSIT": "CONTRIBUTION" if book.account.type in ("TFSA", "RRSP") else "DEPOSIT"}
        rows = []
        for a in book.activities:
            kind = kinds.get(a.kind, a.kind)
            if not start <= a.day <= end or (types and kind not in types):
                continue
            rows.append({
                "id": _uuid("activity", a.id), "symbol": _universal_symbol(a.symbol) if a.symbol else None,
                "option_symbol": None, "price": a.price, "units": -a.quantity if a.kind == "SELL" else a.quantity,
                "amount": a.amount, "currency": _currency(a.currency), "type": kind, "option_type": "",
                "description": a.description, "trade_date": _iso(a.day),
                "settlement_date": _iso(a.day + timedelta(days=1)), "fee": a.commission, "fx_rate": None,
                "institution": book.account.institution, "external_reference_id": a.id,
            })
        page = rows[offset:offset + limit]
        return _response({"data": page, "pagination": {"offset": offset, "limit": limit, "total": len(rows)}})

from datetime import datetime
from decimal import Decimal as D

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.api.accounts import current_user_id
from app.database import get_db
from app.main import app
from app.models.account import AccountRecord
from app.models.transaction import Transaction


def acct(id, institution, number, user=1, **kw):
    return AccountRecord(id=id, user_id=user, platform="p", external_id=str(id), account_number=number,
                         account_type="TFSA", status="Active", institution=institution, **kw)


def tx(id, account, kind, day, symbol="RY.TO", qty="10.5"):
    return Transaction(id=id, account_id=account, external_id=str(id), kind=kind, symbol=symbol,
                       trade_date=datetime(2026, 3, day, 14), quantity=D(qty), price=D("100.25"), fee=D("4.95"),
                       gross_amount=D("-1052.625"), net_amount=D("-1057.575"), currency="CAD", description="desc, quoted")


@pytest.fixture
def client(db_engine):
    factory = sessionmaker(bind=db_engine, expire_on_commit=False)
    with factory() as db:
        db.add_all([acct(1, "Questrade", "26598145"), acct(2, "Wealthsimple", "WS123456"),
                    acct(3, "Questrade", "26598145", duplicate_of_id=1), acct(4, "Other", "1", user=2)])
        db.add_all([tx(1, 1, "BUY", 1), tx(2, 1, "SELL", 5), tx(3, 2, "DIVIDEND", 3, symbol="xeqt.to"),
                    tx(4, 3, "BUY", 1), tx(5, 4, "BUY", 1)])
        db.commit()

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides.update({get_db: override_db, current_user_id: lambda: 1})
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_ledger_merges_institutions_newest_first_without_duplicates_or_other_users(client):
    body = client.get("/api/transactions").json()
    assert body["total"] == 3 and [t["id"] for t in body["items"]] == [2, 3, 1]
    first = body["items"][0]
    assert (first["institution"], first["account_number"], first["quantity"]) == ("Questrade", "••8145", 10.5)


def test_ledger_filters_and_pagination(client):
    get = lambda **p: client.get("/api/transactions", params=p).json()  # noqa: E731
    assert [t["id"] for t in get(institution="Wealthsimple")["items"]] == [3]
    assert [t["id"] for t in get(kind=["BUY", "SELL"])["items"]] == [2, 1]
    assert [t["id"] for t in get(symbol="XEQT.TO")["items"]] == [3]
    assert [t["id"] for t in get(start="2026-03-02", end="2026-03-03")["items"]] == [3]
    assert [t["id"] for t in get(account_id=1)["items"]] == [2, 1]
    page = get(limit=1, offset=1)
    assert (page["total"], [t["id"] for t in page["items"]]) == (3, [3])
    assert client.get("/api/transactions", params={"kind": "NOPE"}).status_code == 422


def test_csv_export_uses_exact_decimals_and_filters(client):
    response = client.get("/api/transactions.csv", params={"kind": "BUY"})
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    header, row = response.text.strip().splitlines()
    assert header.startswith("trade_date,institution")
    assert row == '2026-03-01,Questrade,TFSA,••8145,BUY,RY.TO,10.5,100.25,4.95,-1052.625,-1057.575,CAD,"desc, quoted"'


def test_ledger_accounts_for_filters(client):
    accounts = client.get("/api/ledger/accounts").json()
    assert [(a["institution"], a["account_number"]) for a in accounts] == [("Questrade", "••8145"), ("Wealthsimple", "••3456")]

"""每日复盘扩展指数：固定目录、日线涨跌及指数专用 K 线契约。"""
from fastapi.testclient import TestClient

import app as app_module
import astock

client = TestClient(app_module.app)


class Frame:
    def __init__(self, rows):
        self.rows = rows
        self.empty = not rows

    def to_dict(self, orientation):
        assert orientation == "records"
        return self.rows


def bar(date, close):
    return {"datetime": date, "open": close - 1, "close": close, "low": close - 2, "high": close + 1, "vol": 1000}


def test_review_quotes_order_and_change(monkeypatch):
    calls = []

    class Quotes:
        def index_bars(self, *, symbol, frequency, offset):
            calls.append((symbol, frequency, offset))
            return Frame([bar("2026-09-22", 100), bar("2026-09-23", 102)])

    monkeypatch.setattr(astock, "_mootdx_client", lambda: Quotes())
    response = client.get("/api/indices/review")
    assert response.status_code == 200
    rows = response.json()["data"]
    assert [item["code"] for item in rows] == [code for code, _ in astock.REVIEW_INDICES]
    assert len(rows) == 29
    assert rows[0] == {
        "code": "000016", "name": "上证50", "price": 102.0,
        "change_amt": 2.0, "change_pct": 2.0, "as_of": "2026-09-23",
    }
    assert ("880801", 4, 2) in calls


def test_review_quotes_empty_and_bad_bars(monkeypatch):
    class Quotes:
        def index_bars(self, *, symbol, frequency, offset):
            if symbol == "000016":
                return Frame([])
            if symbol == "880801":
                return Frame([bar("2026-09-23", float("nan"))])
            return Frame([bar("2026-09-23", 102)])

    monkeypatch.setattr(astock, "_mootdx_client", lambda: Quotes())
    rows = client.get("/api/indices/review").json()["data"]
    assert rows[0]["price"] is None and rows[0]["change_pct"] is None
    assert rows[1]["price"] is None
    assert rows[2]["price"] == 102 and rows[2]["change_pct"] is None


def test_review_index_kline_uses_index_source(monkeypatch):
    calls = []

    class Quotes:
        def index_bars(self, *, symbol, frequency, offset):
            calls.append((symbol, frequency, offset))
            return Frame([bar("2026-09-23", 102), bar("2026-09-22", 100)])

    monkeypatch.setattr(astock, "_mootdx_client", lambda: Quotes())
    response = client.get("/api/indices/880381/kline?category=5&offset=200")
    assert response.status_code == 200
    assert response.json()["data"] == {
        "code": "880381", "name": "白酒",
        "bars": [bar("2026-09-22", 100), bar("2026-09-23", 102)],
    }
    assert calls == [("880381", 5, 200)]


def test_review_index_kline_empty_and_validation(monkeypatch):
    class Quotes:
        def index_bars(self, **kwargs):
            return Frame([])

    monkeypatch.setattr(astock, "_mootdx_client", lambda: Quotes())
    assert client.get("/api/indices/000001/kline").json()["data"]["bars"] == []
    assert client.get("/api/indices/123/kline").status_code == 400
    assert client.get("/api/indices/123456/kline").status_code == 404
    assert client.get("/api/indices/000001/kline?category=9").status_code == 422
    assert client.get("/api/indices/000001/kline?offset=801").status_code == 422


def test_review_indices_source_failure(monkeypatch):
    def unavailable():
        raise RuntimeError("source down")

    monkeypatch.setattr(astock, "_mootdx_client", unavailable)
    assert client.get("/api/indices/review").status_code == 502
    assert client.get("/api/indices/000001/kline").status_code == 502

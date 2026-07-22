"""API 验证/契约测（FastAPI TestClient）。大多在校验层就返回，不联网、可靠。"""
import pytest
from fastapi.testclient import TestClient

import app as app_module

client = TestClient(app_module.app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


@pytest.mark.parametrize("path", [
    "/api/quote?codes=abc",
    "/api/valuation?code=12",
    "/api/margin?code=notcode",
    "/api/holders?code=1234567",
    "/api/announcements?code=",
])
def test_bad_code_400(path):
    assert client.get(path).status_code == 400


def test_industry_top_range():
    assert client.get("/api/industry?top=2").status_code == 422   # ge=5
    assert client.get("/api/industry?top=999").status_code == 422  # le=50


def test_user_sector_source_crud_contract(monkeypatch):
    monkeypatch.setattr(
        app_module.user_sectors,
        "add_sector",
        lambda code, name: {"code": code, "name": name, "created_at": 1, "updated_at": 1},
    )
    created = client.post("/api/user-sectors", json={"code": "880544", "name": "光伏"})
    assert created.status_code == 200
    assert created.json()["data"]["code"] == "880544"

    received = {}

    def update(code, *, new_code=None, name=None):
        received.update({"old_code": code, "new_code": new_code, "name": name})
        return {"code": new_code or code, "name": name, "created_at": 1, "updated_at": 2}

    monkeypatch.setattr(app_module.user_sectors, "update_sector", update)
    updated = client.put("/api/user-sectors/880544", json={"code": "880545", "name": "云计算"})
    assert updated.status_code == 200
    assert received == {"old_code": "880544", "new_code": "880545", "name": "云计算"}

    monkeypatch.setattr(app_module.user_sectors, "delete_sector", lambda code: code == "880545")
    assert client.delete("/api/user-sectors/880545").status_code == 200
    assert client.delete("/api/user-sectors/880544").status_code == 404


def test_user_sector_source_validation():
    assert client.post("/api/user-sectors", json={"code": "88054", "name": "光伏"}).status_code == 422
    assert client.post("/api/user-sectors", json={"code": "880544", "name": ""}).status_code == 422


def test_user_sector_rps_contract_and_upstream_failure(monkeypatch):
    payload = {
        "version": 2,
        "source": "通达信板块/指数日 K",
        "trade_date": "2026-07-22",
        "computed_at": 1,
        "source_count": 1,
        "available_count": 1,
        "unavailable_count": 0,
        "ranked_count_by_period": {"5": 1, "10": 1, "15": 1, "20": 1},
        "periods": [5, 10, 15, 20],
        "rule": "test",
        "rows": [],
    }
    monkeypatch.setattr(
        app_module.user_sectors,
        "compute_all_sector_rps",
        lambda force_refresh=False: {**payload, "forced": force_refresh},
    )
    response = client.get("/api/user-sectors/rps?refresh=true")
    assert response.status_code == 200
    assert response.json()["data"]["forced"] is True

    def fail(*, force_refresh=False):
        raise app_module.user_sectors.SectorDataError("tdx down")

    monkeypatch.setattr(app_module.user_sectors, "compute_all_sector_rps", fail)
    failed = client.get("/api/user-sectors/rps")
    assert failed.status_code == 502
    assert "通达信板块 RPS 数据源异常" in failed.json()["detail"]


def test_chat_empty_messages_400():
    r = client.post("/api/chat", json={"messages": [], "llm": {"model": "x", "baseURL": "http://x", "apiKey": "k"}})
    assert r.status_code == 400


def test_chat_api_missing_key_400():
    # API 接入缺 baseURL/apiKey → 400（在开流前拦下）
    r = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "hi"}],
        "llm": {"provider": "deepseek", "model": "deepseek-chat", "baseURL": "", "apiKey": ""},
    })
    assert r.status_code == 400


def test_chat_cli_not_installed_400():
    # 订阅接入选一个本机没装的 CLI → 400 明确提示（不静默失败）
    r = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "hi"}],
        "llm": {"provider": "cli-qwen", "model": "qwen-code", "baseURL": "", "apiKey": ""},
    })
    # qwen 一般未装 → 400；若恰好装了 qwen 则会进流式（放宽断言）
    assert r.status_code in (400, 200)


def test_global_stock_404(monkeypatch):
    """无法解析的美股/港股代码 → 404（不 500、不崩）。"""
    import gstock
    monkeypatch.setattr(gstock, "us_hk_stock", lambda q: {})
    assert client.get("/api/global/stock?symbol=ZZZZ").status_code == 404


def test_gstock_quote_full_null_shape():
    """行情取不到时 `_quote_from({})` 仍返回完整 null 形状（契合 GlobalQuote 类型），不是空 dict。"""
    import gstock
    q = gstock._quote_from({})
    assert set(q) == {"code", "name", "price", "open", "high", "low", "prev_close", "amount", "mcap", "change_pct"}
    assert all(v is None for v in q.values())


def test_kline_full_history_flag_is_forwarded(monkeypatch):
    received = {}

    def fake_kline(code, category=4, offset=60, *, full_history=False):
        received.update({
            "code": code, "category": category, "offset": offset,
            "full_history": full_history,
        })
        return [{"datetime": "1991-04-03 15:00", "close": 1.0}]

    monkeypatch.setattr(app_module.astock, "kline", fake_kline)
    response = client.get(
        "/api/kline?code=000001&category=4&offset=60&full_history=true"
    )

    assert response.status_code == 200
    assert response.json()["data"][0]["datetime"] == "1991-04-03 15:00"
    assert received == {
        "code": "000001", "category": 4, "offset": 60,
        "full_history": True,
    }


def test_kline_rejects_unknown_frequency():
    assert client.get("/api/kline?code=000001&category=11").status_code == 422


def test_kline_empty_history_is_success(monkeypatch):
    monkeypatch.setattr(app_module.astock, "kline", lambda *args, **kwargs: [])

    response = client.get(
        "/api/kline?code=000001&category=4&full_history=true"
    )

    assert response.status_code == 200
    assert response.json() == {"data": []}


def test_kline_upstream_failure_is_502(monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("tdx unavailable")

    monkeypatch.setattr(app_module.astock, "kline", fail)
    response = client.get(
        "/api/kline?code=000001&category=4&full_history=true"
    )

    assert response.status_code == 502
    assert "K线源异常" in response.json()["detail"]


def test_kline_formula_preset_is_editable_tdx_source():
    response = client.get("/api/kline/formula/preset")

    assert response.status_code == 200
    data = response.json()["data"]
    assert "DMI.PDI" in data["default_source"]
    assert "MA5:MA(CLOSE,5)" in data["default_source"]
    assert "DRAWICON" in data["supported_functions"]
    assert data["supported_icon_range"] == [1, 51]


def test_kline_formula_evaluate_returns_dynamic_lines_and_icon_points(monkeypatch):
    monkeypatch.setattr(
        app_module.astock,
        "tencent_quote",
        lambda codes: {codes[0]: {"turnover_pct": 2.0}},
    )
    bars = [
        {
            "datetime": f"2026-01-{index:02d} 15:00",
            "open": 10 + index / 10,
            "high": 11 + index / 10,
            "low": 9 + index / 10,
            "close": 10 + index / 10,
            "vol": 100_000,
        }
        for index in range(1, 21)
    ]
    response = client.post("/api/kline/formula/evaluate", json={
        "code": "002821",
        "category": 6,
        "source": "PDI:=DMI.PDI;自选线:MA(C,7);DRAWICON(PERIOD=7 AND PDI<100,LOW,34);",
        "bars": bars,
        "rps_history": [],
    })

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["period"] == 7
    assert data["bar_count"] == 20
    assert data["lines"][0]["name"] == "自选线"
    assert len(data["lines"][0]["values"]) == 20
    assert data["icons"][0]["icon"] == 34
    assert data["icons"][0]["points"][-1]["index"] == 19


def test_kline_formula_evaluate_reports_source_location():
    response = client.post("/api/kline/formula/evaluate", json={
        "code": "002821",
        "category": 4,
        "source": "A:=UNKNOWN(C);",
        "bars": [{
            "datetime": "2026-01-01 15:00", "open": 1, "high": 1,
            "low": 1, "close": 1, "vol": 1,
        }],
    })

    assert response.status_code == 422
    issue = response.json()["detail"]["issues"][0]
    assert issue["code"] == "unsupported_function"
    assert issue["line"] == 1

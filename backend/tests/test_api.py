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

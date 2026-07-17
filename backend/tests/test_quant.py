"""量化选股纯逻辑与 API 契约测试（不联网）。"""

from fastapi.testclient import TestClient

import app as app_module
import quant


def _bars(count: int, latest_close: float, high: float = 100.0):
    rows = []
    for i in range(count):
        rows.append({
            "datetime": f"2026-01-{(i % 28) + 1:02d} 15:00",
            "high": high,
            "close": latest_close if i == count - 1 else high * 0.8,
        })
    return rows


def _trend_bars(count: int = 320):
    rows = []
    for i in range(count):
        close = 70 + i * 0.1
        if i == count - 40:
            close = 80
        rows.append({
            "datetime": f"2026-01-{(i % 28) + 1:02d} 15:00",
            "high": (70 + i * 0.1) * 1.005,
            "low": min(close * 0.995, (70 + i * 0.1) * 0.995),
            "close": close,
        })
    return rows


def test_near_year_high_matches_tdx_hhv_formula():
    result = quant.near_year_high(_bars(250, 96), proximity_pct=5, lookback_days=250)
    assert result is not None
    assert result["near_high"] is True
    assert result["distance_to_high_pct"] == 4.0
    assert result["history_days"] == 250


def test_near_year_high_rejects_far_or_short_history():
    far = quant.near_year_high(_bars(250, 90), proximity_pct=5, lookback_days=250)
    assert far is not None and far["near_high"] is False
    assert quant.near_year_high(_bars(100, 99), proximity_pct=5, lookback_days=250) is None


def test_rps_percentiles_share_one_ranked_universe():
    rows = [
        {"code": "1", "returns": {50: 0.1}},
        {"code": "2", "returns": {50: 0.2}},
        {"code": "3", "returns": {50: 0.2}},
        {"code": "4", "returns": {50: 0.4}},
    ]
    ranks = quant._percentile_ranks(rows, 50)
    assert ranks == {"1": 25.0, "2": 62.5, "3": 62.5, "4": 100.0}


def test_hkex_codes_and_base_pool_use_or_logic(monkeypatch):
    assert quant._hkex_code_to_a_share("90519", "sh") == "600519"
    assert quant._hkex_code_to_a_share("30001", "sh") == "688001"
    assert quant._hkex_code_to_a_share("70001", "sz") == "000001"
    assert quant._hkex_code_to_a_share("77750", "sz") == "300750"

    fund_rows = [
        {
            "code": code, "name": name, "fund_count": 10,
            "fund_hold_shares": 100, "fund_hold_value_yi": 2,
            "fund_float_ratio_pct": 6, "fund_total_ratio_pct": 5,
            "fund_period": "2025-12-31",
        }
        for code, name in (("000001", "基金独有"), ("000002", "两者重叠"))
    ]
    holdings = {
        code: {
            "code": code, "hkex_name": name,
            "north_hold_shares": 100_000_000,
            "north_total_ratio_pct": 3,
        }
        for code, name in (("000002", "两者重叠"), ("000003", "北向独有"))
    }
    monkeypatch.setattr(quant, "_fund_rows", lambda period, ratio: fund_rows)
    monkeypatch.setattr(
        quant, "latest_north_holdings",
        lambda: {"period": "2025-12-31", "rows": holdings},
    )
    monkeypatch.setattr(
        quant, "_batch_quotes",
        lambda codes: {code: {"name": code, "price": 2} for code in codes},
    )

    result = quant.base_pool(5, 1, fund_period="2025-12-31")
    assert result["fund_candidate_count"] == 2
    assert result["north_candidate_count"] == 2
    assert result["overlap_count"] == 1
    assert result["base_count"] == 3
    assert {row["code"] for row in result["rows"]} == {"000001", "000002", "000003"}


def test_user_tdx_formula_evaluators():
    rps = {"rps50": 99, "rps120": 99, "rps250": 99}
    monthly = quant.monthly_reversal_62(_trend_bars(), rps)
    assert monthly is not None
    assert isinstance(monthly["matched"], bool)
    assert monthly["matched"] is True

    growth = quant.growth_mrgc_sxhcg(_trend_bars(), rps, turnover_pct=3)
    assert growth is not None
    assert growth["technical_candidate"] is True
    assert growth["mrgc"] is True


def test_quant_screen_api(monkeypatch):
    expected = {"base_count": 2, "matched_count": 1, "rows": [{"code": "600519"}]}
    received = {}

    def fake_run_screen(**kwargs):
        received.update(kwargs)
        return expected

    monkeypatch.setattr(app_module.quant, "run_screen", fake_run_screen)
    client = TestClient(app_module.app)
    response = client.post("/api/quant/screen", json={
        "fund_ratio_min": 5,
        "north_value_min_yi": 1,
        "near_high_pct": 5,
        "lookback_days": 250,
        "strategy": "monthly_reversal_62",
    })
    assert response.status_code == 200
    assert response.json()["data"] == expected
    assert received["strategy"] == "monthly_reversal_62"


def test_quant_screen_validation():
    client = TestClient(app_module.app)
    assert client.post("/api/quant/screen", json={"near_high_pct": -1}).status_code == 422
    assert client.post("/api/quant/screen", json={"lookback_days": 20}).status_code == 422
    assert client.post("/api/quant/screen", json={"strategy": "unknown"}).status_code == 422

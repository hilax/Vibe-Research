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
    assert ranks == {"1": 0.0, "2": 50.0, "3": 50.0, "4": 100.0}


def test_rps_exact_qfq_uses_tdx_dividend_rights_and_bonus_records():
    closes = quant._exact_qfq_closes(
        ["2026-01-02", "2026-01-05", "2026-01-06"],
        [100.0, 110.0, 120.0],
        [
            {
                "year": 2026,
                "month": 1,
                "day": 5,
                "category": 1,
                "fenhong": 10,
                "peigu": 2,
                "peigujia": 20,
                "songzhuangu": 1,
            },
            {"year": 2026, "month": 1, "day": 7, "category": 1, "fenhong": 50},
            {"year": 2026, "month": 1, "day": 5, "category": 5, "fenhong": 999},
        ],
    )

    assert closes == [1030 / 13, 110.0, 120.0]


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


def test_compute_3l_metrics():
    bars = _trend_bars(60)
    row = {"code": "600519", "rps250": 95, "rps120": 92}
    quant._compute_3l_metrics(bars, row)
    assert row["ma20"] is not None
    assert row["ma20_slope"] in ("up", "down", "flat")
    assert row["stop_loss_hard_8"] == round(row["close"] * 0.92, 2)
    assert row["stop_loss_hard_5"] == round(row["close"] * 0.95, 2)
    assert row["key_support"] is not None
    assert row["risk_reward_ratio"] is not None
    assert row["timing_status"] in ("均线低吸点", "关键点突破", "主升通道", "乖离过大", "破位回避", "震荡整理")
    assert isinstance(row["risk_tags"], list)


def test_backtest_summary_and_forward_returns():
    row = {"code": "600519", "close": 100.0}
    future_bars = [
        {"close": 102.0, "high": 103.0, "low": 99.0},
        {"close": 103.0, "high": 104.0, "low": 101.0},
        {"close": 104.0, "high": 105.0, "low": 102.0},
        {"close": 105.0, "high": 106.0, "low": 103.0},
        {"close": 108.0, "high": 109.0, "low": 104.0},  # T+5
    ] + [{"close": 110.0 + i, "high": 112.0 + i, "low": 109.0 + i} for i in range(20)]

    quant._apply_forward_returns(row, future_bars)
    assert row["return_5d"] == 8.0
    assert row["return_10d"] is not None
    assert row["return_20d"] is not None
    assert row["max_gain_20d"] is not None

    summary = quant._compute_backtest_summary("2026-06-01", [row])
    assert summary is not None
    assert summary["sample_count"] == 1
    assert summary["win_rate_5d"] == 100.0
    assert summary["avg_return_5d"] == 8.0
    assert summary["win_rate_20d"] == 100.0


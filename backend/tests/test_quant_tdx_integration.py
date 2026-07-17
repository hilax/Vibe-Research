from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

import app as app_module
import quant
import tdx_formula
import tdx_presets


def _bars(count: int = 250, latest: float = 96) -> list[dict]:
    start = date(2025, 1, 1)
    rows = []
    for index in range(count):
        close = latest if index == count - 1 else 90
        rows.append({
            "datetime": f"{start + timedelta(days=index)} 15:00",
            "open": close,
            "high": 100 if index == 0 else close,
            "low": close - 1,
            "close": close,
            "vol": 100_000,
        })
    return rows


def _base_pool() -> dict:
    row = {
        "code": "600000", "name": "测试股票", "industry": "测试",
        "fund_float_ratio_pct": 6.0, "fund_count": 1,
        "fund_hold_shares": 1, "fund_hold_value_yi": 1.0,
        "fund_total_ratio_pct": 1.0, "fund_period": "2026-06-30",
        "north_hold_shares": None, "north_hold_value_yi": None,
        "north_float_ratio_pct": None, "north_total_ratio_pct": None,
        "north_period": "2026-06-30", "condition_tags": ["基金≥5%"],
    }
    return {
        "rows": [row], "fund_period": "2026-06-30", "north_period": "2026-06-30",
        "fund_candidate_count": 1, "north_candidate_count": 0,
        "overlap_count": 0, "base_count": 1,
    }


def _growth_bars(count: int) -> list[dict]:
    start = date(2023, 1, 1)
    rows = []
    for index in range(count):
        baseline = 70 + index * 0.1
        close = 80 if index == count - 40 else baseline
        rows.append({
            "datetime": f"{start + timedelta(days=index)} 15:00",
            "open": baseline * 0.998,
            "high": baseline * 1.005,
            "low": min(close, baseline) * 0.995,
            "close": close,
            "vol": 100_000,
        })
    return rows


def test_tdx_validate_api_and_structured_error():
    client = TestClient(app_module.app)
    valid = client.post("/api/quant/formula/validate", json={
        "strategy": "near_high",
        "source": "{可直接复制}\nXG:C>=HHV(H,250)*0.95;",
    })
    assert valid.status_code == 200
    data = valid.json()["data"]
    assert data["valid"] is True
    assert data["required_history"] == 250
    assert data["used_functions"] == ["HHV"]
    assert len(data["formula_hash"]) == 12

    invalid = client.post("/api/quant/formula/validate", json={
        "strategy": "near_high",
        "source": "XG:=SYSTEM('del');XG;",
    })
    assert invalid.status_code == 422
    detail = invalid.json()["detail"]
    assert detail["code"] == "tdx_formula_validation_error"
    assert detail["issues"][0]["line"] == 1


def test_direct_tdx_source_changes_real_screen_result(monkeypatch):
    monkeypatch.setattr(quant, "base_pool", lambda *args, **kwargs: _base_pool())
    monkeypatch.setattr(quant, "_daily_bar_records", lambda code, offset: _bars(offset))

    matched = quant.run_screen(strategy="near_high", formula_source="XG:C>95;")
    rejected = quant.run_screen(strategy="near_high", formula_source="XG:C>97;")

    assert matched["matched_count"] == 1
    assert rejected["matched_count"] == 0
    assert matched["criteria"]["formula_source"] == "XG:C>95;"
    assert matched["criteria"]["formula_hash"] != rejected["criteria"]["formula_hash"]


def test_presets_compile_and_growth_history_is_practical():
    for preset in tdx_presets.strategy_presets():
        program = tdx_formula.compile_formula(preset["default_source"])
        effective = tdx_presets.effective_history(preset["strategy"], program)
        assert 250 <= effective <= 800
    growth = tdx_formula.compile_formula(tdx_presets.GROWTH_MRGC_SXHCG)
    assert growth.required_history == 800
    assert tdx_presets.effective_history("growth_mrgc_sxhcg", growth) == 280


def test_rps_history_is_aligned_to_bar_dates():
    bars = _bars(3)
    dates = [str(bar["datetime"])[:10] for bar in bars]
    rps = {
        "rps20": 96, "rps50": 99, "rps120": 98, "rps250": 97,
        "history": [
            {"trade_date": dates[1], "rps20": 70, "rps50": 80, "rps120": 81, "rps250": 82},
            {"trade_date": dates[2], "rps20": 79, "rps50": 90, "rps120": 91, "rps250": 92},
        ],
    }
    aligned = quant._tdx_rps_for_bars(rps, bars)
    assert aligned == {
        "rps20": [None, 70.0, 79.0],
        "rps50": [None, 80.0, 90.0],
        "rps120": [None, 81.0, 91.0],
        "rps250": [None, 82.0, 92.0],
    }


def test_growth_source_uses_rps_capital_and_finance_context(monkeypatch):
    monkeypatch.setattr(quant, "base_pool", lambda *args, **kwargs: _base_pool())
    monkeypatch.setattr(quant, "_daily_bar_records", lambda code, offset: _growth_bars(offset))
    monkeypatch.setattr(quant, "_batch_quotes", lambda codes: {"600000": {"turnover_pct": 1.0}})
    monkeypatch.setattr(quant, "rps_snapshot", lambda: {
        "trade_date": "2026-07-17", "universe_count": 4000, "eligible_count": 3500,
        "excluded_short_history_count": 500, "rule": "测试",
        "stocks": {"600000": {"rps50": 99, "rps120": 99, "rps250": 99}},
    })
    financial_calls = []

    def financial(code: str):
        financial_calls.append(code)
        return {
            "financial_period": "2026-06-30",
            "revenue_yoy_pct": 25,
            "net_profit_yoy_pct": 45,
        }

    monkeypatch.setattr(quant, "_financial_growth", financial)
    result = quant.run_screen(strategy="growth_mrgc_sxhcg")

    assert result["matched_count"] == 1
    assert financial_calls == ["600000"]
    assert result["criteria"]["uses_rps"] is True
    assert result["criteria"]["uses_finance"] is True
    assert result["criteria"]["uses_capital"] is True
    assert result["rows"][0]["mrgc"] is True
    assert result["rows"][0]["revenue_yoy_pct"] == 25

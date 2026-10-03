"""可编辑量化公式的解析、执行与 API 契约测试（全程离线）。"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import app as app_module
import quant
import quant_formula
import tdx_formula
import tdx_presets


@pytest.fixture(autouse=True)
def offline_trade_date(monkeypatch):
    monkeypatch.setattr(quant, "_latest_tdx_date", lambda: "2026-09-18")


def _near_high_bars(count: int = 250, latest_close: float = 96.0) -> list[dict]:
    return [
        {
            "datetime": f"2026-01-{(index % 28) + 1:02d} 15:00",
            "high": 100.0,
            "low": 79.0,
            "close": latest_close if index == count - 1 else 80.0,
        }
        for index in range(count)
    ]


def _trend_bars(count: int = 320) -> list[dict]:
    rows = []
    for index in range(count):
        close = 70 + index * 0.1
        if index == count - 40:
            close = 80
        rows.append({
            "datetime": f"2026-01-{(index % 28) + 1:02d} 15:00",
            "high": (70 + index * 0.1) * 1.005,
            "low": min(close * 0.995, (70 + index * 0.1) * 0.995),
            "close": close,
        })
    return rows


def _monthly_bars(closes: list[float], lows: list[float] | None = None) -> list[dict]:
    start = date(2025, 1, 1)
    return [
        {
            "datetime": (start + timedelta(days=index)).isoformat() + " 15:00",
            "open": close,
            "close": close,
            "high": close * 1.005,
            "low": lows[index] if lows is not None else close * 0.995,
        }
        for index, close in enumerate(closes)
    ]


def _base_pool_one() -> dict:
    return {
        "fund_period": "2026-03-31",
        "fund_periods": ["2026-03-31"],
        "north_period": "2026-06-30",
        "fund_candidate_count": 1,
        "north_candidate_count": 0,
        "overlap_count": 0,
        "base_count": 1,
        "rows": [{
            "code": "600000",
            "name": "测试股票",
            "fund_float_ratio_pct": 6.0,
            "north_hold_value_yi": None,
        }],
    }


def test_default_config_parameter_override_and_stable_hash():
    default = quant_formula.normalize_formula("near_high")
    assert default["version"] == 1
    assert default["params"]["lookback_days"] == 250
    assert default["params"]["max_distance_pct"] == 5
    assert default["technical_expression"] == "NEAR_HIGH"

    overridden = quant_formula.normalize_formula(
        "near_high",
        {"params": {"max_distance_pct": 3, "lookback_days": 300}},
    )
    assert overridden["params"]["max_distance_pct"] == 3.0
    assert overridden["params"]["lookback_days"] == 300

    same_values_different_order = quant_formula.normalize_formula(
        "near_high",
        {"params": {"lookback_days": 300, "max_distance_pct": 3}},
    )
    assert quant_formula.formula_hash("near_high", overridden) == quant_formula.formula_hash(
        "near_high", same_values_different_order,
    )


def test_boolean_formula_precedence_and_parentheses():
    values = {"A": True, "B": False, "C": False}
    assert quant_formula.evaluate_expression("A OR B AND C", ["A", "B", "C"], values) is True
    assert quant_formula.evaluate_expression("(A OR B) AND C", ["A", "B", "C"], values) is False
    assert quant_formula.evaluate_expression("NOT B AND A", ["A", "B", "C"], values) is True


@pytest.mark.parametrize(
    "expression",
    [
        "FYX1; FYX2",
        "FINANCE(44) > 20",
        "__IMPORT__('os')",
        "FYX1 AND UNKNOWN_SIGNAL",
    ],
)
def test_formula_parser_rejects_unsafe_or_unknown_syntax(expression: str):
    with pytest.raises(quant_formula.FormulaValidationError) as exc_info:
        quant_formula.normalize_formula(
            "monthly_reversal_62",
            {"technical_expression": expression},
        )
    assert exc_info.value.issues[0]["severity"] == "error"


def test_formula_parameter_and_expression_change_actual_matches(monkeypatch):
    monkeypatch.setattr(quant, "base_pool", lambda *args, **kwargs: _base_pool_one())
    monkeypatch.setattr(quant, "_daily_bar_records", lambda code, offset, **kwargs: _near_high_bars(offset))

    default_result = quant.run_screen(strategy="near_high")
    strict_result = quant.run_screen(
        strategy="near_high",
        formula={"params": {"max_distance_pct": 3}},
    )
    inverted_result = quant.run_screen(
        strategy="near_high",
        formula={"technical_expression": "NOT NEAR_HIGH"},
    )

    assert default_result["matched_count"] == 1
    assert strict_result["matched_count"] == 0
    assert inverted_result["matched_count"] == 0
    assert strict_result["criteria"]["formula_config"]["params"]["max_distance_pct"] == 3.0
    assert strict_result["criteria"]["formula_hash"] != default_result["criteria"]["formula_hash"]


def test_monthly_formula_expression_is_used_by_evaluator():
    rps = {"rps50": 99, "rps120": 99, "rps250": 99}
    default = quant.monthly_reversal_62(_trend_bars(), rps)
    impossible_config = quant_formula.normalize_formula(
        "monthly_reversal_62",
        {"technical_expression": "FYX1 AND NOT FYX1"},
    )
    changed = quant.monthly_reversal_62(_trend_bars(), rps, impossible_config)

    assert default is not None and default["signal_results"]["YXFZ"] is True
    assert default["matched"] is False  # 连续满足 FYX，当前不是 15 日窗口内首次。
    assert changed is not None and changed["matched"] is False
    assert "FYX1" in changed["signal_results"]


def test_monthly_65_defaults_keep_legacy_strategy_and_add_event_history():
    config = quant_formula.normalize_formula("monthly_reversal_62")
    assert config["params"]["platform_ratio_2"] == 1.55
    assert config["params"]["platform_ratio_3"] == 1.65
    assert config["params"]["trend_short_lookback_days"] == 10
    assert config["params"]["trend_lookback_days"] == 15
    assert config["params"]["first_event_window"] == 15
    assert quant_formula.required_history("monthly_reversal_62", config) == 308
    assert "BARSSINCEN" in quant_formula.effective_formula("monthly_reversal_62", config)
    preset = next(p for p in quant_formula.strategy_presets() if p["strategy"] == "monthly_reversal_62")
    assert preset["label"] == "月线反转 6.5"


def test_monthly_65_simplifies_fyx23_and_accepts_two_days_above_ma200():
    bars = _monthly_bars([100.0] * 318 + [110.0, 110.0], [99.0] * 320)
    bars[-35]["low"] = 70.0
    result = quant.monthly_reversal_62(bars, {"rps50": 99, "rps120": 99})
    assert result is not None
    signals = result["signal_results"]
    assert signals["FYX23"] is True  # 最近 10/20 日最低点相等仍可满足。
    assert signals["FYX51"] is True  # AA200 恰好为 2。
    assert signals["FYX52"] is False
    assert signals["FYX53"] is False


def test_monthly_65_ma250_branch_and_bullish_ma_pair():
    closes = [200.0] * 75 + [100.0] * 200 + [120.0] * 45
    lows = [198.0] * 75 + [98.0] * 200 + [110.0] * 44 + [105.0]
    result = quant.monthly_reversal_62(_monthly_bars(closes, lows), {"rps50": 99, "rps120": 99})
    assert result is not None
    signals = result["signal_results"]
    assert signals["FYX51"] is False  # AA200=45。
    assert signals["FYX52"] is False  # 45 日最低价均高于 MA200。
    assert signals["FYX53"] is True
    assert signals["FYX5"] is True
    assert signals["FYX603"] is True  # MA120>MA200，而 MA200<MA250。


def test_monthly_65_uses_either_ten_or_fifteen_day_ma_trend():
    bars = _monthly_bars([100.0] * 305 + [50.0] * 5 + [110.0] * 10)
    result = quant.monthly_reversal_62(bars, {"rps50": 99, "rps120": 99})
    assert result is not None
    signals = result["signal_results"]
    assert signals["FYX6011"] is True
    assert signals["FYX6012"] is False
    assert signals["FYX601"] is True
    assert signals["FYX6021"] is True
    assert signals["FYX6022"] is False
    assert signals["FYX602"] is True


@pytest.mark.parametrize("earlier_event_offset,expected", [(None, True), (2, False), (15, False), (16, True)])
def test_monthly_named_config_filters_first_event_using_historical_rps(earlier_event_offset, expected):
    bars = _monthly_bars([100.0] * 320)
    events = {len(bars) - 1}
    if earlier_event_offset is not None:
        events.add(len(bars) - earlier_event_offset)
    rps = {
        "rps50": 99,
        "rps120": 99,
        "history": [
            {"trade_date": bar["datetime"][:10], "rps50": 99 if index in events else 10, "rps120": 10}
            for index, bar in enumerate(bars)
        ],
    }
    config = quant_formula.normalize_formula("monthly_reversal_62", {"technical_expression": "FYX11"})
    result = quant.monthly_reversal_62(bars, rps, config)
    assert result is not None
    assert result["signal_results"]["YXFZ"] is True
    assert result["matched"] is expected
    assert result["signal_results"]["YXFZXG"] is expected


def test_monthly_named_defaults_match_source_preset_65():
    bars = _monthly_bars([200.0] * 75 + [100.0] * 200 + [120.0] * 45)
    rps = {"rps50": 99, "rps120": 99}
    named = quant.monthly_reversal_62(bars, rps)
    source = tdx_formula.compile_formula(tdx_presets.get_preset("monthly_reversal_62")["default_source"])
    direct = source.evaluate(bars, rps=rps)
    assert named is not None
    assert named["matched"] is direct["matched"]
    for signal in quant_formula.allowed_signals("monthly_reversal_62"):
        assert named["signal_results"][signal] is bool(direct["variables"][signal])


def test_formula_presets_and_validate_api():
    client = TestClient(app_module.app)

    presets_response = client.get("/api/quant/formulas")
    assert presets_response.status_code == 200
    presets = presets_response.json()["data"]
    assert {
        "near_high", "monthly_reversal_62", "growth_mrgc_sxhcg",
    }.issubset({item["strategy"] for item in presets})
    monthly = next(item for item in presets if item["strategy"] == "monthly_reversal_62")
    assert monthly["params"]
    assert monthly["default_formula"]["technical_expression"].startswith("FYX1 AND FYX2")
    assert "FYX7" in monthly["allowed_technical_signals"]

    validate_response = client.post("/api/quant/formula/validate", json={
        "strategy": "near_high",
        "formula": {"params": {"max_distance_pct": 3}},
    })
    assert validate_response.status_code == 200
    result = validate_response.json()["data"]
    assert result["normalized_formula"]["params"]["max_distance_pct"] == 3.0
    assert len(result["formula_hash"]) == 12
    assert "max_distance_pct=3.0" in result["effective_formula"]


@pytest.mark.parametrize("endpoint", ["/api/quant/formula/validate", "/api/quant/screen"])
def test_formula_validation_errors_are_structured_422(endpoint: str):
    client = TestClient(app_module.app)
    response = client.post(endpoint, json={
        "strategy": "monthly_reversal_62",
        "formula": {"technical_expression": "FYX1; __IMPORT__('os')"},
    })

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "formula_validation_error"
    assert detail["message"]
    assert detail["issues"][0]["code"] in {"unsupported_syntax", "unknown_signal"}
    assert detail["issues"][0]["line"] == 1
    assert detail["issues"][0]["severity"] == "error"


def test_screen_api_accepts_and_forwards_formula(monkeypatch):
    received = {}

    def fake_run_screen(**kwargs):
        received.update(kwargs)
        return {"base_count": 1, "matched_count": 0, "rows": []}

    monkeypatch.setattr(app_module.quant, "run_screen", fake_run_screen)
    formula = {
        "params": {"rps50_min": 92},
        "technical_expression": "FYX1 AND FYX3",
    }
    response = TestClient(app_module.app).post("/api/quant/screen", json={
        "strategy": "monthly_reversal_62",
        "formula": formula,
    })

    assert response.status_code == 200
    assert received["formula"] == formula

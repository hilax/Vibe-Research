"""可编辑量化公式的解析、执行与 API 契约测试（全程离线）。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app as app_module
import quant
import quant_formula


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
    monkeypatch.setattr(quant, "_daily_bar_records", lambda code, offset: _near_high_bars(offset))

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

    assert default is not None and default["matched"] is True
    assert changed is not None and changed["matched"] is False
    assert "FYX1" in changed["signal_results"]


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


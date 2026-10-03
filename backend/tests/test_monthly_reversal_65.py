from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import app as app_module
import quant
import tdx_formula
import tdx_presets


STRATEGY = "monthly_reversal_62"


def _bars(count: int = 360) -> list[dict]:
    start = date(2025, 1, 1)
    rows = []
    for index in range(count):
        close = 100 + index * 0.03
        rows.append({
            "datetime": f"{start + timedelta(days=index)} 15:00",
            "open": close - 0.1,
            "high": close + 0.2,
            "low": close - (3.5 if index == count - 35 else 0.5),
            "close": close,
            "vol": 100_000,
        })
    return rows


def _rps(count: int, signal_offsets: tuple[int, ...]) -> dict:
    values = [80.0] * count
    for offset in signal_offsets:
        values[-1 - offset] = 98.0
    return {"rps50": values, "rps120": list(values)}


def _program():
    return tdx_formula.compile_formula(tdx_presets.get_preset(STRATEGY)["default_source"])


def test_monthly_reversal_nested_history_covers_counts_and_first_signal_window():
    count_program = tdx_formula.compile_formula("COUNT(C>MA(C,250),45)>2;")
    assert count_program.required_history == 294

    program = _program()
    assert program.required_history == 308
    assert tdx_presets.effective_history(STRATEGY, program) >= 308


@pytest.mark.parametrize(
    ("signal_offsets", "raw_signal", "matched"),
    [
        ((), False, False),
        ((0,), True, True),
        ((0, 1), True, False),
        ((0, 14), True, False),
        ((0, 15), True, True),
        (tuple(range(15)), True, False),
    ],
    ids=["no-signal", "first-today", "yesterday", "window-edge", "outside-window", "continuous"],
)
def test_monthly_reversal_first_signal_uses_current_and_previous_14_bars(
    signal_offsets: tuple[int, ...], raw_signal: bool, matched: bool,
):
    bars = _bars()
    result = _program().evaluate(bars, rps=_rps(len(bars), signal_offsets))

    assert result["variables"]["YXFZ"] is raw_signal
    assert result["variables"]["YXFZXG"] is matched
    assert result["matched"] is matched


def test_monthly_reversal_ma250_pullback_can_match_without_ma200_pullback():
    bars = _bars()
    for index, bar in enumerate(bars):
        close = 115 if index < 160 else 100 + index * 0.03
        bar.update({
            "open": close - 0.05,
            "high": close + 0.2,
            "low": 109.2 if index == len(bars) - 35 else close - 0.1,
            "close": close,
        })
    result = _program().evaluate(bars, rps=_rps(len(bars), (0,)))
    variables = result["variables"]

    # The older high prices keep MA250 above MA200. The recent lows touch only
    # MA250, so this candidate depends on the new FYX53 alternative.
    assert variables["AA200"] == 45
    assert variables["LAA200"] == 0
    assert variables["FYX51"] is False
    assert variables["FYX52"] is False
    assert variables["FYX53"] is True
    assert variables["FYX5"] is True
    assert variables["FYX601"] is True
    assert variables["FYX602"] is False
    assert variables["FYX603"] is True
    assert result["matched"] is True


@pytest.mark.parametrize(
    ("first_five", "last_ten", "ten_day_rising", "fifteen_day_rising"),
    [(50.0, 110.0, True, False), (140.0, 90.0, False, True)],
)
def test_monthly_reversal_trend_accepts_either_10_or_15_day_comparison(
    first_five: float, last_ten: float, ten_day_rising: bool, fifteen_day_rising: bool,
):
    bars = _bars()
    closes = [100.0] * (len(bars) - 15) + [first_five] * 5 + [last_ten] * 10
    for bar, close in zip(bars, closes):
        bar.update({"open": close, "high": close + 0.2, "low": close - 0.5, "close": close})
    variables = _program().evaluate(bars, rps=_rps(len(bars), (0,)))["variables"]

    assert variables["FYX6011"] is ten_day_rising
    assert variables["FYX6021"] is ten_day_rising
    assert variables["FYX6012"] is fifteen_day_rising
    assert variables["FYX6022"] is fifteen_day_rising
    assert variables["FYX601"] is True
    assert variables["FYX602"] is True


def test_monthly_reversal_api_keeps_strategy_id_and_validates_308_bar_history():
    client = TestClient(app_module.app)
    presets = client.get("/api/quant/formulas")
    assert presets.status_code == 200
    monthly = next(item for item in presets.json()["data"] if item["strategy"] == STRATEGY)
    assert monthly["label"] == "月线反转 6.5"

    validation = client.post("/api/quant/formula/validate", json={
        "strategy": STRATEGY,
        "source": monthly["default_source"],
    })
    assert validation.status_code == 200
    result = validation.json()["data"]
    assert result["valid"] is True
    assert result["required_history"] >= 308
    assert result["minimum_history"] >= 308
    assert "BARSSINCEN" in result["used_functions"]


def test_monthly_reversal_screen_uses_308_bars_and_filters_repeated_signal(monkeypatch):
    fetched = []

    def load(code: str, offset: int, *, target_date: str):
        fetched.append((code, offset, target_date))
        return _bars(offset)

    def rps_stock(signal_offsets: tuple[int, ...]) -> dict:
        bars = _bars(308)
        rps = _rps(len(bars), signal_offsets)
        return {
            "rps50": 98.0, "rps120": 98.0,
            "history": [
                {
                    "trade_date": str(bar["datetime"])[:10],
                    "rps50": rps["rps50"][index],
                    "rps120": rps["rps120"][index],
                }
                for index, bar in enumerate(bars)
            ],
        }

    monkeypatch.setattr(quant, "base_pool", lambda *args, **kwargs: {
        "rows": [
            {"code": "600000", "name": "首次信号测试", "industry": "测试"},
            {"code": "600001", "name": "连续信号测试", "industry": "测试"},
        ],
        "fund_period": "2026-06-30", "north_period": "2026-06-30",
        "fund_candidate_count": 2, "north_candidate_count": 0,
        "overlap_count": 0, "base_count": 2,
    })
    monkeypatch.setattr(quant, "_daily_bar_records", load)
    monkeypatch.setattr(quant, "_latest_tdx_date", lambda: "2026-09-30")
    monkeypatch.setattr(quant.bars_cache, "prefetch_daily_bars", lambda *args, **kwargs: 0)
    monkeypatch.setattr(quant, "get_rps_prewarm_status", lambda: {"ready": True})
    monkeypatch.setattr(quant, "rps_snapshot", lambda: {
        "trade_date": "2026-09-30", "universe_count": 2, "eligible_count": 2,
        "excluded_short_history_count": 0, "rule": "离线测试",
        "stocks": {"600000": rps_stock((0,)), "600001": rps_stock((0, 1))},
    })

    response = TestClient(app_module.app).post("/api/quant/screen", json={"strategy": STRATEGY})
    assert response.status_code == 200
    result = response.json()["data"]
    assert sorted(fetched) == [
        ("600000", 308, "2026-09-30"), ("600001", 308, "2026-09-30"),
    ]
    assert result["criteria"]["required_history"] == 308
    assert result["criteria"]["minimum_history"] == 308
    assert result["technical_failure_count"] == 0
    assert result["matched_count"] == 1
    assert [row["code"] for row in result["rows"]] == ["600000"]
    repeated = next(row for row in result["base_rows"] if row["code"] == "600001")
    assert repeated["signal_results"]["YXFZ"] is True
    assert repeated["signal_results"]["YXFZXG"] is False

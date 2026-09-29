"""季末持仓尚未披露时继续回退到完整报告期，全程使用离线响应。"""
import pytest

import quant


class FundResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


@pytest.fixture(autouse=True)
def isolated_quant_cache(monkeypatch):
    monkeypatch.setattr(quant, "_CACHE", {})


def test_quarter_end_empty_array_falls_back_to_previous_complete_report(monkeypatch):
    periods = ["2026-09-30", "2026-06-30", "2026-03-31", "2025-12-31"]
    requests = []

    def em_get(url, *, params, **kwargs):
        assert url == quant._FUND_URL
        period = params["date"]
        requests.append(period)
        return FundResponse([] if period == "2026-09-30" else {"pages": 5311, "data": [{}]})

    monkeypatch.setattr(quant, "_quarter_ends", lambda: periods)
    monkeypatch.setattr(quant.astock, "em_get", em_get)

    assert quant.latest_complete_fund_period() == "2026-06-30"
    assert requests == ["2026-09-30", "2026-06-30"]
    assert quant.latest_complete_fund_period() == "2026-06-30"
    assert requests == ["2026-09-30", "2026-06-30"]


def test_explicit_empty_report_has_no_fund_rows(monkeypatch):
    monkeypatch.setattr(quant.astock, "em_get", lambda *args, **kwargs: FundResponse([]))
    assert quant._fund_period_size("2026-09-30") == 0
    assert quant._fund_rows("2026-09-30", 5) == []


def test_no_report_is_not_cached_as_a_success(monkeypatch):
    monkeypatch.setattr(quant, "_quarter_ends", lambda: ["2026-09-30", "2026-06-30"])
    monkeypatch.setattr(quant.astock, "em_get", lambda *args, **kwargs: FundResponse([]))
    with pytest.raises(quant.QuantDataError, match="未找到可用的基金持仓报告期"):
        quant.latest_complete_fund_period()
    assert quant._CACHE == {}


@pytest.mark.parametrize("payload", [[{"unexpected": "row"}], "invalid", None])
def test_unrecognized_nonempty_payload_still_fails(monkeypatch, payload):
    monkeypatch.setattr(quant.astock, "em_get", lambda *args, **kwargs: FundResponse(payload))
    with pytest.raises(quant.QuantDataError, match="无法识别的格式"):
        quant._fund_period_size("2026-06-30")

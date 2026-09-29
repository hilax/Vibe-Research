"""日 K 下载分页与增量缓存回归测试，数据源完全离线。"""

from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor
import threading

import pytest

import bars_cache
import quant


@pytest.fixture(autouse=True)
def isolated_daily_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("VR_BARS_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(bars_cache, "_MEM_CACHE", {})
    monkeypatch.setattr(bars_cache, "_SHARED_CONN", None)
    monkeypatch.setattr(bars_cache, "_SHARED_DB_PATH", None)
    yield
    if bars_cache._SHARED_CONN is not None:
        bars_cache._SHARED_CONN.close()


def _bars(count, end="2026-09-01"):
    last = date.fromisoformat(end)
    return [
        {
            "datetime": f"{last - timedelta(days=count - index - 1)} 15:00",
            "open": 10 + index / 100,
            "close": 10.1 + index / 100,
            "high": 10.2 + index / 100,
            "low": 9.9 + index / 100,
            "vol": 1000 + index,
            "amount": 10000 + index,
        }
        for index in range(count)
    ]


class _Frame:
    def __init__(self, rows):
        self.rows = rows
        self.empty = not rows

    def to_dict(self, orient):
        assert orient == "records"
        return [dict(row) for row in self.rows]


class _Client:
    def __init__(self, records):
        self.records = records
        self.calls = []

    def bars(self, *, symbol, frequency, start, offset):
        assert symbol == "600519"
        assert frequency == 4
        assert 0 < offset <= 800
        self.calls.append((start, offset))
        end = max(0, len(self.records) - start)
        begin = max(0, end - offset)
        # 故意逆序返回，验证跨页结果仍按最旧到最新排序。
        return _Frame(list(reversed(self.records[begin:end])))


def _install_client(monkeypatch, records):
    client = _Client(records)
    monkeypatch.setattr(quant, "_thread_client", lambda: client)

    def reject_date_probe():
        raise AssertionError("任务已传目标日，不应逐股再次查询基准日 K")

    monkeypatch.setattr(quant, "_latest_tdx_date", reject_date_probe)
    return client


def test_810_bars_are_paged_and_repeated_screen_does_not_download(monkeypatch):
    records = _bars(850)
    client = _install_client(monkeypatch, records)
    result = quant._daily_bar_records("600519", 810, target_date="2026-09-01")

    assert client.calls == [(0, 800), (800, 10)]
    assert len(result) == 810
    assert [bar["datetime"] for bar in result] == [bar["datetime"] for bar in records[-810:]]
    assert result[-1]["volume"] == result[-1]["vol"] == records[-1]["vol"]

    # 清掉一级缓存后，持久化缓存仍应避免第二次网络下载。
    bars_cache._MEM_CACHE.clear()
    repeated = quant._daily_bar_records("600519", 810, target_date="2026-09-01")
    assert repeated == result
    assert client.calls == [(0, 800), (800, 10)]


def test_new_day_only_downloads_recent_bars_and_overwrites_same_date(monkeypatch):
    stale = _bars(850)
    bars_cache.put_daily_bars("600519", stale, target_date="2026-09-01")
    updated = [dict(bar) for bar in stale]
    updated[-1].update({"close": 77, "high": 78, "vol": 9876})
    updated.append(_bars(1, "2026-09-02")[0])
    client = _install_client(monkeypatch, updated)

    result = quant._daily_bar_records("600519", 800, target_date="2026-09-02")

    assert client.calls == [(0, 64)]
    assert len(result) == 851
    assert result[0] == {**stale[0], "volume": stale[0]["vol"]}
    assert result[-2]["close"] == 77
    assert result[-2]["volume"] == result[-2]["vol"] == 9876
    assert len({bar["datetime"][:10] for bar in result}) == 851


def test_nonoverlapping_recent_page_falls_back_without_keeping_a_history_gap(monkeypatch):
    stale = _bars(800, "2020-09-01")
    bars_cache.put_daily_bars("600519", stale, target_date="2020-09-01")
    current = _bars(850, "2026-09-02")
    client = _install_client(monkeypatch, current)

    result = quant._daily_bar_records("600519", 800, target_date="2026-09-02")

    assert client.calls == [(0, 64), (0, 800)]
    assert len(result) == 800
    assert result[0]["datetime"] == current[-800]["datetime"]
    assert result[-1]["datetime"] == current[-1]["datetime"]


def test_incremental_update_also_fills_missing_810_bar_history(monkeypatch):
    stale = _bars(800)
    bars_cache.put_daily_bars("600519", stale, target_date="2026-09-01")
    current = _bars(850, "2026-09-02")
    client = _install_client(monkeypatch, current)

    result = quant._daily_bar_records("600519", 810, target_date="2026-09-02")

    assert client.calls == [(0, 64), (801, 9)]
    assert len(result) == 810
    assert [bar["datetime"] for bar in result] == [bar["datetime"] for bar in current[-810:]]


def test_complete_short_listing_history_is_reusable(monkeypatch):
    client = _install_client(monkeypatch, _bars(280))

    first = quant._daily_bar_records("600519", 810, target_date="2026-09-01")
    bars_cache._MEM_CACHE.clear()
    second = quant._daily_bar_records("600519", 810, target_date="2026-09-01")

    assert len(first) == 280
    assert second == first
    assert client.calls == [(0, 800)]


def test_complete_short_listing_only_refreshes_64_recent_bars_on_next_day(monkeypatch):
    stale = _bars(280)
    bars_cache.put_daily_bars("600519", stale, target_date="2026-09-01", history_complete=True)
    current = [dict(bar) for bar in stale] + _bars(1, "2026-09-02")
    client = _install_client(monkeypatch, current)

    first = quant._daily_bar_records("600519", 810, target_date="2026-09-02")
    second = quant._daily_bar_records("600519", 810, target_date="2026-09-02")

    assert len(first) == 281
    assert second == first
    assert client.calls == [(0, 64)]
    assert bars_cache.is_daily_history_complete("600519") is True


def test_empty_response_is_not_saved_as_complete_history(monkeypatch):
    client = _install_client(monkeypatch, [])

    assert quant._daily_bar_records("600519", 810, target_date="2026-09-01") == []
    assert bars_cache.get_stale_daily_bars("600519") is None
    assert quant._daily_bar_records("600519", 810, target_date="2026-09-01") == []
    assert client.calls == [(0, 800), (0, 800)]


def test_explicit_unknown_target_date_does_not_probe_each_stock(monkeypatch):
    client = _install_client(monkeypatch, _bars(850))

    result = quant._daily_bar_records("600519", 800, target_date=None)

    assert len(result) == 800
    assert client.calls == [(0, 800)]


def test_concurrent_screen_and_prewarm_share_the_same_download(monkeypatch):
    client = _install_client(monkeypatch, _bars(850))
    barrier = threading.Barrier(2)

    def load():
        barrier.wait(timeout=5)
        return quant._daily_bar_records("600519", 810, target_date="2026-09-01")

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(load)
        second = executor.submit(load)
        assert first.result(timeout=5) == second.result(timeout=5)

    assert client.calls == [(0, 800), (800, 10)]


def test_rps_uses_paged_daily_history_and_keeps_251_bar_sample_rule(monkeypatch):
    client = _install_client(monkeypatch, _bars(850))
    monkeypatch.setattr(quant, "_xdxr_actions", lambda code: [])

    history = quant._rps_history({"code": "600519", "name": "样本"}, "2026-09-01")

    assert history is not None
    assert len(history["bars"]) == 810
    assert len(history["points"]) == 560
    assert client.calls == [(0, 800), (800, 10)]

    short = _bars(250)
    monkeypatch.setattr(quant, "_daily_bar_records", lambda *args, **kwargs: short)
    assert quant._rps_history({"code": "600519", "name": "样本"}, "2026-09-01") is None

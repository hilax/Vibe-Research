"""板块强度数据源 CRUD 与通达信板块 RPS 的离线回归测试。"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

import user_sectors


@pytest.fixture()
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(user_sectors, "DATA_PATH", tmp_path / "tdx_sectors.json")
    monkeypatch.setattr(user_sectors, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(user_sectors, "_legacy_sectors", lambda: [])
    monkeypatch.setattr(
        user_sectors,
        "_default_sectors",
        lambda: [
            {"code": "880301", "name": "煤炭", "created_at": 0.0, "updated_at": 0.0},
            {"code": "880544", "name": "光伏", "created_at": 0.0, "updated_at": 0.0},
            {"code": "880952", "name": "芯片", "created_at": 0.0, "updated_at": 0.0},
        ],
    )
    user_sectors._MEMORY_CACHE.clear()
    yield tmp_path
    user_sectors._MEMORY_CACHE.clear()


def _bars(step: float, count: int = 32, *, last_date: date = date(2026, 7, 22)):
    start = last_date - timedelta(days=count - 1)
    return [
        {"trade_date": (start + timedelta(days=index)).isoformat(), "close": 100 + step * index}
        for index in range(count)
    ]


def test_defaults_crud_and_code_can_be_modified(isolated_store):
    assert [row["code"] for row in user_sectors.list_sectors()] == ["880301", "880544", "880952"]

    created = user_sectors.add_sector("881314", "机器人")
    assert created["code"] == "881314"

    updated = user_sectors.update_sector("881314", new_code="881322", name="集成电路设计")
    assert updated["code"] == "881322"
    assert updated["name"] == "集成电路设计"
    assert user_sectors.get_sector("881314") is None
    assert user_sectors.get_sector("881322")["name"] == "集成电路设计"

    assert user_sectors.delete_sector("881322") is True
    assert user_sectors.delete_sector("881322") is False
    assert [row["code"] for row in user_sectors.list_sectors()] == ["880301", "880544", "880952"]


def test_crud_rejects_invalid_and_duplicate_codes(isolated_store):
    with pytest.raises(ValueError, match="6 位数字"):
        user_sectors.add_sector("88054", "光伏")
    with pytest.raises(ValueError, match="已存在"):
        user_sectors.add_sector("880544", "重复光伏")
    with pytest.raises(ValueError, match="不能为空"):
        user_sectors.update_sector("880544", name=" ")
    with pytest.raises(ValueError, match="已存在"):
        user_sectors.update_sector("880544", new_code="880301")


def test_sector_rps_uses_each_tdx_board_daily_series(isolated_store, monkeypatch):
    series = {
        "880301": _bars(1.0),
        "880544": _bars(2.0),
        "880952": _bars(-0.5),
    }
    monkeypatch.setattr(user_sectors, "_fetch_tdx_daily_bars", lambda code, offset=32: series[code])

    snapshot = user_sectors.compute_all_sector_rps(force_refresh=True)

    assert snapshot["source"] == "通达信板块/指数日 K"
    assert snapshot["trade_date"] == "2026-07-22"
    assert snapshot["available_count"] == 3
    assert snapshot["ranked_count_by_period"] == {"5": 3, "10": 3, "15": 3, "20": 3}
    rows = {row["code"]: row for row in snapshot["rows"]}
    assert rows["880544"]["rps20"] == 100
    assert rows["880301"]["rps20"] == 50
    assert rows["880952"]["rps20"] == 0
    assert rows["880544"]["return20_pct"] > rows["880301"]["return20_pct"]


def test_short_history_and_stale_board_are_excluded_per_period(isolated_store, monkeypatch):
    series = {
        "880301": _bars(1.0),
        "880544": _bars(2.0, count=8),
        "880952": _bars(3.0, last_date=date(2026, 7, 21)),
    }
    monkeypatch.setattr(user_sectors, "_fetch_tdx_daily_bars", lambda code, offset=32: series[code])

    snapshot = user_sectors.compute_all_sector_rps(force_refresh=True)
    rows = {row["code"]: row for row in snapshot["rows"]}

    assert snapshot["trade_date"] == "2026-07-22"
    assert snapshot["ranked_count_by_period"]["5"] == 2
    assert snapshot["ranked_count_by_period"]["10"] == 1
    assert rows["880544"]["rps5"] == 100
    assert rows["880544"]["rps10"] is None
    assert rows["880952"]["status"] == "stale"
    assert rows["880952"]["rps5"] is None


def test_all_tdx_failures_raise_clear_upstream_error(isolated_store, monkeypatch):
    monkeypatch.setattr(user_sectors, "_fetch_tdx_daily_bars", lambda code, offset=32: [])
    with pytest.raises(user_sectors.SectorDataError, match="没有返回任何板块日线"):
        user_sectors.compute_all_sector_rps(force_refresh=True)


def test_tdx_code_types_use_index_fund_and_beijing_routes(monkeypatch):
    calls = []

    class Frame:
        empty = False

        def to_dict(self, orient):
            assert orient == "records"
            return [{"datetime": "2026-07-22 15:00", "close": 1.5}]

    class RawClient:
        def get_index_bars(self, frequency, market, code, start, offset):
            calls.append(("beijing-index", code, market))
            return [{"datetime": "2026-07-22 15:00", "close": 1000}]

    class Client:
        client = RawClient()

        def index_bars(self, **kwargs):
            calls.append(("index", kwargs["symbol"], None))
            return Frame()

        def bars(self, **kwargs):
            calls.append(("fund", kwargs["symbol"], None))
            return Frame()

    monkeypatch.setattr(user_sectors, "_thread_client", lambda: Client())

    assert user_sectors._fetch_once("880544", 22)[-1]["close"] == 1.5
    assert user_sectors._fetch_once("513090", 22)[-1]["close"] == 1.5
    assert user_sectors._fetch_once("899050", 22)[-1]["close"] == 1000
    assert calls == [
        ("index", "880544", None),
        ("fund", "513090", None),
        ("beijing-index", "899050", 2),
    ]

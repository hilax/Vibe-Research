"""日 K 本地缓存与选股加速测试。"""
import time
import pickle
import sqlite3
import pytest

import bars_cache
import quant


@pytest.fixture(autouse=True)
def clean_cache(tmp_path, monkeypatch):
    """每个测试使用独立的临时缓存目录。"""
    monkeypatch.setenv("VR_BARS_CACHE_DIR", str(tmp_path))
    bars_cache.clear_bars_cache()
    yield
    bars_cache.clear_bars_cache()


def _make_bars(count: int = 300, end_date: str = "2026-09-18"):
    rows = []
    for i in range(count):
        day = (i % 28) + 1
        rows.append({
            "datetime": f"2026-08-{day:02d} 15:00" if i < count - 1 else f"{end_date} 15:00",
            "open": 10.0 + i * 0.1,
            "close": 10.5 + i * 0.1,
            "high": 11.0 + i * 0.1,
            "low": 9.5 + i * 0.1,
            "vol": 10000.0,
            "volume": 10000.0,
            "amount": 100000.0,
        })
    return rows


def test_put_and_get_daily_bars():
    bars = _make_bars(260, "2026-09-18")
    bars_cache.put_daily_bars("600519", bars, target_date="2026-09-18")

    # 正常命中
    hit = bars_cache.get_daily_bars("600519", min_bars=250, target_date="2026-09-18")
    assert hit is not None
    assert len(hit) == 260
    assert hit[-1]["close"] == bars[-1]["close"]

    # 历史长度不足时不应命中
    insufficient = bars_cache.get_daily_bars("600519", min_bars=300, target_date="2026-09-18")
    assert insufficient is None

    # 尚未核对下一个交易日的数据，刚写入的旧历史也不能冒充新行情。
    stale = bars_cache.get_daily_bars("600519", min_bars=250, target_date="2026-09-19")
    assert stale is None


def test_suspended_stock_only_reuses_explicitly_checked_trade_date():
    bars = _make_bars(260, "2026-09-17")
    bars_cache.put_daily_bars("600519", bars, target_date="2026-09-18")
    assert bars_cache.get_daily_bars("600519", 250, "2026-09-18") == bars
    assert bars_cache.get_daily_bars("600519", 250, "2026-09-19") is None
    assert bars_cache.get_stale_daily_bars("600519") == bars


def test_complete_short_history_is_reusable_but_not_stale():
    bars = _make_bars(260, "2026-09-18")
    bars_cache.put_daily_bars("600519", bars, target_date="2026-09-18", history_complete=True)
    with bars_cache._MEM_LOCK:
        bars_cache._MEM_CACHE.clear()
    assert bars_cache.prefetch_daily_bars(["600519"], 800, "2026-09-18") == 1
    assert bars_cache.get_daily_bars("600519", 800, "2026-09-18") == bars
    assert bars_cache.get_daily_bars("600519", 800, "2026-09-19") is None


def test_intraday_expiry_and_after_close_refresh(monkeypatch):
    from datetime import datetime

    now = datetime(2026, 9, 18, 14, 0).timestamp()
    original_strftime = time.strftime

    def frozen_strftime(fmt, value=None):
        return original_strftime(fmt, time.localtime(now) if value is None else value)

    monkeypatch.setattr(time, "time", lambda: now)
    monkeypatch.setattr(time, "strftime", frozen_strftime)
    valid = bars_cache._is_valid_cache
    # 停牌股票末根仍是昨天，也必须按今天的盘中刷新规则处理。
    assert valid("2026-09-17", 800, now - 299, 800, "2026-09-18", "2026-09-18")
    assert not valid("2026-09-17", 800, now - 301, 800, "2026-09-18", "2026-09-18")
    before_close = now
    now = datetime(2026, 9, 18, 15, 6).timestamp()
    assert not valid("2026-09-18", 800, before_close, 800, "2026-09-18", "2026-09-18")
    assert valid("2026-09-18", 800, now, 800, "2026-09-18", "2026-09-18")


def test_existing_sqlite_cache_migrates_without_losing_history(tmp_path, monkeypatch):
    cache_dir = tmp_path / "legacy"
    cache_dir.mkdir()
    monkeypatch.setenv("VR_BARS_CACHE_DIR", str(cache_dir))
    bars = _make_bars(800, "2026-09-18")
    with sqlite3.connect(str(cache_dir / "daily_bars.db")) as conn:
        conn.execute(
            "CREATE TABLE daily_bars (code TEXT PRIMARY KEY, latest_date TEXT NOT NULL, "
            "bar_count INTEGER NOT NULL, updated_at REAL NOT NULL, data BLOB NOT NULL)"
        )
        conn.execute("INSERT INTO daily_bars VALUES (?, ?, ?, ?, ?)",
                     ("600519", "2026-09-18", 800, time.time(), pickle.dumps(bars)))
    assert bars_cache.get_daily_bars("600519", 800, "2026-09-18") == bars
    assert bars_cache.get_daily_bars("600519", 800, "2026-09-19") is None
    assert bars_cache.get_stale_daily_bars("600519") == bars


def test_batch_prefetch_and_put():
    stocks = [f"{i:06d}" for i in range(50)]
    bars = _make_bars(280, "2026-09-18")
    items = [(code, bars) for code in stocks]

    bars_cache.put_daily_bars_batch(items, target_date="2026-09-18")

    # 预加载
    hits = bars_cache.prefetch_daily_bars(stocks, min_bars=250, target_date="2026-09-18")
    assert hits == 50

    # 内存直读
    for code in stocks:
        res = bars_cache.get_daily_bars(code, min_bars=250, target_date="2026-09-18")
        assert res is not None
        assert len(res) == 280

    stats = bars_cache.get_cache_stats()
    assert stats["db_count"] == 50
    assert stats["mem_count"] == 50
    assert stats["latest_date"] == "2026-09-18"


def test_quant_daily_bar_records_hits_cache(monkeypatch):
    bars = _make_bars(300, "2026-09-18")
    bars_cache.put_daily_bars("000001", bars, target_date="2026-09-18")

    # 确保不触发网络请求
    def _fail_client():
        raise RuntimeError("Should not touch network!")

    monkeypatch.setattr(quant, "_thread_client", _fail_client)

    monkeypatch.setattr(quant, "_latest_tdx_date", lambda: "2026-09-18")
    result = quant._daily_bar_records("000001", offset=250)
    assert len(result) == 300
    assert result[-1]["datetime"].startswith("2026-09-18")

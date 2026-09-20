"""日 K 本地缓存与选股加速测试。"""
import time
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

    # 日期落后且超过 8 小时时不应命中
    stale = bars_cache.get_daily_bars("600519", min_bars=250, target_date="2026-09-19")
    # 因为刚刚写入（updated_at < 8h），视为目标日停牌/最新可用，允许命中
    assert stale is not None


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

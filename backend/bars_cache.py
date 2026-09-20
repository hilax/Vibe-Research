"""日 K 本地持久化缓存（SQLite + 内存两级缓存）。

为量化选股与全市场 RPS 预热提供毫秒级日 K 检索与持久化。
对于已收盘的交易日，历史日 K 数据完全不可变，直接命中本地缓存，避免重复跨公网请求通达信。
"""
from __future__ import annotations

import os
import pickle
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

# ── 缓存目录与数据库配置 ───────────────────────────────────────────────────

_DB_LOCK = threading.Lock()
_MEM_LOCK = threading.Lock()

# 内存一级缓存: code -> (latest_date, count, updated_at, bars)
_MEM_CACHE: dict[str, tuple[str, int, float, list[dict]]] = {}
_SHARED_CONN: sqlite3.Connection | None = None


def get_bars_cache_dir() -> Path:
    """获取日 K 缓存存储目录。"""
    override = os.environ.get("VR_BARS_CACHE_DIR")
    if override:
        path = Path(override)
    else:
        path = Path(__file__).resolve().parent / ".cache"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_db_path() -> Path:
    return get_bars_cache_dir() / "daily_bars.db"


def _get_connection() -> sqlite3.Connection:
    global _SHARED_CONN
    with _DB_LOCK:
        if _SHARED_CONN is not None:
            return _SHARED_CONN
        db_path = get_db_path()
        conn = sqlite3.connect(
            str(db_path),
            check_same_thread=False,
            timeout=15.0,
        )
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS daily_bars (
                code TEXT PRIMARY KEY,
                latest_date TEXT NOT NULL,
                bar_count INTEGER NOT NULL,
                updated_at REAL NOT NULL,
                data BLOB NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bars_latest_date ON daily_bars(latest_date)")
        conn.commit()
        _SHARED_CONN = conn
        return _SHARED_CONN


# ── 校验规则 ─────────────────────────────────────────────────────────────

def _extract_bar_date(bar: dict) -> str:
    val = bar.get("datetime") or bar.get("date") or ""
    return str(val)[:10]


def _is_valid_cache(
    latest_date: str,
    count: int,
    updated_at: float,
    min_bars: int,
    target_date: str | None,
) -> bool:
    """判定缓存记录是否满足请求条件。"""
    if count < min_bars:
        return False

    if target_date:
        if latest_date >= target_date:
            return True
        # 若最新日期早于 target_date，但本次更新发生在近 8 小时内，
        # 说明该股在 target_date 为停牌/未交易状态，通达信返回的就是此最新数据，无需反复重下。
        if time.time() - updated_at < 8 * 3600:
            return True
        return False

    # 未指定 target_date 时，24 小时内的数据均有效
    return (time.time() - updated_at) < 24 * 3600


# ── 读写接口 ─────────────────────────────────────────────────────────────

def prefetch_daily_bars(
    codes: list[str],
    min_bars: int = 250,
    target_date: str | None = None,
) -> int:
    """批量预加载股票日 K 到内存一级缓存。

    在选股前调用，可一次性将数百只个股读入内存，后续多线程工作时全部以微秒级命中内存，
    彻底消除 SQLite 与网络并发锁开销。
    返回成功命中并加载的股票数量。
    """
    if not codes:
        return 0

    missing_codes: list[str] = []
    hits = 0

    with _MEM_LOCK:
        for code in codes:
            entry = _MEM_CACHE.get(code)
            if entry is not None:
                latest_date, count, updated_at, _ = entry
                if _is_valid_cache(latest_date, count, updated_at, min_bars, target_date):
                    hits += 1
                    continue
            missing_codes.append(code)

    if not missing_codes:
        return hits

    # 从 SQLite 批量加载缺失的股票（按 500 个一批分片避免 SQL 变量超限）
    conn = _get_connection()
    chunk_size = 500
    loaded_items: list[tuple[str, str, int, float, list[dict]]] = []

    with _DB_LOCK:
        for i in range(0, len(missing_codes), chunk_size):
            chunk = missing_codes[i : i + chunk_size]
            placeholders = ",".join(["?"] * len(chunk))
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT code, latest_date, bar_count, updated_at, data "
                f"FROM daily_bars WHERE code IN ({placeholders})",
                chunk,
            )
            rows = cursor.fetchall()
            for code, latest_date, count, updated_at, data in rows:
                if _is_valid_cache(latest_date, count, updated_at, min_bars, target_date):
                    try:
                        bars = pickle.loads(data)
                        loaded_items.append((code, latest_date, count, updated_at, bars))
                    except Exception:  # noqa: BLE001
                        pass

    if loaded_items:
        with _MEM_LOCK:
            for code, latest_date, count, updated_at, bars in loaded_items:
                _MEM_CACHE[code] = (latest_date, count, updated_at, bars)
                hits += 1

    return hits


def get_daily_bars(
    code: str,
    min_bars: int = 250,
    target_date: str | None = None,
) -> list[dict] | None:
    """获取单只股票的日 K 数据（优先查内存，未命中查 SQLite）。"""
    with _MEM_LOCK:
        entry = _MEM_CACHE.get(code)
        if entry is not None:
            latest_date, count, updated_at, bars = entry
            if _is_valid_cache(latest_date, count, updated_at, min_bars, target_date):
                return bars

    # 查 SQLite
    conn = _get_connection()
    with _DB_LOCK:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT latest_date, bar_count, updated_at, data FROM daily_bars WHERE code = ?",
            (code,),
        )
        row = cursor.fetchone()

    if row is not None:
        latest_date, count, updated_at, data = row
        if _is_valid_cache(latest_date, count, updated_at, min_bars, target_date):
            try:
                bars = pickle.loads(data)
                with _MEM_LOCK:
                    _MEM_CACHE[code] = (latest_date, count, updated_at, bars)
                return bars
            except Exception:  # noqa: BLE001
                pass

    return None


def put_daily_bars(
    code: str,
    bars: list[dict],
    target_date: str | None = None,
) -> None:
    """保存单只股票的日 K 到内存与 SQLite。"""
    if not bars:
        return

    latest_date = _extract_bar_date(bars[-1]) or (target_date or "")
    count = len(bars)
    now = time.time()
    data = pickle.dumps(bars, protocol=5)

    with _MEM_LOCK:
        _MEM_CACHE[code] = (latest_date, count, now, bars)

    conn = _get_connection()
    with _DB_LOCK:
        conn.execute(
            "INSERT OR REPLACE INTO daily_bars (code, latest_date, bar_count, updated_at, data) "
            "VALUES (?, ?, ?, ?, ?)",
            (code, latest_date, count, now, data),
        )
        conn.commit()


def put_daily_bars_batch(
    items: list[tuple[str, list[dict]]],
    target_date: str | None = None,
) -> None:
    """批量保存多只股票的日 K 到内存与 SQLite（用于 RPS 预热等全量写入）。"""
    if not items:
        return

    now = time.time()
    db_rows: list[tuple[str, str, int, float, bytes]] = []

    with _MEM_LOCK:
        for code, bars in items:
            if not bars:
                continue
            latest_date = _extract_bar_date(bars[-1]) or (target_date or "")
            count = len(bars)
            _MEM_CACHE[code] = (latest_date, count, now, bars)
            data = pickle.dumps(bars, protocol=5)
            db_rows.append((code, latest_date, count, now, data))

    if db_rows:
        conn = _get_connection()
        with _DB_LOCK:
            conn.executemany(
                "INSERT OR REPLACE INTO daily_bars (code, latest_date, bar_count, updated_at, data) "
                "VALUES (?, ?, ?, ?, ?)",
                db_rows,
            )
            conn.commit()


def clear_bars_cache() -> None:
    """清空日 K 缓存（用于测试与重置）。"""
    global _SHARED_CONN
    with _MEM_LOCK:
        _MEM_CACHE.clear()
    with _DB_LOCK:
        if _SHARED_CONN is not None:
            try:
                _SHARED_CONN.execute("DELETE FROM daily_bars")
                _SHARED_CONN.commit()
            except Exception:  # noqa: BLE001
                pass


def get_cache_stats() -> dict[str, Any]:
    """返回日 K 缓存状态统计。"""
    conn = _get_connection()
    with _DB_LOCK:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*), MAX(latest_date) FROM daily_bars")
        row = cursor.fetchone()
        db_count = row[0] if row else 0
        latest_date = row[1] if row else None

    db_path = get_db_path()
    size_bytes = db_path.stat().st_size if db_path.exists() else 0

    with _MEM_LOCK:
        mem_count = len(_MEM_CACHE)

    return {
        "db_path": str(db_path),
        "db_count": db_count,
        "mem_count": mem_count,
        "latest_date": latest_date,
        "size_mb": round(size_bytes / 1024 / 1024, 2),
    }

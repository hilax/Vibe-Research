"""板块强度数据源与通达信板块 RPS 计算。

用户维护的是通达信板块/指数/ETF 的 ``代码 + 名称``，而不是成分股。
每个代码直接读取通达信日 K，按 N=5/10/15/20 日涨幅在同一板块池内做
0—100 横截面顺序排名。用户修改后的数据源保存在仓库外的
``~/.vibe-research/tdx_sectors.json``（可用 ``VR_DATA_DIR`` 覆盖）。
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import astock

_HERE = Path(__file__).resolve().parent
DEFAULTS_PATH = _HERE / "data" / "tdx_sector_defaults.tsv"
DATA_DIR = Path(os.environ.get("VR_DATA_DIR") or Path.home() / ".vibe-research")
DATA_PATH = DATA_DIR / "tdx_sectors.json"
CACHE_DIR = DATA_DIR / "cache"
_LEGACY_PATH = _HERE / "data" / "user_sectors.json"

_STORE_LOCK = threading.Lock()
_RPS_LOCK = threading.Lock()
_THREAD_LOCAL = threading.local()
_CODE_RE = re.compile(r"^\d{6}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")
_PERIODS = (5, 10, 15, 20)
_RPS_VERSION = 2
_MEMORY_CACHE: dict[str, Any] = {}


class SectorDataError(RuntimeError):
    """通达信板块行情整体不可用。"""


def _now() -> float:
    return time.time()


def _validate_code(code: str) -> str:
    normalized = str(code or "").strip()
    if not _CODE_RE.fullmatch(normalized):
        raise ValueError("板块代码必须是 6 位数字")
    return normalized


def _validate_name(name: str) -> str:
    normalized = str(name or "").strip()
    if not normalized:
        raise ValueError("板块名称不能为空")
    if len(normalized) > 40:
        raise ValueError("板块名称不能超过 40 个字符")
    return normalized


def _default_sectors() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    try:
        text = DEFAULTS_PATH.read_text(encoding="utf-8")
    except OSError:
        return rows
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = re.split(r"\s+", line, maxsplit=1)
        if len(parts) != 2:
            continue
        code, name = parts[0].strip(), parts[1].strip()
        if not _CODE_RE.fullmatch(code) or not name or code in seen:
            continue
        seen.add(code)
        rows.append({
            "code": code,
            "name": name,
            "created_at": 0.0,
            "updated_at": 0.0,
        })
    return rows


def _legacy_sectors() -> list[dict[str, Any]]:
    """兼容旧版仓库内 user_sectors.json，只迁移代码和名称。"""
    try:
        payload = json.loads(_LEGACY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    rows = payload.get("sectors", []) if isinstance(payload, dict) else []
    out: list[dict[str, Any]] = []
    for item in rows if isinstance(rows, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            out.append({
                "code": _validate_code(item.get("code", "")),
                "name": _validate_name(item.get("name", "")),
                "created_at": float(item.get("created_at") or 0),
                "updated_at": float(item.get("updated_at") or 0),
            })
        except (TypeError, ValueError):
            continue
    return out


def _initial_store() -> dict[str, Any]:
    merged = {row["code"]: row for row in _default_sectors()}
    for row in _legacy_sectors():
        merged[row["code"]] = row
    return {
        "version": 2,
        "updated_at": 0.0,
        "sectors": list(merged.values()),
    }


def _normalize_store(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("sectors"), list):
        return _initial_store()
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in payload["sectors"]:
        if not isinstance(item, dict):
            continue
        try:
            code = _validate_code(item.get("code", ""))
            name = _validate_name(item.get("name", ""))
        except ValueError:
            continue
        if code in seen:
            continue
        seen.add(code)
        rows.append({
            "code": code,
            "name": name,
            "created_at": float(item.get("created_at") or 0),
            "updated_at": float(item.get("updated_at") or 0),
        })
    return {
        "version": 2,
        "updated_at": float(payload.get("updated_at") or 0),
        "sectors": rows,
    }


def _load_unlocked() -> dict[str, Any]:
    try:
        return _normalize_store(json.loads(DATA_PATH.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        return _initial_store()


def _atomic_write(payload: dict[str, Any]) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, DATA_PATH)


def _clear_memory_cache() -> None:
    with _RPS_LOCK:
        _MEMORY_CACHE.clear()


def list_sectors() -> list[dict[str, Any]]:
    with _STORE_LOCK:
        payload = _load_unlocked()
    return [dict(row) for row in payload["sectors"]]


def get_sector(code: str) -> dict[str, Any] | None:
    normalized = _validate_code(code)
    return next((row for row in list_sectors() if row["code"] == normalized), None)


def add_sector(code: str, name: str) -> dict[str, Any]:
    normalized_code = _validate_code(code)
    normalized_name = _validate_name(name)
    with _STORE_LOCK:
        payload = _load_unlocked()
        if any(row["code"] == normalized_code for row in payload["sectors"]):
            raise ValueError(f"板块 {normalized_code} 已存在，请使用编辑功能修改")
        now = _now()
        entry = {
            "code": normalized_code,
            "name": normalized_name,
            "created_at": now,
            "updated_at": now,
        }
        payload["sectors"].append(entry)
        payload["updated_at"] = now
        _atomic_write(payload)
    _clear_memory_cache()
    return dict(entry)


def update_sector(code: str, *, new_code: str | None = None, name: str | None = None) -> dict[str, Any]:
    old_code = _validate_code(code)
    target_code = _validate_code(new_code) if new_code is not None else old_code
    target_name = _validate_name(name) if name is not None else None
    with _STORE_LOCK:
        payload = _load_unlocked()
        row = next((item for item in payload["sectors"] if item["code"] == old_code), None)
        if row is None:
            raise KeyError(f"板块 {old_code} 不存在")
        if target_code != old_code and any(item["code"] == target_code for item in payload["sectors"]):
            raise ValueError(f"板块 {target_code} 已存在")
        row["code"] = target_code
        if target_name is not None:
            row["name"] = target_name
        row["updated_at"] = _now()
        payload["updated_at"] = row["updated_at"]
        _atomic_write(payload)
        result = dict(row)
    _clear_memory_cache()
    return result


def delete_sector(code: str) -> bool:
    normalized = _validate_code(code)
    with _STORE_LOCK:
        payload = _load_unlocked()
        before = len(payload["sectors"])
        payload["sectors"] = [row for row in payload["sectors"] if row["code"] != normalized]
        if len(payload["sectors"]) == before:
            return False
        payload["updated_at"] = _now()
        _atomic_write(payload)
    _clear_memory_cache()
    return True


def _thread_client():
    client = getattr(_THREAD_LOCAL, "tdx_client", None)
    if client is None:
        client = astock._mootdx_client()
        _THREAD_LOCAL.tdx_client = client
    return client


def _reset_thread_client() -> None:
    client = getattr(_THREAD_LOCAL, "tdx_client", None)
    if client is not None:
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass
        delattr(_THREAD_LOCAL, "tdx_client")


def _records(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, list):
        return [dict(row) for row in value if isinstance(row, dict)]
    if hasattr(value, "empty") and value.empty:
        return []
    if hasattr(value, "to_dict"):
        return [dict(row) for row in value.to_dict("records")]
    return []


def _is_fund_code(code: str) -> bool:
    return code.startswith(("15", "16", "18", "50", "51", "52", "56", "58"))


def _fetch_once(code: str, offset: int) -> list[dict[str, Any]]:
    """按通达信品种类型读取日 K；板块/指数必须走 index_bars。"""
    client = _thread_client()
    if code.startswith("89"):
        raw = client.client.get_index_bars(4, 2, code, 0, min(offset, 800))
        rows = _records(raw)
    elif _is_fund_code(code):
        rows = _records(client.bars(symbol=code, frequency=4, offset=offset))
    else:
        rows = _records(client.index_bars(symbol=code, frequency=4, offset=offset))
    valid: dict[str, dict[str, Any]] = {}
    for row in rows:
        date = str(row.get("datetime") or row.get("date") or "")[:10]
        try:
            close = float(row.get("close"))
        except (TypeError, ValueError):
            continue
        if not _DATE_RE.match(date) or not math.isfinite(close) or close <= 0:
            continue
        valid[date] = {"trade_date": date, "close": close}
    return [valid[date] for date in sorted(valid)]


def _fetch_tdx_daily_bars(code: str, offset: int = 32) -> list[dict[str, Any]]:
    try:
        return _fetch_once(code, offset)
    except Exception:  # noqa: BLE001 — 单代码断线后重建一次
        _reset_thread_client()
        return _fetch_once(code, offset)


def _history_for_sector(sector: dict[str, Any]) -> dict[str, Any]:
    code = sector["code"]
    try:
        bars = _fetch_tdx_daily_bars(code, max(_PERIODS) + 12)
    except Exception as exc:  # noqa: BLE001 — 单板块失败不影响其余榜单
        _reset_thread_client()
        return {
            "code": code,
            "name": sector["name"],
            "trade_date": None,
            "latest_close": None,
            "bar_count": 0,
            "returns": {},
            "error": f"通达信日线读取失败：{str(exc)[:160]}",
        }
    if not bars:
        return {
            "code": code,
            "name": sector["name"],
            "trade_date": None,
            "latest_close": None,
            "bar_count": 0,
            "returns": {},
            "error": "通达信未返回该代码的板块日线",
        }
    closes = [float(row["close"]) for row in bars]
    returns = {
        period: closes[-1] / closes[-period - 1] - 1
        for period in _PERIODS
        if len(closes) > period and closes[-period - 1] > 0
    }
    return {
        "code": code,
        "name": sector["name"],
        "trade_date": bars[-1]["trade_date"],
        "latest_close": round(closes[-1], 4),
        "bar_count": len(bars),
        "returns": returns,
        "error": None,
    }


def _percentile_ranks(items: list[dict[str, Any]], period: int) -> dict[str, float]:
    ordered = sorted(items, key=lambda row: row["returns"][period])
    count = len(ordered)
    ranks: dict[str, float] = {}
    index = 0
    while index < count:
        end = index
        value = ordered[index]["returns"][period]
        while end + 1 < count and math.isclose(
            ordered[end + 1]["returns"][period], value, rel_tol=0, abs_tol=1e-12,
        ):
            end += 1
        average_rank = (index + end) / 2
        percentile = round(average_rank / (count - 1) * 100 if count > 1 else 100, 2)
        for cursor in range(index, end + 1):
            ranks[ordered[cursor]["code"]] = percentile
        index = end + 1
    return ranks


def _source_digest(sectors: list[dict[str, Any]]) -> str:
    raw = "\n".join(row["code"] for row in sectors)
    return hashlib.sha256(raw.encode("ascii")).hexdigest()[:16]


def _cache_path(trade_date: str, digest: str) -> Path:
    return CACHE_DIR / f"sector-rps-v{_RPS_VERSION}-{trade_date}-{digest}.json"


def _load_disk_cache(digest: str) -> dict[str, Any] | None:
    try:
        candidates = sorted(
            CACHE_DIR.glob(f"sector-rps-v{_RPS_VERSION}-*-{digest}.json"),
            reverse=True,
        )
    except OSError:
        return None
    for path in candidates[:2]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if payload.get("version") == _RPS_VERSION and payload.get("source_digest") == digest:
            return payload
    return None


def _write_disk_cache(payload: dict[str, Any]) -> None:
    trade_date = str(payload.get("trade_date") or "unknown")
    digest = str(payload.get("source_digest") or "unknown")
    path = _cache_path(trade_date, digest)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        return


def _merge_current_names(payload: dict[str, Any], sectors: list[dict[str, Any]]) -> dict[str, Any]:
    names = {row["code"]: row["name"] for row in sectors}
    result = dict(payload)
    result["rows"] = [
        {**row, "name": names.get(row.get("code"), row.get("name", ""))}
        for row in payload.get("rows", [])
        if row.get("code") in names
    ]
    result["source_count"] = len(sectors)
    return result


def _reference_trade_date(sectors: list[dict[str, Any]]) -> str | None:
    """用少量板块探测通达信最新交易日；探测失败时允许使用已有缓存。"""
    for sector in sectors[:5]:
        try:
            bars = _fetch_tdx_daily_bars(sector["code"], 3)
        except Exception:  # noqa: BLE001
            continue
        if bars:
            return str(bars[-1].get("trade_date") or "")[:10] or None
    return None


def _build_snapshot(sectors: list[dict[str, Any]], digest: str) -> dict[str, Any]:
    workers = max(2, min(12, int(os.environ.get("VR_RPS_WORKERS", "8"))))
    histories: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(_history_for_sector, sector) for sector in sectors]
        for future in as_completed(futures):
            histories.append(future.result())

    date_counts = Counter(
        row["trade_date"] for row in histories if row.get("trade_date")
    )
    if not date_counts:
        raise SectorDataError("通达信没有返回任何板块日线，请检查行情节点或通达信网络连接")
    # 取命中代码最多的最新交易日，避免单个异常代码把基准日推到错误日期。
    trade_date = max(date_counts.items(), key=lambda item: (item[1], item[0]))[0]
    current = [row for row in histories if row.get("trade_date") == trade_date]
    rank_maps: dict[int, dict[str, float]] = {}
    ranked_counts: dict[str, int] = {}
    for period in _PERIODS:
        eligible = [row for row in current if period in row["returns"]]
        rank_maps[period] = _percentile_ranks(eligible, period)
        ranked_counts[str(period)] = len(eligible)

    rows: list[dict[str, Any]] = []
    for item in histories:
        is_current = item.get("trade_date") == trade_date
        row: dict[str, Any] = {
            "code": item["code"],
            "name": item["name"],
            "trade_date": item.get("trade_date"),
            "latest_close": item.get("latest_close"),
            "bar_count": item.get("bar_count", 0),
            "status": "ok" if is_current else ("stale" if item.get("trade_date") else "unavailable"),
            "error": item.get("error") if not is_current else None,
        }
        if item.get("trade_date") and not is_current:
            row["error"] = f"最新日线停留在 {item['trade_date']}，未纳入 {trade_date} 横截面排名"
        for period in _PERIODS:
            value = item.get("returns", {}).get(period)
            row[f"return{period}_pct"] = round(value * 100, 3) if value is not None else None
            row[f"rps{period}"] = rank_maps[period].get(item["code"]) if is_current else None
        rows.append(row)
    rows.sort(key=lambda row: row["code"])
    available_count = sum(row["status"] == "ok" for row in rows)
    if available_count < 2:
        raise SectorDataError(f"通达信板块有效样本过少（{available_count}），无法计算横截面 RPS")
    return {
        "version": _RPS_VERSION,
        "source": "通达信板块/指数日 K",
        "source_digest": digest,
        "trade_date": trade_date,
        "computed_at": _now(),
        "source_count": len(sectors),
        "available_count": available_count,
        "unavailable_count": len(rows) - available_count,
        "ranked_count_by_period": ranked_counts,
        "periods": list(_PERIODS),
        "rule": (
            "对每个已维护的通达信板块代码直接读取日K，按"
            "(C-REF(C,N))/REF(C,N)计算N=5/10/15/20日涨幅，"
            "再在同一交易日且该周期历史足够的板块池内做0—100顺序百分位排名；"
            "这是客观机械排序，不构成推荐。"
        ),
        "rows": rows,
    }


def compute_all_sector_rps(*, force_refresh: bool = False) -> dict[str, Any]:
    sectors = list_sectors()
    if not sectors:
        return {
            "version": _RPS_VERSION,
            "source": "通达信板块/指数日 K",
            "trade_date": None,
            "computed_at": _now(),
            "source_count": 0,
            "available_count": 0,
            "unavailable_count": 0,
            "ranked_count_by_period": {str(period): 0 for period in _PERIODS},
            "periods": list(_PERIODS),
            "rule": "暂无板块基础数据源。",
            "rows": [],
        }
    digest = _source_digest(sectors)
    with _RPS_LOCK:
        if not force_refresh:
            memory = _MEMORY_CACHE.get(digest)
            if memory:
                reference_date = _reference_trade_date(sectors)
                if reference_date is None or memory.get("trade_date") == reference_date:
                    return _merge_current_names(memory, sectors)
            disk = _load_disk_cache(digest)
            if disk:
                reference_date = _reference_trade_date(sectors)
                if reference_date is None or disk.get("trade_date") == reference_date:
                    _MEMORY_CACHE[digest] = disk
                    return _merge_current_names(disk, sectors)
        snapshot = _build_snapshot(sectors, digest)
        _MEMORY_CACHE[digest] = snapshot
        _write_disk_cache(snapshot)
        return _merge_current_names(snapshot, sectors)


def compute_sector_rps(code: str, *, force_refresh: bool = False) -> dict[str, Any] | None:
    normalized = _validate_code(code)
    if get_sector(normalized) is None:
        return None
    snapshot = compute_all_sector_rps(force_refresh=force_refresh)
    return next((row for row in snapshot["rows"] if row["code"] == normalized), None)

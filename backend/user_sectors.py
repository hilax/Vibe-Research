"""用户自维护的「板块强度」列表。

通达信里 88xxxx/881xxx 等板块代码本身没有公开的实时行情接口；
要算板块 RPS，必须由用户提供成分股列表（6 位 A 股代码，按行或空格分隔）。
后台从已有 RPS 快照中查找每只成分股的 RPS5/10/15/20，再用中位数合成板块 RPS。

数据落盘：backend/data/user_sectors.json（单文件，原子写；并发安全用锁）。
"""

from __future__ import annotations

import json
import re
import statistics
import threading
import time
from pathlib import Path
from typing import Any

from quant import rps_snapshot

DATA_PATH = Path(__file__).parent / "data" / "user_sectors.json"
_LOCK = threading.Lock()

# 通达信常见板块代码（来自用户提供的 blocknew 列表）：6 位数字
_CODE_RE = re.compile(r"^\d{6}$")


def _empty_store() -> dict[str, Any]:
    return {"version": 1, "updated_at": 0.0, "sectors": []}


def _load() -> dict[str, Any]:
    if not DATA_PATH.exists():
        return _empty_store()
    try:
        with DATA_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or "sectors" not in data:
            return _empty_store()
        return data
    except Exception:
        # 损坏时备份并重建，避免阻塞所有读路径
        try:
            DATA_PATH.rename(DATA_PATH.with_suffix(".json.broken"))
        except Exception:
            pass
        return _empty_store()


def _atomic_write(payload: dict[str, Any]) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    tmp.replace(DATA_PATH)


def _parse_constituents(raw: str | list[str]) -> list[str]:
    """成分股解析：允许换行 / 空格 / 中文逗号 / 英文逗号 / 分号；6 位代码才保留。"""
    if isinstance(raw, list):
        tokens = raw
    else:
        tokens = re.split(r"[\s,;，；]+", raw or "")
    seen: set[str] = set()
    out: list[str] = []
    for tok in tokens:
        code = re.sub(r"\D", "", str(tok))
        if not _CODE_RE.fullmatch(code):
            continue
        if code in seen:
            continue
        seen.add(code)
        out.append(code)
    return out


# ── CRUD ────────────────────────────────────────────────────────────────

def list_sectors() -> list[dict[str, Any]]:
    with _LOCK:
        data = _load()
    return list(data.get("sectors", []))


def get_sector(code: str) -> dict[str, Any] | None:
    with _LOCK:
        data = _load()
    for sector in data.get("sectors", []):
        if sector.get("code") == code:
            return dict(sector)
    return None


def add_sector(code: str, name: str, constituents: list[str] | str = "") -> dict[str, Any]:
    code = (code or "").strip()
    name = (name or "").strip()
    if not _CODE_RE.fullmatch(code):
        raise ValueError("板块代码必须是 6 位数字")
    if not name:
        raise ValueError("板块名称不能为空")
    parsed = _parse_constituents(constituents)
    with _LOCK:
        data = _load()
        if any(s.get("code") == code for s in data["sectors"]):
            raise ValueError(f"板块 {code} 已存在，请用编辑功能修改")
        entry = {
            "code": code,
            "name": name,
            "constituents": parsed,
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        data["sectors"].append(entry)
        data["updated_at"] = time.time()
        _atomic_write(data)
        return entry


def update_sector(code: str, *, name: str | None = None, constituents: list[str] | str | None = None) -> dict[str, Any]:
    with _LOCK:
        data = _load()
        for sector in data["sectors"]:
            if sector.get("code") == code:
                if name is not None:
                    name = name.strip()
                    if not name:
                        raise ValueError("板块名称不能为空")
                    sector["name"] = name
                if constituents is not None:
                    sector["constituents"] = _parse_constituents(constituents)
                sector["updated_at"] = time.time()
                data["updated_at"] = time.time()
                _atomic_write(data)
                return dict(sector)
        raise KeyError(f"板块 {code} 不存在")


def delete_sector(code: str) -> bool:
    with _LOCK:
        data = _load()
        before = len(data["sectors"])
        data["sectors"] = [s for s in data["sectors"] if s.get("code") != code]
        if len(data["sectors"]) == before:
            return False
        data["updated_at"] = time.time()
        _atomic_write(data)
        return True


# ── 板块 RPS 计算 ─────────────────────────────────────────────────────────

def compute_sector_rps(code: str) -> dict[str, Any] | None:
    """从全市场 RPS 快照聚合板块的 RPS5/10/15/20。
    合成规则：成分股 RPS 的中位数（剔除空值/异常）。"""
    sector = get_sector(code)
    if sector is None:
        return None
    constituents = sector.get("constituents", [])
    if not constituents:
        return {
            "code": sector["code"],
            "name": sector["name"],
            "constituent_count": 0,
            "matched_count": 0,
            "missing_codes": [],
            "rps5": None, "rps10": None, "rps15": None, "rps20": None,
            "constituents": [],
            "computed_at": time.time(),
        }

    snap = rps_snapshot()
    stocks = snap.get("stocks", {})
    trade_date = snap.get("trade_date")

    per_period: dict[int, list[float]] = {p: [] for p in (5, 10, 15, 20)}
    matched_rows: list[dict[str, Any]] = []
    missing: list[str] = []
    for c_code in constituents:
        info = stocks.get(c_code)
        if not info:
            missing.append(c_code)
            continue
        per_row = {"code": c_code, "name": info.get("name", "")}
        for period in (5, 10, 15, 20):
            v = info.get(f"rps{period}")
            if v is None:
                per_row[f"rps{period}"] = None
                continue
            per_period[period].append(float(v))
            per_row[f"rps{period}"] = round(float(v), 2)
        matched_rows.append(per_row)

    sector_rps: dict[int, float | None] = {}
    for period, vals in per_period.items():
        if not vals:
            sector_rps[period] = None
        else:
            sector_rps[period] = round(statistics.median(vals), 2)

    return {
        "code": sector["code"],
        "name": sector["name"],
        "trade_date": trade_date,
        "constituent_count": len(constituents),
        "matched_count": len(matched_rows),
        "missing_codes": missing,
        "rps5": sector_rps[5],
        "rps10": sector_rps[10],
        "rps15": sector_rps[15],
        "rps20": sector_rps[20],
        "constituents": matched_rows,
        "computed_at": time.time(),
    }


def compute_all_sector_rps() -> list[dict[str, Any]]:
    """一次性计算所有用户板块的 RPS。"""
    sectors = list_sectors()
    out: list[dict[str, Any]] = []
    for s in sectors:
        rps = compute_sector_rps(s["code"])
        if rps is not None:
            out.append(rps)
    return out

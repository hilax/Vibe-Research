"""量化选股：机构持仓基础池 + 通达信技术条件。

数据口径：
  - 基金持仓：东方财富主力数据，季度报告，使用占流通股比例。
  - 北向持股：港交所官方沪深股通持股记录（季度披露）+ 腾讯最新行情估算市值。
  - 技术条件：mootdx / 通达信日 K，默认 C >= HHV(H, 250) * 95%。

本模块只执行用户明确设置的客观条件，不提供买卖建议或收益预测。
"""

from __future__ import annotations

import math
import hashlib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from typing import Any

import astock
import quant_formula
import tdx_formula
import tdx_presets

_FUND_URL = "https://data.eastmoney.com/dataapi/zlsj/list"
_HKEX_URL = "https://www3.hkexnews.hk/sdw/search/mutualmarket_c.aspx"
_HEADERS = {
    "User-Agent": astock.UA,
    "Referer": "https://data.eastmoney.com/",
}
_CACHE: dict[tuple, tuple[float, Any]] = {}
_CACHE_LOCK = threading.RLock()
# 基础池（基金/北向）数据按季度披露；缓存 24h 既能复用，又能在新报告日失效。
# 之前的 6h 太短，会反复拉东方财富/港交所接口，导致每次筛选都慢。
_BASE_TTL = 24 * 3600
_THREAD_LOCAL = threading.local()
_RPS_CACHE_DIR = Path(__file__).with_name(".cache")
_RPS_VERSION = 8
_RPS_PERIODS = (5, 10, 15, 20, 50, 120, 250)
# RPS 历史回看窗口。= 0 表示只算截面最新一天的 RPS；增大可让副图覆盖更多 K 线日期。
# 由于 RPS250 本身就需要 250 根 K 线，给到 560 能覆盖 K 线页默认 240 根日 K（= 250 + 310 余量）
# 以及拉到 ~800 根时的全段 RPS。首次构建量随此值线性放大（每只股票多拉 N 根 K）。
_RPS_HISTORY_DAYS = 560
_STRATEGIES = {
    "near_high": "接近一年新高",
    "monthly_reversal_62": "月线反转 6.2",
    "growth_mrgc_sxhcg": "RPS 高成长（MRGC / SXHCG）",
}

# ── RPS 后台预热状态 ──────────────────────────────────────────────────────
# 目标：让前端发起选股请求时，rps_snapshot() 总是命中内存热缓存，
# 把"几千只股 × 网络请求"的耗时从用户等待时间里彻底移除。
# 状态用 dict（dict 取/赋值原子） + 写时加锁；读取用快照避免阻塞。
_RPS_PREWARM_STATE: dict[str, Any] = {
    "ready": False,             # 当日快照是否就绪
    "trade_date": None,         # 当前就绪快照对应的交易日
    "started_at": None,         # 最近一次预热开始时间
    "finished_at": None,        # 最近一次预热成功结束时间
    "last_error": None,         # 最近一次预热失败的错误信息
    "running": False,           # 当前是否正在跑预热
    "runs_total": 0,            # 累计预热次数
    "runs_failed": 0,           # 累计失败次数
}
_RPS_PREWARM_LOCK = threading.Lock()


def get_rps_prewarm_status() -> dict:
    """读取 RPS 预热状态（不阻塞、不加锁；返回 dict 副本）。"""
    with _RPS_PREWARM_LOCK:
        return dict(_RPS_PREWARM_STATE)


def _set_rps_prewarm(**kwargs) -> None:
    with _RPS_PREWARM_LOCK:
        _RPS_PREWARM_STATE.update(kwargs)


def _prewarm_rps_sync() -> None:
    """后台线程执行：预热当日 RPS 快照。

    设计要点：
    1. 失败绝不抛出；状态写错误信息方便前端排查。
    2. 若内存已就绪（同交易日），跳过重复计算。
    3. 完成后磁盘 + 内存双层缓存，下一次 rps_snapshot() 同步读取 O(1) 返回。
    """
    _set_rps_prewarm(running=True, started_at=time.time(), last_error=None)
    try:
        # 在调用 rps_snapshot() 之前先看 trade_date —— 它本身会拉一次 mootdx，
        # 但已经在 _latest_tdx_date() 内部做了客户端复用，开销可接受。
        snapshot = rps_snapshot()
        _set_rps_prewarm(
            ready=True,
            trade_date=snapshot.get("trade_date"),
            finished_at=time.time(),
            running=False,
            runs_total=_RPS_PREWARM_STATE["runs_total"] + 1,
        )
    except Exception as error:  # noqa: BLE001 — 后台任务不能崩
        _set_rps_prewarm(
            running=False,
            last_error=f"{type(error).__name__}: {error}",
            runs_failed=_RPS_PREWARM_STATE["runs_failed"] + 1,
        )


def trigger_rps_prewarm() -> threading.Thread | None:
    """触发一次预热；如已在跑则直接返回。返回启动的线程（可能为 None）。"""
    with _RPS_PREWARM_LOCK:
        if _RPS_PREWARM_STATE["running"]:
            return None
    thread = threading.Thread(
        target=_prewarm_rps_sync, name="rps-prewarm", daemon=True,
    )
    thread.start()
    return thread


# ── RPS 预热调度器 ────────────────────────────────────────────────────────
# 默认在 9:00 / 15:30 / 16:30 三个时间点各触发一次，覆盖：
#  - 开盘前：清缓存 + 准备新一日快照
#  - 收盘后 15:30 第一次：等交易所数据稳定
#  - 收盘后 16:30 第二次：兜底（万一前一次失败 / 上游延迟）
# 可通过环境变量 VR_RPS_PREWARM_TIMES="9:00,15:30,16:30" 自定义。
def _parse_prewarm_times(spec: str) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for token in spec.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            hh, mm = token.split(":", 1)
            out.append((int(hh), int(mm)))
        except (ValueError, AttributeError):
            continue
    return out


def _seconds_until_next(target_hh: int, target_mm: int) -> float:
    from datetime import datetime, timedelta
    now = datetime.now()
    target = now.replace(hour=target_hh, minute=target_mm, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def start_rps_prewarm_scheduler(
    prewarm_times: str | None = None,
    prewarm_on_start: bool = True,
) -> None:
    """启动 RPS 后台预热调度器。

    - prewarm_times: "HH:MM,HH:MM,..."；为空则用默认值。
    - prewarm_on_start: 启动后是否立刻预热一次（不阻塞启动）。
    """
    times = _parse_prewarm_times(
        prewarm_times or os.environ.get("VR_RPS_PREWARM_TIMES", "9:00,15:30,16:30"),
    )
    if not times:
        times = [(9, 0), (15, 30), (16, 30)]

    def loop():
        # 启动时立刻预热一次（不阻塞主流程）
        if prewarm_on_start:
            trigger_rps_prewarm()
        while True:
            # 找到下一个最近的时刻
            now = time.time()
            waits = [(_seconds_until_next(hh, mm), hh, mm) for hh, mm in times]
            wait, hh, mm = min(waits, key=lambda x: x[0])
            # 最多睡 1 小时醒来再算一次（防止时钟漂移 / 系统休眠后错过）
            sleep_chunk = min(wait, 3600)
            time.sleep(max(1.0, sleep_chunk))
            # 如果我们已经跨过目标时刻就触发
            from datetime import datetime as _dt
            if _dt.now().hour == hh and _dt.now().minute == mm:
                trigger_rps_prewarm()

    threading.Thread(target=loop, name="rps-prewarm-scheduler", daemon=True).start()


class QuantDataError(RuntimeError):
    """上游数据不可用或返回结构异常。"""


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _round(value: Any, digits: int = 2) -> float | None:
    number = _finite(value)
    return round(number, digits) if number is not None else None


def _percent(value: Any) -> float | None:
    if isinstance(value, str):
        value = value.strip().replace("%", "").replace(",", "")
    return _finite(value)


def _json(url: str, params: dict, timeout: int = 25) -> dict:
    response = astock.em_get(url, params=params, headers=_HEADERS, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise QuantDataError("数据源返回了无法识别的格式")
    return payload


def _cache_get(key: tuple, ttl: int):
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    return None


def _cache_put(key: tuple, value: Any):
    with _CACHE_LOCK:
        _CACHE[key] = (time.time(), value)


def _quarter_ends(today: date | None = None) -> list[str]:
    today = today or date.today()
    out: list[date] = []
    for year in range(today.year, today.year - 4, -1):
        for month, day in ((3, 31), (6, 30), (9, 30), (12, 31)):
            value = date(year, month, day)
            if value <= today:
                out.append(value)
    return [d.isoformat() for d in sorted(out, reverse=True)]


def _fund_period_size(period: str) -> int:
    payload = _json(_FUND_URL, {
        "date": period,
        "type": "1",
        "zjc": "0",
        "sortField": "FREESHARES_RATIO",
        "sortDirec": "1",
        "pageNum": "1",
        "pageSize": "1",
        "p": "1",
        "pageNo": "1",
    })
    return int(payload.get("pages") or 0)


def latest_complete_fund_period() -> str:
    key = ("latest-fund-period",)
    cached = _cache_get(key, _BASE_TTL)
    if cached:
        return cached

    first_non_empty: str | None = None
    for period in _quarter_ends():
        size = _fund_period_size(period)
        if size > 0 and first_non_empty is None:
            first_non_empty = period
        # 季末刚过时数据会逐步披露；不足 1000 只视为尚未完整。
        if size >= 1000:
            _cache_put(key, period)
            return period
    if first_non_empty:
        _cache_put(key, first_non_empty)
        return first_non_empty
    raise QuantDataError("未找到可用的基金持仓报告期")


def _fund_pool_periods(fund_period: str | None = None) -> list[str]:
    """默认合并最新报告期与最近年报/中报，避免一季报、三季报披露不全。"""
    if fund_period:
        return [fund_period]
    latest = latest_complete_fund_period()
    periods = [latest]
    for period in _quarter_ends():
        if period >= latest or not period.endswith(("06-30", "12-31")):
            continue
        if _fund_period_size(period) >= 1000:
            periods.append(period)
            break
    return periods


def _fund_pool_rows(periods: list[str], ratio_min: float) -> list[dict]:
    # periods 按新到旧；同一股票优先展示较新的报告期数据。
    by_code: dict[str, dict] = {}
    for period in periods:
        for row in _fund_rows(period, ratio_min):
            by_code.setdefault(row["code"], row)
    return list(by_code.values())


def _fund_rows(period: str, ratio_min: float) -> list[dict]:
    rows: list[dict] = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        payload = _json(_FUND_URL, {
            "date": period,
            "type": "1",
            "zjc": "0",
            "sortField": "FREESHARES_RATIO",
            "sortDirec": "1",
            "pageNum": str(page),
            "pageSize": "500",
            "p": str(page),
            "pageNo": str(page),
        })
        total_pages = int(payload.get("pages") or 0)
        page_rows = payload.get("data") or []
        if not page_rows:
            break
        below_threshold = False
        for item in page_rows:
            ratio = _finite(item.get("FREESHARES_RATIO")) or 0.0
            if ratio < ratio_min:
                below_threshold = True
                continue
            code = str(item.get("SECURITY_CODE") or "")
            if not re.fullmatch(r"\d{6}", code):
                continue
            rows.append({
                "code": code,
                "name": item.get("SECURITY_NAME_ABBR") or "",
                "fund_count": int(_finite(item.get("HOULD_NUM")) or 0),
                "fund_hold_shares": _round(item.get("TOTAL_SHARES"), 0),
                "fund_hold_value_yi": _round((_finite(item.get("HOLD_VALUE")) or 0) / 1e8),
                "fund_float_ratio_pct": _round(ratio, 4),
                "fund_total_ratio_pct": _round(item.get("TOTALSHARES_RATIO"), 4),
                "fund_period": period,
            })
        if below_threshold:
            break
        page += 1
    return rows


def _hkex_code_to_a_share(value: str, market: str) -> str | None:
    """把港交所北向查询使用的 5 位证券编号还原为沪深 A 股代码。"""
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    code: str | None = None
    if market == "sh":
        if 30000 <= number < 32000:      # 科创板 688/689xxx
            code = f"{number + 658000:06d}"
        elif 90000 <= number < 100000:   # 沪市主板 600-609xxx
            code = f"{number + 510000:06d}"
    elif market == "sz":
        if 70000 <= number < 74000:      # 深市 000-003xxx
            code = f"{number - 70000:06d}"
        elif 77000 <= number < 79000:    # 创业板 300/301xxx
            code = f"{number + 223000:06d}"
    market_id = 1 if market == "sh" else 0
    return code if code and _is_hs_a_share(code, market_id) else None


def _hkex_market_rows(market: str) -> tuple[str, dict[str, dict]]:
    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError as exc:
        raise QuantDataError("读取港交所北向持仓需要 beautifulsoup4") from exc

    response = requests.get(
        _HKEX_URL,
        params={"t": market},
        headers={"User-Agent": astock.UA},
        timeout=45,
    )
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    date_input = soup.select_one("#txtShareholdingDate")
    period = str(date_input.get("value") if date_input else "").replace("/", "-")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", period):
        raise QuantDataError(f"港交所{market.upper()}持仓页没有返回有效日期")

    rows: dict[str, dict] = {}
    for cell in soup.select("td.col-stock-code"):
        tr = cell.find_parent("tr")
        values = [
            item.get_text(" ", strip=True)
            for item in tr.select("td .mobile-list-body")
        ] if tr else []
        if len(values) < 4:
            continue
        code = _hkex_code_to_a_share(values[0], market)
        shares = _finite(values[2].replace(",", ""))
        ratio = _percent(values[3])
        if not code or shares is None:
            continue
        rows[code] = {
            "code": code,
            "hkex_name": values[1],
            "north_hold_shares": round(shares),
            "north_total_ratio_pct": _round(ratio, 4),
        }
    if len(rows) < 1000:
        raise QuantDataError(f"港交所{market.upper()}持仓样本过少：{len(rows)}")
    return period, rows


def latest_north_holdings() -> dict:
    """港交所最新季度末北向个股持股，结果按日缓存。"""
    key = ("hkex-north-holdings",)
    cached = _cache_get(key, 24 * 3600)
    if cached:
        return cached
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(_hkex_market_rows, market) for market in ("sh", "sz")]
        snapshots = [future.result() for future in futures]
    periods = {period for period, _ in snapshots}
    if len(periods) != 1:
        raise QuantDataError(f"港交所沪深持仓日期不一致：{sorted(periods)}")
    rows: dict[str, dict] = {}
    for _, market_rows in snapshots:
        rows.update(market_rows)
    data = {"period": periods.pop(), "rows": rows}
    _cache_put(key, data)
    return data


def base_pool(
    fund_ratio_min: float = 5.0,
    north_value_min_yi: float = 1.0,
    fund_period: str | None = None,
) -> dict:
    fund_periods = _fund_pool_periods(fund_period)
    period = " + ".join(fund_periods)
    key = (
        "base-pool", period, round(fund_ratio_min, 4),
        round(north_value_min_yi, 4),
    )
    cached = _cache_get(key, _BASE_TTL)
    if cached:
        return cached

    funds = _fund_pool_rows(fund_periods, fund_ratio_min)
    fund_by_code = {row["code"]: row for row in funds}
    north_snapshot = latest_north_holdings()
    north_period = north_snapshot["period"]
    north_holdings = north_snapshot["rows"]
    north_quotes = _batch_quotes(list(north_holdings))
    north_by_code: dict[str, dict] = {}
    for code, holding in north_holdings.items():
        quote = north_quotes.get(code) or {}
        price = _finite(quote.get("price"))
        if price is None or price <= 0:
            continue
        north_value = holding["north_hold_shares"] * price / 1e8
        if north_value < north_value_min_yi:
            continue
        north_by_code[code] = {
            **holding,
            "name": quote.get("name") or holding["hkex_name"],
            "north_hold_value_yi": _round(north_value),
            "north_quote_price": _round(price, 3),
        }

    rows: list[dict] = []
    all_codes = set(fund_by_code) | set(north_by_code)
    for code in all_codes:
        fund = fund_by_code.get(code) or {}
        north = north_by_code.get(code) or {}
        fund_met = code in fund_by_code
        north_met = code in north_by_code
        rows.append({
            "code": code,
            "name": fund.get("name") or north.get("name") or "",
            "fund_count": fund.get("fund_count", 0),
            "fund_hold_shares": fund.get("fund_hold_shares"),
            "fund_hold_value_yi": fund.get("fund_hold_value_yi"),
            "fund_float_ratio_pct": fund.get("fund_float_ratio_pct"),
            "fund_total_ratio_pct": fund.get("fund_total_ratio_pct"),
            "fund_period": fund.get("fund_period") or period,
            "north_hold_shares": north.get("north_hold_shares"),
            "north_hold_value_yi": north.get("north_hold_value_yi"),
            "north_float_ratio_pct": None,
            "north_total_ratio_pct": north.get("north_total_ratio_pct"),
            "north_period": north_period,
            "north_quote_price": north.get("north_quote_price"),
            "fund_condition_met": fund_met,
            "north_condition_met": north_met,
            "condition_tags": [
                label for condition, label in (
                    (fund_met, f"基金≥{fund_ratio_min:g}%"),
                    (north_met, f"北向≥{north_value_min_yi:g}亿"),
                ) if condition
            ],
            "industry": "",
        })
    # 给结果集一次性补全「行业」+「当日涨跌」。申万分类走 astock 的本地缓存
    # （backend/data/sw_industry.json，30 天内复用）；当日涨跌走腾讯 qt.gtimg.cn
    # （你这边网络唯一稳定可达的实时行情源，单次批量拉最多 80 只）。
    if rows:
        for r in rows:
            r["industry"] = astock.get_sw_industry(r["code"])
        # 腾讯行情接口一次最多 ~80 只，全市场 5000+ 必须分块；复用项目内的 _batch_quotes。
        quotes = _batch_quotes([r["code"] for r in rows])
        for r in rows:
            q = quotes.get(r["code"]) or {}
            r["change_pct"] = q.get("change_pct")
    rows.sort(key=lambda row: (
        -(int(row["fund_condition_met"]) + int(row["north_condition_met"])),
        -(row["fund_float_ratio_pct"] or 0),
        -(row["north_hold_value_yi"] or 0),
        row["code"],
    ))
    data = {
        "fund_period": period,
        "fund_periods": fund_periods,
        "north_period": north_period,
        "fund_candidate_count": len(funds),
        "north_candidate_count": len(north_by_code),
        "overlap_count": len(set(fund_by_code) & set(north_by_code)),
        "base_count": len(rows),
        "rows": rows,
    }
    _cache_put(key, data)
    return data


# ---------------------------------------------------------------------------
# 全市场 RPS：统一剔除不足 251 根日 K 的上市一年内新股
# ---------------------------------------------------------------------------

def _thread_client():
    client = getattr(_THREAD_LOCAL, "tdx_client", None)
    if client is None:
        client = astock._mootdx_client()
        _THREAD_LOCAL.tdx_client = client
    return client


def _reset_thread_client():
    if hasattr(_THREAD_LOCAL, "tdx_client"):
        delattr(_THREAD_LOCAL, "tdx_client")


def _is_hs_a_share(code: str, market: int) -> bool:
    if market == 0:  # 深市主板 / 中小板 / 创业板
        return code.startswith(("000", "001", "002", "003", "300", "301"))
    if market == 1:  # 沪市主板 / 科创板
        return code.startswith(("600", "601", "603", "605", "688", "689"))
    return False


def _security_page(market: int, start: int) -> list[dict]:
    try:
        return _thread_client().client.get_security_list(market=market, start=start) or []
    except Exception:  # noqa: BLE001 — 连接失效时重建一次
        _reset_thread_client()
        return _thread_client().client.get_security_list(market=market, start=start) or []


def _hs_a_universe() -> list[dict]:
    """沪深 A 股共同样本。

    注：mootdx 标准协议对北交所 K 线接口返回空，因此北交所个股暂不纳入 RPS 横截面。
    如未来切换到底层客户端，可放开此限制。
    """
    key = ("hs-a-universe",)
    cached = _cache_get(key, 24 * 3600)
    if cached:
        return cached
    client = astock._mootdx_client()
    tasks = []
    for market in (0, 1):
        count = int(client.stock_count(market=market) or 0)
        if count <= 0:
            continue
        tasks.extend((market, start) for start in range(0, count, 1000))
    rows: list[dict] = []
    workers = max(2, min(12, int(os.environ.get("VR_RPS_WORKERS", "8"))))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_security_page, market, start): market
            for market, start in tasks
        }
        for future in as_completed(futures):
            market = futures[future]
            for item in future.result():
                code = str(item.get("code") or "")
                if _is_hs_a_share(code, market):
                    rows.append({
                        "code": code,
                        "name": str(item.get("name") or "").replace("\x00", "").strip(),
                    })
    unique = {row["code"]: row for row in rows}
    result = [unique[code] for code in sorted(unique)]
    _cache_put(key, result)
    return result


def _latest_tdx_date() -> str:
    frame = astock._mootdx_client().bars(symbol="600519", frequency=4, offset=2)
    if frame is None or frame.empty:
        raise QuantDataError("通达信未返回基准股票日 K，无法确定 RPS 日期")
    return str(frame.iloc[-1].get("datetime") or "")[:10]


def _exact_qfq_closes(
    trade_dates: list[str],
    raw_closes: list[float],
    actions: list[dict],
) -> list[float]:
    """按通达信除权除息记录计算精确前复权收盘价。

    通达信 category=1 的字段均以每 10 股为单位。除权日之前的价格依次按
    ``(价格*10-分红+配股数*配股价)/(10+配股数+送转数)`` 调整。
    """
    adjusted = list(raw_closes)
    if not adjusted or not actions:
        return adjusted
    normalized_dates = [str(value or "")[:10] for value in trade_dates]
    last_trade_date = normalized_dates[-1]
    valid_actions: list[tuple[str, float, float, float, float]] = []
    for row in actions:
        if int(_finite(row.get("category")) or 0) != 1:
            continue
        try:
            action_date = (
                f"{int(row.get('year')):04d}-{int(row.get('month')):02d}-"
                f"{int(row.get('day')):02d}"
            )
        except (TypeError, ValueError):
            continue
        if action_date > last_trade_date:
            continue
        fenhong = float(_finite(row.get("fenhong")) or 0)
        peigu = float(_finite(row.get("peigu")) or 0)
        peigujia = float(_finite(row.get("peigujia")) or 0)
        songzhuangu = float(_finite(row.get("songzhuangu")) or 0)
        denominator = 10 + peigu + songzhuangu
        if denominator > 0:
            valid_actions.append((action_date, fenhong, peigu, peigujia, denominator))

    # 必须按除权日从早到晚应用；现金分红使复权变换并非简单的乘法。
    for action_date, fenhong, peigu, peigujia, denominator in sorted(valid_actions):
        for index, trade_date in enumerate(normalized_dates):
            if trade_date >= action_date:
                break
            adjusted[index] = (
                adjusted[index] * 10 - fenhong + peigu * peigujia
            ) / denominator
    return adjusted


def _xdxr_actions(code: str) -> list[dict]:
    try:
        frame = _thread_client().xdxr(symbol=code)
    except Exception:  # noqa: BLE001 — 连接失效时重建一次
        _reset_thread_client()
        frame = _thread_client().xdxr(symbol=code)
    if frame is None or frame.empty:
        return []
    return frame.to_dict("records")


def _rps_history(stock: dict) -> dict | None:
    code = stock["code"]
    try:
        frame = _thread_client().bars(
            symbol=code,
            frequency=4,
            offset=250 + _RPS_HISTORY_DAYS,
        )
        if frame is None or frame.empty or len(frame) < 251:
            return None
        raw_closes = [_finite(value) for value in frame["close"].tolist()]
        if any(value is None or value <= 0 for value in raw_closes):
            return None
        trade_dates = [str(value or "")[:10] for value in frame["datetime"].tolist()]
        closes = _exact_qfq_closes(
            trade_dates,
            [float(value) for value in raw_closes],
            _xdxr_actions(code),
        )
        if any(value <= 0 for value in closes):
            return None
        start = max(250, len(closes) - _RPS_HISTORY_DAYS)
        points = []
        for index in range(start, len(closes)):
            points.append({
                "trade_date": trade_dates[index],
                "returns": {
                    period: closes[index] / closes[index - period] - 1
                    for period in _RPS_PERIODS
                },
            })
        returns = points[-1]["returns"]
        return {
            "code": code,
            "name": stock["name"],
            "trade_date": str(frame.iloc[-1].get("datetime") or "")[:10],
            "returns": returns,
            "points": points,
        }
    except Exception:  # noqa: BLE001 — 单只失败不影响全市场快照
        _reset_thread_client()
        return None


def _percentile_ranks(items: list[dict], period: int) -> dict[str, float]:
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
        # 通达信“0—1000归一化顺序”：最小值为 0，最大值为 1000。
        # 项目内部保留 0—100 展示值；EXTDATA_USER 引用时再乘 10。
        average_zero_based_rank = (index + end) / 2
        percentile = round(
            average_zero_based_rank / (count - 1) * 100 if count > 1 else 100,
            2,
        )
        for cursor in range(index, end + 1):
            ranks[ordered[cursor]["code"]] = percentile
        index = end + 1
    return ranks


def rps_snapshot() -> dict:
    """构建/读取当日 RPS20/50/120/250 全市场快照。

    先统一选取至少 251 根日 K 的沪深 A 股作为上市一年以上共同样本，再让所有
    RPS 周期都在同一批股票内计算精确复权涨幅和 0—1000 归一化顺序排名。
    """
    trade_date = _latest_tdx_date()
    memory_key = ("rps-snapshot", trade_date, _RPS_VERSION)
    cached = _cache_get(memory_key, 24 * 3600)
    if cached:
        return cached
    cache_path = _RPS_CACHE_DIR / f"quant-rps-v{_RPS_VERSION}-{trade_date}.json"
    try:
        disk = json.loads(cache_path.read_text(encoding="utf-8"))
        if disk.get("version") == _RPS_VERSION and disk.get("trade_date") == trade_date:
            _cache_put(memory_key, disk)
            return disk
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        pass

    universe = _hs_a_universe()
    histories: list[dict] = []
    workers = max(2, min(12, int(os.environ.get("VR_RPS_WORKERS", "8"))))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(_rps_history, stock) for stock in universe]
        for future in as_completed(futures):
            item = future.result()
            if item:
                histories.append(item)
    if len(histories) < 1000:
        raise QuantDataError(f"RPS 有效样本过少（{len(histories)}），通达信数据可能不完整")

    rank_maps = {
        period: _percentile_ranks(histories, period)
        for period in _RPS_PERIODS
    }
    by_date: dict[str, list[dict]] = {}
    for item in histories:
        for point in item.get("points", []):
            by_date.setdefault(point["trade_date"], []).append({
                "code": item["code"],
                "returns": point["returns"],
            })
    historical_ranks: dict[str, list[dict]] = {}
    for point_date in sorted(by_date):
        date_items = by_date[point_date]
        date_rank_maps = {
            period: _percentile_ranks(date_items, period)
            for period in _RPS_PERIODS
        }
        for item in date_items:
            code = item["code"]
            point: dict[str, object] = {"trade_date": point_date}
            for period in _RPS_PERIODS:
                point[f"rps{period}"] = date_rank_maps[period][code]
            historical_ranks.setdefault(code, []).append(point)
    stocks = {}
    for item in histories:
        code = item["code"]
        stocks[code] = {
            "name": item["name"],
            **{f"rps{period}": rank_maps[period][code] for period in _RPS_PERIODS},
            **{f"return{period}_pct": round(item["returns"][period] * 100, 3) for period in _RPS_PERIODS},
            "history": historical_ranks.get(code, []),
        }
    snapshot = {
        "version": _RPS_VERSION,
        "trade_date": trade_date,
        "universe_count": len(universe),
        "eligible_count": len(histories),
        "excluded_short_history_count": len(universe) - len(histories),
        "ranked_count_by_period": {
            str(period): len(histories) for period in _RPS_PERIODS
        },
        "rule": (
            "沪深A股统一选取至少251根日K的上市一年以上共同样本，先在该全市场样本内"
            "使用通达信除权除息记录精确前复权，按(C-REF(C,N))/REF(C,N)计算"
            "N=20/50/120/250收益率并做0—1000归一化顺序排名，再将RPS结果与基金/北向"
            "基础池合并参与选股（项目展示为0—100，EXTDATA_USER为0—1000）；"
            f"同时保留最近{_RPS_HISTORY_DAYS}个交易日RPS供通达信历史函数使用"
        ),
        "stocks": stocks,
    }
    try:
        _RPS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        temp_path = cache_path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
        temp_path.replace(cache_path)
    except OSError:
        pass
    _cache_put(memory_key, snapshot)
    return snapshot


# ---------------------------------------------------------------------------
# 通达信公式求值（当前最新交易日）
# ---------------------------------------------------------------------------

def _series(bars: list[dict], field: str) -> list[float]:
    values = [_finite(bar.get(field)) for bar in bars]
    return [float(value) for value in values if value is not None]


def _ma(values: list[float], period: int) -> list[float | None]:
    result: list[float | None] = [None] * len(values)
    running = 0.0
    for index, value in enumerate(values):
        running += value
        if index >= period:
            running -= values[index - period]
        if index >= period - 1:
            result[index] = running / period
    return result


def _hhv(values: list[float], period: int, index: int | None = None) -> float:
    index = len(values) - 1 if index is None else index
    return max(values[max(0, index - period + 1):index + 1])


def _llv(values: list[float], period: int, index: int | None = None) -> float:
    index = len(values) - 1 if index is None else index
    return min(values[max(0, index - period + 1):index + 1])


def _count_last(values: list[bool], period: int) -> int:
    return sum(values[-period:])


def _drawdown_from_recent_high(highs: list[float], lows: list[float], window: int) -> float:
    end = len(highs) - 1
    start = max(0, len(highs) - window)
    high_value = max(highs[start:end + 1])
    # HHVBARS 在并列最高点时取最近一次。
    high_index = max(i for i in range(start, end + 1) if highs[i] == high_value)
    if high_index == end:
        return 0.0
    low_value = min(lows[high_index + 1:end + 1])
    return max(0.0, (high_value - low_value) / high_value)


def _technical_series(bars: list[dict], minimum: int = 250) -> dict | None:
    closes = _series(bars, "close")
    highs = _series(bars, "high")
    lows = _series(bars, "low")
    if min(len(closes), len(highs), len(lows)) < minimum:
        return None
    size = min(len(closes), len(highs), len(lows))
    closes, highs, lows = closes[-size:], highs[-size:], lows[-size:]
    return {
        "close": closes,
        "high": highs,
        "low": lows,
        "ma10": _ma(closes, 10),
        "ma20": _ma(closes, 20),
        "ma50": _ma(closes, 50),
        "ma120": _ma(closes, 120),
        "ma200": _ma(closes, 200),
        "ma250": _ma(closes, 250),
    }


def monthly_reversal_62(
    bars: list[dict], rps: dict, formula_config: dict | None = None,
) -> dict | None:
    config = formula_config or quant_formula.normalize_formula("monthly_reversal_62")
    p = config["params"]
    minimum = max(
        250, p["close_breakout_days"], p["recent_high_days"],
        p["secondary_breakout_days"], p["ma_very_long_days"],
        p["platform_low_days"], p["near_high_long_days"],
    ) + p["trend_lookback_days"]
    data = _technical_series(bars, minimum)
    if not data:
        return None
    c, h, l = data["close"], data["high"], data["low"]
    ma20 = _ma(c, p["ma_short_days"])
    ma120 = _ma(c, p["ma_mid_days"])
    ma200 = _ma(c, p["ma_long_days"])
    ma250 = _ma(c, p["ma_very_long_days"])
    i = len(c) - 1
    rps50, rps120 = rps["rps50"], rps["rps120"]

    fyx11 = rps50 > p["rps50_min"]
    fyx12 = rps120 > p["rps120_min"]
    fyx130 = rps50 >= p["breakout_rps_min"] or rps120 >= p["breakout_rps_min"]
    fyx131 = c[i] >= _hhv(c, p["close_breakout_days"])
    fyx13 = fyx130 and fyx131
    fyx1 = fyx11 or fyx12

    fyx21 = _llv(l, 50) > _llv(l, 200) and fyx13
    fyx22 = _llv(l, 30) > _llv(l, 120) and fyx13
    fyx23 = _llv(l, 20) > _llv(l, 50) and _llv(l, 10) > _llv(l, 20)
    fyx2 = fyx21 or fyx22 or fyx23

    nh80 = [h[j] >= _hhv(h, p["recent_high_days"], j) for j in range(len(h))]
    fyx31 = _count_last(nh80, p["recent_high_window"]) > 0
    fyx32 = (
        c[i] >= _hhv(c, p["secondary_breakout_days"])
        or h[i] >= _hhv(h, p["secondary_breakout_days"])
    ) and fyx130
    fyx3 = fyx31 or fyx32

    fyx4 = (
        c[i] > ma20[i]
        and c[i] > ma200[i]
        and ma120[i] / ma200[i] > p["ma_ratio_min"]
    )
    above200 = [
        value is not None and c[index] > value
        for index, value in enumerate(ma200)
    ]
    low_below200 = [
        value is not None and l[index] < value
        for index, value in enumerate(ma200)
    ]
    aa200 = _count_last(above200, p["ma_above_window"])
    laa200 = _count_last(low_below200, p["ma_above_window"])
    fyx51 = p["ma_above_min_days"] < aa200 < p["ma_above_window"]
    fyx52 = laa200 > 0 and aa200 > p["ma_above_min_days"]
    fyx5 = fyx51 or fyx52

    trend_ref = p["trend_lookback_days"]
    fyx601 = ma120[i] >= ma120[i - trend_ref] or ma200[i] >= ma200[i - trend_ref]
    fyx602 = ma120[i] >= ma120[i - trend_ref] and ma200[i] >= ma200[i - trend_ref]
    fyx603 = ma120[i] > ma200[i] and ma200[i] > ma250[i]
    ratio = _hhv(h, p["platform_high_days"]) / _llv(l, p["platform_low_days"])
    fyx61 = ratio < p["platform_ratio_1"] and fyx601
    fyx62 = ratio < p["platform_ratio_2"] and fyx602
    fyx63 = ratio < p["platform_ratio_3"] and fyx603 and fyx13
    fyx6 = fyx61 or fyx62 or fyx63

    near_high_ratio = _hhv(h, p["near_high_short_days"]) / _hhv(h, p["near_high_long_days"])
    fyx71 = near_high_ratio > p["near_high_ratio_1"]
    fyx72 = near_high_ratio > p["near_high_ratio_2"] and fyx13
    fyx73 = c[i] / _hhv(h, p["close_near_high_days"]) > p["close_near_high_ratio"]
    fyx7 = (fyx71 or fyx72) and fyx73
    signal_results = {
        "FYX11": fyx11, "FYX12": fyx12, "FYX13": fyx13,
        "FYX21": fyx21, "FYX22": fyx22, "FYX23": fyx23,
        "FYX31": fyx31, "FYX32": fyx32, "FYX51": fyx51, "FYX52": fyx52,
        "FYX61": fyx61, "FYX62": fyx62, "FYX63": fyx63,
        "FYX71": fyx71, "FYX72": fyx72, "FYX73": fyx73,
        "FYX1": fyx1, "FYX2": fyx2, "FYX3": fyx3, "FYX4": fyx4,
        "FYX5": fyx5, "FYX6": fyx6, "FYX7": fyx7,
    }
    matched = quant_formula.evaluate_expression(
        config["technical_expression"],
        quant_formula.allowed_signals("monthly_reversal_62"),
        signal_results,
    )
    signals = [fyx1, fyx2, fyx3, fyx4, fyx5, fyx6, fyx7]
    return {
        "matched": matched,
        "signal_results": signal_results,
        "strategy_detail": "FYX1–FYX7：" + " / ".join("✓" if value else "×" for value in signals),
        "close": round(c[i], 3),
        "year_high": round(_hhv(h, 250), 3),
        "distance_to_high_pct": round(max(0.0, (_hhv(h, 250) - c[i]) / _hhv(h, 250) * 100), 3),
    }


def growth_mrgc_sxhcg(
    bars: list[dict], rps: dict, turnover_pct: float | None,
    formula_config: dict | None = None,
) -> dict | None:
    config = formula_config or quant_formula.normalize_formula("growth_mrgc_sxhcg")
    p = config["params"]
    minimum = max(280, 250 + p["above_ma_window"], 20 + p["ma_trend_days"])
    data = _technical_series(bars, minimum)
    if not data or turnover_pct is None:
        return None
    c, h, l = data["close"], data["high"], data["low"]
    ma10, ma20, ma200, ma250 = data["ma10"], data["ma20"], data["ma200"], data["ma250"]
    i = len(c) - 1
    rps50, rps120, rps250 = rps["rps50"], rps["rps120"], rps["rps250"]
    drawdown120 = _drawdown_from_recent_high(h, l, 120)
    drawdown20 = _drawdown_from_recent_high(h, l, 20)
    mrgc001 = drawdown120 <= p["drawdown120_max_pct"] / 100
    mrgc002 = c[i] / _hhv(c, 250) > p["year_ratio_1"]
    mrgc003 = drawdown120 <= p["drawdown120_strict_pct"] / 100
    mrgc004 = c[i] / _hhv(c, 250) > p["year_ratio_2"]
    mrgc_hc = mrgc003 and mrgc004

    close_new_high = [
        math.isclose(c[j], _hhv(c, 250, j), rel_tol=0, abs_tol=1e-8)
        for j in range(len(c))
    ]
    xg1 = (
        _count_last(close_new_high, 5) >= 1
        and (
            (rps120 >= p["rps_xg1_or_min"] or rps250 >= p["rps_xg1_or_min"])
            or (rps120 >= p["rps_xg1_and_min"] and rps50 >= p["rps_xg1_and_min"])
        )
    )
    xg2 = c[i] / _hhv(h, 250) >= p["year_ratio_3"] and (
        rps120 >= p["rps_xg2_min"] or rps250 >= p["rps_xg2_min"]
    )
    xg3 = c[i] / _hhv(h, 250) >= p["year_ratio_1"] and (
        rps120 >= p["rps_xg3_min"] or rps250 >= p["rps_xg3_min"]
    )
    xg4 = mrgc_hc and (
        rps120 >= p["rps_xg4_min"] or rps250 >= p["rps_xg4_min"]
    )
    mrgc00 = turnover_pct < p["mrgc_turnover_max_pct"]
    mrgc = mrgc00 and mrgc001 and mrgc002 and (xg1 or xg2 or xg3 or xg4)

    above250 = [value is not None and c[j] > value for j, value in enumerate(ma250)]
    above200 = [value is not None and c[j] > value for j, value in enumerate(ma200)]
    above20 = [value is not None and c[j] > value for j, value in enumerate(ma20)]
    above10 = [value is not None and c[j] > value for j, value in enumerate(ma10)]
    sxhcg1 = rps120 + rps250 > p["rps_sum_min"]
    sxhcg2 = (
        c[i] > ma20[i]
        and _count_last(above250, p["above_ma_window"]) >= p["above_ma_min_days"]
        and _count_last(above200, p["above_ma_window"]) >= p["above_ma_min_days"]
        and (
            _count_last(above20, p["above20_window"]) >= p["above20_min_days"]
            or (
                _count_last(above10, p["recent_ma_window"]) >= p["recent_ma_min_days"]
                and _count_last(above20, p["recent_ma_window"]) >= p["recent_ma_min_days"]
            )
        )
    )
    sxhcg3 = drawdown20 <= p["drawdown20_max_pct"] / 100 and c[i] / _hhv(c, 250) > p["year_ratio_2"]
    trend_days = p["ma_trend_days"]
    sxhcg411 = all(
        ma20[j] is not None and ma20[j - 1] is not None and ma20[j] >= ma20[j - 1]
        for j in range(i - trend_days + 1, i + 1)
    )
    sxhcg412 = all(
        ma10[j] is not None and ma20[j] is not None and ma10[j] >= ma20[j]
        for j in range(i - trend_days + 1, i + 1)
    )
    sxhcg41 = sxhcg411 and sxhcg412
    sxhcg42 = ma10[i] >= ma10[i - 1] and ma20[i] >= ma20[i - 1] and ma10[i] >= ma20[i]
    sxhcg4 = sxhcg41 or sxhcg42
    sxhcg5 = turnover_pct < p["sxhcg_turnover_max_pct"]
    sxhcg6 = mrgc001
    sxhcg = sxhcg1 and sxhcg2 and sxhcg3 and sxhcg4 and sxhcg5 and sxhcg6
    signal_results = {
        "MRGC00": mrgc00, "MRGC001": mrgc001, "MRGC002": mrgc002,
        "MRGC003": mrgc003, "MRGC004": mrgc004, "MRGC_HC": mrgc_hc,
        "XG1": xg1, "XG2": xg2, "XG3": xg3, "XG4": xg4, "MRGC": mrgc,
        "SXHCG1": sxhcg1, "SXHCG2": sxhcg2, "SXHCG3": sxhcg3,
        "SXHCG4": sxhcg4, "SXHCG5": sxhcg5, "SXHCG6": sxhcg6,
        "SXHCG": sxhcg,
    }
    technical_candidate = quant_formula.evaluate_expression(
        config["technical_expression"],
        quant_formula.allowed_signals("growth_mrgc_sxhcg"),
        signal_results,
    )
    return {
        "technical_candidate": technical_candidate,
        "mrgc": mrgc,
        "sxhcg": sxhcg,
        "signal_results": signal_results,
        "strategy_detail": f"MRGC={'✓' if mrgc else '×'} / SXHCG={'✓' if sxhcg else '×'}",
        "turnover_pct": round(turnover_pct, 3),
        "drawdown120_pct": round(drawdown120 * 100, 3),
        "close": round(c[i], 3),
        "year_high": round(_hhv(h, 250), 3),
        "distance_to_high_pct": round(max(0.0, (_hhv(h, 250) - c[i]) / _hhv(h, 250) * 100), 3),
    }


def _batch_quotes(codes: list[str]) -> dict[str, dict]:
    quotes: dict[str, dict] = {}
    for start in range(0, len(codes), 80):
        try:
            quotes.update(astock.tencent_quote(codes[start:start + 80]))
        except Exception:
            continue
    return quotes


def _daily_bar_records(code: str, offset: int) -> list[dict]:
    try:
        frame = _thread_client().bars(symbol=code, frequency=4, offset=offset)
    except Exception:  # noqa: BLE001 — 线程连接失效时重建一次
        _reset_thread_client()
        frame = _thread_client().bars(symbol=code, frequency=4, offset=offset)
    return frame.to_dict("records") if frame is not None and not frame.empty else []


def _financial_growth(code: str) -> dict:
    key = ("quant-financial-growth", code)
    cached = _cache_get(key, _BASE_TTL)
    if cached is not None:
        return cached
    data = astock.financials(code)
    result = {
        "financial_period": data.get("period"),
        "revenue_yoy_pct": _round(_percent(data.get("revenue_yoy"))),
        "net_profit_yoy_pct": _round(_percent(data.get("net_profit_yoy"))),
    }
    _cache_put(key, result)
    return result


def near_year_high(bars: list[dict], proximity_pct: float, lookback_days: int) -> dict | None:
    """计算通达信风格 `C >= HHV(H, N) * (1-p)`，纯逻辑、便于单测。"""
    valid = []
    for bar in bars[-lookback_days:]:
        high = _finite(bar.get("high"))
        close = _finite(bar.get("close"))
        if high is not None and close is not None and high > 0:
            valid.append((bar, high, close))
    required = min(200, lookback_days)
    if len(valid) < required:
        return None
    latest_bar, _, close = valid[-1]
    period_high = max(item[1] for item in valid)
    distance_pct = max(0.0, (period_high - close) / period_high * 100)
    return {
        "close": round(close, 3),
        "year_high": round(period_high, 3),
        "distance_to_high_pct": round(distance_pct, 3),
        "near_high": distance_pct <= proximity_pct,
        "history_days": len(valid),
        "technical_date": str(latest_bar.get("datetime") or "")[:10] or None,
    }


def _run_screen_named_signals(
    fund_ratio_min: float = 5.0,
    north_value_min_yi: float = 1.0,
    near_high_pct: float = 5.0,
    lookback_days: int = 250,
    fund_period: str | None = None,
    strategy: str = "near_high",
    formula: dict | None = None,
) -> dict:
    if strategy not in _STRATEGIES:
        raise ValueError(f"不支持的量化策略：{strategy}")

    compiled_formula = quant_formula.compile_formula(
        strategy,
        formula,
        legacy_near_high_pct=near_high_pct,
        legacy_lookback_days=lookback_days,
    )
    formula_config = compiled_formula.config
    formula_params = formula_config["params"]
    started = time.perf_counter()
    base = base_pool(fund_ratio_min, north_value_min_yi, fund_period)
    rps_data = rps_snapshot() if strategy != "near_high" else None
    rps_by_code = rps_data["stocks"] if rps_data else {}
    quotes = (
        _batch_quotes([row["code"] for row in base["rows"]])
        if strategy == "growth_mrgc_sxhcg"
        else {}
    )
    matched: list[dict] = []
    base_rows: list[dict] = []
    financial_candidates: list[dict] = []
    failures = 0
    latest_technical_date: str | None = None
    kline_days = quant_formula.required_history(strategy, formula_config)
    prepared: list[tuple[dict, dict | None]] = []
    for original in base["rows"]:
        row = dict(original)
        rps = rps_by_code.get(row["code"])
        if rps:
            row.update({key: value for key, value in rps.items() if key != "history"})
        if strategy == "growth_mrgc_sxhcg":
            row["turnover_pct"] = _finite((quotes.get(row["code"]) or {}).get("turnover_pct"))
        if strategy != "near_high" and not rps:
            failures += 1
            base_rows.append(row)
            continue
        prepared.append((row, rps))

    workers = max(2, min(12, int(os.environ.get("VR_SCREEN_WORKERS", "8"))))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_daily_bar_records, row["code"], kline_days): (row, rps)
            for row, rps in prepared
        }
        for future in as_completed(futures):
            row, rps = futures[future]
            try:
                bars = future.result()
            except Exception:  # noqa: BLE001 — 单只股票失败不应打断整个筛选
                failures += 1
                base_rows.append(row)
                continue
            try:
                if strategy == "near_high":
                    technical = near_year_high(
                        bars,
                        formula_params["max_distance_pct"],
                        formula_params["lookback_days"],
                    )
                    if technical:
                        technical["signal_results"] = {"NEAR_HIGH": technical["near_high"]}
                        is_match = quant_formula.evaluate_expression(
                            formula_config["technical_expression"],
                            quant_formula.allowed_signals("near_high"),
                            technical["signal_results"],
                        )
                        technical["matched"] = is_match
                    else:
                        is_match = False
                elif strategy == "monthly_reversal_62":
                    technical = monthly_reversal_62(bars, rps, formula_config)
                    is_match = bool(technical and technical["matched"])
                else:
                    technical = growth_mrgc_sxhcg(
                        bars, rps, row.get("turnover_pct"), formula_config,
                    )
                    is_match = False
                if not technical:
                    failures += 1
                    base_rows.append(row)
                    continue
                technical_date = str(bars[-1].get("datetime") or "")[:10] or None
                technical["technical_date"] = technical_date
                row.update(technical)

                if strategy == "growth_mrgc_sxhcg":
                    row.update({
                        "financial_period": None,
                        "revenue_yoy_pct": None,
                        "net_profit_yoy_pct": None,
                        "matched": False,
                    })
                    if technical["technical_candidate"]:
                        fundamental_names = quant_formula.expression_names(
                            formula_config["fundamental_expression"],
                        )
                        needs_financials = bool(
                            fundamental_names & {"REVENUE_YOY_OK", "NET_PROFIT_YOY_OK"}
                        )
                        if needs_financials:
                            financial_candidates.append(row)
                        else:
                            prefixes = tuple(formula_params["excluded_prefixes"])
                            fundamental_signals = {
                                "REVENUE_YOY_OK": False,
                                "NET_PROFIT_YOY_OK": False,
                                "NON_EXCLUDED_BOARD": not row["code"].startswith(prefixes),
                            }
                            row["signal_results"].update(fundamental_signals)
                            row["matched"] = quant_formula.evaluate_expression(
                                formula_config["fundamental_expression"],
                                quant_formula.allowed_signals("growth_mrgc_sxhcg", "fundamental"),
                                fundamental_signals,
                            )
                            if row["matched"]:
                                matched.append(dict(row))

                if technical["technical_date"] and (
                    latest_technical_date is None
                    or technical["technical_date"] > latest_technical_date
                ):
                    latest_technical_date = technical["technical_date"]
                if is_match:
                    matched.append(dict(row))
            except Exception:  # noqa: BLE001 — 单只公式求值失败不打断整个筛选
                failures += 1
            base_rows.append(row)

    if strategy == "growth_mrgc_sxhcg" and financial_candidates:
        workers = min(4, len(financial_candidates))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(_financial_growth, row["code"]): row
                for row in financial_candidates
            }
            for future in as_completed(futures):
                row = futures[future]
                try:
                    row.update(future.result())
                except Exception:  # noqa: BLE001 — 单股财务源失败只记为不匹配
                    failures += 1
                    continue
                revenue_yoy = row.get("revenue_yoy_pct")
                net_profit_yoy = row.get("net_profit_yoy_pct")
                prefixes = tuple(formula_params["excluded_prefixes"])
                fundamental_signals = {
                    "REVENUE_YOY_OK": bool(
                        revenue_yoy is not None
                        and revenue_yoy > formula_params["revenue_yoy_min_pct"]
                    ),
                    "NET_PROFIT_YOY_OK": bool(
                        net_profit_yoy is not None
                        and net_profit_yoy > formula_params["net_profit_yoy_min_pct"]
                    ),
                    "NON_EXCLUDED_BOARD": not row["code"].startswith(prefixes),
                }
                row["signal_results"].update(fundamental_signals)
                row["matched"] = quant_formula.evaluate_expression(
                    formula_config["fundamental_expression"],
                    quant_formula.allowed_signals("growth_mrgc_sxhcg", "fundamental"),
                    fundamental_signals,
                )
                if row["matched"]:
                    matched.append(dict(row))

    if strategy == "near_high":
        matched.sort(key=lambda row: (
            row["distance_to_high_pct"],
            -(row["fund_float_ratio_pct"] or 0),
            row["code"],
        ))
    else:
        matched.sort(key=lambda row: (
            -((row.get("rps120") or 0) + (row.get("rps250") or 0)),
            row.get("distance_to_high_pct") or 0,
            row["code"],
        ))

    rps_meta = None
    if rps_data:
        rps_meta = {
            key: rps_data[key]
            for key in (
                "trade_date", "universe_count", "eligible_count",
                "excluded_short_history_count", "rule",
            )
        }
    return {
        "strategy": strategy,
        "strategy_label": _STRATEGIES[strategy],
        "criteria": {
            "fund_ratio_min": fund_ratio_min,
            "north_value_min_yi": north_value_min_yi,
            "near_high_pct": formula_params.get("max_distance_pct", near_high_pct),
            "lookback_days": formula_params.get("lookback_days", kline_days),
            "tdx_formula": (
                f"(FUND_FREE_RATIO >= {fund_ratio_min:g} OR "
                f"NORTH_HOLD_VALUE >= {north_value_min_yi:g}亿)；基础池内执行："
                f"{formula_config['technical_expression']}"
            ),
            "effective_formula": compiled_formula.effective,
            "formula_hash": compiled_formula.hash,
            "formula_config": formula_config,
        },
        "rps_meta": rps_meta,
        "fund_period": base["fund_period"],
        "north_period": base["north_period"],
        "technical_date": latest_technical_date,
        "fund_candidate_count": base["fund_candidate_count"],
        "north_candidate_count": base["north_candidate_count"],
        "overlap_count": base["overlap_count"],
        "base_count": base["base_count"],
        "matched_count": len(matched),
        "technical_failure_count": failures,
        "elapsed_seconds": round(time.perf_counter() - started, 2),
        "north_disclosure_note": (
            "北向个股持仓自2024-08-19起改为季度披露；这里使用港交所最新季度末持股数量，"
            "再按腾讯最新行情估算持股市值，不是每日更新的持仓数量。"
        ),
        "base_rows": base_rows,
        "rows": matched,
    }


def _tdx_formula_hash(source: str) -> str:
    normalized = source.replace("\r\n", "\n").strip() + "\n"
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]


def _tdx_capital_from_turnover(bars: list[dict], turnover_pct: float | None) -> float | None:
    """用最新换手率反推通达信 CAPITAL 单位，使 VOL/CAPITAL*100 与行情一致。"""
    if not bars or turnover_pct is None or turnover_pct <= 0:
        return None
    latest = bars[-1]
    volume = _finite(latest.get("vol") if latest.get("vol") is not None else latest.get("volume"))
    return volume * 100 / turnover_pct if volume is not None and volume > 0 else None


def _tdx_evaluation_bars(bars: list[dict]) -> list[dict]:
    """保留既有顺序；测试桩没有唯一日期时去掉日期元数据再交给解释器。"""
    dates = [str(bar.get("datetime") or bar.get("date") or "") for bar in bars]
    if all(dates) and any(current <= previous for previous, current in zip(dates, dates[1:])):
        return [
            {key: value for key, value in bar.items() if key not in {"datetime", "date"}}
            for bar in bars
        ]
    return bars


def _tdx_rps_for_bars(rps: dict | None, bars: list[dict]) -> dict | None:
    """将最近RPS横截面历史按K线日期对齐，供REF/BARSSINCEN等历史公式使用。"""
    if not rps or not rps.get("history"):
        return rps
    history = {item.get("trade_date"): item for item in rps["history"]}
    result: dict[str, list[float | None]] = {
        "rps20": [], "rps50": [], "rps120": [], "rps250": [],
    }
    for bar in bars:
        trade_date = str(bar.get("datetime") or bar.get("date") or "")[:10]
        point = history.get(trade_date) or {}
        for key in result:
            result[key].append(_finite(point.get(key)))
    return result


def _tdx_apply_evaluation(row: dict, bars: list[dict], evaluation: dict) -> None:
    variables = evaluation.get("variables") or {}
    upper_variables = {str(key).upper(): value for key, value in variables.items()}
    row["matched"] = bool(evaluation.get("matched"))
    row["signal_results"] = {
        str(key): bool(value)
        for key, value in variables.items()
        if value is not None
    }
    if "MRGC" in upper_variables or "SXHCG" in upper_variables:
        mrgc = bool(upper_variables.get("MRGC"))
        sxhcg = bool(upper_variables.get("SXHCG"))
        row.update({
            "mrgc": mrgc,
            "sxhcg": sxhcg,
            "strategy_detail": f"MRGC={'✓' if mrgc else '×'} / SXHCG={'✓' if sxhcg else '×'}",
        })
    elif all(f"FYX{index}" in upper_variables for index in range(1, 8)):
        signals = [bool(upper_variables[f"FYX{index}"]) for index in range(1, 8)]
        row["strategy_detail"] = "FYX1–FYX7：" + " / ".join("✓" if value else "×" for value in signals)
    else:
        outputs = evaluation.get("outputs") or []
        output = outputs[-1] if outputs else None
        output_name = (output or {}).get("name") or "最终条件"
        row["strategy_detail"] = f"{output_name}={'✓' if evaluation.get('matched') else '×'}"

    closes = _series(bars, "close")
    highs = _series(bars, "high")
    if closes and highs:
        close = closes[-1]
        period_high = max(highs[-min(250, len(highs)):])
        row.update({
            "close": round(close, 3),
            "year_high": round(period_high, 3),
            "distance_to_high_pct": round(max(0.0, (period_high - close) / period_high * 100), 3),
        })
    row["history_days"] = len(bars)
    row["technical_date"] = str(bars[-1].get("datetime") or "")[:10] or None


def _run_screen_tdx(
    *,
    fund_ratio_min: float,
    north_value_min_yi: float,
    fund_period: str | None,
    strategy: str,
    formula_source: str | None,
    progress_cb=None,
) -> dict:
    """执行通达信版量化筛选。

    ``progress_cb`` 为可选回调，签名 ``progress_cb(phase, done, total, message)``。
    目前分四阶段推送：
      - "basepool"：基金/北向基础池构建
      - "rps"     ：全市场 RPS 快照（仅当公式使用 RPS 函数）
      - "bars"    ：基础池逐股日 K 下载（最大头）
      - "finance" ：财务增长率二次校验（仅当公式使用 FINANCE 时）
    """
    def _emit(phase: str, done: int, total: int, message: str = "") -> None:
        if progress_cb is None:
            return
        try:
            progress_cb(phase, done, total, message)
        except Exception:  # noqa: BLE001 — 进度回调出错不影响选股
            pass

    if strategy not in _STRATEGIES:
        raise ValueError(f"不支持的量化策略：{strategy}")
    preset = tdx_presets.get_preset(strategy)
    source = formula_source if formula_source is not None else preset["default_source"]
    program = tdx_formula.compile_formula(source)
    formula_hash = _tdx_formula_hash(source)
    minimum_history = tdx_presets.effective_history(strategy, program)
    fetch_history = max(minimum_history, int(program.required_history))
    source_upper = source.upper()
    uses_capital = bool(re.search(r"(?<![A-Z0-9_])CAPITAL(?![A-Z0-9_])", source_upper))

    started = time.perf_counter()
    _emit("basepool", 0, 1, "正在拉取基金/北向基础池…")
    base = base_pool(fund_ratio_min, north_value_min_yi, fund_period)
    _emit("basepool", 1, 1, f"基础池命中 {base['base_count']} 只")

    rps_data: dict | None = None
    if program.uses_rps:
        # 优先使用后台预热的快照；若还没就绪，触发预热 + 等待一段时间（最多 5 分钟）
        _emit("rps", 0, 1, "正在等待 RPS 快照就绪…")
        prewarm = get_rps_prewarm_status()
        if not prewarm.get("ready"):
            trigger_rps_prewarm()
            deadline = time.time() + 5 * 60
            last_msg_at = 0.0
            while time.time() < deadline:
                cur = get_rps_prewarm_status()
                if cur.get("last_error") and not cur.get("ready"):
                    # 预热失败：降级走懒加载
                    _emit("rps", 0, 1, f"后台预热失败（{cur['last_error']}），切换到即时计算…")
                    break
                if cur.get("running"):
                    now = time.time()
                    if now - last_msg_at > 1.0:
                        elapsed = (now - (cur.get("started_at") or now))
                        _emit("rps", 0, 1, f"等待后台 RPS 预热（已 {elapsed:.0f}s）…")
                        last_msg_at = now
                    time.sleep(0.5)
                    continue
                # 没在跑、也没失败 —— 可能是上次失败/没排到；再触发一次兜底
                if not cur.get("ready"):
                    trigger_rps_prewarm()
                else:
                    break

        _emit("rps", 0, 1, "正在构建全市场 RPS 快照…")
        rps_data = rps_snapshot()
        _emit("rps", 1, 1, f"RPS 快照完成（{rps_data['eligible_count']} 只）")
    rps_by_code = rps_data["stocks"] if rps_data else {}
    quotes = (
        _batch_quotes([row["code"] for row in base["rows"]])
        if uses_capital else {}
    )
    matched: list[dict] = []
    base_rows: list[dict] = []
    financial_candidates: list[tuple[dict, list[dict], dict | None, float | None]] = []
    failures = 0
    runtime_error_sample: str | None = None
    latest_technical_date: str | None = None

    prepared: list[tuple[dict, dict | None]] = []
    for original in base["rows"]:
        row = dict(original)
        rps = rps_by_code.get(row["code"])
        if rps:
            row.update({key: value for key, value in rps.items() if key != "history"})
        if program.uses_rps and not rps:
            failures += 1
            base_rows.append(row)
            continue
        if uses_capital:
            row["turnover_pct"] = _finite((quotes.get(row["code"]) or {}).get("turnover_pct"))
        prepared.append((row, rps))

    workers = max(2, min(12, int(os.environ.get("VR_SCREEN_WORKERS", "8"))))
    total_bars = len(prepared)
    done_bars = 0
    _emit("bars", 0, total_bars, f"开始下载 {total_bars} 只个股的日 K…")
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_daily_bar_records, row["code"], fetch_history): (row, rps)
            for row, rps in prepared
        }
        for future in as_completed(futures):
            row, rps = futures[future]
            done_bars += 1
            # 每完成一只都推一次，便于前端细粒度更新；前端自己节流到 ~100ms。
            if done_bars == total_bars or done_bars % max(1, total_bars // 50) == 0:
                _emit("bars", done_bars, total_bars, f"日 K {done_bars}/{total_bars}")
            try:
                bars = future.result()
                if len(bars) < minimum_history:
                    raise tdx_formula.TdxFormulaEvaluationError(
                        f"K线不足：至少需要{minimum_history}日，实际{len(bars)}日",
                        code="insufficient_history",
                    )
                capital = _tdx_capital_from_turnover(bars, row.get("turnover_pct")) if uses_capital else None
                eval_bars = _tdx_evaluation_bars(bars)
                formula_rps = _tdx_rps_for_bars(rps, bars)
                if uses_capital and capital is None:
                    raise tdx_formula.TdxFormulaEvaluationError(
                        "公式使用 CAPITAL，但无法取得最新换手率/成交量",
                        code="missing_capital",
                    )

                if program.uses_finance:
                    # 用户给出的增长公式均为 FINANCE(43/44) 大于阈值。先用极大值
                    # 执行完整技术部分，只对可能命中的股票请求较慢的逐股财务源。
                    probe = program.evaluate(
                        eval_bars,
                        rps=formula_rps,
                        financial={"43": 1_000_000_000, "44": 1_000_000_000},
                        code=row["code"],
                        capital=capital,
                    )
                    _tdx_apply_evaluation(row, bars, probe)
                    row.update({
                        "matched": False,
                        "financial_period": None,
                        "revenue_yoy_pct": None,
                        "net_profit_yoy_pct": None,
                    })
                    if probe["matched"]:
                        financial_candidates.append((row, bars, rps, capital))
                else:
                    evaluation = program.evaluate(
                        eval_bars, rps=formula_rps, code=row["code"], capital=capital,
                    )
                    _tdx_apply_evaluation(row, bars, evaluation)
                    if evaluation["matched"]:
                        matched.append(dict(row))

                technical_date = row.get("technical_date")
                if technical_date and (latest_technical_date is None or technical_date > latest_technical_date):
                    latest_technical_date = technical_date
            except Exception as error:  # noqa: BLE001 — 单股数据异常不打断全池
                failures += 1
                if runtime_error_sample is None:
                    runtime_error_sample = str(error)
            base_rows.append(row)

    if financial_candidates:
        total_finance = len(financial_candidates)
        done_finance = 0
        _emit("finance", 0, total_finance, f"开始核对 {total_finance} 只候选的财务增长率…")
        finance_workers = min(6, len(financial_candidates))
        with ThreadPoolExecutor(max_workers=finance_workers) as executor:
            futures = {
                executor.submit(_financial_growth, row["code"]): (row, bars, rps, capital)
                for row, bars, rps, capital in financial_candidates
            }
            for future in as_completed(futures):
                row, bars, rps, capital = futures[future]
                done_finance += 1
                if done_finance == total_finance or done_finance % max(1, total_finance // 20) == 0:
                    _emit("finance", done_finance, total_finance, f"财务 {done_finance}/{total_finance}")
                try:
                    financial = future.result()
                    row.update(financial)
                    evaluation = program.evaluate(
                        _tdx_evaluation_bars(bars),
                        rps=_tdx_rps_for_bars(rps, bars),
                        financial={
                            "43": financial.get("net_profit_yoy_pct"),
                            "44": financial.get("revenue_yoy_pct"),
                        },
                        code=row["code"],
                        capital=capital,
                    )
                    _tdx_apply_evaluation(row, bars, evaluation)
                    if evaluation["matched"]:
                        matched.append(dict(row))
                except Exception as error:  # noqa: BLE001
                    failures += 1
                    if runtime_error_sample is None:
                        runtime_error_sample = str(error)

    matched.sort(key=lambda row: (
        -((row.get("rps120") or 0) + (row.get("rps250") or 0)),
        row.get("distance_to_high_pct") or 0,
        row["code"],
    ))
    if strategy == "near_high":
        matched.sort(key=lambda row: (
            row.get("distance_to_high_pct") or 0,
            -(row.get("fund_float_ratio_pct") or 0),
            row["code"],
        ))

    rps_meta = None
    if rps_data:
        rps_meta = {
            key: rps_data[key]
            for key in (
                "trade_date", "universe_count", "eligible_count",
                "excluded_short_history_count", "rule",
            )
        }
    return {
        "strategy": strategy,
        "strategy_label": _STRATEGIES[strategy],
        "criteria": {
            "fund_ratio_min": fund_ratio_min,
            "north_value_min_yi": north_value_min_yi,
            "lookback_days": fetch_history,
            "tdx_formula": (
                f"(FUND_FREE_RATIO >= {fund_ratio_min:g} OR "
                f"NORTH_HOLD_VALUE >= {north_value_min_yi:g}亿)；基础池内执行当前通达信源码"
            ),
            "formula_source": source,
            "formula_hash": formula_hash,
            "required_history": fetch_history,
            "minimum_history": minimum_history,
            "used_functions": list(program.used_functions),
            "uses_rps": program.uses_rps,
            "uses_finance": program.uses_finance,
            "uses_capital": uses_capital,
            "runtime_error_sample": runtime_error_sample,
        },
        "rps_meta": rps_meta,
        "fund_period": base["fund_period"],
        "north_period": base["north_period"],
        "technical_date": latest_technical_date,
        "fund_candidate_count": base["fund_candidate_count"],
        "north_candidate_count": base["north_candidate_count"],
        "overlap_count": base["overlap_count"],
        "base_count": base["base_count"],
        "matched_count": len(matched),
        "technical_failure_count": failures,
        "elapsed_seconds": round(time.perf_counter() - started, 2),
        "north_disclosure_note": (
            "北向个股持仓自2024-08-19起改为季度披露；这里使用港交所最新季度末持股数量，"
            "再按腾讯最新行情估算持股市值，不是每日更新的持仓数量。"
        ),
        "base_rows": base_rows,
        "rows": matched,
    }


def run_screen(
    fund_ratio_min: float = 5.0,
    north_value_min_yi: float = 1.0,
    near_high_pct: float = 5.0,
    lookback_days: int = 250,
    fund_period: str | None = None,
    strategy: str = "near_high",
    formula: dict | None = None,
    formula_source: str | None = None,
    progress_cb=None,
) -> dict:
    """执行量化筛选。

    ``formula_source`` 是当前页面使用的通达信兼容源码；旧版结构化 ``formula``
    仍保留兼容，避免已有调用方突然失效。
    ``progress_cb`` 是可选的进度回调，签名 ``progress_cb(phase, done, total, message)``。
    """
    if formula is not None and formula_source is None:
        return _run_screen_named_signals(
            fund_ratio_min=fund_ratio_min,
            north_value_min_yi=north_value_min_yi,
            near_high_pct=near_high_pct,
            lookback_days=lookback_days,
            fund_period=fund_period,
            strategy=strategy,
            formula=formula,
        )
    return _run_screen_tdx(
        fund_ratio_min=fund_ratio_min,
        north_value_min_yi=north_value_min_yi,
        fund_period=fund_period,
        strategy=strategy,
        formula_source=formula_source,
        progress_cb=progress_cb,
    )

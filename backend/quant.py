"""量化选股：机构持仓基础池 + 通达信技术条件。

数据口径：
  - 基金持仓：东方财富主力数据，季度报告，使用占流通股比例。
  - 北向持股：港交所官方沪深股通持股记录（季度披露）+ 腾讯最新行情估算市值。
  - 技术条件：mootdx / 通达信日 K，默认 C >= HHV(H, 250) * 95%。

本模块只执行用户明确设置的客观条件，不提供买卖建议或收益预测。
"""

from __future__ import annotations

import math
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

_FUND_URL = "https://data.eastmoney.com/dataapi/zlsj/list"
_HKEX_URL = "https://www3.hkexnews.hk/sdw/search/mutualmarket_c.aspx"
_HEADERS = {
    "User-Agent": astock.UA,
    "Referer": "https://data.eastmoney.com/",
}
_CACHE: dict[tuple, tuple[float, Any]] = {}
_CACHE_LOCK = threading.RLock()
_BASE_TTL = 6 * 3600
_THREAD_LOCAL = threading.local()
_RPS_CACHE_DIR = Path(__file__).with_name(".cache")
_RPS_VERSION = 1
_RPS_PERIODS = (50, 120, 250)
_STRATEGIES = {
    "near_high": "接近一年新高",
    "monthly_reversal_62": "月线反转 6.2",
    "growth_mrgc_sxhcg": "RPS 高成长（MRGC / SXHCG）",
}


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
    key = ("hs-a-universe",)
    cached = _cache_get(key, 24 * 3600)
    if cached:
        return cached
    client = astock._mootdx_client()
    tasks = []
    for market in (0, 1):
        count = int(client.stock_count(market=market) or 0)
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


def _rps_history(stock: dict) -> dict | None:
    code = stock["code"]
    try:
        frame = _thread_client().bars(symbol=code, frequency=4, offset=251)
        if frame is None or frame.empty or len(frame) < 251:
            return None
        closes = [_finite(value) for value in frame["close"].tolist()]
        if any(value is None or value <= 0 for value in closes):
            return None
        current = closes[-1]
        returns = {
            period: current / closes[-period - 1] - 1
            for period in _RPS_PERIODS
        }
        return {
            "code": code,
            "name": stock["name"],
            "trade_date": str(frame.iloc[-1].get("datetime") or "")[:10],
            "returns": returns,
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
        average_rank = ((index + 1) + (end + 1)) / 2
        percentile = round(average_rank / count * 100, 2)
        for cursor in range(index, end + 1):
            ranks[ordered[cursor]["code"]] = percentile
        index = end + 1
    return ranks


def rps_snapshot() -> dict:
    """构建/读取当日 RPS50/120/250 全市场快照。

    只有至少 251 根有效日 K 的沪深 A 股进入三个 RPS 的共同样本，等价于先
    剔除上市约一年内的新股，再按 50/120/250 日涨幅计算横截面百分位。
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

    rank_maps = {period: _percentile_ranks(histories, period) for period in _RPS_PERIODS}
    stocks = {}
    for item in histories:
        code = item["code"]
        stocks[code] = {
            "name": item["name"],
            "rps50": rank_maps[50][code],
            "rps120": rank_maps[120][code],
            "rps250": rank_maps[250][code],
            "return50_pct": round(item["returns"][50] * 100, 3),
            "return120_pct": round(item["returns"][120] * 100, 3),
            "return250_pct": round(item["returns"][250] * 100, 3),
        }
    snapshot = {
        "version": _RPS_VERSION,
        "trade_date": trade_date,
        "universe_count": len(universe),
        "eligible_count": len(histories),
        "excluded_short_history_count": len(universe) - len(histories),
        "rule": "沪深A股统一剔除不足251根日K的上市一年内新股，再计算RPS50/120/250",
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


def monthly_reversal_62(bars: list[dict], rps: dict) -> dict | None:
    data = _technical_series(bars, 250)
    if not data:
        return None
    c, h, l = data["close"], data["high"], data["low"]
    ma20, ma120, ma200, ma250 = data["ma20"], data["ma120"], data["ma200"], data["ma250"]
    i = len(c) - 1
    rps50, rps120 = rps["rps50"], rps["rps120"]

    fyx11 = rps50 > 87
    fyx12 = rps120 > 90
    fyx130 = rps50 >= 90 or rps120 >= 90
    fyx131 = c[i] >= _hhv(c, 70)
    fyx13 = fyx130 and fyx131
    fyx1 = fyx11 or fyx12

    fyx21 = _llv(l, 50) > _llv(l, 200) and fyx13
    fyx22 = _llv(l, 30) > _llv(l, 120) and fyx13
    fyx23 = _llv(l, 20) > _llv(l, 50) and _llv(l, 10) > _llv(l, 20)
    fyx2 = fyx21 or fyx22 or fyx23

    nh80 = [h[j] >= _hhv(h, 80, j) for j in range(len(h))]
    fyx31 = _count_last(nh80, 10) > 0
    fyx32 = (c[i] >= _hhv(c, 50) or h[i] >= _hhv(h, 50)) and fyx130
    fyx3 = fyx31 or fyx32

    fyx4 = (
        c[i] > ma20[i]
        and c[i] > ma200[i]
        and ma120[i] / ma200[i] > 0.9
    )
    above200 = [
        value is not None and c[index] > value
        for index, value in enumerate(ma200)
    ]
    low_below200 = [
        value is not None and l[index] < value
        for index, value in enumerate(ma200)
    ]
    aa200 = _count_last(above200, 45)
    laa200 = _count_last(low_below200, 45)
    fyx51 = 2 < aa200 < 45
    fyx52 = laa200 > 0 and aa200 > 2
    fyx5 = fyx51 or fyx52

    fyx601 = ma120[i] >= ma120[i - 15] or ma200[i] >= ma200[i - 15]
    fyx602 = ma120[i] >= ma120[i - 15] and ma200[i] >= ma200[i - 15]
    fyx603 = ma120[i] > ma200[i] and ma200[i] > ma250[i]
    ratio = _hhv(h, 30) / _llv(l, 120)
    fyx61 = ratio < 1.50 and fyx601
    fyx62 = ratio < 1.60 and fyx602
    fyx63 = ratio < 1.75 and fyx603 and fyx13
    fyx6 = fyx61 or fyx62 or fyx63

    fyx71 = _hhv(h, 5) / _hhv(h, 120) > 0.85
    fyx72 = _hhv(h, 5) / _hhv(h, 120) > 0.8 and fyx13
    fyx73 = c[i] / _hhv(h, 10) > 0.9
    fyx7 = (fyx71 or fyx72) and fyx73
    signals = [fyx1, fyx2, fyx3, fyx4, fyx5, fyx6, fyx7]
    return {
        "matched": all(signals),
        "strategy_detail": "FYX1–FYX7：" + " / ".join("✓" if value else "×" for value in signals),
        "close": round(c[i], 3),
        "year_high": round(_hhv(h, 250), 3),
        "distance_to_high_pct": round(max(0.0, (_hhv(h, 250) - c[i]) / _hhv(h, 250) * 100), 3),
    }


def growth_mrgc_sxhcg(
    bars: list[dict], rps: dict, turnover_pct: float | None,
) -> dict | None:
    data = _technical_series(bars, 280)
    if not data or turnover_pct is None:
        return None
    c, h, l = data["close"], data["high"], data["low"]
    ma10, ma20, ma200, ma250 = data["ma10"], data["ma20"], data["ma200"], data["ma250"]
    i = len(c) - 1
    rps50, rps120, rps250 = rps["rps50"], rps["rps120"], rps["rps250"]
    drawdown120 = _drawdown_from_recent_high(h, l, 120)
    drawdown20 = _drawdown_from_recent_high(h, l, 20)
    mrgc001 = drawdown120 <= 0.5
    mrgc002 = c[i] / _hhv(c, 250) > 0.7
    mrgc003 = drawdown120 <= 0.35
    mrgc004 = c[i] / _hhv(c, 250) > 0.8
    mrgc_hc = mrgc003 and mrgc004

    close_new_high = [
        math.isclose(c[j], _hhv(c, 250, j), rel_tol=0, abs_tol=1e-8)
        for j in range(len(c))
    ]
    xg1 = (
        _count_last(close_new_high, 5) >= 1
        and ((rps120 > 95.99 or rps250 > 95.99) or (rps120 > 94.99 and rps50 > 94.99))
    )
    xg2 = c[i] / _hhv(h, 250) >= 0.85 and (rps120 > 96.99 or rps250 > 96.99)
    xg3 = c[i] / _hhv(h, 250) >= 0.70 and (rps120 > 97.99 or rps250 > 97.99)
    xg4 = mrgc_hc and (rps120 > 94.99 or rps250 > 94.99)
    mrgc = turnover_pct < 25 and mrgc001 and mrgc002 and (xg1 or xg2 or xg3 or xg4)

    above250 = [value is not None and c[j] > value for j, value in enumerate(ma250)]
    above200 = [value is not None and c[j] > value for j, value in enumerate(ma200)]
    above20 = [value is not None and c[j] > value for j, value in enumerate(ma20)]
    above10 = [value is not None and c[j] > value for j, value in enumerate(ma10)]
    sxhcg1 = rps120 + rps250 > 185
    sxhcg2 = (
        c[i] > ma20[i]
        and _count_last(above250, 30) >= 25
        and _count_last(above200, 30) >= 25
        and (
            _count_last(above20, 10) >= 9
            or (_count_last(above10, 4) >= 3 and _count_last(above20, 4) >= 3)
        )
    )
    sxhcg3 = drawdown20 <= 0.25 and c[i] / _hhv(c, 250) > 0.8
    sxhcg411 = all(
        ma20[j] is not None and ma20[j - 1] is not None and ma20[j] >= ma20[j - 1]
        for j in range(i - 4, i + 1)
    )
    sxhcg412 = all(
        ma10[j] is not None and ma20[j] is not None and ma10[j] >= ma20[j]
        for j in range(i - 4, i + 1)
    )
    sxhcg41 = sxhcg411 and sxhcg412
    sxhcg42 = ma10[i] >= ma10[i - 1] and ma20[i] >= ma20[i - 1] and ma10[i] >= ma20[i]
    sxhcg4 = sxhcg41 or sxhcg42
    sxhcg = sxhcg1 and sxhcg2 and sxhcg3 and sxhcg4 and turnover_pct < 15 and mrgc001
    return {
        "technical_candidate": mrgc or sxhcg,
        "mrgc": mrgc,
        "sxhcg": sxhcg,
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


def run_screen(
    fund_ratio_min: float = 5.0,
    north_value_min_yi: float = 1.0,
    near_high_pct: float = 5.0,
    lookback_days: int = 250,
    fund_period: str | None = None,
    strategy: str = "near_high",
) -> dict:
    if strategy not in _STRATEGIES:
        raise ValueError(f"不支持的量化策略：{strategy}")

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
    kline_days = lookback_days if strategy == "near_high" else 320
    prepared: list[tuple[dict, dict | None]] = []
    for original in base["rows"]:
        row = dict(original)
        rps = rps_by_code.get(row["code"])
        if rps:
            row.update(rps)
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
                    technical = near_year_high(bars, near_high_pct, lookback_days)
                    is_match = bool(technical and technical["near_high"])
                elif strategy == "monthly_reversal_62":
                    technical = monthly_reversal_62(bars, rps)
                    is_match = bool(technical and technical["matched"])
                else:
                    technical = growth_mrgc_sxhcg(bars, rps, row.get("turnover_pct"))
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
                    if technical["technical_candidate"] and not row["code"].startswith("688"):
                        financial_candidates.append(row)

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
                row["matched"] = bool(
                    revenue_yoy is not None
                    and net_profit_yoy is not None
                    and revenue_yoy > 20
                    and net_profit_yoy > 40
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

    formulas = {
        "near_high": f"C >= HHV(H,{lookback_days}) * {1 - near_high_pct / 100:.4f}",
        "monthly_reversal_62": "YXFZ:=FYX1 AND FYX2 AND FYX3 AND FYX4 AND FYX5 AND FYX6 AND FYX7",
        "growth_mrgc_sxhcg": (
            "(SXHCG OR MRGC) AND FINANCE(44)>20 AND FINANCE(43)>40 "
            "AND NOT(CODELIKE('688'))"
        ),
    }
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
            "near_high_pct": near_high_pct,
            "lookback_days": lookback_days,
            "tdx_formula": (
                f"(FUND_FREE_RATIO >= {fund_ratio_min:g} OR "
                f"NORTH_HOLD_VALUE >= {north_value_min_yi:g}亿)；基础池内执行："
                f"{formulas[strategy]}"
            ),
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

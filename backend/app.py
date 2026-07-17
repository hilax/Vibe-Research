"""Vibe-Research 后端 —— A股数据层 HTTP 接口（FastAPI）。

端点全部在 /api 下，前端 vite 代理 /api → localhost:8900。
只读、无状态、按用户传入代码返回客观数据。不预置标的、不建议。

启动：
    uvicorn app:app --host 127.0.0.1 --port 8900
"""

from __future__ import annotations

import json
import hashlib
import os
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

import astock
import chat as chat_layer
import cli_runtime
import gstock
import newsradar
import portfolio as pf
import market
import myreports as mr
import quant
import quant_formula
import tdx_formula
import tdx_presets

app = FastAPI(title="Vibe-Research API", version="0.1.3")

# 每半小时后台刷新持仓数据
pf.start_scheduler(1800)

# 后台预热 RPS 全市场快照，让选股请求进来时永远命中热缓存。
# 默认 9:00 / 15:30 / 16:30 各触发一次；启动时也立刻跑一次。
# VR_RPS_PREWARM_TIMES="HH:MM,..." 自定义；VR_RPS_PREWARM=0 可关闭。
if os.environ.get("VR_RPS_PREWARM", "1") != "0":
    quant.start_rps_prewarm_scheduler()

# CORS：默认放开（本地自托管友好）；公网部署时用 VR_ALLOW_ORIGINS 收紧成白名单。
#   例：VR_ALLOW_ORIGINS="https://myhost"  （逗号分隔多个）
_ORIGINS = [o.strip() for o in os.environ.get("VR_ALLOW_ORIGINS", "*").split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# 可选鉴权：设了 VR_API_KEY 就要求所有 /api/* 带 `Authorization: Bearer <key>`
#   （本地自托管不设=开放；公网部署务必设，否则别人能读你的持仓/调你的后端）。
_API_KEY = os.environ.get("VR_API_KEY", "").strip()


@app.middleware("http")
async def _require_api_key(request: Request, call_next):
    if (
        _API_KEY
        and request.method != "OPTIONS"
        and request.url.path.startswith("/api/")
        and request.url.path != "/api/health"
    ):
        if request.headers.get("authorization", "") != f"Bearer {_API_KEY}":
            return JSONResponse({"detail": "未授权：缺少或错误的 API Key（VR_API_KEY）"}, status_code=401)
    return await call_next(request)

_CODE_RE = r"^\d{6}$"


def _validate(code: str) -> str:
    code = (code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    return code


@app.get("/api/health")
def health():
    return {"ok": True, "service": "vibe-research-api", "version": "0.1.3"}


class QuantScreenReq(BaseModel):
    strategy: Literal["near_high", "monthly_reversal_62", "growth_mrgc_sxhcg"] = "near_high"
    fund_ratio_min: float = Field(5.0, ge=0.1, le=100)
    north_value_min_yi: float = Field(1.0, ge=0, le=100000)
    near_high_pct: float = Field(5.0, ge=0, le=50)
    lookback_days: int = Field(250, ge=60, le=800)
    fund_period: str | None = Field(None, pattern=r"^\d{4}-(03-31|06-30|09-30|12-31)$")
    formula: dict[str, Any] | None = None
    formula_source: str | None = Field(None, max_length=100000)


class QuantFormulaValidateReq(BaseModel):
    strategy: Literal["near_high", "monthly_reversal_62", "growth_mrgc_sxhcg"] = "near_high"
    formula: dict[str, Any] | None = None
    source: str | None = Field(None, max_length=100000)
    # 兼容旧版“接近新高”页面：未提供 formula 时仍用这两个字段生成等价配置。
    near_high_pct: float = Field(5.0, ge=0, le=50)
    lookback_days: int = Field(250, ge=60, le=800)


def _formula_validation_detail(error: quant_formula.FormulaValidationError) -> dict:
    return {
        "code": "formula_validation_error",
        "message": str(error),
        "issues": error.issues,
    }


def _tdx_formula_validation_detail(error: tdx_formula.TdxFormulaError) -> dict:
    return {
        "code": "tdx_formula_validation_error",
        "message": str(error),
        "issues": error.issues,
    }


@app.get("/api/quant/formulas")
def quant_formulas():
    """返回可直接复制/粘贴的通达信源码预设，并保留旧版参数描述兼容。"""
    legacy = {item["strategy"]: item for item in quant_formula.strategy_presets()}
    items = []
    for item in tdx_presets.strategy_presets():
        old = legacy.get(item["strategy"], {})
        items.append({
            **item,
            "params": old.get("params", []),
            "allowed_technical_signals": old.get("allowed_technical_signals", []),
            "allowed_fundamental_signals": old.get("allowed_fundamental_signals", []),
            "default_formula": old.get("default_formula"),
        })
    return {"data": items}


@app.get("/api/quant/rps/status")
def quant_rps_status():
    """返回 RPS 后台预热状态。前端轮询或初始化时调用，决定是否走"等待预热"分支。"""
    return {"data": quant.get_rps_prewarm_status()}


@app.post("/api/quant/rps/prewarm")
def quant_rps_trigger_prewarm():
    """手动触发一次预热（如用户觉得数据过期）。后端去重，重复触发返回 running=True。"""
    thread = quant.trigger_rps_prewarm()
    return {"data": {"triggered": thread is not None, **quant.get_rps_prewarm_status()}}


@app.post("/api/quant/formula/validate")
def quant_formula_validate(req: QuantFormulaValidateReq):
    """仅编译并校验公式，不请求行情或触发耗时选股。"""
    if req.source is not None:
        try:
            normalized = req.source.replace("\r\n", "\n").strip() + "\n"
            program = tdx_formula.compile_formula(normalized)
        except tdx_formula.TdxFormulaError as e:
            raise HTTPException(422, detail=_tdx_formula_validation_detail(e)) from e
        issues = []
        if "DRAWICON" in program.used_functions:
            issues.append({
                "code": "drawing_function_compatibility",
                "message": "DRAWICON 在选股中不绘图，其第一个条件参数作为公式结果。",
                "severity": "warning",
            })
        last_statement = program.statements[-1]
        minimum_history = tdx_presets.effective_history(req.strategy, program)
        return {
            "data": {
                "valid": True,
                "strategy": req.strategy,
                "normalized_source": normalized,
                "formula_hash": hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12],
                "required_history": max(minimum_history, program.required_history),
                "minimum_history": minimum_history,
                "used_functions": list(program.used_functions),
                "uses_rps": program.uses_rps,
                "uses_finance": program.uses_finance,
                "output_name": getattr(last_statement, "name", None),
                "issues": issues,
            }
        }
    try:
        compiled = quant_formula.compile_formula(
            req.strategy,
            req.formula,
            legacy_near_high_pct=req.near_high_pct,
            legacy_lookback_days=req.lookback_days,
        )
    except quant_formula.FormulaValidationError as e:
        raise HTTPException(422, detail=_formula_validation_detail(e)) from e
    return {
        "data": {
            "strategy": req.strategy,
            "normalized_formula": compiled.config,
            "formula_hash": compiled.hash,
            "effective_formula": compiled.effective,
        }
    }


@app.post("/api/quant/screen")
def quant_screen(req: QuantScreenReq):
    """基金/北向基础池，再叠加所选通达信技术公式。"""
    try:
        return {"data": quant.run_screen(**req.model_dump())}
    except tdx_formula.TdxFormulaError as e:
        raise HTTPException(422, detail=_tdx_formula_validation_detail(e)) from e
    except quant_formula.FormulaValidationError as e:
        raise HTTPException(422, detail=_formula_validation_detail(e)) from e
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except quant.QuantDataError as e:
        raise HTTPException(502, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"量化选股异常：{e}") from e


# ── 异步进度流式接口 ────────────────────────────────────────────────────────
# 设计：保留旧 /api/quant/screen 同步接口不变（兼容性），新前端使用 start + stream。
# - POST /api/quant/screen/start  → 立即返回 {job_id}，后端起后台线程跑选股。
# - GET  /api/quant/screen/{job_id}/stream  → NDJSON 流：
#     {type:"progress", phase, done, total, message, elapsed}
#     {type:"result",   data:{...与旧接口 data 字段一致...}}
#     {type:"error",    message}
#     {type:"done"}
import threading
import queue
import uuid
from typing import Any

_SCREEN_JOBS: dict[str, dict[str, Any]] = {}
_SCREEN_JOBS_LOCK = threading.Lock()
_SCREEN_JOB_TTL = 60 * 30  # 任务记录保留 30 分钟，便于前端断线重连复盘


class _QuantScreenJob:
    """单个异步选股任务：参数、事件队列、结果、状态。"""

    __slots__ = ("params", "events", "result", "error", "done", "started_at", "thread")

    def __init__(self, params: dict):
        self.params = params
        self.events: queue.Queue = queue.Queue(maxsize=1024)
        self.result: dict | None = None
        self.error: dict | None = None
        self.done = False
        self.started_at = time_module.time()
        self.thread: threading.Thread | None = None

    def push(self, event: dict) -> None:
        # 阻塞放行：选股主线程不要被反压拖慢
        try:
            self.events.put_nowait(event)
        except queue.Full:
            try:
                self.events.get_nowait()
            except queue.Empty:
                pass
            try:
                self.events.put_nowait(event)
            except queue.Full:
                pass


import time as time_module  # noqa: E402 — 局部导入避免与上方冲突


def _run_screen_job(job_id: str, req: QuantScreenReq) -> None:
    """后台线程：跑选股 + 通过 job.events 推送进度。"""
    job = _SCREEN_JOBS.get(job_id)
    if job is None:
        return

    def progress(phase: str, done: int, total: int, message: str) -> None:
        job.push({
            "type": "progress",
            "phase": phase,
            "done": int(done),
            "total": int(total),
            "message": message or "",
            "elapsed": round(time_module.time() - job.started_at, 2),
        })

    try:
        progress("validate", 0, 1, "正在校验通达信公式…")
        params = req.model_dump()
        # 进度回调只对 tdx 路径生效，旧 named_signals 没有内部进度，整体当 1 步推。
        result = quant.run_screen(progress_cb=progress, **params)
        job.result = result
        job.push({"type": "result", "data": result})
    except tdx_formula.TdxFormulaError as e:
        job.error = {"code": "tdx_formula_validation_error", "message": str(e), "issues": getattr(e, "issues", [])}
        job.push({"type": "error", **job.error})
    except quant_formula.FormulaValidationError as e:
        job.error = {"code": "formula_validation_error", "message": str(e), "issues": getattr(e, "issues", [])}
        job.push({"type": "error", **job.error})
    except astock.DependencyMissing as e:
        job.error = {"code": "dependency_missing", "message": str(e)}
        job.push({"type": "error", **job.error})
    except quant.QuantDataError as e:
        job.error = {"code": "data_error", "message": str(e)}
        job.push({"type": "error", **job.error})
    except Exception as e:  # noqa: BLE001
        job.error = {"code": "internal", "message": f"量化选股异常：{e}"}
        job.push({"type": "error", **job.error})
    finally:
        job.done = True
        job.push({"type": "done"})


def _gc_screen_jobs() -> None:
    """清理超时的任务记录，避免长期内存泄漏。"""
    now = time_module.time()
    with _SCREEN_JOBS_LOCK:
        stale = [jid for jid, job in _SCREEN_JOBS.items() if now - job.started_at > _SCREEN_JOB_TTL]
        for jid in stale:
            _SCREEN_JOBS.pop(jid, None)


@app.post("/api/quant/screen/start")
def quant_screen_start(req: QuantScreenReq):
    """启动异步选股，立即返回 job_id。前端随后通过 stream 端点拉取进度。"""
    _gc_screen_jobs()
    job_id = uuid.uuid4().hex
    job = _QuantScreenJob(req.model_dump())
    with _SCREEN_JOBS_LOCK:
        _SCREEN_JOBS[job_id] = job
    thread = threading.Thread(
        target=_run_screen_job, args=(job_id, req), name=f"quant-screen-{job_id[:6]}", daemon=True,
    )
    job.thread = thread
    thread.start()
    return {"data": {"job_id": job_id, "started_at": job.started_at}}


@app.get("/api/quant/screen/{job_id}/stream")
def quant_screen_stream(job_id: str, request: Request):
    """以 NDJSON 流推送 job_id 对应任务的进度与最终结果。"""
    with _SCREEN_JOBS_LOCK:
        job = _SCREEN_JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "job_id 不存在或已过期")

    def gen():
        # 客户端断开检测
        while True:
            try:
                event = job.events.get(timeout=15)
            except queue.Empty:
                # 心跳：防止中间代理/浏览器读超时
                yield json.dumps({"type": "heartbeat"}) + "\n"
                continue
            yield json.dumps(event, ensure_ascii=False) + "\n"
            if event.get("type") in ("done",):
                break

    return StreamingResponse(gen(), media_type="application/x-ndjson")


class LLMConfig(BaseModel):
    provider: str = ""       # cli-* = 订阅接入（调本机 CLI）；其余 = API 接入
    baseURL: str = ""        # 订阅接入时留空
    apiKey: str = ""         # 订阅接入时留空
    model: str


class ChatReq(BaseModel):
    messages: list[dict]
    context: str = ""
    llm: LLMConfig


@app.post("/api/chat")
def chat(req: ChatReq):
    """系统 AI 对话，**流式** NDJSON（每行一个事件 {type: tool|delta|done|error}）。

    - API 接入：OpenAI 兼容 function-calling，边流答案边推工具调用事件。
    - 订阅接入（provider=cli-*）：调本机已登录的 CLI，stdout 边出边流（数据靠 context）。
    配置错误（缺 key / 未装 CLI）走 HTTP 400；运行时错误走流内 error 事件。用户配置随请求传入，后端不持久化。
    """
    if not req.messages:
        raise HTTPException(400, "messages 不能为空")
    if not req.llm.model:
        raise HTTPException(400, "缺少模型配置，请先在「接入 AI」里选择")

    is_cli = req.llm.provider.startswith("cli-")
    if is_cli:
        kind = req.llm.provider[4:]
        if not cli_runtime.detect_cli(kind):
            raise HTTPException(400, f"未检测到「{kind}」对应的本机命令。请先安装并登录该 CLI，或改用「API 接入」。")
    elif not req.llm.apiKey or not req.llm.baseURL:
        raise HTTPException(400, "缺少 Base URL 或 API Key，请先在「接入 AI」里填写")

    cfg = req.llm.model_dump()

    def gen():
        try:
            events = (chat_layer.run_chat_cli_stream if is_cli else chat_layer.run_chat_stream)(cfg, req.messages, req.context)
            for ev in events:
                yield json.dumps(ev, ensure_ascii=False) + "\n"
        except Exception as e:  # noqa: BLE001 — 运行时错误以流内事件上报，不中断连接
            yield json.dumps({"type": "error", "message": f"对话失败：{e}"}, ensure_ascii=False) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


class HoldingIn(BaseModel):
    code: str
    shares: float
    cost: float


@app.get("/api/portfolio")
def portfolio_get():
    """持仓 + 实时盈亏（浮动盈亏红涨绿跌）。"""
    try:
        return {"data": pf.get_portfolio()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"持仓读取异常：{e}") from e


@app.post("/api/portfolio/holding")
def portfolio_add(h: HoldingIn):
    """加一笔持仓（同代码按加权平均成本合并）。存本地，不上传。"""
    code = (h.code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    if h.shares <= 0:
        raise HTTPException(400, "数量必须大于 0")
    # 成本价不限正负：融券 / 返息 / 摊薄后为负成本等情形按结果计算，用户想怎么输就怎么输。
    return {"data": pf.add_holding(code, h.shares, h.cost)}


@app.delete("/api/portfolio/holding")
def portfolio_remove(code: str = Query(...)):
    return {"data": pf.remove_holding(code.strip())}


# ---- 我的研报（用户上传自己的研报，存本地、不上传、不进开源仓库）----

class ReportIn(BaseModel):
    name: str
    content_b64: str


@app.get("/api/myreports")
def myreports_list():
    return {"data": mr.list_reports()}


@app.post("/api/myreports")
def myreports_upload(r: ReportIn):
    """上传一份研报（base64）→ 存本地 + 按文件名自动打行业标签。"""
    try:
        return {"data": mr.save_report(r.name, r.content_b64)}
    except mr.ReportError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/myreports/file/{rid}")
def myreports_file(rid: str):
    """下载/预览某份研报原文件。"""
    hit = mr.report_path(rid)
    if not hit:
        raise HTTPException(404, "研报不存在")
    path, name = hit
    return FileResponse(str(path), filename=name)


@app.delete("/api/myreports/{rid}")
def myreports_delete(rid: str):
    return {"data": {"ok": mr.delete_report(rid)}}


class CloseIn(BaseModel):
    code: str
    date: str
    price: float
    shares: float
    cost: float


@app.post("/api/portfolio/close")
def portfolio_close(c: CloseIn):
    """记一笔已清仓（已实现盈亏）。存本地。"""
    code = (c.code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    if c.price <= 0 or c.shares <= 0:
        raise HTTPException(400, "清仓价与股数必须大于 0")
    # 买入成本不限正负（同持仓录入）：按 (清仓价 - 成本) × 股数 的结果计算已实现盈亏。
    date = (c.date or "").strip()
    if not date:
        raise HTTPException(400, "请填清仓日期")
    from datetime import datetime
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "清仓日期格式应为 YYYY-MM-DD") from None
    return {"data": pf.close_position(code, date, c.price, c.shares, c.cost)}


@app.delete("/api/portfolio/close")
def portfolio_close_remove(index: int = Query(...)):
    return {"data": pf.remove_closed(index)}


@app.post("/api/portfolio/refresh")
def portfolio_refresh():
    """手动刷新：立即重拉行情算盈亏。"""
    try:
        return {"data": pf.get_portfolio()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"刷新失败：{e}") from e


@app.get("/api/radar")
def radar():
    """资讯雷达：12 赛道公开 RSS 资讯（读缓存，无缓存返回赛道骨架）。"""
    try:
        return {"data": newsradar.get_radar(force=False)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"资讯雷达异常：{e}") from e


@app.post("/api/radar/refresh")
def radar_refresh():
    """强制重抓全部 RSS 源（耗时约 20-40s），更新缓存。"""
    try:
        return {"data": newsradar.fetch_radar()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"资讯雷达刷新失败：{e}") from e


@app.get("/api/market/overview")
def market_overview():
    """市场情绪 + 板块资金流（板块/大盘级，全站共享缓存 5 分钟）。"""
    try:
        return {"data": market.get_overview()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"市场总览异常：{e}") from e


@app.get("/api/market/emotion")
def market_emotion():
    """短线情绪：连板梯队 / 最高连板 / 炸板率 / 封板率 / 晋级率 / 涨跌停家数。

    含连板梯队个股清单（code/name/连板数等）——2026-07-05 起如实展示客观公开榜单（东财同款），
    只呈现事实，不附推荐/评分/预测/买卖时机。全站共享缓存 5 分钟。
    """
    try:
        return {"data": market.get_short_term_emotion()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"短线情绪异常：{e}") from e


@app.get("/api/market/turnover-top")
def market_turnover_top():
    """全市场成交额榜 Top20（客观公开榜单数据，非推荐/非预测/不评分）。全站共享缓存 5 分钟。"""
    try:
        return {"data": market.get_turnover_top()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"成交额榜异常：{e}") from e


@app.get("/api/global/indices")
def global_indices():
    """全球指数快照（道指 / 标普500 / 纳斯达克 / 恒生 / 恒生科技）—— A 股看隔夜外围脸色。缓存 5 分钟。"""
    try:
        return {"data": market.get_global_indices()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"全球指数异常：{e}") from e


@app.get("/api/global/stock")
def global_stock(symbol: str = Query(..., min_length=1, max_length=16)):
    """美股 / 港股个股聚合：行情 + 关键财务指标（东财域内源）。symbol 如 AAPL / BABA / 00700。"""
    try:
        data = gstock.us_hk_stock(symbol.strip())
        if not data:
            raise HTTPException(404, f"未找到美股/港股代码「{symbol}」")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"美港股查询异常：{e}") from e


@app.get("/api/indices")
def indices():
    """A股大盘指数实时行情（上证/深证成指/创业板指/沪深300）。仅标准库。"""
    try:
        return {"data": astock.index_quote()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"指数行情异常：{e}") from e


@app.get("/api/quote")
def quote(codes: str = Query(..., description="逗号分隔的 6 位代码")):
    """实时行情：现价/涨跌/PE/PB/市值/换手/涨跌停。仅标准库，永远可用。"""
    lst = [c.strip() for c in codes.split(",") if c.strip()]
    if not lst or any(not c.isdigit() or len(c) != 6 for c in lst):
        raise HTTPException(400, "codes 必须是逗号分隔的 6 位数字")
    try:
        return {"data": astock.tencent_quote(lst)}
    except Exception as e:  # noqa: BLE001 — 边界统一兜底
        raise HTTPException(502, f"行情源异常：{e}") from e


import time as _time
_PCT_CACHE: dict = {}


@app.get("/api/valuation/percentile")
def valuation_percentile(code: str = Query(...)):
    """PE-TTM / PB 历史分位（近5年）。全站缓存 30 分钟/代码（历史序列日频、变化慢）。"""
    code = _validate(code)
    hit = _PCT_CACHE.get(code)
    if hit and _time.time() - hit[0] < 1800:
        return {"data": hit[1]}
    try:
        data = astock.valuation_percentile(code)
        _PCT_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"估值分位异常：{e}") from e


_ANN_CACHE: dict = {}


@app.get("/api/announcements")
def announcements(code: str = Query(...)):
    """个股近期公告（东财，仅 requests）。缓存 15 分钟/代码。"""
    code = _validate(code)
    hit = _ANN_CACHE.get(code)
    if hit and _time.time() - hit[0] < 900:
        return {"data": hit[1]}
    try:
        data = astock.announcements(code)
        _ANN_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"公告源异常：{e}") from e


_FIN_CACHE: dict = {}


@app.get("/api/financials")
def financials(code: str = Query(...)):
    """财务关键指标（同花顺财务摘要，最新报告期）。缓存 30 分钟/代码。"""
    code = _validate(code)
    hit = _FIN_CACHE.get(code)
    if hit and _time.time() - hit[0] < 1800:
        return {"data": hit[1]}
    try:
        data = astock.financials(code)
        _FIN_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"财务摘要异常：{e}") from e


@app.get("/api/valuation")
def valuation(code: str = Query(...)):
    """完整估值：行情 + 一致预期 + 前向PE/PEG/消化年数。"""
    code = _validate(code)
    try:
        return {"data": astock.full_valuation(code)}
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"估值计算异常：{e}") from e


@app.get("/api/reports")
def reports(code: str = Query(...), pages: int = Query(2, ge=1, le=5)):
    """个股研报列表（东财，含 PDF 链接）。仅需 requests。"""
    code = _validate(code)
    try:
        rows = astock.eastmoney_reports(code, max_pages=pages)
        for r in rows:
            r["pdfUrl"] = astock.pdf_url(r.get("infoCode", "")) if r.get("infoCode") else None
        return {"data": rows}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"研报源异常：{e}") from e


@app.get("/api/news")
def news(code: str = Query(...), limit: int = Query(20, ge=1, le=50)):
    """个股新闻（东财，需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.stock_news(code, limit=limit)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"新闻源异常：{e}") from e


@app.get("/api/info")
def info(code: str = Query(...)):
    """个股基本面：行业/股本/上市时间（需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.individual_info(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"基本面源异常：{e}") from e


@app.get("/api/disclosure")
def disclosure(code: str = Query(...)):
    """巨潮公告列表（需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.disclosure(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"公告源异常：{e}") from e


@app.get("/api/kline")
def kline(code: str = Query(...), category: int = Query(4), offset: int = Query(60, ge=1, le=800)):
    """K线（需 mootdx）。category 4=日 5=周 6=月 11=60分钟。"""
    code = _validate(code)
    try:
        return {"data": astock.kline(code, category=category, offset=offset)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"K线源异常：{e}") from e


@app.get("/api/finance")
def finance(code: str = Query(...)):
    """季报财务快照（需 mootdx）。"""
    code = _validate(code)
    try:
        return {"data": astock.finance(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"财务源异常：{e}") from e


# ---------------------------------------------------------------------------
# 资金面 / 筹码 / 信号（东财数据中心，v3.3 并入）—— 均为「用户查的那只股」的公开数据。
# 东财有 1s 限流，这些多为日/季级静态数据，统一走 30 分钟缓存，进一步降低被封风险。
# ---------------------------------------------------------------------------

_DC_CACHE: dict = {}  # key=(endpoint, code) -> (ts, data)


def _cached(endpoint: str, code: str, ttl: int, fetch):
    key = (endpoint, code)
    hit = _DC_CACHE.get(key)
    if hit and _time.time() - hit[0] < ttl:
        return hit[1]
    data = fetch()
    _DC_CACHE[key] = (_time.time(), data)
    return data


@app.get("/api/margin")
def margin(code: str = Query(...)):
    """融资融券明细（东财，日级）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("margin", code, 1800, lambda: astock.margin_trading(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"融资融券异常：{e}") from e


@app.get("/api/block-trade")
def block_trade(code: str = Query(...)):
    """大宗交易（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("block", code, 1800, lambda: astock.block_trade(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"大宗交易异常：{e}") from e


@app.get("/api/holders")
def holders(code: str = Query(...)):
    """股东户数变化（东财，季度级）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("holders", code, 1800, lambda: astock.holder_num_change(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"股东户数异常：{e}") from e


@app.get("/api/dividend")
def dividend(code: str = Query(...)):
    """分红送转历史（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("dividend", code, 1800, lambda: astock.dividend_history(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"分红送转异常：{e}") from e


@app.get("/api/fund-flow")
def fund_flow(code: str = Query(...)):
    """个股资金流（东财 push2his，120 日主力净流入）。缓存 15 分钟。
    注：push2his 对部分大陆住宅 IP 有间歇风控，可能返回空（非代码问题）。"""
    code = _validate(code)
    try:
        return {"data": _cached("fundflow", code, 900, lambda: astock.stock_fund_flow_120d(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"资金流异常：{e}") from e


@app.get("/api/dragon-tiger")
def dragon_tiger(code: str = Query(...)):
    """龙虎榜：该股近期上榜记录 + 买卖席位 + 机构净买（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("dt", code, 1800, lambda: astock.dragon_tiger_board(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"龙虎榜异常：{e}") from e


@app.get("/api/lockup")
def lockup(code: str = Query(...)):
    """限售解禁日历：历史解禁 + 未来 90 天待解禁（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("lockup", code, 1800, lambda: astock.lockup_expiry(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"解禁日历异常：{e}") from e


@app.get("/api/blocks")
def blocks(code: str = Query(...)):
    """个股所属板块/概念归属（东财 slist）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("blocks", code, 1800, lambda: astock.concept_blocks(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"板块归属异常：{e}") from e


@app.get("/api/hot-concepts")
def hot_concepts(code: str = Query(...)):
    """个股当下被市场归到哪些概念在炒（东财热门概念命中）。缓存 15 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("hotcon", code, 900, lambda: astock.hot_concepts(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"热门概念异常：{e}") from e


@app.get("/api/investor-qa")
def investor_qa(code: str = Query(...)):
    """互动易问答（巨潮）：投资者提问 + 公司回复。缓存 15 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("irm", code, 900, lambda: astock.investor_qa(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"互动易异常：{e}") from e


@app.get("/api/industry")
def industry(top: int = Query(20, ge=5, le=50)):
    """全行业涨跌幅排名（东财行业板块，板块级、零个股名单）。缓存 5 分钟。"""
    key = ("industry", str(top))
    hit = _DC_CACHE.get(key)
    if hit and _time.time() - hit[0] < 300:
        return {"data": hit[1]}
    try:
        data = astock.industry_comparison(top_n=top)
        _DC_CACHE[key] = (_time.time(), data)
        return {"data": data}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"行业排名异常：{e}") from e

// Vibe-Research 后端 API 客户端。/api → vite 代理到本地 FastAPI（默认 8900）。
// 后端未启动或数据源异常时抛 ApiError，页面据此优雅降级。

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

// 后端访问密钥（对应后端部署时的 VR_API_KEY，公网部署防蹭用）。只存本地浏览器。
const ACCESS_KEY = "vr-access-key";

export function loadAccessKey(): string {
  try {
    return localStorage.getItem(ACCESS_KEY) || "";
  } catch {
    return "";
  }
}

export function saveAccessKey(key: string) {
  try {
    if (key) localStorage.setItem(ACCESS_KEY, key);
    else localStorage.removeItem(ACCESS_KEY);
  } catch {
    /* 隐私模式等场景 localStorage 不可用 */
  }
}

export function authHeaders(): Record<string, string> {
  const k = loadAccessKey();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

export interface MyReport {
  id: string; name: string; industry: string; size: number; ext: string; ts: number;
}

// 下载/预览研报：带鉴权头 fetch → blob → 触发浏览器下载（<a download> 无法带 Authorization，故走 blob）。
export async function downloadReport(id: string, name: string): Promise<void> {
  const resp = await fetch(`/api/myreports/file/${id}`, { headers: authHeaders() });
  if (!resp.ok) throw new ApiError(`下载失败 HTTP ${resp.status}`, resp.status);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function request<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  let resp: Response;
  const headers: Record<string, string> = { ...authHeaders() };
  const opts: RequestInit = { method };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (signal) opts.signal = signal;
  if (Object.keys(headers).length > 0) opts.headers = headers;
  try {
    resp = await fetch(`/api${path}`, opts);
  } catch (reason) {
    if ((reason as any)?.name === "AbortError") throw reason;
    throw new ApiError("连接不到后端，请先启动 backend（uvicorn app:app --port 8900）", 0);
  }
  let payload: any = null;
  try {
    payload = await resp.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!resp.ok) {
    if (resp.status === 401) {
      throw new ApiError("后端开启了访问鉴权（VR_API_KEY）：请在「接入 AI」页底部填写后端访问密钥", 401);
    }
    const detail = payload?.detail;
    if (detail && typeof detail === "object") {
      throw new ApiError(detail.message || `HTTP ${resp.status}`, resp.status, detail.issues || detail);
    }
    throw new ApiError(detail || `HTTP ${resp.status}`, resp.status);
  }
  return (payload?.data ?? payload) as T;
}

const get = <T>(path: string) => request<T>(path, "GET");

// ── NDJSON 流式消费工具：把 fetch 的 ReadableStream 解析成按行事件 ───────────
async function* iterateNdjson(
  resp: Response,
  signal?: AbortSignal,
): AsyncGenerator<unknown> {
  if (!resp.body) {
    throw new ApiError("后端未返回流式数据", resp.status || 502);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) {
        try { reader.cancel(); } catch { /* noop */ }
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line) {
          try { yield JSON.parse(line); }
          catch { /* 忽略坏行 */ }
        }
        newlineIdx = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) {
      try { yield JSON.parse(buffer.trim()); }
      catch { /* 忽略 */ }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }
}

/** 启动异步选股，立即返回 job_id。 */
async function startQuantScreen(
  input: QuantScreenInput,
  signal?: AbortSignal,
): Promise<{ job_id: string; started_at: number }> {
  const started = await request<{ job_id: string; started_at: number }>(
    "/quant/screen/start", "POST", input, signal,
  );
  return started;
}

/**
 * 流式拉取选股进度。每解析一行 NDJSON 就调用 onEvent 回调，
 * 返回最终的 QuantScreenResult（或抛出 ApiError）。
 */
export async function runQuantScreenStream(
  input: QuantScreenInput,
  onEvent: (ev: QuantStreamEvent) => void,
  signal?: AbortSignal,
): Promise<QuantScreenResult> {
  const { job_id } = await startQuantScreen(input, signal);
  const headers: Record<string, string> = { ...authHeaders() };
  let resp: Response;
  try {
    resp = await fetch(`/api/quant/screen/${job_id}/stream`, {
      method: "GET",
      headers,
      signal,
    });
  } catch (reason) {
    if ((reason as any)?.name === "AbortError") throw reason;
    throw new ApiError("连接不到后端，请先启动 backend（uvicorn app:app --port 8900）", 0);
  }
  if (!resp.ok) {
    let detail: any = null;
    try { detail = await resp.json(); } catch { /* noop */ }
    const msg = detail?.detail?.message || detail?.detail || `HTTP ${resp.status}`;
    throw new ApiError(typeof msg === "string" ? msg : JSON.stringify(msg), resp.status, detail?.detail);
  }

  let result: QuantScreenResult | null = null;
  let firstError: ApiError | null = null;

  for await (const raw of iterateNdjson(resp, signal)) {
    const ev = raw as QuantStreamEvent;
    if (!ev || typeof ev !== "object") continue;
    onEvent(ev);
    if (ev.type === "result") {
      result = ev.data;
    } else if (ev.type === "error" && firstError === null) {
      firstError = new ApiError(ev.message, 422, ev.issues);
    } else if (ev.type === "done") {
      break;
    }
  }

  if (result) return result;
  if (firstError) throw firstError;
  throw new ApiError("选股任务未返回结果", 502);
}

export interface Quote {
  name: string; price: number; last_close: number; change_pct: number;
  pe_ttm: number; pb: number; mcap_yi: number; turnover_pct: number;
  limit_up: number; limit_down: number;
}

// 日/周/月 K 线单根：mootdx bars 序列。datetime 用 ISO 字符串（to_dict 后 index 也保留为该字段）。
export interface KlineBar {
  datetime: string;
  open: number;
  close: number;
  high: number;
  low: number;
  vol: number;        // 股数
  amount: number;     // 成交额（元）
}

// 个股 RPS 历史点：来自全市场横截面百分位排名（0–100，越大越强）。
// trade_date 是 K 线图同源的日期串，前端把它和 bars 对齐到 x 轴上。
export interface RpsPoint {
  trade_date: string;
  rps5: number;
  rps10: number;
  rps15: number;
  rps20: number;
  rps50: number;
  rps120: number;
  rps250: number;
}

export interface KlineFormulaPreset {
  name: string;
  syntax_version: string;
  default_source: string;
  supported_functions: string[];
  supported_icon_range: [number, number];
}

export interface KlineFormulaLine {
  name: string;
  values: (number | null)[];
}

export interface KlineFormulaIconPoint {
  index: number;
  price: number;
  icon: number;
}

export interface KlineFormulaIconLayer {
  icon: number;
  points: KlineFormulaIconPoint[];
}

export interface KlineFormulaEvaluation {
  formula_hash: string;
  normalized_source: string;
  required_history: number;
  used_functions: string[];
  period: number;
  bar_count: number;
  lines: KlineFormulaLine[];
  icons: KlineFormulaIconLayer[];
}

export interface Valuation {
  name: string; code: string; price: number; mcap_yi: number;
  pe_ttm: number; pb: number;
  eps_26e: number | null; eps_27e: number | null; pe_26e: number | null;
  cagr_pct: number | null; peg: number | null; digest_years: number | null;
  analyst_count: number; forecast_note?: string;
}

export interface Report {
  title: string; publishDate: string; orgSName: string;
  emRatingName?: string; indvInduName?: string; pdfUrl?: string | null;
}

export interface ValMetric {
  current: number; percentile: number; min: number; max: number;
  p20: number; p50: number; p80: number; n: number;
}
export interface ValPercentile {
  period: string; metrics: { pe_ttm?: ValMetric; pb?: ValMetric };
}

export interface Announcement {
  date: string; title: string; type: string; url: string;
}

export interface Financials {
  period: string | null;
  revenue: string | null; revenue_yoy: string | null;
  net_profit: string | null; net_profit_yoy: string | null;
  eps: string | null; bvps: string | null; roe: string | null;
  gross_margin: string | null; net_margin: string | null; op_cf_ps: string | null;
}

export interface NewsItem {
  新闻标题?: string; 发布时间?: string; 文章来源?: string; 新闻链接?: string;
}

export interface IndexQuote {
  name: string; price: number; change_pct: number; change_amt: number;
}

export interface MarketSentiment {
  up: number; down: number; flat: number; zt: number; zt_real: number; dt: number; dt_real: number;
  active: string; breadth: string; speculation: string; date: string;
}
export interface SectorFlow {
  name: string; pct: number; net: number; inflow: number; outflow: number; firms: number;
}
export interface MarketOverview {
  sentiment: MarketSentiment; sectors: SectorFlow[]; updated: string;
}

// 短线情绪：连板梯队 / 最高连板 / 炸板率 / 封板率 / 晋级率 / 涨跌停家数 + 连板股清单（客观公开榜单）
export interface EmotionTier { boards: number; count: number; plus: boolean }
export interface LianbanStock {
  code: string; name: string; boards: number;
  price: number; pct: number; amount: number | null; float_cap: number | null; industry: string;
}
export interface ShortTermEmotion {
  date: string;
  zt_count: number; dt_count: number; zb_count: number;
  max_boards: number; lianban_count: number;
  ladder: EmotionTier[];
  lianban_stocks: LianbanStock[];
  seal_rate: number | null; break_rate: number | null; promotion_rate: number | null;
  yzt_count: number;
}

// 全市场成交额榜（客观公开榜单）
export interface TurnoverStock {
  code: string; name: string;
  price: number | null; pct: number | null;
  amount: number | null; mcap: number | null; float_cap: number | null; industry: string;
}
export interface TurnoverTop { stocks: TurnoverStock[]; updated: string }

export interface RadarItem {
  title: string; url: string; time: string; source: string; summary?: string; zh?: string;
}
export interface Industry {
  key: string; name: string; accent: string; total: number; items: RadarItem[];
}
export interface RadarData {
  generated_at: string | null; recent_days: number; industries: Industry[];
  stats: { industries: number; total_sources: number; failed_sources?: number };
}

export interface Holding {
  code: string; name: string; price: number; shares: number; cost: number;
  market_value: number; pnl: number; pnl_pct: number;
}
export interface ClosedPosition {
  code: string; name: string; date: string; price: number; shares: number; cost: number;
  pnl: number; pnl_pct: number;
}
export interface PortfolioData {
  holdings: Holding[];
  totals: { market_value: number; cost: number; pnl: number; pnl_pct: number };
  closed: ClosedPosition[];
  realized_pnl: number;
  updated: string; last_refresh: string | null;
}

// 资金面 / 筹码 / 信号（v3.3 并入，均为「用户查的那只股」的公开数据）
export interface MarginRow { date: string; rzye: number; rzmre: number; rzche: number; rqye: number; rqmcl: number; rzrqye: number }
export interface BlockTradeRow { date: string; price: number; close: number; premium_pct: number; vol: number; amount: number; buyer: string; seller: string }
export interface HolderRow { date: string; holder_num: number; change_ratio: number; avg_shares: number }
export interface DividendRow { date: string; bonus_rmb: number; transfer_ratio: number; bonus_ratio: number | null; plan: string }
export interface FundFlowRow { date: string; main_net: number; small_net: number; mid_net: number; large_net: number; super_net: number }
export interface DtSeat { name: string; buy_amt: number; sell_amt: number; net: number }
export interface DragonTiger {
  records: { date: string; reason: string; net_buy: number; turnover: number }[];
  seats: { buy: DtSeat[]; sell: DtSeat[] };
  institution: { buy_amt: number; sell_amt: number; net_amt: number };
}
export interface LockupRow { date: string; type: string; shares: number; able_shares: number; ratio: number }
export interface Lockup { history: LockupRow[]; upcoming: LockupRow[] }
export interface Board { name: string; code: string; change_pct: number | string; lead_stock: string }
export interface Blocks { total: number; boards: Board[]; concept_tags: string[] }
export interface HotConcept { concept: string; bk: string; hit: number }
export interface QaRow { company: string; question: string; answer: string | null; answerer: string; ask_time: string }
export interface IndustryRow { rank: number; name: string; change_pct: number; code: string; up_count: number; down_count: number }
export interface IndustryData { top: IndustryRow[]; bottom: IndustryRow[]; total: number }

// 通达信板块强度：用户维护代码/名称，后端直接按板块日 K 计算横截面 RPS。
export interface SectorSource {
  code: string;
  name: string;
  created_at: number;
  updated_at: number;
}
export interface SectorStrengthRow {
  code: string;
  name: string;
  trade_date: string | null;
  latest_close: number | null;
  bar_count: number;
  status: "ok" | "stale" | "unavailable";
  error: string | null;
  rps5: number | null;
  rps10: number | null;
  rps15: number | null;
  rps20: number | null;
  return5_pct: number | null;
  return10_pct: number | null;
  return15_pct: number | null;
  return20_pct: number | null;
}
export interface SectorStrengthSnapshot {
  version: number;
  source: string;
  trade_date: string | null;
  computed_at: number;
  source_count: number;
  available_count: number;
  unavailable_count: number;
  ranked_count_by_period: Record<string, number>;
  periods: number[];
  rule: string;
  rows: SectorStrengthRow[];
}

export type QuantStrategy =
  | "near_high"
  | "monthly_reversal_62"
  | "growth_mrgc_sxhcg"
  | "blue_diamond_left_low"
  | "daily_observe_3"
  | "xg_breakout";
export interface TdxFormulaPreset {
  strategy: QuantStrategy; label: string; description: string; syntax_version: string;
  default_source: string; default_history_days: number; supported_functions: string[];
}
export interface TdxFormulaIssue {
  code?: string; message: string; line?: number | null; column?: number | null;
  severity?: "error" | "warning";
}
export interface TdxFormulaValidation {
  strategy: QuantStrategy;
  normalized_source: string;
  formula_hash: string;
  required_history: number;
  minimum_history?: number;
  used_functions: string[];
  uses_rps: boolean;
  uses_finance: boolean;
  output_name?: string | null;
  issues?: TdxFormulaIssue[];
}
export interface QuantScreenInput {
  strategy: QuantStrategy;
  fund_ratio_min: number;
  north_value_min_yi: number;
  near_high_pct?: number;
  lookback_days?: number;
  fund_period?: string | null;
  formula_source?: string;
}
export interface QuantRow {
  code: string; name: string; industry: string;
  fund_count: number; fund_hold_shares: number | null; fund_hold_value_yi: number | null;
  fund_float_ratio_pct: number | null; fund_total_ratio_pct: number | null; fund_period: string;
  north_hold_shares: number | null; north_hold_value_yi: number | null;
  north_float_ratio_pct: number | null; north_total_ratio_pct: number | null; north_period: string;
  north_quote_price?: number | null;
  fund_condition_met?: boolean; north_condition_met?: boolean; condition_tags?: string[];
  close?: number; year_high?: number; distance_to_high_pct?: number;
  history_days?: number; technical_date?: string | null;
  rps20?: number; rps50?: number; rps120?: number; rps250?: number;
  change_pct?: number | null;  // 当日涨跌幅（%，腾讯实时）
  return20_pct?: number; return50_pct?: number; return120_pct?: number; return250_pct?: number;
  turnover_pct?: number | null; drawdown120_pct?: number;
  strategy_detail?: string; matched?: boolean;
  signal_results?: Record<string, boolean>;
  mrgc?: boolean; sxhcg?: boolean;
  financial_period?: string | null;
  revenue_yoy_pct?: number | null; net_profit_yoy_pct?: number | null;
}
export interface QuantScreenResult {
  strategy: QuantScreenInput["strategy"];
  strategy_label: string;
  criteria: {
    fund_ratio_min: number; north_value_min_yi: number;
    near_high_pct?: number; lookback_days?: number; tdx_formula: string;
    formula_source?: string; formula_hash?: string; required_history?: number; minimum_history?: number;
    used_functions?: string[]; uses_rps?: boolean; uses_finance?: boolean; uses_capital?: boolean;
  };
  fund_period: string; north_period: string; technical_date: string | null;
  fund_candidate_count: number; north_candidate_count: number; overlap_count: number;
  base_count: number; matched_count: number;
  technical_failure_count: number; elapsed_seconds: number;
  north_disclosure_note: string;
  rps_meta: null | {
    trade_date: string; universe_count: number; eligible_count: number;
    excluded_short_history_count: number; rule: string;
  };
  base_rows: QuantRow[]; rows: QuantRow[];
}

// ── 通达信 blocknew 选股公式板块 ────────────────────────────────────────────
// 数据从后端 backend/data/tdx_blocks.json 取（前端不需要读本地 TDX 文件夹）。
export interface TdxBlockSummary {
  id: string;
  label: string;
  description: string;
  stock_count: number;
}
export interface TdxBlock extends TdxBlockSummary {
  codes: string[];          // 标准格式 "000703.SZ" / "600246.SH" / "920002.BJ"
}
export interface TdxBlockStockRow {
  code: string;
  name: string;
  industry: string;
  close: number | null;
  change_pct: number | null;
  turnover_pct: number | null;
  pe_ttm: number | null;
  pb: number | null;
  mcap_yi: number | null;
  limit_up: number | null;
  limit_down: number | null;
  matched: boolean;
}
export interface TdxBlockDetail extends TdxBlock {
  quotes: Record<string, Quote>;
  rows: TdxBlockStockRow[];
}

// ── 选股阶段枚举 ─────────────────────────────────────────────────────────
export type QuantPhase =
  | "validate" | "basepool" | "rps" | "bars" | "finance" | "evaluate";

// ── 后台 RPS 预热状态 ──────────────────────────────────────────────────────
export interface QuantRpsStatus {
  ready: boolean;
  trade_date: string | null;
  started_at: number | null;
  finished_at: number | null;
  last_error: string | null;
  running: boolean;
  runs_total: number;
  runs_failed: number;
}

export interface QuantProgressEvent {
  type: "progress";
  phase: QuantPhase;
  done: number;
  total: number;
  message: string;
  elapsed: number;
}

export interface QuantResultEvent { type: "result"; data: QuantScreenResult; }
export interface QuantErrorEvent {
  type: "error";
  code?: string;
  message: string;
  issues?: unknown;
}
export interface QuantDoneEvent { type: "done"; }
export interface QuantHeartbeatEvent { type: "heartbeat"; }

// ── 选股进度流（NDJSON） ────────────────────────────────────────────────
export type QuantStreamEvent =
  | QuantProgressEvent
  | QuantResultEvent
  | QuantErrorEvent
  | QuantDoneEvent
  | QuantHeartbeatEvent;

// 全球市场（美股 / 港股，移植自 global-stock-data · 东财域内源）
export interface GlobalIndex {
  key: string; name: string; region: string;
  price: number | null; change_pct: number | null;
}
export interface GlobalQuote {
  code: string; name: string;
  price: number | null; open: number | null; high: number | null; low: number | null;
  prev_close: number | null; amount: number | null; mcap: number | null; change_pct: number | null;
}
export interface GlobalMetrics {
  report_date: string;
  revenue: number | null; revenue_yoy: number | null; net_profit: number | null;
  eps: number | null; roe: number | null; gross_margin: number | null;
  net_margin: number | null; debt_ratio: number | null;
}
export interface GlobalStock {
  code: string; name: string; market: string;
  quote: GlobalQuote; metrics: GlobalMetrics | null;
}

export const api = {
  health: () => get<{ ok: boolean }>("/health"),
  indices: () => get<IndexQuote[]>("/indices"),
  marketOverview: () => get<MarketOverview>("/market/overview"),
  emotion: () => get<ShortTermEmotion>("/market/emotion"),
  turnoverTop: () => get<TurnoverTop>("/market/turnover-top"),
  globalIndices: () => get<GlobalIndex[]>("/global/indices"),
  globalStock: (symbol: string) => get<GlobalStock>(`/global/stock?symbol=${encodeURIComponent(symbol)}`),
  radar: () => get<RadarData>("/radar"),
  radarRefresh: () => request<RadarData>("/radar/refresh", "POST"),
  portfolio: () => get<PortfolioData>("/portfolio"),
  addHolding: (code: string, shares: number, cost: number) => request<PortfolioData>("/portfolio/holding", "POST", { code, shares, cost }),
  removeHolding: (code: string) => request<PortfolioData>(`/portfolio/holding?code=${code}`, "DELETE"),
  refreshPortfolio: () => request<PortfolioData>("/portfolio/refresh", "POST"),
  closePosition: (code: string, date: string, price: number, shares: number, cost: number) =>
    request<PortfolioData>("/portfolio/close", "POST", { code, date, price, shares, cost }),
  removeClosed: (index: number) => request<PortfolioData>(`/portfolio/close?index=${index}`, "DELETE"),
  valuation: (code: string) => get<Valuation>(`/valuation?code=${code}`),
  percentile: (code: string) => get<ValPercentile>(`/valuation/percentile?code=${code}`),
  financials: (code: string) => get<Financials>(`/financials?code=${code}`),
  announcements: (code: string) => get<Announcement[]>(`/announcements?code=${code}`),
  quote: (codes: string) => get<Record<string, Quote>>(`/quote?codes=${codes}`),
  reports: (code: string) => get<Report[]>(`/reports?code=${code}`),
  news: (code: string) => get<NewsItem[]>(`/news?code=${code}`),
  margin: (code: string) => get<MarginRow[]>(`/margin?code=${code}`),
  blockTrade: (code: string) => get<BlockTradeRow[]>(`/block-trade?code=${code}`),
  holders: (code: string) => get<HolderRow[]>(`/holders?code=${code}`),
  dividend: (code: string) => get<DividendRow[]>(`/dividend?code=${code}`),
  fundFlow: (code: string) => get<FundFlowRow[]>(`/fund-flow?code=${code}`),
  dragonTiger: (code: string) => get<DragonTiger>(`/dragon-tiger?code=${code}`),
  lockup: (code: string) => get<Lockup>(`/lockup?code=${code}`),
  blocks: (code: string) => get<Blocks>(`/blocks?code=${code}`),
  hotConcepts: (code: string) => get<HotConcept[]>(`/hot-concepts?code=${code}`),
  investorQa: (code: string) => get<QaRow[]>(`/investor-qa?code=${code}`),
  industry: (top = 20) => get<IndustryData>(`/industry?top=${top}`),
  sectorSources: (signal?: AbortSignal) =>
    request<SectorSource[]>("/user-sectors", "GET", undefined, signal),
  sectorStrength: (refresh = false, signal?: AbortSignal) =>
    request<SectorStrengthSnapshot>(`/user-sectors/rps?refresh=${refresh ? "true" : "false"}`, "GET", undefined, signal),
  addSectorSource: (input: { code: string; name: string }) =>
    request<SectorSource>("/user-sectors", "POST", input),
  updateSectorSource: (code: string, input: { code: string; name: string }) =>
    request<SectorSource>(`/user-sectors/${encodeURIComponent(code)}`, "PUT", input),
  deleteSectorSource: (code: string) =>
    request<{ deleted: string }>(`/user-sectors/${encodeURIComponent(code)}`, "DELETE"),
  quantScreen: (input: QuantScreenInput) =>
    request<QuantScreenResult>("/quant/screen", "POST", input),
  quantFormulas: () => get<TdxFormulaPreset[]>("/quant/formulas"),
  // 通达信 blocknew 板块摘要/明细/含行情明细
  tdxBlocks: () => get<TdxBlockSummary[]>("/tdx/blocks"),
  tdxBlock: (id: string) => get<TdxBlock>(`/tdx/blocks/${encodeURIComponent(id)}`),
  tdxBlockStocks: (id: string) => get<TdxBlockDetail>(`/tdx/blocks/${encodeURIComponent(id)}/stocks`),
  validateQuantFormula: (strategy: QuantStrategy, source: string, signal?: AbortSignal) =>
    request<TdxFormulaValidation>("/quant/formula/validate", "POST", { strategy, source }, signal),
  quantRpsStatus: () => get<QuantRpsStatus>("/quant/rps/status"),
  triggerQuantRpsPrewarm: () =>
    request<QuantRpsStatus & { triggered: boolean }>("/quant/rps/prewarm", "POST"),
  // 个股 K 线（来自 mootdx）。category 3=60分钟 4=日 5=周 6=月；
  // fullHistory=true 时后端按通达信 800 根/页回溯到上市首根。
  // 后端返回 {"data": [...]}，request() 在顶层把 data 字段剥出来，所以这里直接拿到数组。
  kline: (code: string, opts: { category?: number; offset?: number; fullHistory?: boolean } = {}) =>
    get<KlineBar[]>(
      `/kline?code=${encodeURIComponent(code)}` +
      `&category=${opts.category ?? 4}` +
      `&offset=${opts.offset ?? 120}` +
      `&full_history=${opts.fullHistory ? "true" : "false"}`,
    ),
  klineFormulaPreset: () => get<KlineFormulaPreset>("/kline/formula/preset"),
  evaluateKlineFormula: (
    code: string,
    category: number,
    source: string,
    bars: KlineBar[],
    rpsHistory: RpsPoint[],
    signal?: AbortSignal,
  ) => request<KlineFormulaEvaluation>("/kline/formula/evaluate", "POST", {
    code,
    category,
    source,
    bars,
    rps_history: rpsHistory,
  }, signal),
  // 个股 RPS 历史（最近约 560 个交易日）。后端只在 RPS 快照就绪时返回非空数组，
  // 否则返回 []；前端 K 线页拿到 [] 时静默隐藏 RPS 副图，不报错。
  rpsHistory: (code: string) => get<RpsPoint[]>(`/stock/rps-history?code=${encodeURIComponent(code)}`),
  myReports: () => get<MyReport[]>("/myreports"),
  uploadReport: (name: string, contentB64: string) =>
    request<MyReport>("/myreports", "POST", { name, content_b64: contentB64 }),
  deleteReport: (id: string) => request<{ ok: boolean }>(`/myreports/${id}`, "DELETE"),
};

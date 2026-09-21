import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, BarChart3,
  Check, ChevronDown, ChevronUp, Code2, Database,
  Download, Eye, Flame, Filter, History, Layers3, LineChart,
  LoaderCircle, Pencil, Play, Plus, RefreshCw, Rocket, Search,
  SlidersHorizontal, Sparkles, Square, Star,
  Target, TrendingUp, Wand2, X, Zap,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import {
  TdxFormulaEditor, type TdxFormulaValidationState,
} from "@/components/quant/TdxFormulaEditor";
import {
  ApiError, api, runQuantScreenStream,
  type TdxFormulaIssue, type TdxFormulaPreset, type QuantRow,
  type QuantScreenResult, type QuantStrategy, type QuantStreamEvent,
  type QuantRpsStatus,
} from "@/lib/api";
import { addCodes, loadWatch, saveWatch } from "@/lib/watchlist";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── 跨会话/跨路由持久化筛选结果 ─────────────────────────────────────
// 避免因切换浏览器标签页、后台休眠重载、路由跳转或刷新页面导致已选标的消失。
const LAST_SCREEN_SNAPSHOT_KEY = "vr-quant-screen-snapshot-v2";

interface PersistentSnapshot {
  input: import("@/lib/api").QuantScreenInput;
  result: import("@/lib/api").QuantScreenResult;
  view: "matched" | "base";
  selectedKey: string;
  fundRatioMin: number;
  northValueMin: number;
  screenMode: "live" | "backtest";
  asOfDate: string;
  savedAt: number;
}

let _cachedSnapshot: PersistentSnapshot | null = null;

function readPersistentSnapshot(): PersistentSnapshot | null {
  if (_cachedSnapshot) return _cachedSnapshot;
  try {
    const raw = localStorage.getItem(LAST_SCREEN_SNAPSHOT_KEY) || sessionStorage.getItem(LAST_SCREEN_SNAPSHOT_KEY);
    if (!raw) return null;
    const data: PersistentSnapshot = JSON.parse(raw);
    // 72 小时内有效（防过期陈旧数据，同时保证跨日与休眠完全保留）
    if (Date.now() - data.savedAt > 72 * 3600 * 1000) {
      localStorage.removeItem(LAST_SCREEN_SNAPSHOT_KEY);
      sessionStorage.removeItem(LAST_SCREEN_SNAPSHOT_KEY);
      return null;
    }
    _cachedSnapshot = data;
    return data;
  } catch {
    return null;
  }
}

function savePersistentSnapshot(snapshot: PersistentSnapshot | null) {
  _cachedSnapshot = snapshot;
  try {
    if (snapshot) {
      const serialized = JSON.stringify(snapshot);
      try {
        localStorage.setItem(LAST_SCREEN_SNAPSHOT_KEY, serialized);
      } catch {
        sessionStorage.setItem(LAST_SCREEN_SNAPSHOT_KEY, serialized);
      }
    } else {
      localStorage.removeItem(LAST_SCREEN_SNAPSHOT_KEY);
      sessionStorage.removeItem(LAST_SCREEN_SNAPSHOT_KEY);
    }
  } catch {
    /* 忽略存储异常 */
  }
}

// ── 阶段文案 + 顺序权重（用于"总体进度条"）──────────────────────────────────
const PHASE_LABEL: Record<string, string> = {
  validate: "校验通达信公式",
  basepool: "构建基础池",
  rps:      "构建全市场 RPS",
  bars:     "下载日 K",
  finance:  "核对财务增长率",
  evaluate: "评估公式",
};
const PHASE_WEIGHT: Record<string, number> = {
  validate: 0.5, basepool: 1, rps: 2, bars: 8, finance: 1, evaluate: 0.5,
};
const PHASE_ORDER = ["validate", "basepool", "rps", "bars", "finance", "evaluate"] as const;
const TOTAL_WEIGHT = PHASE_ORDER.reduce((s, k) => s + (PHASE_WEIGHT[k] ?? 0), 0);

/** 把分阶段进度折算成一个 0~100 的百分比。bars 是最大头，所以权重最大。 */
function aggregateProgress(phase: string | null, done: number, total: number): number {
  if (!phase) return 0;
  let acc = 0;
  for (const key of PHASE_ORDER) {
    if (key === phase) {
      const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
      return ((acc + (PHASE_WEIGHT[key] ?? 0) * ratio) / TOTAL_WEIGHT) * 100;
    }
    acc += PHASE_WEIGHT[key] ?? 0;
  }
  return (acc / TOTAL_WEIGHT) * 100;
}

// ── 自定义策略类型 ──────────────────────────────────────────────────────────
interface CustomStrategy {
  key: string;            // "custom-{timestamp}"
  label: string;
  description: string;
  base_strategy: QuantStrategy;  // 决定引擎（RPS / 成长指标等）
  source: string;         // 保存时的公式快照（"默认"）
  createdAt: number;
}

// 展示用：将内置 preset 和自定义策略统一成同一形状
interface DisplayStrategy {
  key: string;
  label: string;
  description: string;
  defaultSource: string;
  baseStrategy: QuantStrategy;
  isCustom: boolean;
  // ── UI 增强：分类与标签 ──
  category: StrategyCategory;
  tags: StrategyTag[];
  icon: ReactNode;
}

type StrategyCategory = "blue_diamond" | "classic" | "custom";
type StrategyTag = "rps" | "finance" | "capital" | "high_tight" | "drawdown";

/** 给每个内置策略打分类 + 图标 + 标签；自定义策略走默认 classic 分类。 */
function describeBuiltin(strategy: string): { category: StrategyCategory; tags: StrategyTag[]; icon: ReactNode } {
  switch (strategy) {
    case "blue_diamond_left_low":
      return {
        category: "blue_diamond",
        tags: ["rps", "capital", "drawdown"],
        icon: <Sparkles className="h-4 w-4" />,
      };
    case "daily_observe_3":
      return {
        category: "blue_diamond",
        tags: ["rps"],
        icon: <Eye className="h-4 w-4" />,
      };
    case "xg_breakout":
      return {
        category: "blue_diamond",
        tags: ["rps", "capital", "high_tight"],
        icon: <Rocket className="h-4 w-4" />,
      };
    case "monthly_reversal_62":
      return {
        category: "classic",
        tags: ["rps"],
        icon: <LineChart className="h-4 w-4" />,
      };
    case "growth_mrgc_sxhcg":
      return {
        category: "classic",
        tags: ["rps", "finance", "capital"],
        icon: <Flame className="h-4 w-4" />,
      };
    case "near_high":
    default:
      return {
        category: "classic",
        tags: [],
        icon: <Target className="h-4 w-4" />,
      };
  }
}

const CATEGORY_META: Record<StrategyCategory, { title: string; subtitle: string; icon: ReactNode; accent: string }> = {
  blue_diamond: {
    title: "蓝钻公式",
    subtitle: "通达信经典选股公式",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    accent: "from-amber-500/25 to-orange-500/10 border-amber-400/40",
  },
  classic: {
    title: "经典策略",
    subtitle: "内置动量/反转策略",
    icon: <Wand2 className="h-3.5 w-3.5" />,
    accent: "from-sky-500/20 to-indigo-500/10 border-sky-400/40",
  },
  custom: {
    title: "自定义策略",
    subtitle: "用户自建公式",
    icon: <Plus className="h-3.5 w-3.5" />,
    accent: "from-fuchsia-500/20 to-pink-500/10 border-fuchsia-400/40",
  },
};

const TAG_META: Record<StrategyTag, { label: string; tone: string }> = {
  rps:        { label: "RPS动量", tone: "border-primary/40 bg-primary/10 text-primary" },
  finance:    { label: "财务增长", tone: "border-emerald-400/40 bg-emerald-400/10 text-emerald-400" },
  capital:    { label: "换手控制", tone: "border-sky-400/40 bg-sky-400/10 text-sky-400" },
  high_tight: { label: "高位突破", tone: "border-amber-400/40 bg-amber-400/10 text-amber-400" },
  drawdown:   { label: "严格回撤", tone: "border-rose-400/40 bg-rose-400/10 text-rose-400" },
};

// ── 3L 交易体系 · 买前十问标准复核清单 ─────────────────────────────────────
const QUESTIONS_3L = [
  {
    id: 1,
    title: "大盘环境处于可操作窗口",
    desc: "大盘指数未处于主跌浪或系统性流动性危机中，大盘均线多头或企稳反弹（参考 7.1 大盘指数的作用）。",
    source: "7.1 大盘环境",
  },
  {
    id: 2,
    title: "符合动量主线（第一个L）",
    desc: "个股 RPS250 / RPS120 / RPS50 任一 ≥ 90，属于全市场涨幅前 10% 的超级领涨品种（参考 3.1 动量主线）。",
    source: "3.1 动量主线",
  },
  {
    id: 3,
    title: "一年新高印证",
    desc: "当前价格距离一年新高（250日最高价）不超过 15%，具备不断向上拓宽空间的动量特征（参考 3.5 新高印证）。",
    source: "3.5 新高印证",
  },
  {
    id: 4,
    title: "具备不可证伪的最强逻辑（第二个L）",
    desc: "个股所处行业存在强催化剂（如业绩暴增、行业拐点、政策重磅扶持），非纯情绪博弈（参考 4.1 最强逻辑）。",
    source: "4.1 最强逻辑",
  },
  {
    id: 5,
    title: "明确的关键点形态（第三个L）",
    desc: "形态处于平台突破、箱体突破、或经过充分缩量回调企稳的关键转折点（参考 6.2 关键点）。",
    source: "6.2 关键点",
  },
  {
    id: 6,
    title: "生命线 MA20 向上且未过度乖离",
    desc: "20日均线向上延伸，当前股价距离 MA20 乖离率 ≤ 15%，非连续拉升后的严重超买（参考 6.3 入场时机）。",
    source: "6.3 入场时机",
  },
  {
    id: 7,
    title: "严格明确的硬止损与结构止损预案",
    desc: "已设定硬止损点（-5% ~ -8%）与结构支撑位（跌破 MA20 / 前低坚决离场），绝不抱有侥幸心理（参考 6.4 止损点）。",
    source: "6.4 止损点",
  },
  {
    id: 8,
    title: "盈亏比 ≥ 3:1",
    desc: "根据上方前期阻力位计算出的潜在获利空间，至少是到止损位亏损空间的 3 倍以上（参考 6.5 止盈点）。",
    source: "6.5 止盈点",
  },
  {
    id: 9,
    title: "已排除回避模板特征",
    desc: "无高位放巨量长上影滞涨、无主跌浪破位、无重大不可逆基本面利空（参考 6.7 回避模板）。",
    source: "6.7 回避模板",
  },
  {
    id: 10,
    title: "仓位纪律与风险优先",
    desc: "单票仓位符合风控规则，绝不逆势加仓摊薄成本，买入前已接受最大潜在亏损（参考 8.2 仓位控制）。",
    source: "8.2 仓位控制",
  },
];

const FORMULA_DRAFTS_KEY = "vr-quant-tdx-source-drafts-v1";
const CUSTOM_STRATEGIES_KEY = "vr-quant-custom-strategies-v1";
const BUILTIN_OVERRIDES_KEY = "vr-quant-builtin-overrides-v1";
const HIDDEN_BUILTINS_KEY = "vr-quant-hidden-builtins-v1";

type FormulaDrafts = Record<string, string>;
type BuiltinOverrides = Record<string, { label?: string; description?: string }>;

const readFormulaDrafts = (): FormulaDrafts => {
  try { return JSON.parse(localStorage.getItem(FORMULA_DRAFTS_KEY) || "{}"); }
  catch { return {}; }
};
const readCustomStrategies = (): CustomStrategy[] => {
  try { return JSON.parse(localStorage.getItem(CUSTOM_STRATEGIES_KEY) || "[]"); }
  catch { return []; }
};
const saveCustomStrategies = (list: CustomStrategy[]) => {
  try { localStorage.setItem(CUSTOM_STRATEGIES_KEY, JSON.stringify(list)); }
  catch { /* 隐私模式 */ }
};
const readBuiltinOverrides = (): BuiltinOverrides => {
  try { return JSON.parse(localStorage.getItem(BUILTIN_OVERRIDES_KEY) || "{}"); }
  catch { return {}; }
};
const saveBuiltinOverrides = (o: BuiltinOverrides) => {
  try { localStorage.setItem(BUILTIN_OVERRIDES_KEY, JSON.stringify(o)); }
  catch {}
};
const readHiddenBuiltins = (): string[] => {
  try { return JSON.parse(localStorage.getItem(HIDDEN_BUILTINS_KEY) || "[]"); }
  catch { return []; }
};
const saveHiddenBuiltins = (list: string[]) => {
  try { localStorage.setItem(HIDDEN_BUILTINS_KEY, JSON.stringify(list)); }
  catch {}
};

const errorIssues = (reason: unknown): TdxFormulaIssue[] | undefined => {
  if (!(reason instanceof ApiError) || !Array.isArray(reason.details)) return undefined;
  return reason.details as TdxFormulaIssue[];
};

const numberText = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

function ConditionInput({
  label, value, suffix, min, max, step, onChange,
}: {
  label: string; value: number; suffix: string; min: number; max: number; step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex overflow-hidden rounded-lg border border-border bg-black/20 focus-within:border-primary/50">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm font-mono outline-none"
        />
        <span className="flex items-center border-l border-border/60 px-3 text-xs text-muted-foreground">
          {suffix}
        </span>
      </div>
    </label>
  );
}

export function QuantScreening() {
  const initialSnapshot = useMemo(() => readPersistentSnapshot(), []);
  // 筛选参数（优先从持久化快照恢复）
  const [fundRatioMin, setFundRatioMin] = useState(initialSnapshot?.fundRatioMin ?? 5);
  const [northValueMin, setNorthValueMin] = useState(initialSnapshot?.northValueMin ?? 1);
  const [selectedKey, setSelectedKey] = useState<string>(initialSnapshot?.selectedKey ?? "near_high");

  // 运行状态
  const [result, setResult] = useState<QuantScreenResult | null>(initialSnapshot?.result ?? null);
  const [view, setView] = useState<"matched" | "base">(initialSnapshot?.view ?? "matched");
  const [loading, setLoading] = useState(false);
  const [formulaLoading, setFormulaLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 选股进度（来自后端 SSE 流）
  const [progressPhase, setProgressPhase] = useState<string | null>(null);
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [elapsed, setElapsed] = useState<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  // RPS 后台预热状态（轮询）
  const [rpsStatus, setRpsStatus] = useState<QuantRpsStatus | null>(null);
  const navigate = useNavigate();
  const rpsPollAbortRef = useRef<AbortController | null>(null);

  // 自选股（localStorage 同步）
  const [watchSet, setWatchSet] = useState<Set<string>>(() => new Set(loadWatch()));

  // 策略数据
  const [presets, setPresets] = useState<TdxFormulaPreset[]>([]);
  const [customStrategies, setCustomStrategies] = useState<CustomStrategy[]>(() => readCustomStrategies());
  const [drafts, setDrafts] = useState<FormulaDrafts>({});
  const [validation, setValidation] = useState<TdxFormulaValidationState>({ status: "idle" });

  // 分类切换 Tab ("all" | StrategyCategory)
  const [activeCategoryTab, setActiveCategoryTab] = useState<"all" | StrategyCategory>("all");

  // 编辑器折叠
  const [showEditor, setShowEditor] = useState(false);
  // 基础池条件折叠
  const [showBasePool, setShowBasePool] = useState(false);

  // 结果表格内实时搜索与快捷筛选
  const [tableSearch, setTableSearch] = useState("");
  const [tableFilter, setTableFilter] = useState<"all" | "up" | "high_rps" | "unwatched">("all");

  // ── 模式与回测参数（从持久化快照恢复） ──
  const [screenMode, setScreenMode] = useState<"live" | "backtest">(initialSnapshot?.screenMode ?? "live");
  const [asOfDate, setAsOfDate] = useState<string>(initialSnapshot?.asOfDate ?? "");

  // ── 3L 买前十问弹窗状态 ──
  const [checklistStock, setChecklistStock] = useState<QuantRow | null>(null);
  const [checkedQuestions, setCheckedQuestions] = useState<Record<number, boolean>>({});

  // 新增策略表单
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newBaseStrategy, setNewBaseStrategy] = useState<QuantStrategy>("near_high");
  const [copyCurrentSource, setCopyCurrentSource] = useState(true);
  const newLabelRef = useRef<HTMLInputElement>(null);

  // 编辑策略名称/说明
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const editLabelRef = useRef<HTMLInputElement>(null);

  // 内置策略覆盖（重命名/隐藏）
  const [builtinOverrides, setBuiltinOverrides] = useState<BuiltinOverrides>(() => readBuiltinOverrides());
  const [hiddenBuiltins, setHiddenBuiltins] = useState<string[]>(() => readHiddenBuiltins());

  // 加载内置策略，初始化草稿
  useEffect(() => {
    let active = true;
    setFormulaLoading(true);
    api.quantFormulas()
      .then((items) => {
        if (!active) return;
        const saved = readFormulaDrafts();
        const next: FormulaDrafts = { ...saved };
        // 内置策略：草稿不存在时用默认公式初始化
        items.forEach((preset) => {
          if (!next[preset.strategy] || !next[preset.strategy].trim()) {
            next[preset.strategy] = preset.default_source;
          }
        });
        setPresets(items);
        setDrafts(next);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof ApiError ? reason.message : "加载选股公式失败");
      })
      .finally(() => { if (active) setFormulaLoading(false); });
    return () => { active = false; };
  }, []);

  // 草稿持久化
  useEffect(() => {
    if (Object.keys(drafts).length === 0) return;
    try { localStorage.setItem(FORMULA_DRAFTS_KEY, JSON.stringify(drafts)); }
    catch { /* 隐私模式 */ }
  }, [drafts]);

  // 自定义策略持久化
  useEffect(() => {
    saveCustomStrategies(customStrategies);
  }, [customStrategies]);

  // 内置策略覆盖/隐藏持久化
  useEffect(() => { saveBuiltinOverrides(builtinOverrides); }, [builtinOverrides]);
  useEffect(() => { saveHiddenBuiltins(hiddenBuiltins); }, [hiddenBuiltins]);

  // ── RPS 后台预热状态轮询 ──────────────────────────────────────────────
  // 每 10 秒拉一次状态；同时在用户主动触发预热后立即拉一次。
  // 当页面卸载或后端连续失败时停止轮询，避免无效请求堆积。
  useEffect(() => {
    let active = true;
    let consecutiveFailures = 0;
    const ctrl = new AbortController();
    rpsPollAbortRef.current = ctrl;

    const tick = async () => {
      if (!active) return;
      try {
        const data = await api.quantRpsStatus();
        if (!active) return;
        setRpsStatus(data);
        consecutiveFailures = 0;
      } catch {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 5) {
          // 后端不可达就停止轮询，避免给页面增加噪声
          return;
        }
      }
    };

    void tick();
    const timer = window.setInterval(tick, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      ctrl.abort();
      if (rpsPollAbortRef.current === ctrl) rpsPollAbortRef.current = null;
    };
  }, []);

  // ── 统一策略列表（内置应用改名/过滤隐藏，自定义直接合并）──────────────────
  const allStrategies = useMemo<DisplayStrategy[]>(() => [
    ...presets
      .filter((p) => !hiddenBuiltins.includes(p.strategy))
      .map((p) => {
        const ov = builtinOverrides[p.strategy] ?? {};
        const desc = describeBuiltin(p.strategy);
        return {
          key: p.strategy,
          label: ov.label ?? p.label,
          description: ov.description ?? p.description,
          defaultSource: p.default_source,
          baseStrategy: p.strategy as QuantStrategy,
          isCustom: false,
          category: desc.category,
          tags: desc.tags,
          icon: desc.icon,
        };
      }),
    ...customStrategies.map((c) => ({
      key: c.key,
      label: c.label,
      description: c.description,
      defaultSource: c.source,
      baseStrategy: c.base_strategy,
      isCustom: true,
      category: "custom" as StrategyCategory,
      tags: ["rps"] as StrategyTag[],
      icon: <Wand2 className="h-4 w-4" />,
    })),
  ], [presets, customStrategies, builtinOverrides, hiddenBuiltins]);

  // ── 策略搜索过滤（按 label / description 模糊匹配 + 分类过滤）─────────────────────
  const [strategySearch, setStrategySearch] = useState("");
  const filteredStrategies = useMemo(() => {
    const q = strategySearch.trim().toLowerCase();
    return allStrategies.filter((s) => {
      if (activeCategoryTab !== "all" && s.category !== activeCategoryTab) {
        return false;
      }
      if (!q) return true;
      return (
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.key.toLowerCase().includes(q)
      );
    });
  }, [allStrategies, strategySearch, activeCategoryTab]);

  // 统计各分类数量
  const categoryCounts = useMemo(() => {
    const counts = { all: allStrategies.length, blue_diamond: 0, classic: 0, custom: 0 };
    for (const s of allStrategies) {
      counts[s.category] += 1;
    }
    return counts;
  }, [allStrategies]);

  const selected = allStrategies.find((s) => s.key === selectedKey);
  const activeSource = drafts[selectedKey] ?? selected?.defaultSource ?? "";
  const isDirty = useMemo(() => {
    const draft = drafts[selectedKey] ?? "";
    return selected ? draft.trim() !== selected.defaultSource.trim() : false;
  }, [drafts, selectedKey, selected]);

  const rows = useMemo(
    () => (view === "matched" ? result?.rows ?? [] : result?.base_rows ?? []),
    [result, view],
  );

  // ── 结果行过滤（按搜索框 + 快捷过滤） ─────────────────────────────────────
  const filteredRows = useMemo(() => {
    let list = rows;
    const q = tableSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.industry && r.industry.toLowerCase().includes(q))
      );
    }
    if (tableFilter === "up") {
      list = list.filter((r) => (r.change_pct as number) > 0);
    } else if (tableFilter === "high_rps") {
      list = list.filter((r) => {
        const rps = (r.rps250 ?? r.rps120 ?? r.rps50 ?? 0) as number;
        return rps >= 90;
      });
    } else if (tableFilter === "unwatched") {
      list = list.filter((r) => !watchSet.has(r.code));
    }
    return list;
  }, [rows, tableSearch, tableFilter, watchSet]);

  // ── 列表排序：每列表头可点击，三态循环（无 → 升 → 降 → 无）。
  type SortKey =
    | "name" | "industry" | "fund_float_ratio_pct" | "fund_count" | "fund_hold_value_yi"
    | "north_hold_value_yi" | "north_total_ratio_pct"
    | "rps20" | "rps50" | "rps120" | "rps250"
    | "turnover_pct" | "revenue_yoy_pct" | "net_profit_yoy_pct"
    | "close" | "year_high" | "distance_to_high_pct"
    | "change_pct"
    | "ma20" | "key_support" | "risk_reward_ratio" | "timing_score"
    | "return_5d" | "return_10d" | "return_20d" | "return_60d" | "max_gain_20d" | "max_dd_20d";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    setSortKey(null); setSortDir("asc");
  };
  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const k = sortKey;
    const arr = [...filteredRows];
    arr.sort((a, b) => {
      const av = a[k] as number | string | null | undefined;
      const bv = b[k] as number | string | null | undefined;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const sa = String(av), sb = String(bv);
      return sortDir === "asc" ? sa.localeCompare(sb, "zh") : sb.localeCompare(sa, "zh");
    });
    return arr;
  }, [filteredRows, sortKey, sortDir]);

  const SortHead = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) => {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        className={cn(
          "whitespace-nowrap px-3 py-2.5 font-medium select-none cursor-pointer hover:text-foreground transition-colors bg-card/95 backdrop-blur",
          align === "right" && "text-right",
        )}
        title="点击排序"
      >
        <span className={cn("inline-flex items-center gap-1", align === "right" ? "justify-end" : "justify-start")}>
          {label}
          {active ? (
            sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-primary shrink-0" /> : <ArrowDown className="h-3 w-3 text-primary shrink-0" />
          ) : (
            <ArrowUpDown className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />
          )}
        </span>
      </th>
    );
  };
  const usesRps = result
    ? (result.criteria.uses_rps ?? result.strategy !== "near_high")
    : false;
  const usesFinance = result
    ? (result.criteria.uses_finance ?? result.strategy === "growth_mrgc_sxhcg")
    : false;
  const usesCapital = result
    ? (result.criteria.uses_capital ?? result.strategy === "growth_mrgc_sxhcg")
    : false;

  // ── 事件处理 ────────────────────────────────────────────────────────────────
  const updateFormulaSource = (source: string) => {
    setDrafts((cur) => ({ ...cur, [selectedKey]: source }));
    setValidation({ status: "idle" });
  };

  const validateFormula = async () => {
    if (!activeSource.trim() || !selected) return;
    setValidating(true);
    setValidation({ status: "validating", message: "正在检查通达信语法和数据函数…" });
    try {
      const checked = await api.validateQuantFormula(selected.baseStrategy, activeSource);
      setDrafts((cur) => ({ ...cur, [selectedKey]: checked.normalized_source }));
      setValidation({
        status: "valid",
        message: `校验通过 · ${checked.formula_hash} · 读取 ${checked.required_history} 日${checked.minimum_history ? `（至少需 ${checked.minimum_history} 日）` : ""}`,
        issues: checked.issues,
      });
    } catch (reason) {
      setValidation({
        status: "invalid",
        message: reason instanceof ApiError ? reason.message : "公式校验失败",
        issues: errorIssues(reason),
      });
    } finally { setValidating(false); }
  };

  const cancelRun = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const run = async () => {
    if (!activeSource.trim() || !selected) {
      setError("选股公式尚未加载完成");
      return;
    }
    // 防止并发：若已有任务在跑，按"取消旧任务"处理
    if (loading) cancelRun();
    setLoading(true);
    setError(null);
    setProgressPhase("validate");
    setProgressDone(0);
    setProgressTotal(1);
    setProgressMessage("正在校验通达信公式…");
    setElapsed(0);

    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    try {
      setValidation({ status: "validating", message: "运行前正在校验通达信公式…" });
      const checked = await api.validateQuantFormula(
        selected.baseStrategy, activeSource, signal,
      );
      setDrafts((cur) => ({ ...cur, [selectedKey]: checked.normalized_source }));
      setValidation({
        status: "valid",
        message: `校验通过，当前筛选使用公式版本 ${checked.formula_hash}`,
        issues: checked.issues,
      });
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");

      const data = await runQuantScreenStream(
        {
          strategy: selected.baseStrategy,
          fund_ratio_min: fundRatioMin,
          north_value_min_yi: northValueMin,
          formula_source: checked.normalized_source,
          as_of_date: screenMode === "backtest" && asOfDate ? asOfDate : undefined,
        },
        (ev: QuantStreamEvent) => {
          if (ev.type === "progress") {
            setProgressPhase(ev.phase);
            setProgressDone(ev.done);
            setProgressTotal(ev.total);
            setProgressMessage(ev.message);
            setElapsed(ev.elapsed);
          } else if (ev.type === "error") {
            // 错误最终由 runQuantScreenStream 抛 ApiError，这里仅提前显示
            setProgressMessage(`❗ ${ev.message}`);
          }
        },
        signal,
      );
      setResult(data);
      setView("matched");
      // 把这次成功的「输入 + 结果 + 当前 tab」存到 module-level cache，
      // 这样点行进 K 线页、再按浏览器返回时，结果不会丢。
      savePersistentSnapshot({
        input: {
          strategy: selected.baseStrategy,
          fund_ratio_min: fundRatioMin,
          north_value_min_yi: northValueMin,
          formula_source: checked.normalized_source,
          as_of_date: screenMode === "backtest" && asOfDate ? asOfDate : undefined,
        },
        result: data,
        view: "matched",
        selectedKey,
        fundRatioMin,
        northValueMin,
        screenMode,
        asOfDate,
        savedAt: Date.now(),
      });
      setProgressPhase(null);
      setProgressMessage("");
      setProgressDone(0);
      setProgressTotal(0);
    } catch (reason) {
      if ((reason as any)?.name === "AbortError") {
        setError(null);
        setProgressMessage("已取消");
      } else {
        setError(reason instanceof ApiError ? reason.message : "筛选失败，请稍后重试");
        if (reason instanceof ApiError && reason.status === 422) {
          setValidation({ status: "invalid", message: reason.message, issues: errorIssues(reason) });
        }
      }
      setProgressPhase(null);
    } finally {
      setLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleAddWatch = (codes: string[]) => {
    if (codes.length === 0) return;
    const current = Array.from(watchSet);
    // 一次合并多只；用 | 分隔喂给 addCodes 的解析器即可。
    const { next, added } = addCodes(current, codes.join("|"));
    if (!added) {
      toast.info("这批股票已全部在自选里");
      return;
    }
    setWatchSet(new Set(next));
    saveWatch(next);
    toast.success(`已加入 ${added} 只到自选股（总 ${next.length} 只）`);
  };

  const exportCsv = () => {
    if (!sortedRows.length) return;
    const headers = [
      "股票代码", "股票名称", "今日涨跌(%)", "行业",
      "基金占流通(%)", "基金家数", "基金持有市值(亿)", "北向持有市值(亿)", "北向占A股(%)",
      ...(usesRps ? ["RPS20", "RPS50", "RPS120", "RPS250"] : []),
      ...(usesCapital ? ["换手率(%)"] : []),
      ...(usesFinance ? ["营收同比(%)", "净利同比(%)"] : []),
      "最新收盘", "一年最高", "距新高(%)", "K线日期"
    ];
    const exportRows = sortedRows.map(r => [
      r.code,
      r.name,
      r.change_pct != null ? (r.change_pct as number).toFixed(2) : "",
      r.industry || "",
      r.fund_float_ratio_pct != null ? r.fund_float_ratio_pct.toFixed(2) : "",
      r.fund_count ?? "",
      r.fund_hold_value_yi != null ? r.fund_hold_value_yi.toFixed(2) : "",
      r.north_hold_value_yi != null ? r.north_hold_value_yi.toFixed(2) : "",
      r.north_total_ratio_pct != null ? r.north_total_ratio_pct.toFixed(2) : "",
      ...(usesRps ? [r.rps20 ?? "", r.rps50 ?? "", r.rps120 ?? "", r.rps250 ?? ""] : []),
      ...(usesCapital ? [r.turnover_pct ?? ""] : []),
      ...(usesFinance ? [r.revenue_yoy_pct ?? "", r.net_profit_yoy_pct ?? ""] : []),
      r.close ?? "",
      r.year_high ?? "",
      r.distance_to_high_pct != null ? r.distance_to_high_pct.toFixed(2) : "",
      r.technical_date || ""
    ]);
    const csvContent = "﻿" + [headers.join(","), ...exportRows.map(row => row.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `量化选股_${selected?.label ?? "结果"}_${result?.technical_date ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSelectStrategy = (key: string) => {
    if (key === selectedKey) return; // 点击已经选中的卡片，绝对不要清空数据！
    setSelectedKey(key);
    setValidation({ status: "idle" });
    setResult(null);
    setView("matched");
    setShowEditor(false);
    savePersistentSnapshot(null);
  };

  const handleAddStrategy = () => {
    const label = newLabel.trim();
    if (!label) return;
    const key = `custom-${Date.now()}`;
    const source = copyCurrentSource ? (drafts[selectedKey] ?? selected?.defaultSource ?? "") : "";
    const entry: CustomStrategy = {
      key, label,
      description: newDesc.trim(),
      base_strategy: newBaseStrategy,
      source,
      createdAt: Date.now(),
    };
    setCustomStrategies((cur) => [...cur, entry]);
    // 草稿用公式快照初始化
    setDrafts((cur) => ({ ...cur, [key]: source }));
    // 重置表单并选中新策略
    setNewLabel(""); setNewDesc(""); setNewBaseStrategy("near_high");
    setCopyCurrentSource(true); setShowAddForm(false);
    handleSelectStrategy(key);
  };

  const handleDeleteStrategy = (key: string) => {
    const strat = customStrategies.find((s) => s.key === key);
    if (!strat) return;
    if (!window.confirm(`确认删除自定义策略「${strat.label}」？此操作不可撤销。`)) return;
    setCustomStrategies((cur) => cur.filter((s) => s.key !== key));
    setDrafts((cur) => { const next = { ...cur }; delete next[key]; return next; });
    if (selectedKey === key) handleSelectStrategy(allStrategies.find((s) => s.key !== key)?.key ?? "near_high");
  };

  const handleHideBuiltin = (key: string) => {
    const strat = allStrategies.find((s) => s.key === key && !s.isCustom);
    if (!strat) return;
    if (!window.confirm(`隐藏内置策略「${strat.label}」？可在策略列表底部点击「恢复」找回。`)) return;
    const next = [...hiddenBuiltins, key];
    setHiddenBuiltins(next);
    if (selectedKey === key) handleSelectStrategy(allStrategies.find((s) => s.key !== key)?.key ?? "near_high");
  };

  const handleRestoreBuiltins = () => {
    setHiddenBuiltins([]);
  };

  const handleEditStrategy = (key: string) => {
    const strat = allStrategies.find((s) => s.key === key);
    if (!strat) return;
    setEditingKey(key);
    setEditLabel(strat.label);
    setEditDesc(strat.description);
    setShowAddForm(false);
    setTimeout(() => editLabelRef.current?.focus(), 50);
  };

  const handleSaveEdit = () => {
    if (!editingKey || !editLabel.trim()) return;
    const label = editLabel.trim();
    const description = editDesc.trim();
    const strat = allStrategies.find((s) => s.key === editingKey);
    if (!strat) { setEditingKey(null); return; }
    if (strat.isCustom) {
      setCustomStrategies((cur) =>
        cur.map((s) => s.key === editingKey ? { ...s, label, description } : s)
      );
    } else {
      setBuiltinOverrides((cur) => ({ ...cur, [editingKey]: { label, description } }));
    }
    setEditingKey(null);
  };

  const openAddForm = () => {
    setShowAddForm(true);
    setEditingKey(null);
    setNewBaseStrategy((selected?.baseStrategy ?? presets[0]?.strategy ?? "near_high") as QuantStrategy);
    setTimeout(() => newLabelRef.current?.focus(), 50);
  };

  return (
    <div className="space-y-4">
      {/* ── 页面标题 + 快捷重新筛选 + RPS 状态条 ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="量化选股"
          subtitle="机构持仓（基金/北向）构建基础池，叠加通达信技术公式二次筛选。"
          actions={result && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  savePersistentSnapshot(null);
                  toast.info("已清空当前筛选结果");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-black/20 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                title="清空当前结果"
              >
                <X className="h-3.5 w-3.5" /> 清空结果
              </button>
              <button
                type="button"
                onClick={run}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-black/20 px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> 重新筛选
              </button>
            </div>
          )}
        />
        <RpsStatusPill
          status={rpsStatus}
          onRefresh={async () => {
            try {
              const next = await api.triggerQuantRpsPrewarm();
              setRpsStatus(next);
            } catch (reason) {
              toast.error(reason instanceof ApiError ? reason.message : "触发 RPS 预热失败");
            }
          }}
        />
      </div>

      {/* ── 主控制面板：策略选择 + 参数配置 + 执行 ── */}
      <GlassCard className="p-5" glow>
        {/* 策略选择标题与分类栏 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <div>
              <span className="text-sm font-semibold text-foreground">选股策略</span>
              <span className="ml-2 text-xs text-muted-foreground">选择或自定义通达信筛选策略</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border/60 bg-black/30 p-0.5 text-xs">
              {(["all", "blue_diamond", "classic", "custom"] as const).map((cat) => {
                const isActive = activeCategoryTab === cat;
                const label = cat === "all" ? "全部" : CATEGORY_META[cat].title;
                const count = categoryCounts[cat];
                if (cat === "custom" && count === 0 && !isActive) return null;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategoryTab(cat)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                      isActive
                        ? "bg-primary/20 text-primary shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span>{label}</span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                      isActive ? "bg-primary/30 text-primary" : "bg-white/5 text-muted-foreground"
                    )}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={strategySearch}
                onChange={(e) => setStrategySearch(e.target.value)}
                placeholder="搜索策略…"
                className="w-32 sm:w-44 rounded-lg border border-border/60 bg-black/30 py-1 pl-8 pr-3 text-xs outline-none transition-all focus:w-52 focus:border-primary/50"
              />
            </div>

            {!showAddForm && !editingKey && (
              <button
                type="button"
                disabled={loading || formulaLoading}
                onClick={openAddForm}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-2.5 py-1 text-xs text-primary transition-all hover:bg-primary/15 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> 自定义策略
              </button>
            )}
          </div>
        </div>

        {/* 策略卡片网格 */}
        {formulaLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> 正在加载通达信策略列表…
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredStrategies.map((item) => {
              const isActive = item.key === selectedKey;
              return (
                <div
                  key={item.key}
                  className={cn(
                    "group relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all",
                    isActive
                      ? "border-primary/80 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent shadow-md shadow-primary/10 ring-1 ring-primary/40"
                      : "border-border/60 bg-black/20 hover:border-primary/40 hover:bg-black/30"
                  )}
                >
                  <button
                    type="button"
                    data-testid={isActive ? "quant-strategy" : undefined}
                    disabled={loading}
                    onClick={() => handleSelectStrategy(item.key)}
                    className="flex flex-1 flex-col text-left disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                          isActive ? "bg-primary/25 text-primary" : "bg-muted/50 text-muted-foreground"
                        )}>
                          {item.icon}
                        </span>
                        <span className={cn(
                          "text-sm font-semibold tracking-tight",
                          isActive ? "text-primary" : "text-foreground/90"
                        )}>
                          {item.label}
                        </span>
                      </div>
                      {isActive ? (
                        <span className="flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          <Check className="h-3 w-3" /> 当前选中
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                          点击选择
                        </span>
                      )}
                    </div>

                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground/90">
                      {item.description || <span className="opacity-40">暂无策略说明</span>}
                    </p>

                    {item.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {item.tags.map((tag) => (
                          <span
                            key={tag}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              TAG_META[tag].tone
                            )}
                          >
                            {TAG_META[tag].label}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>

                  <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label={`重命名策略 ${item.label}`}
                      onClick={(e) => { e.stopPropagation(); handleEditStrategy(item.key); }}
                      className="rounded-md bg-black/50 p-1 text-muted-foreground backdrop-blur hover:text-primary"
                      title="重命名策略"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={item.isCustom ? `删除策略 ${item.label}` : `隐藏策略 ${item.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        item.isCustom ? handleDeleteStrategy(item.key) : handleHideBuiltin(item.key);
                      }}
                      className="rounded-md bg-black/50 p-1 text-muted-foreground backdrop-blur hover:text-destructive"
                      title={item.isCustom ? "删除此自定义策略" : "隐藏内置策略"}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {filteredStrategies.length === 0 && !formulaLoading && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            没有匹配「{strategySearch}」的策略
          </div>
        )}

        {/* 策略说明 */}
        {selected && (
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            {selected.description || <span className="opacity-50">暂无说明</span>}
            {selected.isCustom && (
              <span className="ml-2 opacity-60">· 基础引擎：{selected.baseStrategy}</span>
            )}
          </p>
        )}

        {/* ── 新增策略表单 ── */}
        {showAddForm && (
          <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
            <p className="mb-3 text-sm font-semibold">新建自定义策略</p>
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">策略名称 <span className="text-destructive">*</span></span>
                <input
                  ref={newLabelRef}
                  type="text"
                  value={newLabel}
                  maxLength={30}
                  placeholder="例如：均线金叉策略"
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && newLabel.trim() && handleAddStrategy()}
                  className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">策略说明（可选）</span>
                <input
                  type="text"
                  value={newDesc}
                  maxLength={60}
                  placeholder="简要描述选股逻辑"
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </label>
            </div>
            <div className="mb-4">
              <span className="mb-2 block text-xs font-medium text-muted-foreground">基础引擎</span>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <button
                    key={p.strategy}
                    type="button"
                    onClick={() => setNewBaseStrategy(p.strategy as QuantStrategy)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm font-medium transition-all",
                      newBaseStrategy === p.strategy
                        ? "border-primary/60 bg-primary/15 text-primary shadow-sm shadow-primary/10"
                        : "border-border bg-black/20 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {presets.find((p) => p.strategy === newBaseStrategy)?.description}
              </p>
            </div>
            <div className="mb-3">
              <button
                type="button"
                onClick={() => setCopyCurrentSource((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all",
                  copyCurrentSource
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-black/20 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                )}
              >
                <span className={cn(
                  "flex h-4 w-4 items-center justify-center rounded border text-[10px] transition-all",
                  copyCurrentSource
                    ? "border-primary/60 bg-primary/20 text-primary"
                    : "border-border bg-black/20"
                )}>
                  {copyCurrentSource && "✓"}
                </span>
                以当前公式为起点
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowAddForm(false); setNewLabel(""); setNewDesc(""); }}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!newLabel.trim()}
                onClick={handleAddStrategy}
                className="rounded-lg bg-primary/15 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/25 disabled:opacity-40"
              >
                保存策略
              </button>
            </div>
          </div>
        )}

        {/* ── 编辑策略名称/说明表单 ── */}
        {editingKey !== null && (
          <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
            <p className="mb-3 text-sm font-semibold">
              编辑策略：{allStrategies.find((s) => s.key === editingKey)?.isCustom ? "" : "（内置）"}
              {allStrategies.find((s) => s.key === editingKey)?.label}
            </p>
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  策略名称 <span className="text-destructive">*</span>
                </span>
                <input
                  ref={editLabelRef}
                  type="text"
                  value={editLabel}
                  maxLength={30}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && editLabel.trim() && handleSaveEdit()}
                  className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">策略说明</span>
                <input
                  type="text"
                  value={editDesc}
                  maxLength={60}
                  placeholder="简要描述选股逻辑"
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingKey(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!editLabel.trim()}
                onClick={handleSaveEdit}
                className="rounded-lg bg-primary/15 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/25 disabled:opacity-40"
              >
                保存
              </button>
            </div>
          </div>
        )}

        {/* 已隐藏内置策略提示 */}
        {hiddenBuiltins.length > 0 && (
          <p className="mt-2.5 text-xs text-muted-foreground">
            已隐藏 {hiddenBuiltins.length} 个内置策略
            <button
              type="button"
              onClick={handleRestoreBuiltins}
              className="ml-2 text-primary underline-offset-2 hover:underline"
            >
              全部恢复
            </button>
          </p>
        )}

        <div className="my-4 border-t border-border/40" />

        {/* 核心筛选链路配置（基础池 + 公式） */}
        <div className="space-y-3">
          {/* ── 选股模式切换：实时选股 vs 历史回测 ── */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/50 bg-black/20 p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {screenMode === "live" ? <Zap className="h-4 w-4" /> : <History className="h-4 w-4" />}
              </span>
              <div>
                <span className="text-xs font-semibold text-foreground">
                  {screenMode === "live" ? "实时选股模式" : "历史回测模式"}
                </span>
                <span className="ml-2 text-[11px] text-muted-foreground">
                  {screenMode === "live"
                    ? "使用最新行情与 RPS 执行筛选"
                    : "回放到指定历史交易日执行选股，并自动跟踪 T+5/10/20/60 胜率与收益表现"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-border/60 bg-black/30 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => { setScreenMode("live"); setAsOfDate(""); }}
                  className={cn(
                    "rounded-md px-3 py-1 font-medium transition-all",
                    screenMode === "live" ? "bg-primary/20 text-primary font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  今日实时
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScreenMode("backtest");
                    if (!asOfDate) {
                      const d = new Date();
                      d.setDate(d.getDate() - 30);
                      setAsOfDate(d.toISOString().slice(0, 10));
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-3 py-1 font-medium transition-all",
                    screenMode === "backtest" ? "bg-primary/20 text-primary font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <History className="h-3.5 w-3.5" />
                  历史回测
                </button>
              </div>

              {screenMode === "backtest" && (
                <div className="flex flex-wrap items-center gap-1.5 animate-in fade-in-50">
                  <input
                    type="date"
                    value={asOfDate}
                    onChange={(e) => { setAsOfDate(e.target.value); }}
                    className="rounded-lg border border-border/60 bg-black/40 px-2.5 py-1 text-xs font-mono outline-none focus:border-primary/50"
                  />
                  {[
                    { label: "1周前", days: 7 },
                    { label: "1个月前", days: 30 },
                    { label: "3个月前", days: 90 },
                    { label: "半年前", days: 180 },
                    { label: "1年前", days: 365 },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() - item.days);
                        setAsOfDate(d.toISOString().slice(0, 10));
                      }}
                      className="rounded border border-border/50 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground hover:border-primary/40"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* 基础池条件 */}
            <div className="rounded-xl border border-border/50 bg-black/20 p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-sky-400" />
                  <span className="text-xs font-semibold text-foreground">基础池入池门槛</span>
                  <span className="rounded-full bg-sky-400/10 px-1.5 py-0.2 text-[10px] text-sky-400">满足其一</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBasePool(!showBasePool)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showBasePool ? "精简设置" : "自定义参数"}
                </button>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">基金持股 ≥</span>
                  {[3, 5, 8, 10].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => { setFundRatioMin(val); }}
                      className={cn(
                        "rounded px-2 py-0.5 font-mono text-xs transition-colors",
                        fundRatioMin === val
                          ? "bg-sky-500/20 text-sky-400 font-semibold"
                          : "bg-white/5 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {val}%
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">北向市值 ≥</span>
                  {[0.5, 1, 3, 5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => { setNorthValueMin(val); }}
                      className={cn(
                        "rounded px-2 py-0.5 font-mono text-xs transition-colors",
                        northValueMin === val
                          ? "bg-sky-500/20 text-sky-400 font-semibold"
                          : "bg-white/5 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {val}亿
                    </button>
                  ))}
                </div>
              </div>

              {showBasePool && (
                <div className="mt-3 grid gap-2.5 pt-2 border-t border-border/30 sm:grid-cols-2">
                  <ConditionInput
                    label="基金持股占流通股 ≥"
                    value={fundRatioMin}
                    suffix="%"
                    min={0.1}
                    max={100}
                    step={0.5}
                    onChange={(v) => { setFundRatioMin(Number.isFinite(v) ? v : 0); }}
                  />
                  <ConditionInput
                    label="北向持股市值 ≥"
                    value={northValueMin}
                    suffix="亿元"
                    min={0}
                    max={100000}
                    step={0.5}
                    onChange={(v) => { setNorthValueMin(Number.isFinite(v) ? v : 0); }}
                  />
                </div>
              )}
            </div>

            {/* 技术公式状态与源码入口 */}
            <div className="rounded-xl border border-border/50 bg-black/20 p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Code2 className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold text-foreground">技术筛选公式</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {activeSource.split(/\r?\n/).length} 行
                  </span>
                  {isDirty && (
                    <span className="rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.2 text-[9px] font-medium text-warning">
                      已修改
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowEditor(!showEditor)}
                  className="inline-flex items-center gap-1 text-xs text-primary transition-colors hover:underline"
                >
                  {showEditor ? "收起源码" : "查看/编辑源码"}
                  {showEditor ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              </div>

              <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                当前公式：<span className="font-semibold text-foreground">{selected?.label ?? "未选定"}</span>
                {selected?.isCustom && <span className="ml-1 opacity-70">（自定义）</span>}
                <p className="mt-1 line-clamp-1 text-[11px] opacity-70">
                  {selected?.description}
                </p>
              </div>
            </div>
          </div>

          {selected && activeSource && showEditor && (
            <div className="rounded-xl border border-border/60 bg-black/30 p-3">
              <TdxFormulaEditor
                source={activeSource}
                defaultSource={selected.defaultSource}
                strategyLabel={selected.label}
                validation={validation}
                disabled={loading}
                onSourceChange={updateFormulaSource}
                onValidate={validateFormula}
                onReset={() => {
                  updateFormulaSource(selected.defaultSource);
                  setValidation({ status: "idle", message: "已恢复当前策略的默认公式" });
                }}
              />
            </div>
          )}

          {/* 流程摘要与执行选股按钮 */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 bg-black/30 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-white/5 px-2 py-1 font-mono text-muted-foreground">
                基础池: 基金 ≥ {fundRatioMin}% OR 北向 ≥ {northValueMin}亿
              </span>
              <span className="text-muted-foreground">➔</span>
              <span className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">
                技术公式: {selected?.label}（{activeSource.split(/\r?\n/).length} 行）
              </span>
            </div>

            <div className="flex items-center gap-2">
              {loading && (
                <button
                  type="button"
                  onClick={cancelRun}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-all hover:border-destructive/40 hover:text-destructive"
                >
                  <Square className="h-3.5 w-3.5" /> 取消
                </button>
              )}
              <button
                data-testid="quant-run"
                onClick={run}
                disabled={loading || validating || formulaLoading || !activeSource.trim()}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-glow transition-all hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
              >
                {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                {loading
                  ? (PHASE_LABEL[progressPhase ?? ""] ?? "执行选股中…")
                  : validating ? "正在验证公式…" : "验证并开始筛选"}
              </button>
            </div>
          </div>

          {/* 进度条与阶段详情 */}
          {loading && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 animate-in fade-in-50">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                  <span className="font-semibold text-foreground">
                    {PHASE_LABEL[progressPhase ?? ""] ?? "准备中…"}
                  </span>
                  {progressTotal > 0 && progressPhase !== "validate" && (
                    <span className="font-mono text-primary font-medium">
                      {progressDone}/{progressTotal}
                    </span>
                  )}
                </div>
                <span className="font-mono text-muted-foreground">
                  已运行 {elapsed.toFixed(1)}s
                </span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-black/40">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary/60 via-primary to-amber-400 transition-all duration-300 ease-out"
                  style={{ width: `${aggregateProgress(progressPhase, progressDone, progressTotal).toFixed(1)}%` }}
                />
              </div>

              {progressMessage && (
                <p className="mt-2 break-all text-xs font-mono text-muted-foreground">
                  {progressMessage}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-1.5">
                {PHASE_ORDER.map((key) => {
                  const isActive = key === progressPhase;
                  const idxActive = progressPhase ? PHASE_ORDER.indexOf(progressPhase as typeof PHASE_ORDER[number]) : -1;
                  const idxKey = PHASE_ORDER.indexOf(key);
                  const isDone = idxActive >= 0 && idxKey < idxActive;
                  return (
                    <span
                      key={key}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all",
                        isActive
                          ? "bg-primary/25 text-primary ring-1 ring-primary/40"
                          : isDone
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-white/5 text-muted-foreground/50"
                      )}
                    >
                      {isDone && <Check className="h-3 w-3" />}
                      {isActive && <LoaderCircle className="h-3 w-3 animate-spin" />}
                      {PHASE_LABEL[key]}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </GlassCard>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── 筛选结果看板 ── */}
      {result && (
        <div className="space-y-4">
          {/* ── 策略历史回测表现看板 ── */}
          {result.backtest_summary && (
            <GlassCard className="!p-4 border-l-4 border-l-emerald-500" glow>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2.5 mb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/20 text-emerald-400">
                    <BarChart3 className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    策略历史回测表现 · 胜率与收益统计
                  </span>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono text-emerald-400">
                    基准日期: {result.backtest_summary.as_of_date} · 样本: {result.backtest_summary.sample_count} 只
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>20日盈亏比: <strong className="font-mono text-foreground font-num">{result.backtest_summary.profit_loss_ratio_20d ?? "—"}</strong></span>
                  <span>20日最高中位数: <strong className="font-mono text-market-up font-num">+{result.backtest_summary.max_gain_median_20d ?? 0}%</strong></span>
                  <span>20日最大跌中位数: <strong className="font-mono text-market-down font-num">{result.backtest_summary.max_dd_median_20d ?? 0}%</strong></span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "T+5 胜率与收益", win: result.backtest_summary.win_rate_5d, ret: result.backtest_summary.avg_return_5d },
                  { label: "T+10 胜率与收益", win: result.backtest_summary.win_rate_10d, ret: result.backtest_summary.avg_return_10d },
                  { label: "T+20 胜率与收益", win: result.backtest_summary.win_rate_20d, ret: result.backtest_summary.avg_return_20d },
                  { label: "T+60 胜率与收益", win: result.backtest_summary.win_rate_60d, ret: result.backtest_summary.avg_return_60d },
                ].map((item, idx) => (
                  <div key={idx} className="rounded-lg border border-border/50 bg-black/25 p-2.5">
                    <div className="text-[11px] text-muted-foreground mb-1">{item.label}</div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-lg font-bold font-mono font-num text-foreground">
                        {item.win != null ? `${item.win}%` : "—"}
                      </span>
                      <span className={cn(
                        "font-mono font-semibold text-xs",
                        item.ret == null ? "text-muted-foreground" :
                        item.ret > 0 ? "text-market-up" : "text-market-down"
                      )}>
                        {item.ret != null ? `${item.ret > 0 ? "+" : ""}${item.ret}%` : "—"}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border/40">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          (item.win ?? 0) >= 60 ? "bg-emerald-400" : (item.win ?? 0) >= 50 ? "bg-amber-400" : "bg-muted-foreground"
                        )}
                        style={{ width: `${Math.min(100, Math.max(0, item.win ?? 0))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <GlassCard className="!p-4 relative overflow-hidden border-l-4 border-l-blue-500">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Database className="h-4 w-4 text-blue-400" /> 基金达标
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  期 {result.fund_period}
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold font-mono font-num text-foreground">
                {result.fund_candidate_count}
              </p>
              <p className="text-[11px] text-muted-foreground">基金持股 ≥ {fundRatioMin}%</p>
            </GlassCard>

            <GlassCard className="!p-4 relative overflow-hidden border-l-4 border-l-sky-500">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Database className="h-4 w-4 text-sky-400" /> 北向达标
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  期 {result.north_period}
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold font-mono font-num text-foreground">
                {result.north_candidate_count}
              </p>
              <p className="text-[11px] text-muted-foreground">北向市值 ≥ {northValueMin}亿</p>
            </GlassCard>

            <GlassCard className="!p-4 relative overflow-hidden border-l-4 border-l-purple-500">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Layers3 className="h-4 w-4 text-purple-400" /> 基础池并集
                </span>
                <span className="font-mono text-[10px] text-purple-400 font-medium">
                  重叠 {result.overlap_count} 只
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold font-mono font-num text-foreground">
                {result.base_count}
              </p>
              <p className="text-[11px] text-muted-foreground">基金与北向并集总数</p>
            </GlassCard>

            <GlassCard className="!p-4 relative overflow-hidden border-l-4 border-l-primary" glow>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium text-primary">
                  <TrendingUp className="h-4 w-4 text-primary" /> 技术最终命中
                </span>
                <span className="font-mono text-[10px] text-primary">
                  {result.elapsed_seconds}s
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold font-mono font-num text-primary">
                {result.matched_count}
              </p>
              <p className="text-[11px] text-muted-foreground">
                转化率 {result.base_count > 0 ? ((result.matched_count / result.base_count) * 100).toFixed(1) : 0}% · 命中通达信公式
              </p>
            </GlassCard>
          </div>

          {result.rps_meta && (
            <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <span>
                  <strong className="text-foreground">全市场 RPS 快照：</strong>
                  {result.rps_meta.trade_date} · 沪深 A 股 {result.rps_meta.universe_count} 只 · 剔除上市不足一年的 {result.rps_meta.excluded_short_history_count} 只 · 最终 {result.rps_meta.eligible_count} 只参与动量排名
                </span>
              </div>
            </div>
          )}

          <GlassCard className="!p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-5 py-3.5 bg-black/20">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex rounded-lg border border-border/60 bg-black/30 p-0.5 text-xs">
                  <button
                    onClick={() => {
                      setView("matched");
                      if (_cachedSnapshot) {
                        savePersistentSnapshot({ ..._cachedSnapshot, view: "matched" });
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all",
                      view === "matched" ? "bg-primary text-primary-foreground font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span>技术命中</span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                      view === "matched" ? "bg-black/20 text-white" : "bg-white/5 text-muted-foreground"
                    )}>
                      {result.matched_count}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setView("base");
                      if (_cachedSnapshot) {
                        savePersistentSnapshot({ ..._cachedSnapshot, view: "base" });
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all",
                      view === "base" ? "bg-primary text-primary-foreground font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span>基础池</span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                      view === "base" ? "bg-black/20 text-white" : "bg-white/5 text-muted-foreground"
                    )}>
                      {result.base_count}
                    </span>
                  </button>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="按代码 / 名称 / 行业过滤…"
                    className="w-48 sm:w-56 rounded-lg border border-border/60 bg-black/30 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary/50"
                  />
                  {tableSearch && (
                    <button
                      type="button"
                      onClick={() => setTableSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <div className="hidden sm:flex items-center gap-1 text-xs">
                  {[
                    { key: "all", label: "全部" },
                    { key: "up", label: "今日上涨" },
                    { key: "high_rps", label: "RPS ≥ 90" },
                    { key: "unwatched", label: "未自选" },
                  ].map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setTableFilter(f.key as any)}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs transition-colors",
                        tableFilter === f.key
                          ? "bg-white/15 text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportCsv}
                  disabled={sortedRows.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-black/20 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  title="导出当前筛选结果为 CSV"
                >
                  <Download className="h-3.5 w-3.5" /> 导出 CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const codes = sortedRows.map((r) => r.code).filter((c) => !watchSet.has(c));
                    handleAddWatch(codes);
                  }}
                  disabled={!sortedRows.some((r) => !watchSet.has(r.code))}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:border-border/40 disabled:bg-black/20 disabled:text-muted-foreground"
                  title="把当前表格中未加入自选的股票一次性加入"
                >
                  <Star className="h-3.5 w-3.5" /> 全部加入自选
                </button>
              </div>
            </div>

            {sortedRows.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                {tableSearch || tableFilter !== "all"
                  ? "当前过滤条件下没有匹配的个股，请尝试清除搜索框。"
                  : "当前条件没有命中，可适当放宽基金或北向持股阈值后重试。"}
              </div>
            ) : (
              <div className="max-h-[640px] overflow-auto">
                <table className="w-full min-w-[1380px] text-sm">
                  <thead className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border/60">
                    <tr className="text-left text-[11px] text-muted-foreground">
                      <th className="sticky left-0 z-30 bg-card/95 backdrop-blur whitespace-nowrap px-4 py-2.5 font-medium shadow-[2px_0_6px_rgba(0,0,0,0.25)]">
                        <button
                          type="button"
                          onClick={() => toggleSort("name")}
                          className={cn("inline-flex items-center gap-1 hover:text-foreground transition-colors", sortKey === "name" && "text-primary")}
                          title="点击按名称排序"
                        >
                          名称 / 代码
                          {sortKey === "name" ? (
                            sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                          ) : (
                            <ArrowUpDown className="h-2.5 w-2.5 text-muted-foreground/30" />
                          )}
                        </button>
                      </th>
                      <SortHead k="change_pct" label="今日涨跌" align="right" />
                      <SortHead k="industry" label="行业" />
                      <SortHead k="fund_float_ratio_pct" label="基金占流通" align="right" />
                      <SortHead k="fund_count" label="基金家数" align="right" />
                      <SortHead k="fund_hold_value_yi" label="基金市值" align="right" />
                      <SortHead k="north_hold_value_yi" label="北向市值" align="right" />
                      <SortHead k="north_total_ratio_pct" label="北向占A股" align="right" />
                      {usesRps && (
                        <>
                          <SortHead k="rps20" label="RPS20" align="right" />
                          <SortHead k="rps50" label="RPS50" align="right" />
                          <SortHead k="rps120" label="RPS120" align="right" />
                          <SortHead k="rps250" label="RPS250" align="right" />
                        </>
                      )}
                      {usesCapital && <SortHead k="turnover_pct" label="换手率" align="right" />}
                      {usesFinance && (
                        <>
                          <SortHead k="revenue_yoy_pct" label="营收同比" align="right" />
                          <SortHead k="net_profit_yoy_pct" label="净利同比" align="right" />
                        </>
                      )}
                      <SortHead k="close" label="最新收盘" align="right" />
                      <SortHead k="timing_score" label="3L择时/形态" />
                      <SortHead k="ma20" label="生命线MA20" align="right" />
                      <SortHead k="key_support" label="支撑/止损" align="right" />
                      <SortHead k="risk_reward_ratio" label="盈亏比" align="right" />
                      {result.backtest_summary && (
                        <>
                          <SortHead k="return_5d" label="T+5收益" align="right" />
                          <SortHead k="return_10d" label="T+10收益" align="right" />
                          <SortHead k="return_20d" label="T+20收益" align="right" />
                          <SortHead k="max_gain_20d" label="20日最高" align="right" />
                          <SortHead k="max_dd_20d" label="20日最大跌" align="right" />
                        </>
                      )}
                      <SortHead k="distance_to_high_pct" label="距新高" align="right" />
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium bg-card/95 backdrop-blur">K线日期</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium text-center bg-card/95 backdrop-blur">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row: QuantRow) => (
                      <tr
                        key={row.code}
                        onClick={() => navigate(`/stock-kline/${row.code}`)}
                        className="cursor-pointer border-b border-border/30 transition-colors hover:bg-muted/25 group"
                      >
                        <td className="sticky left-0 z-[5] bg-card/95 backdrop-blur px-4 py-2.5 shadow-[2px_0_6px_rgba(0,0,0,0.25)]">
                          <Link
                            to={`/stock-kline/${row.code}`}
                            onClick={(e) => e.stopPropagation()}
                            className="block"
                          >
                            <div className="font-semibold text-foreground group-hover:text-primary transition-colors">
                              {row.name}
                            </div>
                            <div className="font-mono font-num text-[11px] text-muted-foreground">
                              {row.code}
                            </div>
                          </Link>
                        </td>

                        <td className={cn(
                          "px-3 py-2.5 text-right font-mono font-num",
                          row.change_pct == null ? "text-muted-foreground" :
                          (row.change_pct as number) > 0 ? "text-market-up font-semibold" :
                          (row.change_pct as number) < 0 ? "text-market-down font-semibold" : "text-muted-foreground",
                        )}>
                          {row.change_pct == null ? "—" : `${(row.change_pct as number) > 0 ? "+" : ""}${(row.change_pct as number).toFixed(2)}%`}
                        </td>

                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                          {row.industry || "—"}
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono font-num text-primary font-medium">
                          {numberText(row.fund_float_ratio_pct, 2)}%
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-num text-muted-foreground">
                          {row.fund_count ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-num">
                          {numberText(row.fund_hold_value_yi)}亿
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono font-num">
                          {numberText(row.north_hold_value_yi)}亿
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-num text-muted-foreground">
                          {numberText(row.north_total_ratio_pct)}%
                        </td>

                        {usesRps && (
                          <>
                            {(["rps20", "rps50", "rps120", "rps250"] as const).map((rk) => {
                              const val = row[rk] as number | null | undefined;
                              return (
                                <td key={rk} className="relative px-3 py-2.5 text-right font-mono font-num">
                                  {val != null && (
                                    <div
                                      className={cn(
                                        "pointer-events-none absolute inset-y-2 right-1 rounded-sm opacity-20 transition-all",
                                        val >= 95 ? "bg-market-up" : val >= 90 ? "bg-amber-400" : "bg-muted-foreground/30",
                                      )}
                                      style={{ width: `${Math.min(100, Math.max(0, val))}%` }}
                                    />
                                  )}
                                  <span className={cn(
                                    "relative z-[1]",
                                    val != null && val >= 95
                                      ? "text-market-up font-bold"
                                      : val != null && val >= 90
                                      ? "text-amber-400 font-semibold"
                                      : "text-foreground/80"
                                  )}>
                                    {numberText(val)}
                                  </span>
                                </td>
                              );
                            })}
                          </>
                        )}

                        {usesCapital && (
                          <td className="px-3 py-2.5 text-right font-mono font-num">
                            {numberText(row.turnover_pct)}%
                          </td>
                        )}

                        {usesFinance && (
                          <>
                            <td className="px-3 py-2.5 text-right font-mono font-num">
                              {numberText(row.revenue_yoy_pct)}%
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-num">
                              {numberText(row.net_profit_yoy_pct)}%
                            </td>
                          </>
                        )}

                        {/* 最新收盘 */}
                        <td className="px-3 py-2.5 text-right font-mono font-num font-medium">
                          {numberText(row.close, 2)}
                        </td>

                        {/* 3L 择时评估与买前十问入口 */}
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setChecklistStock(row);
                              }}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-all hover:scale-105",
                                row.timing_status === "均线低吸点" ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40" :
                                row.timing_status === "关键点突破" ? "bg-primary/20 text-primary ring-1 ring-primary/40" :
                                row.timing_status === "主升通道" ? "bg-sky-500/20 text-sky-400" :
                                row.timing_status === "乖离过大" ? "bg-amber-500/20 text-amber-400" :
                                row.timing_status === "破位回避" ? "bg-rose-500/20 text-rose-400" :
                                "bg-white/10 text-muted-foreground"
                              )}
                              title="点击进行 3L 买前十问知行合一复核"
                            >
                              <Target className="h-3 w-3" />
                              <span>{row.timing_status || "—"}</span>
                            </button>
                            {row.risk_tags && row.risk_tags.length > 0 && (
                              <span className="rounded bg-rose-500/15 px-1 py-0.2 text-[9px] font-medium text-rose-400">
                                {row.risk_tags[0]}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 生命线 MA20 */}
                        <td className="px-3 py-2.5 text-right font-mono font-num text-xs">
                          {row.ma20 != null ? (
                            <div className="flex items-center justify-end gap-1">
                              <span>{numberText(row.ma20, 2)}</span>
                              <span className={cn(
                                "text-[10px]",
                                row.ma20_slope === "up" ? "text-market-up" :
                                row.ma20_slope === "down" ? "text-market-down" : "text-muted-foreground"
                              )}>
                                {row.ma20_slope === "up" ? "▲" : row.ma20_slope === "down" ? "▼" : "—"}
                              </span>
                            </div>
                          ) : "—"}
                        </td>

                        {/* 支撑防线 */}
                        <td className="px-3 py-2.5 text-right font-mono font-num text-xs">
                          <div className="flex flex-col items-end leading-tight">
                            <span className="text-foreground/90">{numberText(row.key_support, 2)}</span>
                            <span className="text-[10px] text-rose-400/80">-{numberText(row.stop_loss_hard_8, 2)}</span>
                          </div>
                        </td>

                        {/* 预估盈亏比 */}
                        <td className="px-3 py-2.5 text-right font-mono font-num">
                          {row.risk_reward_ratio != null ? (
                            <span className={cn(
                              "font-semibold",
                              row.risk_reward_ratio >= 3.0 ? "text-emerald-400" :
                              row.risk_reward_ratio >= 2.0 ? "text-amber-400" : "text-muted-foreground"
                            )}>
                              {row.risk_reward_ratio}:1
                            </span>
                          ) : "—"}
                        </td>

                        {/* 回测收益列（仅在回测模式下展示） */}
                        {result.backtest_summary && (
                          <>
                            <td className={cn(
                              "px-3 py-2.5 text-right font-mono font-num",
                              row.return_5d == null ? "text-muted-foreground" :
                              row.return_5d > 0 ? "text-market-up font-medium" : "text-market-down font-medium"
                            )}>
                              {row.return_5d != null ? `${row.return_5d > 0 ? "+" : ""}${row.return_5d}%` : "—"}
                            </td>
                            <td className={cn(
                              "px-3 py-2.5 text-right font-mono font-num",
                              row.return_10d == null ? "text-muted-foreground" :
                              row.return_10d > 0 ? "text-market-up font-medium" : "text-market-down font-medium"
                            )}>
                              {row.return_10d != null ? `${row.return_10d > 0 ? "+" : ""}${row.return_10d}%` : "—"}
                            </td>
                            <td className={cn(
                              "px-3 py-2.5 text-right font-mono font-num",
                              row.return_20d == null ? "text-muted-foreground" :
                              row.return_20d > 0 ? "text-market-up font-bold" : "text-market-down font-bold"
                            )}>
                              {row.return_20d != null ? `${row.return_20d > 0 ? "+" : ""}${row.return_20d}%` : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-num text-market-up font-medium">
                              {row.max_gain_20d != null ? `+${row.max_gain_20d}%` : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-num text-market-down font-medium">
                              {row.max_dd_20d != null ? `${row.max_dd_20d}%` : "—"}
                            </td>
                          </>
                        )}

                        {/* 距新高 */}
                        <td className={cn(
                          "px-3 py-2.5 text-right font-mono font-num font-medium",
                          row.distance_to_high_pct != null && row.distance_to_high_pct <= 5
                            ? "text-primary font-bold"
                            : "text-muted-foreground"
                        )}>
                          {row.distance_to_high_pct == null ? "—" : `${numberText(row.distance_to_high_pct, 2)}%`}
                        </td>

                        <td className="whitespace-nowrap px-3 py-2.5 font-mono font-num text-xs text-muted-foreground">
                          {row.technical_date || "—"}
                        </td>

                        <td className="whitespace-nowrap px-3 py-2.5 text-center">
                          {watchSet.has(row.code) ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                              <Star className="h-3 w-3 fill-current" /> 已自选
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddWatch([row.code]);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary/60 hover:text-primary"
                              title={`将 ${row.code} 加入自选股`}
                            >
                              <Star className="h-3 w-3" /> 加自选
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-border/40 px-5 py-2.5 text-xs text-muted-foreground bg-black/10">
              <div>
                共显示 <span className="font-mono font-semibold text-foreground">{sortedRows.length}</span> 只股票
                {filteredRows.length !== rows.length && (
                  <span className="ml-1 opacity-70">（已从 {rows.length} 过滤）</span>
                )}
              </div>
              <div className="flex items-center gap-4 text-[11px] opacity-70">
                <span>点击表头支持任意列三态排序</span>
                <span>点击单行可直接前往 K 线深度图</span>
              </div>
            </div>
          </GlassCard>
        </div>
      )}

      {!result && !loading && (
        <GlassCard className="py-12 text-center">
          <div className="mx-auto max-w-md space-y-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <SlidersHorizontal className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-foreground">准备开始两阶段量化选股</p>
            <p className="text-xs text-muted-foreground">
              选择上方的选股策略，根据需要调整基金或北向持股阈值，然后点击“验证并开始筛选”。
              支持今日实时选股与历史回测，日 K 本地持久化极速响应。
            </p>
          </div>
        </GlassCard>
      )}

      {/* ── 3L 买前十问知行合一检查表弹窗 ── */}
      {checklistStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in-50">
          <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-primary/40 bg-card shadow-2xl overflow-hidden">
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-border/50 bg-black/40 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
                  <Target className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    3L交易体系 · 买前十问知行合一检查表
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {checklistStock.name} ({checklistStock.code}) · 行业: {checklistStock.industry || "—"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setChecklistStock(null); setCheckedQuestions({}); }}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 关键数据摘要药丸 */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 border-b border-border/40 bg-black/20 p-3 text-xs">
              <div className="rounded border border-border/40 bg-black/30 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">最新收盘</div>
                <div className="mt-0.5 font-mono font-bold font-num text-foreground">{checklistStock.close}</div>
              </div>
              <div className="rounded border border-border/40 bg-black/30 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">生命线 MA20</div>
                <div className="mt-0.5 font-mono font-bold font-num text-sky-400">{checklistStock.ma20 ?? "—"}</div>
              </div>
              <div className="rounded border border-border/40 bg-black/30 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">硬止损(-8%)</div>
                <div className="mt-0.5 font-mono font-bold font-num text-rose-400">{checklistStock.stop_loss_hard_8 ?? "—"}</div>
              </div>
              <div className="rounded border border-border/40 bg-black/30 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">RPS250/120</div>
                <div className="mt-0.5 font-mono font-bold font-num text-primary">{checklistStock.rps250 ?? "—"}/{checklistStock.rps120 ?? "—"}</div>
              </div>
              <div className="rounded border border-border/40 bg-black/30 p-2 text-center col-span-2 sm:col-span-1">
                <div className="text-[10px] text-muted-foreground">预估盈亏比</div>
                <div className={cn(
                  "mt-0.5 font-mono font-bold font-num",
                  (checklistStock.risk_reward_ratio ?? 0) >= 3 ? "text-emerald-400" : "text-amber-400"
                )}>
                  {checklistStock.risk_reward_ratio ? `${checklistStock.risk_reward_ratio}:1` : "—"}
                </div>
              </div>
            </div>

            {/* 十问清单列表（可滚动） */}
            <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
              {QUESTIONS_3L.map((q) => {
                const isChecked = !!checkedQuestions[q.id];
                return (
                  <div
                    key={q.id}
                    onClick={() => setCheckedQuestions((prev) => ({ ...prev, [q.id]: !prev[q.id] }))}
                    className={cn(
                      "group flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all",
                      isChecked
                        ? "border-primary/50 bg-primary/10 shadow-sm"
                        : "border-border/60 bg-black/20 hover:border-primary/30 hover:bg-black/30"
                    )}
                  >
                    <div className="mt-0.5 shrink-0">
                      <div className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border transition-all",
                        isChecked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40 bg-transparent group-hover:border-primary/60"
                      )}>
                        {isChecked && <Check className="h-3 w-3" />}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn(
                          "text-xs font-semibold",
                          isChecked ? "text-primary" : "text-foreground/90"
                        )}>
                          {q.id}. {q.title}
                        </span>
                        <span className="text-[10px] text-muted-foreground opacity-60">
                          {q.source}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        {q.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 底部评分与操作 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 bg-black/40 px-6 py-3.5">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">知行合一评分:</span>
                <span className={cn(
                  "font-mono text-xl font-bold font-num",
                  Object.values(checkedQuestions).filter(Boolean).length >= 8 ? "text-emerald-400" :
                  Object.values(checkedQuestions).filter(Boolean).length >= 6 ? "text-amber-400" : "text-rose-400"
                )}>
                  {Object.values(checkedQuestions).filter(Boolean).length} / 10 分
                </span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  Object.values(checkedQuestions).filter(Boolean).length >= 8 ? "bg-emerald-500/15 text-emerald-400" :
                  Object.values(checkedQuestions).filter(Boolean).length >= 6 ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400"
                )}>
                  {Object.values(checkedQuestions).filter(Boolean).length >= 8 ? "符合3L买入纪律" :
                   Object.values(checkedQuestions).filter(Boolean).length >= 6 ? "存在瑕疵·建议试错仓" : "不建议买入·严格回避"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const all: Record<number, boolean> = {};
                    QUESTIONS_3L.forEach((q) => { all[q.id] = true; });
                    setCheckedQuestions(all);
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  一键全选
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (checklistStock) {
                      handleAddWatch([checklistStock.code]);
                      setChecklistStock(null);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow hover:bg-primary/90"
                >
                  <Star className="h-3.5 w-3.5" /> 加入自选
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── RPS 状态精简药丸 ──────────────────────────────────────────────────────
function RpsStatusPill({
  status, onRefresh,
}: { status: QuantRpsStatus | null; onRefresh: () => void }) {
  if (!status) return null;

  let tone: string;
  let icon: ReactNode;
  let label: string;

  if (status.ready) {
    tone = "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    icon = <TrendingUp className="h-3 w-3" />;
    label = status.trade_date ? `${status.trade_date} · RPS就绪` : "RPS就绪";
  } else if (status.running) {
    tone = "border-sky-500/30 bg-sky-500/10 text-sky-400";
    icon = <LoaderCircle className="h-3 w-3 animate-spin" />;
    label = "RPS 预热中…";
  } else if (status.last_error) {
    tone = "border-destructive/30 bg-destructive/10 text-destructive";
    icon = <AlertTriangle className="h-3 w-3" />;
    label = "RPS 预热失败";
  } else {
    tone = "border-border bg-black/20 text-muted-foreground";
    icon = <Database className="h-3 w-3" />;
    label = "RPS 懒加载";
  }

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium",
      tone,
    )}>
      {icon}
      <span>{label}</span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={status.running}
        className="ml-1 text-current opacity-70 hover:opacity-100 disabled:opacity-30"
        title="刷新/重试预热"
      >
        <RefreshCw className={cn("h-3 w-3", status.running && "animate-spin")} />
      </button>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  AlertTriangle, ChevronDown, ChevronUp, Code2, Database, Eye, Flame,
  Filter, Layers3, LineChart, LoaderCircle, Pencil, Play, Plus, RefreshCw,
  Rocket, Search, SlidersHorizontal, Sparkles, Square, Star,
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

// ── 跨路由保留最近一次筛选结果 ─────────────────────────────────────
// 列表行点击会跳到 /stock-kline/:code，按浏览器返回时 React Router 会重新挂载
// /quant-screening，整个组件的 useState 回到初始值，结果就消失了。
// 这里用 module-level cache 把上一次的「输入 + 结果 + 当前 tab」缓存下来，
// 组件 mount 时优先从 cache 恢复（不是 localStorage，避免跨会话显示陈旧数据）。
type CachedSnapshot = {
  input: import("@/lib/api").QuantScreenInput;
  result: import("@/lib/api").QuantScreenResult;
  view: "matched" | "base";
  selectedKey: string;
  fundRatioMin: number;
  northValueMin: number;
};
let _cachedSnapshot: CachedSnapshot | null = null;

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
    subtitle: "通达信自定义选股公式",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    accent: "from-amber-500/25 to-orange-500/10 border-amber-400/40",
  },
  classic: {
    title: "经典策略",
    subtitle: "内置结构化策略",
    icon: <Wand2 className="h-3.5 w-3.5" />,
    accent: "from-sky-500/20 to-indigo-500/10 border-sky-400/40",
  },
  custom: {
    title: "自定义策略",
    subtitle: "用户新建的策略",
    icon: <Plus className="h-3.5 w-3.5" />,
    accent: "from-fuchsia-500/20 to-pink-500/10 border-fuchsia-400/40",
  },
};

const TAG_META: Record<StrategyTag, { label: string; tone: string }> = {
  rps:        { label: "RPS",  tone: "border-primary/30 bg-primary/10 text-primary" },
  finance:    { label: "财务", tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
  capital:    { label: "换手", tone: "border-sky-400/30 bg-sky-400/10 text-sky-300" },
  high_tight: { label: "突破", tone: "border-amber-400/30 bg-amber-400/10 text-amber-300" },
  drawdown:   { label: "回撤", tone: "border-rose-400/30 bg-rose-400/10 text-rose-300" },
};

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

function SectionLabel({ icon, title, desc }: { icon: ReactNode; title: string; desc?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-primary">{icon}</span>
      <span className="text-sm font-semibold">{title}</span>
      {desc && <span className="text-xs text-muted-foreground">{desc}</span>}
    </div>
  );
}

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
  // 筛选参数（默认从 module-level cache 取，保持跨路由返回时不丢筛选上下文）
  const [fundRatioMin, setFundRatioMin] = useState(_cachedSnapshot?.fundRatioMin ?? 5);
  const [northValueMin, setNorthValueMin] = useState(_cachedSnapshot?.northValueMin ?? 1);
  const [selectedKey, setSelectedKey] = useState<string>(_cachedSnapshot?.selectedKey ?? "near_high");

  // 运行状态
  const [result, setResult] = useState<QuantScreenResult | null>(_cachedSnapshot?.result ?? null);
  const [view, setView] = useState<"matched" | "base">(_cachedSnapshot?.view ?? "matched");
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

  // 编辑器折叠
  const [showEditor, setShowEditor] = useState(false);
  // 基础池条件折叠（默认收起，留出空间让用户先看公式/策略）
  const [showBasePool, setShowBasePool] = useState(false);

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

  // ── 策略搜索过滤（按 label / description 模糊匹配）─────────────────────
  const [strategySearch, setStrategySearch] = useState("");
  const filteredStrategies = useMemo(() => {
    const q = strategySearch.trim().toLowerCase();
    if (!q) return allStrategies;
    return allStrategies.filter((s) =>
      s.label.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.key.toLowerCase().includes(q),
    );
  }, [allStrategies, strategySearch]);

  // 把过滤后的策略按 category 分组渲染
  const strategiesByCategory = useMemo(() => {
    const map: Record<StrategyCategory, DisplayStrategy[]> = {
      blue_diamond: [], classic: [], custom: [],
    };
    for (const s of filteredStrategies) map[s.category].push(s);
    return map;
  }, [filteredStrategies]);

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
  // ── 列表排序：每列表头可点击，三态循环（无 → 升 → 降 → 无）。
  // 用独立的 sortedRows 喂表格，rows 保持原始顺序——批量「加自选」等仍按后端返回顺序遍历。
  type SortKey =
    | "name" | "industry" | "fund_float_ratio_pct" | "fund_count" | "fund_hold_value_yi"
    | "north_hold_value_yi" | "north_total_ratio_pct"
    | "rps20" | "rps50" | "rps120" | "rps250"
    | "turnover_pct" | "revenue_yoy_pct" | "net_profit_yoy_pct"
    | "close" | "year_high" | "distance_to_high_pct"
    | "change_pct";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    setSortKey(null); setSortDir("asc"); // 再点一次回到默认（按后端原序）
  };
  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const k = sortKey;
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[k] as number | string | null | undefined;
      const bv = b[k] as number | string | null | undefined;
      // null/undefined 永远沉底，避免一个缺值把整列弄乱
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
  }, [rows, sortKey, sortDir]);
  const SortHead = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) => {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        className={cn(
          "whitespace-nowrap px-3 py-2.5 font-medium select-none cursor-pointer hover:text-foreground transition-colors",
          align === "right" && "text-right",
        )}
        title="点击排序"
      >
        <span className="inline-flex items-center gap-1">
          {label}
          <span className={cn("text-[10px] leading-none", active ? "text-primary" : "text-muted-foreground/40")}>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
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
    setResult(null);
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
      _cachedSnapshot = {
        input: {
          strategy: selected.baseStrategy,
          fund_ratio_min: fundRatioMin,
          north_value_min_yi: northValueMin,
          formula_source: checked.normalized_source,
        },
        result: data,
        view: "matched",
        selectedKey,
        fundRatioMin,
        northValueMin,
      };
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

  const handleSelectStrategy = (key: string) => {
    setSelectedKey(key);
    setValidation({ status: "idle" });
    setResult(null);
    setView("matched");
    setShowEditor(false);
    _cachedSnapshot = null;
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
    <div>
      <PageHeader
        title="量化选股"
        subtitle="基金持仓或北向持仓满足任一条件即可入池，再叠加通达信技术公式二次筛选。"
        actions={result && (
          <button onClick={run} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-primary disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> 重新筛选
          </button>
        )}
      />

      {/* ── RPS 后台预热状态徽章 ── */}
      <RpsStatusBadge
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

      <GlassCard className="mb-4" glow>
        {/* ── 选股策略 ── */}
        <SectionLabel icon={<SlidersHorizontal className="h-4 w-4" />} title="选股策略" />

        {formulaLoading ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> 正在加载策略列表…
          </div>
        ) : (
          <div className="space-y-3">
            {/* 搜索框 + 添加策略按钮 */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={strategySearch}
                  onChange={(e) => setStrategySearch(e.target.value)}
                  placeholder="搜索策略（名称 / 说明 / key）"
                  className="w-full rounded-lg border border-border bg-black/20 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary/50"
                />
              </div>
              {!showAddForm && !editingKey && (
                <button
                  type="button"
                  disabled={loading || formulaLoading}
                  onClick={openAddForm}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-all hover:border-primary/40 hover:text-primary disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> 添加策略
                </button>
              )}
            </div>

            {/* 按分类分组渲染策略卡片 */}
            {(Object.keys(strategiesByCategory) as StrategyCategory[]).map((cat) => {
              const list = strategiesByCategory[cat];
              if (list.length === 0) return null;
              const meta = CATEGORY_META[cat];
              return (
                <div key={cat} className="rounded-xl border border-border/40 bg-black/10 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-primary">{meta.icon}</span>
                      <span className="font-semibold text-foreground/90">{meta.title}</span>
                      <span className="text-muted-foreground">· {meta.subtitle}</span>
                    </div>
                    <span className="rounded-full bg-black/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {list.length} 个
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {list.map((item) => {
                      const isActive = item.key === selectedKey;
                      return (
                        <div
                          key={item.key}
                          className={cn(
                            "group relative flex flex-col gap-2 rounded-xl border p-3 text-left transition-all",
                            isActive
                              ? "border-primary/60 bg-gradient-to-br from-primary/15 to-primary/5 shadow-sm shadow-primary/10"
                              : "border-border/60 bg-black/20 hover:border-primary/30 hover:bg-black/30",
                          )}
                        >
                          <button
                            type="button"
                            data-testid={isActive ? "quant-strategy" : undefined}
                            disabled={loading}
                            onClick={() => handleSelectStrategy(item.key)}
                            className="flex flex-1 flex-col gap-1.5 text-left disabled:cursor-not-allowed"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={cn(
                                "flex items-center gap-1.5 text-sm font-semibold",
                                isActive ? "text-primary" : "text-foreground/90",
                              )}>
                                <span className={cn(
                                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                                  isActive ? "bg-primary/20 text-primary" : "bg-muted/60 text-muted-foreground",
                                )}>
                                  {item.icon}
                                </span>
                                <span className="line-clamp-1">{item.label}</span>
                              </span>
                              {isActive && <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />}
                            </div>
                            <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                              {item.description || <span className="opacity-50">暂无说明</span>}
                            </p>
                            {item.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {item.tags.map((tag) => (
                                  <span key={tag} className={cn(
                                    "rounded-full border px-1.5 py-0.5 text-[9px] font-medium",
                                    TAG_META[tag].tone,
                                  )}>
                                    {TAG_META[tag].label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </button>
                          {/* 重命名 / 删除按钮（悬浮显示） */}
                          <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              aria-label={`重命名策略 ${item.label}`}
                              onClick={(e) => { e.stopPropagation(); handleEditStrategy(item.key); }}
                              className="rounded p-0.5 text-muted-foreground hover:text-primary"
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
                              className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {filteredStrategies.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                没有匹配「{strategySearch}」的策略
              </p>
            )}
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

        <div className="my-5 border-t border-border/40" />

        {/* ── 基础池条件（默认折叠，点标题展开）── */}
        <button
          type="button"
          onClick={() => setShowBasePool((v) => !v)}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm transition-all",
            showBasePool
              ? "border-primary/40 bg-primary/5 text-foreground"
              : "border-border/60 bg-black/15 text-muted-foreground hover:border-primary/30 hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-2">
            <span className="text-primary"><Filter className="h-4 w-4" /></span>
            <span className="text-sm font-semibold">基础池条件</span>
            <span className="text-xs text-muted-foreground">基金或北向满足任一项即可入池</span>
          </span>
          {showBasePool
            ? <ChevronUp className="h-4 w-4 shrink-0 text-primary" />
            : <ChevronDown className="h-4 w-4 shrink-0" />}
        </button>
        {showBasePool && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <ConditionInput
              label="基金持股占流通股 ≥"
              value={fundRatioMin}
              suffix="%"
              min={0.1}
              max={100}
              step={0.5}
              onChange={(v) => { setFundRatioMin(Number.isFinite(v) ? v : 0); setResult(null); _cachedSnapshot = null; }}
            />
            <ConditionInput
              label="北向持股市值 ≥"
              value={northValueMin}
              suffix="亿元"
              min={0}
              max={100000}
              step={0.5}
              onChange={(v) => { setNorthValueMin(Number.isFinite(v) ? v : 0); setResult(null); _cachedSnapshot = null; }}
            />
          </div>
        )}

        <div className="my-5 border-t border-border/40" />

        {/* ── 公式源码（可折叠）── */}
        {selected && activeSource && (
          <>
            <button
              type="button"
              onClick={() => setShowEditor((v) => !v)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-sm transition-all",
                showEditor
                  ? "border-primary/40 bg-primary/5 text-foreground"
                  : "border-border/60 bg-black/15 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              )}
            >
              <div className="flex items-center gap-2.5">
                <Code2 className={cn("h-4 w-4 shrink-0", showEditor ? "text-primary" : "")} />
                <span className="font-medium">通达信公式源码</span>
                <span className="font-mono text-xs opacity-70">
                  {activeSource.split(/\r?\n/).length} 行
                </span>
                {isDirty && (
                  <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                    已修改
                  </span>
                )}
              </div>
              {showEditor
                ? <ChevronUp className="h-4 w-4 shrink-0 text-primary" />
                : <ChevronDown className="h-4 w-4 shrink-0" />}
            </button>

            {showEditor && (
              <div className="mt-3">
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

            <div className="my-5 border-t border-border/40" />
          </>
        )}

        {/* ── 条件摘要 + 执行按钮 ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-black/25 px-3 py-2 text-xs text-primary/80">
            {`(基金 ≥ ${fundRatioMin}% OR 北向 ≥ ${northValueMin}亿) → `}
            {activeSource
              ? `执行 ${selected?.label ?? "通达信公式"}（${activeSource.split(/\r?\n/).length} 行）`
              : "公式加载中…"}
          </code>
          <div className="flex shrink-0 items-center gap-2">
            {loading && (
              <button
                type="button"
                onClick={cancelRun}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground transition-all hover:border-destructive/40 hover:text-destructive"
              >
                <Square className="h-3.5 w-3.5" /> 取消
              </button>
            )}
            <button
              data-testid="quant-run"
              onClick={run}
              disabled={loading || validating || formulaLoading || !activeSource.trim()}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary/15 px-5 py-2.5 text-sm font-semibold text-primary shadow-glow hover:bg-primary/25 disabled:cursor-wait disabled:opacity-60"
            >
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {loading
                ? (PHASE_LABEL[progressPhase ?? ""] ?? "执行选股")
                : validating ? "正在验证公式…" : "验证并开始筛选"}
            </button>
          </div>
        </div>

        {/* ── 进度条 + 阶段详情 ── */}
        {loading && (
          <div className="mt-3 rounded-lg border border-border/60 bg-black/20 p-3">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="font-medium text-foreground">
                  {PHASE_LABEL[progressPhase ?? ""] ?? "准备中…"}
                </span>
                {progressTotal > 0 && progressPhase !== "validate" && (
                  <span className="font-mono text-primary/80">
                    {progressDone}/{progressTotal}
                  </span>
                )}
              </div>
              <span className="font-mono text-muted-foreground">
                已运行 {elapsed.toFixed(1)}s
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/40">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-300 ease-out"
                style={{ width: `${aggregateProgress(progressPhase, progressDone, progressTotal).toFixed(1)}%` }}
              />
            </div>
            {progressMessage && (
              <p className="mt-1.5 break-all text-[11px] text-muted-foreground">
                {progressMessage}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PHASE_ORDER.map((key) => {
                const isActive = key === progressPhase;
                const idxActive = progressPhase ? PHASE_ORDER.indexOf(progressPhase as typeof PHASE_ORDER[number]) : -1;
                const idxKey = PHASE_ORDER.indexOf(key);
                const isDone = idxActive >= 0 && idxKey < idxActive;
                return (
                  <span
                    key={key}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] transition-colors",
                      isActive
                        ? "bg-primary/20 text-primary"
                        : isDone
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-border/40 text-muted-foreground/60",
                    )}
                  >
                    {PHASE_LABEL[key]}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </GlassCard>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <GlassCard className="!p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Database className="h-4 w-4" /> 基金条件命中</div>
              <p className="mt-2 text-2xl font-bold font-mono">{result.fund_candidate_count}</p>
              <p className="text-[11px] text-muted-foreground">报告期 {result.fund_period}</p>
            </GlassCard>
            <GlassCard className="!p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Database className="h-4 w-4" /> 北向条件命中</div>
              <p className="mt-2 text-2xl font-bold font-mono">{result.north_candidate_count}</p>
              <p className="text-[11px] text-muted-foreground">港交所持股 {result.north_period}</p>
            </GlassCard>
            <GlassCard className="!p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Layers3 className="h-4 w-4" /> OR 基础池</div>
              <p className="mt-2 text-2xl font-bold font-mono">{result.base_count}</p>
              <p className="text-[11px] text-muted-foreground">两条件重叠 {result.overlap_count} 只</p>
            </GlassCard>
            <GlassCard className="!p-4" glow>
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="h-4 w-4 text-primary" /> {result.strategy_label}</div>
              <p className="mt-2 text-2xl font-bold font-mono text-primary">{result.matched_count}</p>
              <p className="text-[11px] text-muted-foreground">K 线 {result.technical_date || "—"} · {result.elapsed_seconds}s</p>
            </GlassCard>
          </div>

          {result.rps_meta && (
            <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">全市场 RPS 快照：</span>
              {result.rps_meta.trade_date}，沪深 A 股 {result.rps_meta.universe_count} 只；剔除上市未满一年/日 K 不足的 {result.rps_meta.excluded_short_history_count} 只，
              最终 {result.rps_meta.eligible_count} 只按同一股票池计算 RPS20 / RPS50 / RPS120 / RPS250。
            </div>
          )}

          <div className="mb-4 flex gap-2 rounded-xl border border-warning/25 bg-warning/5 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium text-foreground">北向持仓已改为最新季度数据</p>
              <p className="mt-0.5">{result.north_disclosure_note} 当前使用 {result.north_period}；基金数据使用 {result.fund_period}。</p>
            </div>
          </div>

          <GlassCard className="mb-4 !p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-5 py-4">
              <div>
                <h2 className="font-semibold">筛选结果</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{result.criteria.tdx_formula}</p>
                {result.criteria.formula_hash && (
                  <p className="mt-1 font-mono text-[10px] text-primary/80">
                    公式版本 {result.criteria.formula_hash}
                    {result.criteria.required_history ? ` · 读取K线 ${result.criteria.required_history} 日` : ""}
                    {result.criteria.minimum_history ? ` · 最少历史 ${result.criteria.minimum_history} 日` : ""}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const codes = rows.map((r) => r.code).filter((c) => !watchSet.has(c));
                    handleAddWatch(codes);
                  }}
                  disabled={!rows.some((r) => !watchSet.has(r.code))}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:border-border/40 disabled:bg-black/20 disabled:text-muted-foreground"
                  title="把当前列表中未加入自选的股票一次性加入"
                >
                  <Star className="h-3.5 w-3.5" /> 全部加入自选
                </button>
                <div className="flex rounded-lg bg-black/20 p-1 text-xs">
                  <button
                    onClick={() => { setView("matched"); if (_cachedSnapshot) _cachedSnapshot.view = "matched"; }}
                    className={cn("rounded-md px-3 py-1.5", view === "matched" ? "bg-primary/15 text-primary" : "text-muted-foreground")}
                  >
                    技术命中 {result.matched_count}
                  </button>
                  <button
                    onClick={() => { setView("base"); if (_cachedSnapshot) _cachedSnapshot.view = "base"; }}
                    className={cn("rounded-md px-3 py-1.5", view === "base" ? "bg-primary/15 text-primary" : "text-muted-foreground")}
                  >
                    基础池 {result.base_count}
                  </button>
                </div>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">当前条件没有命中，可适当放宽阈值后重试。</p>
            ) : (
              <div className="max-h-[620px] overflow-auto">
                <table className="w-full min-w-[1380px] text-sm">
                  <thead className="sticky top-0 z-[1] bg-card/95 backdrop-blur">
                    <tr className="border-b border-border/60 text-left text-[11px] text-muted-foreground">
                      <th className="whitespace-nowrap px-5 py-2.5 font-medium">
                        <button type="button" onClick={() => toggleSort("name")}
                          className={cn("inline-flex items-center gap-1 hover:text-foreground transition-colors", sortKey === "name" && "text-primary")}
                          title="点击按名称排序">
                          名称 / 代码
                          <span className={cn("text-[10px] leading-none", sortKey === "name" ? "text-primary" : "text-muted-foreground/40")}>
                            {sortKey === "name" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        </button>
                      </th>
                      <SortHead k="change_pct" label="今日涨跌" align="right" />
                      <SortHead k="industry" label="行业" />
                      <SortHead k="fund_float_ratio_pct" label="基金占流通股" align="right" />
                      <SortHead k="fund_count" label="基金家数" align="right" />
                      <SortHead k="fund_hold_value_yi" label="基金持有市值" align="right" />
                      <SortHead k="north_hold_value_yi" label="北向持有市值" align="right" />
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
                      <SortHead k="year_high" label="一年最高" align="right" />
                      <SortHead k="distance_to_high_pct" label="距新高" align="right" />
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">K线日期</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row: QuantRow) => (
                      <tr key={row.code}
                        onClick={() => navigate(`/stock-kline/${row.code}`)}
                        className="cursor-pointer border-b border-border/30 hover:bg-muted/20">
                        <td className="px-5 py-2.5">
                          <Link to={`/stock-kline/${row.code}`}
                            onClick={(e) => e.stopPropagation()}
                            className="block">
                            <div className="font-medium">{row.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">{row.code}</div>
                          </Link>
                        </td>
                        <td className={cn(
                          "px-3 py-2.5 text-right font-mono",
                          row.change_pct == null ? "text-muted-foreground" :
                          (row.change_pct as number) > 0 ? "text-market-up" :
                          (row.change_pct as number) < 0 ? "text-market-down" : "text-muted-foreground",
                        )}>
                          {row.change_pct == null ? "—" : `${(row.change_pct as number) > 0 ? "+" : ""}${(row.change_pct as number).toFixed(2)}%`}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">{row.industry || "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-primary">{numberText(row.fund_float_ratio_pct, 2)}%</td>
                        <td className="px-3 py-2.5 text-right font-mono">{row.fund_count}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{numberText(row.fund_hold_value_yi)}亿</td>
                        <td className="px-3 py-2.5 text-right font-mono">{numberText(row.north_hold_value_yi)}亿</td>
                        <td className="px-3 py-2.5 text-right font-mono">{numberText(row.north_total_ratio_pct)}%</td>
                        {usesRps && (
                          <>
                            <td className="px-3 py-2.5 text-right font-mono text-primary">{numberText(row.rps20)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-primary">{numberText(row.rps50)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-primary">{numberText(row.rps120)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-primary">{numberText(row.rps250)}</td>
                          </>
                        )}
                        {usesCapital && (
                          <td className="px-3 py-2.5 text-right font-mono">{numberText(row.turnover_pct)}%</td>
                        )}
                        {usesFinance && (
                          <>
                            <td className="px-3 py-2.5 text-right font-mono">{numberText(row.revenue_yoy_pct)}%</td>
                            <td className="px-3 py-2.5 text-right font-mono">{numberText(row.net_profit_yoy_pct)}%</td>
                          </>
                        )}
                        <td className="px-3 py-2.5 text-right font-mono">{numberText(row.close, 3)}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{numberText(row.year_high, 3)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-primary">{row.distance_to_high_pct == null ? "—" : `${numberText(row.distance_to_high_pct, 2)}%`}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.technical_date || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {watchSet.has(row.code) ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1 text-[11px] text-primary">
                              <Star className="h-3.5 w-3.5 fill-current" /> 已加入
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleAddWatch([row.code])}
                              className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary/60 hover:text-primary"
                              title={`将 ${row.code} 加入自选股`}
                            >
                              <Star className="h-3.5 w-3.5" /> 加自选
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </>
      )}

      {!result && !loading && (
        <GlassCard className="mb-4">
          <div className="py-10 text-center text-sm text-muted-foreground">
            设置条件后点击“开始两阶段筛选”。首次运行 RPS 策略需要构建全沪深市场快照，完成后会按交易日缓存。
          </div>
        </GlassCard>
      )}
    </div>
  );
}

// ── RPS 后台预热状态徽章 ─────────────────────────────────────────────────
// 展示当前 RPS 快照是否就绪；不可用时降级隐藏，避免给页面增加噪声。
// 颜色语义：
//   ready  = 绿：全市场 RPS 已就绪 → 选股会秒回
//   running= 蓝：正在后台预热 → 选股会等待一小段时间
//   error  = 红：上次预热失败 → 选股会降级到即时计算（会慢）
//   idle   = 灰：后端没启预热（VR_RPS_PREWARM=0）→ 选股走懒加载
function RpsStatusBadge({
  status, onRefresh,
}: { status: QuantRpsStatus | null; onRefresh: () => void }) {
  if (!status) return null; // 还在拉，没拿到就不显示

  let tone: string;
  let icon: ReactNode;
  let label: string;
  let detail: string;

  if (status.ready) {
    tone = "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    icon = <TrendingUp className="h-3.5 w-3.5" />;
    label = "RPS 快照已就绪";
    detail = status.trade_date
      ? `${status.trade_date} · 选股将秒回`
      : "选股将秒回";
  } else if (status.running) {
    tone = "border-sky-500/30 bg-sky-500/10 text-sky-300";
    icon = <LoaderCircle className="h-3.5 w-3.5 animate-spin" />;
    label = "RPS 后台预热中…";
    detail = "新交易日首次构建全市场快照，请稍候";
  } else if (status.last_error) {
    tone = "border-destructive/30 bg-destructive/10 text-destructive";
    icon = <AlertTriangle className="h-3.5 w-3.5" />;
    label = "RPS 后台预热失败";
    detail = "选股将降级到即时计算（较慢），可点此重试";
  } else {
    tone = "border-border bg-black/20 text-muted-foreground";
    icon = <Database className="h-3.5 w-3.5" />;
    label = "RPS 后台预热未启用";
    detail = "选股首次会即时计算全市场快照";
  }

  return (
    <div className={cn(
      "mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs",
      tone,
    )}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium">{label}</span>
        <span className="opacity-70">{detail}</span>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={status.running}
        className="inline-flex items-center gap-1 rounded-md border border-current/30 px-2 py-0.5 text-[11px] opacity-80 transition-opacity hover:opacity-100 disabled:cursor-wait disabled:opacity-40"
      >
        <RefreshCw className={cn("h-3 w-3", status.running && "animate-spin")} />
        {status.last_error ? "重试" : "手动预热"}
      </button>
    </div>
  );
}

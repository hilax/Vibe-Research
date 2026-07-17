import { useMemo, useState } from "react";
import {
  AlertTriangle, Database, Filter, Layers3, LoaderCircle, Play,
  RefreshCw, TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import {
  ApiError, api, type QuantRow, type QuantScreenInput, type QuantScreenResult,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULTS: QuantScreenInput = {
  strategy: "near_high",
  fund_ratio_min: 5,
  north_value_min_yi: 1,
  near_high_pct: 5,
  lookback_days: 250,
};

const STRATEGIES: Array<{
  value: QuantScreenInput["strategy"]; label: string; description: string; formula: string;
}> = [
  {
    value: "near_high",
    label: "接近一年新高",
    description: "收盘价距离指定周期最高价不超过设定比例。",
    formula: "C >= HHV(H,250) * 0.95",
  },
  {
    value: "monthly_reversal_62",
    label: "月线反转 6.2",
    description: "完整执行 FYX1–FYX7，使用全市场 RPS50 / RPS120。",
    formula: "YXFZ := FYX1 AND FYX2 AND FYX3 AND FYX4 AND FYX5 AND FYX6 AND FYX7",
  },
  {
    value: "growth_mrgc_sxhcg",
    label: "RPS 高成长（MRGC / SXHCG）",
    description: "执行 MRGC 或 SXHCG，并叠加营收、净利和非科创板过滤。",
    formula: "(SXHCG OR MRGC) AND 营收同比>20 AND 净利同比>40 AND 非688",
  },
];

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
  const [input, setInput] = useState<QuantScreenInput>(DEFAULTS);
  const [result, setResult] = useState<QuantScreenResult | null>(null);
  const [view, setView] = useState<"matched" | "base">("matched");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () => (view === "matched" ? result?.rows ?? [] : result?.base_rows ?? []),
    [result, view],
  );
  const usesRps = result?.strategy !== "near_high";
  const isGrowth = result?.strategy === "growth_mrgc_sxhcg";
  const selectedStrategy = STRATEGIES.find((item) => item.value === input.strategy)!;

  const update = (key: keyof QuantScreenInput, value: number) => {
    setInput((current) => ({ ...current, [key]: Number.isFinite(value) ? value : 0 }));
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.quantScreen(input);
      setResult(data);
      setView("matched");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "筛选失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="量化选股"
        subtitle="基金持仓或北向持仓满足任一条件即可入池，再执行通达信技术公式。"
        actions={result && (
          <button
            onClick={run}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-primary disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> 重新筛选
          </button>
        )}
      />

      <GlassCard className="mb-4" glow>
        <div className="mb-4 flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">筛选条件</h2>
            <p className="text-xs text-muted-foreground">基础池采用 OR：基金持股达标或北向持股市值达标，满足任一项即可入池。</p>
          </div>
        </div>
        <label className="mb-4 block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">通达信选股策略</span>
          <select
            data-testid="quant-strategy"
            value={input.strategy}
            onChange={(event) => setInput((current) => ({
              ...current,
              strategy: event.target.value as QuantScreenInput["strategy"],
            }))}
            className="w-full rounded-lg border border-border bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-primary/50"
          >
            {STRATEGIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <span className="mt-1.5 block text-xs text-muted-foreground">{selectedStrategy.description}</span>
        </label>
        <div className={cn("grid gap-3", input.strategy === "near_high" ? "md:grid-cols-4" : "md:grid-cols-2")}>
          <ConditionInput
            label="基金持股占流通股 ≥"
            value={input.fund_ratio_min}
            suffix="%"
            min={0.1}
            max={100}
            step={0.5}
            onChange={(value) => update("fund_ratio_min", value)}
          />
          <ConditionInput
            label="北向持股市值 ≥"
            value={input.north_value_min_yi}
            suffix="亿元"
            min={0}
            max={100000}
            step={0.5}
            onChange={(value) => update("north_value_min_yi", value)}
          />
          {input.strategy === "near_high" && (
            <>
              <ConditionInput
                label="距离一年新高 ≤"
                value={input.near_high_pct}
                suffix="%"
                min={0}
                max={50}
                step={0.5}
                onChange={(value) => update("near_high_pct", value)}
              />
              <ConditionInput
                label="通达信回看周期"
                value={input.lookback_days}
                suffix="交易日"
                min={60}
                max={800}
                step={10}
                onChange={(value) => update("lookback_days", value)}
              />
            </>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <code className="rounded-lg bg-black/25 px-3 py-2 text-xs text-primary/90">
            {`(基金≥${input.fund_ratio_min}% OR 北向≥${input.north_value_min_yi}亿) → `}
            {input.strategy === "near_high"
              ? `C >= HHV(H,${input.lookback_days}) * ${(1 - input.near_high_pct / 100).toFixed(4)}`
              : selectedStrategy.formula}
          </code>
          <button
            data-testid="quant-run"
            onClick={run}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary/15 px-5 py-2.5 text-sm font-semibold text-primary shadow-glow hover:bg-primary/25 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {loading
              ? input.strategy === "near_high"
                ? "正在拉取持仓并计算日 K…"
                : "正在构建全市场 RPS 并执行公式…"
              : "开始两阶段筛选"}
          </button>
        </div>
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
              最终 {result.rps_meta.eligible_count} 只按同一股票池计算 RPS50 / RPS120 / RPS250。
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
              </div>
              <div className="flex rounded-lg bg-black/20 p-1 text-xs">
                <button
                  onClick={() => setView("matched")}
                  className={cn("rounded-md px-3 py-1.5", view === "matched" ? "bg-primary/15 text-primary" : "text-muted-foreground")}
                >
                  技术命中 {result.matched_count}
                </button>
                <button
                  onClick={() => setView("base")}
                  className={cn("rounded-md px-3 py-1.5", view === "base" ? "bg-primary/15 text-primary" : "text-muted-foreground")}
                >
                  基础池 {result.base_count}
                </button>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">当前条件没有命中，可适当放宽阈值后重试。</p>
            ) : (
              <div className="max-h-[620px] overflow-auto">
                <table className="w-full min-w-[1380px] text-sm">
                  <thead className="sticky top-0 z-[1] bg-card/95 backdrop-blur">
                    <tr className="border-b border-border/60 text-left text-[11px] text-muted-foreground">
                      {[
                        "名称 / 代码", "入池条件", "行业", "基金占流通股", "基金家数", "基金持有市值", "北向持有市值", "北向占A股",
                        ...(usesRps ? ["RPS50", "RPS120", "RPS250"] : []),
                        ...(isGrowth ? ["换手率", "营收同比", "净利同比"] : []),
                        "最新收盘", "一年最高", "距新高", ...(usesRps ? ["公式分支"] : []), "K线日期",
                      ].map((heading) => (
                        <th key={heading} className="whitespace-nowrap px-3 py-2.5 font-medium">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row: QuantRow) => (
                      <tr key={row.code} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{row.name}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{row.code}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-primary">{row.condition_tags?.join(" + ") || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">{row.industry || "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-primary">{numberText(row.fund_float_ratio_pct, 2)}%</td>
                        <td className="px-3 py-2.5 font-mono">{row.fund_count}</td>
                        <td className="px-3 py-2.5 font-mono">{numberText(row.fund_hold_value_yi)}亿</td>
                        <td className="px-3 py-2.5 font-mono">{numberText(row.north_hold_value_yi)}亿</td>
                        <td className="px-3 py-2.5 font-mono">{numberText(row.north_total_ratio_pct)}%</td>
                        {usesRps && (
                          <>
                            <td className="px-3 py-2.5 font-mono text-primary">{numberText(row.rps50)}</td>
                            <td className="px-3 py-2.5 font-mono text-primary">{numberText(row.rps120)}</td>
                            <td className="px-3 py-2.5 font-mono text-primary">{numberText(row.rps250)}</td>
                          </>
                        )}
                        {isGrowth && (
                          <>
                            <td className="px-3 py-2.5 font-mono">{numberText(row.turnover_pct)}%</td>
                            <td className="px-3 py-2.5 font-mono">{numberText(row.revenue_yoy_pct)}%</td>
                            <td className="px-3 py-2.5 font-mono">{numberText(row.net_profit_yoy_pct)}%</td>
                          </>
                        )}
                        <td className="px-3 py-2.5 font-mono">{numberText(row.close, 3)}</td>
                        <td className="px-3 py-2.5 font-mono">{numberText(row.year_high, 3)}</td>
                        <td className="px-3 py-2.5 font-mono text-primary">{row.distance_to_high_pct == null ? "—" : `${numberText(row.distance_to_high_pct, 2)}%`}</td>
                        {usesRps && <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">{row.strategy_detail || "—"}</td>}
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.technical_date || "—"}</td>
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

      <Disclaimer />
    </div>
  );
}

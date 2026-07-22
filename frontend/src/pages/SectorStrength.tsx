import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Database,
  Edit3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  api,
  type SectorSource,
  type SectorStrengthRow,
  type SectorStrengthSnapshot,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Period = 5 | 10 | 15 | 20;
type PeriodKey = "rps5" | "rps10" | "rps15" | "rps20";
type SortKey = "code" | "return20_pct" | PeriodKey | "latest_close";
type SortDirection = "asc" | "desc";

const PERIODS: Period[] = [5, 10, 15, 20];
const PAGE_SIZE = 50;

function rpsKey(period: Period): PeriodKey {
  return `rps${period}` as PeriodKey;
}

function rpsTone(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "text-muted-foreground/50";
  if (value >= 95) return "font-bold text-market-up";
  if (value >= 90) return "font-semibold text-market-up/90";
  if (value >= 80) return "text-market-up/75";
  return "text-foreground/75";
}

function returnTone(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-market-up" : "text-market-down";
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function formatReturn(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function emptyRow(source: SectorSource): SectorStrengthRow {
  return {
    code: source.code,
    name: source.name,
    trade_date: null,
    latest_close: null,
    bar_count: 0,
    status: "unavailable",
    error: "RPS 尚未计算",
    rps5: null,
    rps10: null,
    rps15: null,
    rps20: null,
    return5_pct: null,
    return10_pct: null,
    return15_pct: null,
    return20_pct: null,
  };
}

export function SectorStrength() {
  const [sources, setSources] = useState<SectorSource[]>([]);
  const [snapshot, setSnapshot] = useState<SectorStrengthSnapshot | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rps20");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [search, setSearch] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(true);
  const [page, setPage] = useState(1);
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingRps, setLoadingRps] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (forceRefresh = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    setError(null);
    if (forceRefresh) setRefreshing(true);
    else {
      setLoadingSources(true);
      setLoadingRps(true);
    }

    try {
      const nextSources = await api.sectorSources(controller.signal);
      if (requestId !== requestIdRef.current) return;
      setSources(nextSources);
      setLoadingSources(false);
      try {
        const nextSnapshot = await api.sectorStrength(forceRefresh, controller.signal);
        if (requestId !== requestIdRef.current) return;
        setSnapshot(nextSnapshot);
      } catch (reason) {
        if ((reason as Error)?.name === "AbortError") return;
        if (requestId !== requestIdRef.current) return;
        setError(reason instanceof Error ? reason.message : "通达信板块 RPS 加载失败");
      } finally {
        if (requestId === requestIdRef.current) setLoadingRps(false);
      }
    } catch (reason) {
      if ((reason as Error)?.name === "AbortError") return;
      if (requestId !== requestIdRef.current) return;
      setError(reason instanceof Error ? reason.message : "板块基础数据源加载失败");
      setLoadingSources(false);
      setLoadingRps(false);
    } finally {
      if (requestId === requestIdRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    return () => abortRef.current?.abort();
  }, [load]);

  const rows = useMemo(() => {
    const byCode = new Map((snapshot?.rows ?? []).map(row => [row.code, row]));
    return sources.map(source => {
      const computed = byCode.get(source.code);
      return computed ? { ...computed, name: source.name } : emptyRow(source);
    });
  }, [snapshot, sources]);

  const displayedRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter(row => showUnavailable || row.status === "ok")
      .filter(row => !query || row.code.includes(query) || row.name.toLowerCase().includes(query))
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av == null && bv == null) return a.code.localeCompare(b.code);
        if (av == null) return 1;
        if (bv == null) return -1;
        const comparison = typeof av === "string"
          ? av.localeCompare(String(bv), "zh-CN")
          : av - Number(bv);
        return (sortDirection === "asc" ? comparison : -comparison) || a.code.localeCompare(b.code);
      });
  }, [rows, search, showUnavailable, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(displayedRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => displayedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [currentPage, displayedRows],
  );

  useEffect(() => {
    setPage(1);
  }, [search, showUnavailable, sortDirection, sortKey]);

  const changeSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection(direction => direction === "desc" ? "asc" : "desc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "code" ? "asc" : "desc");
  };

  const openAdd = () => {
    setEditingCode(null);
    setFormCode("");
    setFormName("");
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (source: SectorSource) => {
    setEditingCode(source.code);
    setFormCode(source.code);
    setFormName(source.name);
    setFormError(null);
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingCode(null);
    setFormError(null);
  };

  const submitForm = async () => {
    const code = formCode.trim();
    const name = formName.trim();
    setFormError(null);
    if (!/^\d{6}$/.test(code)) {
      setFormError("板块代码必须是 6 位数字");
      return;
    }
    if (!name) {
      setFormError("板块名称不能为空");
      return;
    }
    setSubmitting(true);
    try {
      if (editingCode) await api.updateSectorSource(editingCode, { code, name });
      else await api.addSectorSource({ code, name });
      closeForm();
      await load(true);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteSource = async (source: SectorSource) => {
    if (!window.confirm(`确认删除板块数据源「${source.code} ${source.name}」？`)) return;
    try {
      await api.deleteSectorSource(source.code);
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    }
  };

  const sourceByCode = useMemo(() => new Map(sources.map(source => [source.code, source])), [sources]);
  const computedAt = snapshot?.computed_at
    ? new Date(snapshot.computed_at * 1000).toLocaleString("zh-CN", { hour12: false })
    : null;

  return (
    <div>
      <PageHeader
        title="板块强度"
        subtitle="直接使用通达信板块日 K，计算 RPS5 / RPS10 / RPS15 / RPS20 横截面列表。"
        actions={(
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loadingSources || loadingRps || refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-black/20 px-3 py-2 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", (refreshing || loadingRps) && "animate-spin")} />
            重新计算
          </button>
        )}
      />

      <GlassCard className="mb-4 !p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Database className="h-4 w-4" />
              基础数据源 <strong className="font-mono text-foreground">{sources.length}</strong> 个
            </span>
            {snapshot?.trade_date && (
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-primary">
                RPS 基准日 {snapshot.trade_date}
              </span>
            )}
            {snapshot && (
              <span>
                有效 <strong className="font-mono text-foreground">{snapshot.available_count}</strong>
                {snapshot.unavailable_count > 0 && (
                  <> · 异常 <strong className="font-mono text-warning">{snapshot.unavailable_count}</strong></>
                )}
              </span>
            )}
            {computedAt && <span>计算于 {computedAt}</span>}
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" /> 新增数据源
          </button>
        </div>
      </GlassCard>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div>{error}</div>
            <div className="mt-1 text-xs text-muted-foreground">基础代码和名称仍可维护；恢复通达信连接后点“重新计算”。</div>
          </div>
        </div>
      )}

      {formOpen && (
        <GlassCard className="mb-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">{editingCode ? "修改板块数据源" : "新增板块数据源"}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">代码与名称都会参与板块池；修改代码后会重新拉取通达信日 K。</p>
            </div>
            <button type="button" onClick={closeForm} className="rounded p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
            <label>
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">板块代码</span>
              <input
                type="text"
                inputMode="numeric"
                value={formCode}
                onChange={event => setFormCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="如 880544"
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">板块名称</span>
              <input
                type="text"
                value={formName}
                onChange={event => setFormName(event.target.value)}
                maxLength={40}
                placeholder="如 光伏"
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
            </label>
          </div>
          {formError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{formError}
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={closeForm} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">取消</button>
            <button
              type="button"
              onClick={() => void submitForm()}
              disabled={submitting || refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/25 disabled:opacity-50"
            >
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存并重算
            </button>
          </div>
        </GlassCard>
      )}

      <GlassCard className="mb-4 !p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[210px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="搜索板块代码 / 名称"
              className="w-full rounded-lg border border-border bg-black/20 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary/50"
            />
          </div>
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showUnavailable}
              onChange={event => setShowUnavailable(event.target.checked)}
              className="accent-primary"
            />
            显示无行情代码
          </label>
        </div>
      </GlassCard>

      {loadingSources ? (
        <GlassCard>
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> 加载板块基础数据源…
          </div>
        </GlassCard>
      ) : sources.length === 0 ? (
        <GlassCard>
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">板块数据源为空，请先新增通达信板块代码和名称。</p>
            <button type="button" onClick={openAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm text-primary hover:bg-primary/25">
              <Plus className="h-4 w-4" /> 新增第一个数据源
            </button>
          </div>
        </GlassCard>
      ) : (
        <GlassCard className="!p-0 overflow-hidden">
          <div className="border-b border-border/50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">RPS20 完整列表</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  共 {displayedRows.length} 个板块；点击表头可切换排序，每页 {PAGE_SIZE} 条。
                </p>
              </div>
              {loadingRps && (
                <span className="inline-flex items-center gap-1.5 text-xs text-primary">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> 正在读取通达信板块日 K…
                </span>
              )}
            </div>
          </div>
          <div className="max-h-[760px] overflow-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 z-[1] bg-card/95 backdrop-blur">
                <tr className="border-b border-border/60 text-left text-[11px] text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">序号</th>
                  <SortHeader label="板块代码 / 名称" columnKey="code" sortKey={sortKey} direction={sortDirection} onSort={changeSort} align="left" />
                  <SortHeader label="20日涨幅" columnKey="return20_pct" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                  {PERIODS.map(period => (
                    <SortHeader
                      key={period}
                      label={`RPS${period}`}
                      columnKey={rpsKey(period)}
                      sortKey={sortKey}
                      direction={sortDirection}
                      onSort={changeSort}
                      className={period === 20 ? "text-primary" : undefined}
                    />
                  ))}
                  <SortHeader label="最新点位" columnKey="latest_close" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                  <th className="px-3 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row, index) => {
                  const source = sourceByCode.get(row.code);
                  const rank = (currentPage - 1) * PAGE_SIZE + index + 1;
                  return (
                    <tr key={row.code} className="border-b border-border/30 transition-colors hover:bg-muted/20">
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{rank}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{row.name}</div>
                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                          <span>{row.code}</span>
                          {row.status !== "ok" && (
                            <span className="font-sans text-warning" title={row.error ?? undefined}>
                              {row.status === "stale" ? "日线滞后" : "无日线"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={cn("px-3 py-2.5 text-right font-mono", returnTone(row.return20_pct))}>
                        {formatReturn(row.return20_pct)}
                      </td>
                      {PERIODS.map(period => (
                        <td key={period} className={cn(
                          "px-3 py-2.5 text-right font-mono",
                          rpsTone(row[rpsKey(period)]),
                          period === 20 && "bg-primary/[0.035]",
                        )}>
                          {formatNumber(row[rpsKey(period)])}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">
                        {formatNumber(row.latest_close, row.latest_close != null && row.latest_close < 10 ? 3 : 2)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {source && (
                          <div className="inline-flex gap-1">
                            <button type="button" onClick={() => openEdit(source)} title="修改代码或名称" className="rounded-md p-1 text-muted-foreground transition hover:bg-muted/40 hover:text-primary">
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => void deleteSource(source)} title="删除数据源" className="rounded-md p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {displayedRows.length > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
              <span>第 {currentPage} / {totalPages} 页</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage(value => Math.max(1, value - 1))}
                  disabled={currentPage <= 1}
                  className="rounded-lg border border-border px-3 py-1.5 transition hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => setPage(value => Math.min(totalPages, value + 1))}
                  disabled={currentPage >= totalPages}
                  className="rounded-lg border border-border px-3 py-1.5 transition hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </GlassCard>
      )}

      {snapshot?.rule && (
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
          <strong>计算口径：</strong>{snapshot.rule}
        </p>
      )}
    </div>
  );
}

function SortHeader({
  label,
  columnKey,
  sortKey,
  direction,
  onSort,
  align = "right",
  className,
}: {
  label: string;
  columnKey: SortKey;
  sortKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sortKey === columnKey;
  return (
    <th
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2.5 font-medium", align === "right" && "text-right", className)}
    >
      <button
        type="button"
        aria-label={`按${label}排序`}
        onClick={() => onSort(columnKey)}
        className={cn(
          "inline-flex items-center gap-1 transition hover:text-primary",
          align === "right" && "justify-end",
          active && "text-primary",
        )}
      >
        <span>{label}</span>
        {active
          ? direction === "asc"
            ? <ArrowUp className="h-3 w-3" />
            : <ArrowDown className="h-3 w-3" />
          : <ArrowUpDown className="h-3 w-3 opacity-50" />}
      </button>
    </th>
  );
}

// Auto-generated: SectorStrength page
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BarChart3, ChevronDown, ChevronUp,
  Database, Edit3, LoaderCircle, Plus, RefreshCw,
  Save, Search, Sparkles, Trash2, TrendingUp, X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";


interface UserSector { code: string; name: string; constituents: string[]; created_at: number; updated_at: number; }
interface ConstituentRps { code: string; name: string; rps5: number | null; rps10: number | null; rps15: number | null; rps20: number | null; }
interface SectorRps {
  code: string; name: string; trade_date: string | null;
  constituent_count: number; matched_count: number; missing_codes: string[];
  rps5: number | null; rps10: number | null; rps15: number | null; rps20: number | null;
  constituents: ConstituentRps[]; computed_at: number;
}
type SortKey = "code" | "name" | "rps5" | "rps10" | "rps15" | "rps20" | "matched_count";

const PERIODS: { key: "rps5" | "rps10" | "rps15" | "rps20"; label: string }[] = [
  { key: "rps5", label: "RPS5" },
  { key: "rps10", label: "RPS10" },
  { key: "rps15", label: "RPS15" },
  { key: "rps20", label: "RPS20" },
];

function rpsTone(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-muted-foreground/60";
  if (v >= 95) return "font-bold text-danger";
  if (v >= 90) return "font-semibold text-primary";
  if (v >= 80) return "text-primary/90";
  if (v >= 60) return "text-foreground/80";
  if (v >= 30) return "text-muted-foreground";
  return "text-muted-foreground/70";
}
function fmtPct(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

const PRESETS_TEXT = [
  "880301 煤炭", "880305 电力", "880318 钢铁", "880324 有色",
  "880372 食品饮料", "880387 家用电器", "880398 医疗保健", "880471 银行",
  "880491 半导体", "880544 光伏", "880545 云计算", "880705 氢能源",
  "880703 人形机器人", "880952 芯片", "881121 半导体", "881262 电池",
  "881268 电网设备"
].join("\n");

export function SectorStrength() {
  const [sectors, setSectors] = useState<UserSector[]>([]);
  const [rpsList, setRpsList] = useState<SectorRps[]>([]);
  const [tradeDate, setTradeDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formConstituents, setFormConstituents] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("rps20");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  const reload = async () => {
    setRefreshing(true); setError(null);
    try {
      const list = await fetchJson<UserSector[]>("/api/user-sectors");
      setSectors(list);
      try {
        const rps = await fetchJson<SectorRps[]>("/api/user-sectors/rps");
        setRpsList(rps);
        setTradeDate(rps[0]?.trade_date ?? null);
      } catch (e) { console.warn("RPS load failed", e); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载板块列表失败");
    } finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { void reload(); }, []);

  const openAdd = () => {
    setShowAddForm(true); setEditingCode(null);
    setFormCode(""); setFormName(""); setFormConstituents("");
    setFormError(null);
  };
  const openEdit = (sector: UserSector) => {
    setEditingCode(sector.code); setShowAddForm(false);
    setFormCode(sector.code); setFormName(sector.name);
    setFormConstituents(sector.constituents.join("\n"));
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancelForm = () => { setShowAddForm(false); setEditingCode(null); setFormError(null); };

  const submitForm = async () => {
    setFormError(null);
    if (!/^\d{6}$/.test(formCode.trim())) { setFormError("板块代码必须是 6 位数字"); return; }
    if (!formName.trim()) { setFormError("板块名称不能为空"); return; }
    setSubmitting(true);
    try {
      if (editingCode) {
        await fetchJson(`/api/user-sectors/${editingCode}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim(), constituents: formConstituents }),
        });
      } else {
        await fetchJson("/api/user-sectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: formCode.trim(), name: formName.trim(), constituents: formConstituents }),
        });
      }
      cancelForm(); void reload();
    } catch (e) { setFormError(e instanceof Error ? e.message : "保存失败"); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (code: string, name: string) => {
    if (!window.confirm(`确认删除板块 「${code} ${name}」？此操作不可撤销。`)) return;
    try {
      await fetchJson(`/api/user-sectors/${code}`, { method: "DELETE" });
      if (expandedCode === code) setExpandedCode(null);
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : "删除失败"); }
  };

  const merged = useMemo(() => {
    const rpsByCode = new Map(rpsList.map(r => [r.code, r]));
    return sectors.map(s => {
      const r = rpsByCode.get(s.code);
      return {
        ...s,
        rps5:  r?.rps5  ?? null,
        rps10: r?.rps10 ?? null,
        rps15: r?.rps15 ?? null,
        rps20: r?.rps20 ?? null,
        matched_count: r?.matched_count ?? 0,
        missing_codes: r?.missing_codes ?? [],
        constituents_detail: r?.constituents ?? [],
      } as any;
    });
  }, [sectors, rpsList]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(s => s.name.toLowerCase().includes(q) || s.code.includes(q));
  }, [merged, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a: any, b: any) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc" ? String(av).localeCompare(String(bv), "zh") : String(bv).localeCompare(String(av), "zh");
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("desc"); return; }
    setSortDir(sortDir === "desc" ? "asc" : "desc");
  };

  const SortHead = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: "left" | "right" }) => {
    const active = sortKey === k;
    return (
      <th onClick={() => toggleSort(k)} className={cn(
        "whitespace-nowrap px-3 py-2.5 font-medium select-none cursor-pointer hover:text-foreground transition-colors",
        align === "right" && "text-right"
      )}>
        <span className="inline-flex items-center gap-1">
          {label}
          <span className={cn("text-[10px] leading-none", active ? "text-primary" : "text-muted-foreground/40")}>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </span>
      </th>
    );
  };

  return (
    <div>
      <PageHeader title="板块强度" subtitle="通达信板块代码 + 用户自填成分股，RPS5/10/15/20 取中位数。" actions={
        <button type="button" onClick={() => void reload()} disabled={loading || refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-black/20 px-3 py-2 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-50">
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          刷新
        </button>
      } />

      <GlassCard className="mb-4 !p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Database className="h-4 w-4" />
            <span>已配置 <span className="font-mono text-foreground">{sectors.length}</span> 个板块</span>
            {tradeDate && (
              <span className="ml-2 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-primary">
                RPS 基准日 {tradeDate}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-danger" /> ≥95 极强</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-primary" /> ≥90 强</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" /> 中性</span>
          </div>
        </div>
      </GlassCard>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {(showAddForm || editingCode !== null) && (
        <GlassCard className="mb-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">
              {editingCode ? `编辑板块 ${editingCode}` : "新增板块"}
            </h2>
            <button onClick={cancelForm} className="rounded p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">板块代码 <span className="text-destructive">*</span></span>
              <input type="text" inputMode="numeric" value={formCode} disabled={!!editingCode}
                onChange={(e) => setFormCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="如 880544"
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 font-mono text-sm outline-none focus:border-primary/50 disabled:opacity-60" />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">板块名称 <span className="text-destructive">*</span></span>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} maxLength={40}
                placeholder="如 光伏"
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
            </label>
          </div>

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="block text-xs font-medium text-muted-foreground">
                成分股（A 股 6 位代码，换行 / 空格 / 逗号 / 分号分隔；可留空后填）
              </span>
              <button type="button" onClick={() => {
                if (!window.confirm("将用预设板块代码填入成分股框？表单当前内容会丢失。")) return;
                const codes = PRESETS_TEXT.split("\n").map(l => l.split(/\s+/)[0]).filter(Boolean);
                setFormConstituents(codes.join("\n"));
              }} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                <Sparkles className="h-3 w-3" /> 一键填入 17 个常用板块代码
              </button>
            </div>
            <textarea value={formConstituents} onChange={(e) => setFormConstituents(e.target.value)} rows={6}
              placeholder={"例如：\n600519\n000001\n600036"}
              className="w-full rounded-lg border border-border bg-black/25 px-3 py-2 font-mono text-[12px] leading-5 outline-none focus:border-primary/50" />
            <p className="mt-1 text-[11px] text-muted-foreground">
              解析后将自动去重、非 6 位代码忽略。板块 RPS = 成分股 RPS 的<strong>中位数</strong>（剔除新股/异常更稳健）。
            </p>
          </div>
          {formError && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{formError}</span>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={cancelForm} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">取消</button>
            <button type="button" onClick={submitForm} disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/25 disabled:opacity-50">
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存
            </button>
          </div>
        </GlassCard>
      )}

      <GlassCard className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索板块代码 / 名称"
              className="w-full rounded-lg border border-border bg-black/20 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary/50" />
          </div>
          {!showAddForm && editingCode === null && (
            <button type="button" onClick={openAdd}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary">
              <Plus className="h-3.5 w-3.5" /> 新增板块
            </button>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">
            点击表头排序；点击板块行展开成分股明细
          </span>
        </div>
      </GlassCard>

      {loading ? (
        <GlassCard className="mb-4">
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> 加载板块列表…
          </div>
        </GlassCard>
      ) : sectors.length === 0 ? (
        <GlassCard className="mb-4">
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              还没有任何板块。在工具栏点「新增板块」，填写通达信板块代码和成分股即可开始追踪。
            </p>
            {!showAddForm && (
              <button type="button" onClick={openAdd}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/25">
                <Plus className="h-4 w-4" /> 新增第一个板块
              </button>
            )}
          </div>
        </GlassCard>
      ) : (
        <GlassCard className="!p-0 overflow-hidden">
          <div className="max-h-[680px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-card/95 backdrop-blur">
                <tr className="border-b border-border/60 text-left text-[11px] text-muted-foreground">
                  <SortHead k="code" label="代码 / 名称" align="left" />
                  <SortHead k="matched_count" label="成分股 命中" align="right" />
                  {PERIODS.map(p => <SortHead key={p.key} k={p.key as SortKey} label={p.label} />)}
                  <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s: any) => {
                  const expanded = expandedCode === s.code;
                  return (
                    <RowGroup key={s.code} sector={s} expanded={expanded}
                      onToggle={() => setExpandedCode(expanded ? null : s.code)}
                      onEdit={() => openEdit(s)}
                      onDelete={() => void handleDelete(s.code, s.name)} />
                  );
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {!loading && sectors.length > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          <strong>提示：</strong>成分股为空时 RPS 显示为 —。RPS 计算走量化选股已构建的全市场快照（≥1 次/交易日），无需重复拉取行情。
        </p>
      )}
    </div>
  );
}

function RowGroup({ sector, expanded, onToggle, onEdit, onDelete }: {
  sector: any; expanded: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer border-b border-border/30 transition-colors hover:bg-muted/20" onClick={onToggle}>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-primary" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />}
            <div>
              <div className="font-medium">{sector.name || "—"}</div>
              <div className="font-mono text-[11px] text-muted-foreground">{sector.code}</div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right font-mono">
          <span className={cn(sector.matched_count === 0 && "text-muted-foreground/60")}>{sector.matched_count}</span>
          <span className="text-muted-foreground/50"> / {sector.constituents.length}</span>
        </td>
        {PERIODS.map(p => (
          <td key={p.key} className={cn("px-3 py-2.5 text-right font-mono", rpsTone(sector[p.key]))}>
            {fmtPct(sector[p.key])}
          </td>
        ))}
        <td className="whitespace-nowrap px-3 py-2.5 text-right">
          <div className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={onEdit} title="编辑"
              className="rounded-md p-1 text-muted-foreground transition hover:bg-muted/40 hover:text-primary">
              <Edit3 className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onDelete} title="删除"
              className="rounded-md p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/30 bg-black/15">
          <td colSpan={6} className="px-3 py-3"><ExpandedDetail sector={sector} /></td>
        </tr>
      )}
    </>
  );
}

function ExpandedDetail({ sector }: { sector: any }) {
  const constituents: string[] = sector.constituents ?? [];
  const detail: ConstituentRps[] = sector.constituents_detail ?? [];
  const missing: string[] = sector.missing_codes ?? [];
  const detailByCode = new Map(detail.map(d => [d.code, d]));

  if (constituents.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        还没有成分股。在表格行右边点「编辑」粘贴 A 股代码即可计算 RPS。
      </p>
    );
  }

  const rows = ([...constituents].map(code => detailByCode.get(code)).filter(Boolean) as ConstituentRps[]);
  rows.sort((a, b) => (b.rps20 ?? -1) - (a.rps20 ?? -1));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="h-3 w-3 text-primary" />
          共 {constituents.length} 只，按 RPS20 降序
        </span>
        {missing.length > 0 && (
          <span className="inline-flex items-center gap-1 text-warning">
            <AlertTriangle className="h-3 w-3" />{missing.length} 只未命中快照（新股或未上市满 1 年）
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">无成分股命中 RPS 快照，请确认股票代码。</p>
      ) : (
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map(c => (
            <div key={c.code} className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.name || c.code}</div>
                <div className="font-mono text-muted-foreground">{c.code}</div>
              </div>
              <div className="flex shrink-0 gap-1.5 font-mono">
                <span className={cn("w-9 text-right", rpsTone(c.rps5))}>{fmtPct(c.rps5, 0)}</span>
                <span className={cn("w-9 text-right", rpsTone(c.rps10))}>{fmtPct(c.rps10, 0)}</span>
                <span className={cn("w-9 text-right", rpsTone(c.rps15))}>{fmtPct(c.rps15, 0)}</span>
                <span className={cn("w-9 text-right", rpsTone(c.rps20))}>{fmtPct(c.rps20, 0)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  let payload: any = null;
  try { payload = await resp.json(); } catch {}
  if (!resp.ok) {
    const detail = payload?.detail;
    const msg = typeof detail === "string" ? detail
              : Array.isArray(detail) ? detail.map((d: any) => d.msg).join("; ")
              : payload?.message || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return (payload?.data ?? payload) as T;
}

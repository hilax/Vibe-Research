import { useMemo, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ExternalLink,
  Filter,
  Link2,
  Search,
  ShieldAlert,
} from "lucide-react";
import {
  catalysts,
  crossSectorLinks,
  failureCases,
  listedCompanies,
  researchRecordById,
  researchRecords,
  researchSourceById,
  researchSources,
} from "@/data/research";
import type {
  CertaintyLevel,
  EvidenceGrade,
  ResearchRecord,
  ResearchSectorKey,
} from "@/data/research";

const SECTOR_LABELS: Record<ResearchSectorKey, string> = {
  "ai-computing": "AI算力",
  hbm: "HBM",
  cpo: "光互联",
  "business-space": "商业航天",
};

const CERTAINTY_LABELS: Record<CertaintyLevel, string> = {
  green: "绿档",
  yellow: "黄档",
  red: "红档",
};

function certaintyClass(level: CertaintyLevel) {
  if (level === "green") return "border-success/35 bg-success/10 text-success";
  if (level === "yellow") return "border-warning/35 bg-warning/10 text-warning";
  return "border-danger/35 bg-danger/10 text-danger";
}

function EvidencePill({ grade }: { grade: EvidenceGrade }) {
  return (
    <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
      证据 {grade} 级
    </span>
  );
}

function SourceLinks({ sourceIds }: { sourceIds: string[] }) {
  const sources = sourceIds.flatMap((id) => {
    const source = researchSourceById.get(id);
    return source ? [source] : [];
  });
  if (!sources.length) return <p className="text-xs text-warning">来源记录待补。</p>;

  return (
    <div className="space-y-2">
      {sources.map((source) => (
        <a
          key={source.id}
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="block rounded-lg border border-border/50 bg-background/25 p-3 text-xs hover:border-primary/35"
        >
          <span className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
            {source.name}
            <EvidencePill grade={source.grade} />
            <span className="text-muted-foreground">{source.verification === "cross-verified" ? "已交叉验证" : source.verification === "single-source" ? "单一来源" : "待验证"}</span>
            <ExternalLink className="ml-auto h-3.5 w-3.5 text-primary" />
          </span>
          <span className="mt-1 block leading-relaxed text-muted-foreground">{source.originalTitle}</span>
          <span className="mt-1 block text-[11px] text-muted-foreground">发布 {source.publishedAt} · 事件 {source.eventAt ?? "不适用/未披露"} · 数据期 {source.period ?? "未披露"} · 抓取 {source.accessedAt}</span>
          {source.note ? <span className="mt-1 block text-[11px] text-warning">边界：{source.note}</span> : null}
        </a>
      ))}
    </div>
  );
}

function ResearchCard({ record }: { record: ResearchRecord }) {
  return (
    <details className="group overflow-hidden rounded-xl border border-border/55 bg-muted/15 open:border-primary/35 open:bg-primary/[0.035]">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-4 marker:hidden">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-foreground">{record.title}</h4>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${certaintyClass(record.certainty)}`}>
              {CERTAINTY_LABELS[record.certainty]}
            </span>
            <EvidencePill grade={record.evidenceGrade} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{record.subtitle}</p>
          <p className="mt-2 text-xs leading-relaxed text-foreground/80">阶段：{record.stage}</p>
        </div>
        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-primary transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-border/45 px-4 py-4">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(record.fields).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border/45 bg-background/20 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-foreground/85">{value || "暂无可靠公开数据"}</dd>
            </div>
          ))}
        </dl>

        <section className="mt-4">
          <h5 className="mb-2 text-xs font-bold text-foreground">四证链（分开展示）</h5>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
            {record.evidence.map((item) => (
              <article key={item.dimension} className="rounded-lg border border-border/50 bg-muted/20 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                  {item.dimension === "technology" ? "技术证据" : item.dimension === "customer" ? "客户证据" : item.dimension === "capacity" ? "产能证据" : "财务证据"}
                </p>
                <p className="mt-1 text-xs font-semibold text-foreground">{item.stage}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.summary}</p>
                {item.fatalShortfall ? <p className="mt-2 text-[11px] font-medium text-danger">致命短板：{item.fatalShortfall}</p> : null}
              </article>
            ))}
          </div>
        </section>

        {record.pending.length ? (
          <p className="mt-4 rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs leading-relaxed text-warning">
            待补：{record.pending.join("；")}
          </p>
        ) : null}

        <details className="group/source mt-4 rounded-lg border border-border/50 bg-muted/15">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-primary marker:hidden">
            展开来源与口径（{record.sourceIds.length}）
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/source:rotate-180" />
          </summary>
          <div className="border-t border-border/40 p-3"><SourceLinks sourceIds={record.sourceIds} /></div>
        </details>

        <p className="mt-3 text-[11px] text-muted-foreground">数据更新：{record.updatedAt}</p>
      </div>
    </details>
  );
}

export function ResearchAssetWorkbench({ sector, title, recordType }: { sector?: ResearchSectorKey; title: string; recordType?: ResearchRecord["recordType"] }) {
  const [query, setQuery] = useState("");
  const [certainty, setCertainty] = useState<"all" | CertaintyLevel>("all");
  const [grade, setGrade] = useState<"all" | EvidenceGrade>("all");
  const [sort, setSort] = useState<"updated" | "company" | "certainty">("updated");

  const records = useMemo(() => {
    const certaintyOrder: Record<CertaintyLevel, number> = { green: 0, yellow: 1, red: 2 };
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return researchRecords
      .filter((record) => !sector || record.sector === sector)
      .filter((record) => !recordType || record.recordType === recordType)
      .filter((record) => certainty === "all" || record.certainty === certainty)
      .filter((record) => grade === "all" || record.evidenceGrade === grade)
      .filter((record) => !normalized || `${record.title} ${record.subtitle} ${record.company} ${record.stage} ${record.tags.join(" ")} ${Object.values(record.fields).join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalized))
      .sort((a, b) => sort === "company" ? a.company.localeCompare(b.company, "zh-CN") : sort === "certainty" ? certaintyOrder[a.certainty] - certaintyOrder[b.certainty] : b.updatedAt.localeCompare(a.updatedAt));
  }, [certainty, grade, query, recordType, sector, sort]);

  return (
    <section className="glass overflow-hidden">
      <div className="border-b border-border/50 px-4 py-4 sm:px-5">
        <h3 className="text-base font-bold text-foreground">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">支持按公司、产品、路线、阶段、证据等级和确定性检索；空字段不估算。</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_150px_130px_150px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司、产品、技术路线或阶段" className="w-full rounded-lg border border-border/60 bg-background/35 py-2 pl-9 pr-3 text-xs outline-none focus:border-primary/50" />
          </label>
          <Select value={certainty} onChange={(value) => setCertainty(value as "all" | CertaintyLevel)} label="确定性" options={[['all','全部确定性'],['green','绿档'],['yellow','黄档'],['red','红档']]} />
          <Select value={grade} onChange={(value) => setGrade(value as "all" | EvidenceGrade)} label="证据等级" options={[['all','全部证据'],['A','A级'],['B','B级'],['C','C级'],['D','D级'],['E','E级']]} />
          <Select value={sort} onChange={(value) => setSort(value as "updated" | "company" | "certainty")} label="排序" options={[['updated','按更新时间'],['company','按公司'],['certainty','按确定性']]} />
        </div>
      </div>
      <div className="space-y-3 p-3 sm:p-4">
        {records.map((record) => <ResearchCard key={record.id} record={record} />)}
        {!records.length ? <p className="py-8 text-center text-sm text-muted-foreground">没有符合当前筛选条件的数据。</p> : null}
      </div>
    </section>
  );
}

function Select({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: [string, string][] }) {
  return (
    <label className="relative">
      <Filter className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full appearance-none rounded-lg border border-border/60 bg-background/35 py-2 pl-8 pr-7 text-xs outline-none focus:border-primary/50">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
    </label>
  );
}

export function CompanyMappingTable({ sector, title }: { sector?: ResearchSectorKey; title: string }) {
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("all");
  const [sortKey, setSortKey] = useState<"company" | "market" | "date">("market");
  const markets = useMemo(() => Array.from(new Set(listedCompanies.map((company) => company.market))).sort(), []);
  const rows = useMemo(() => listedCompanies
    .filter((company) => !sector || company.sectors.includes(sector))
    .filter((company) => market === "all" || company.market === market)
    .filter((company) => !query.trim() || `${company.company} ${company.ticker} ${company.chainPosition} ${company.products} ${company.customers ?? ""}`.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN")))
    .sort((a, b) => sortKey === "date" ? b.dataDate.localeCompare(a.dataDate) : sortKey === "market" ? a.market.localeCompare(b.market) || a.company.localeCompare(b.company, "zh-CN") : a.company.localeCompare(b.company, "zh-CN")), [market, query, sector, sortKey]);

  return (
    <section className="overflow-hidden rounded-xl border border-border/50">
      <div className="border-b border-border/50 bg-muted/25 p-4">
        <h3 className="text-sm font-bold">{title}</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司、代码、产品" className="w-full rounded-lg border border-border/60 bg-background/35 py-2 pl-9 pr-3 text-xs outline-none focus:border-primary/50" /></label>
          <Select value={market} onChange={setMarket} label="上市市场" options={[["all", "全部市场"], ...markets.map((item): [string, string] => [item, item])]} />
          <Select value={sortKey} onChange={(value) => setSortKey(value as "company" | "market" | "date")} label="排序" options={[["market", "按市场"], ["company", "按公司"], ["date", "按数据日期"]]} />
        </div>
      </div>

      <div className="space-y-3 p-3 md:hidden">
        {rows.map((company) => (
          <details key={company.id} className="group rounded-xl border border-border/55 bg-muted/15 p-3">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-2 marker:hidden"><div><p className="text-sm font-bold">{company.company}</p><p className="text-xs text-primary">{company.ticker} · {company.market}</p><p className="mt-1 text-xs text-muted-foreground">{company.chainPosition}</p></div><ChevronDown className="h-4 w-4 text-primary transition group-open:rotate-180" /></summary>
            <dl className="mt-3 space-y-2 border-t border-border/40 pt-3 text-xs"><MobileField label="核心产品" value={company.products} /><MobileField label="客户/认证" value={[company.customers, company.qualification].filter(Boolean).join("；")} /><MobileField label="收入/订单" value={[company.relatedRevenue, company.relatedRevenueShare, company.orders].filter(Boolean).join("；")} /><MobileField label="产能/扩产" value={[company.capacity, company.utilization, company.expansion].filter(Boolean).join("；")} /><MobileField label="优势" value={company.advantage} /><MobileField label="风险" value={company.risk} /></dl>
            <div className="mt-3"><SourceLinks sourceIds={company.sourceIds} /></div>
          </details>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-[1500px] w-full text-left text-xs">
          <thead className="bg-primary/10"><tr>{["公司/代码", "市场", "产业位置", "核心产品", "客户/认证", "相关收入/占比", "订单/产能/扩产", "经营与财务观察", "优势", "最大风险", "数据日期/来源"].map((head) => <th key={head} className="whitespace-nowrap px-3 py-3 font-semibold">{head}</th>)}</tr></thead>
          <tbody>{rows.map((company, index) => <tr key={company.id} className={index % 2 === 0 ? "bg-muted/20" : ""}>
            <td className="px-3 py-3 align-top font-semibold">{company.company}<br /><span className="font-normal text-primary">{company.ticker}</span></td><td className="px-3 py-3 align-top">{company.market}</td><td className="px-3 py-3 align-top">{company.chainPosition}</td><td className="px-3 py-3 align-top">{company.products}</td><td className="px-3 py-3 align-top">{[company.customers, company.qualification].filter(Boolean).join("；") || "暂无可靠公开数据"}</td><td className="px-3 py-3 align-top">{[company.relatedRevenue, company.relatedRevenueShare, company.relatedGrossMargin].filter(Boolean).join("；") || "暂无可靠公开数据"}</td><td className="px-3 py-3 align-top">{[company.orders, company.capacity, company.utilization, company.expansion].filter(Boolean).join("；") || "暂无可靠公开数据"}</td><td className="px-3 py-3 align-top">{[company.capex, company.inventory, company.receivables, company.contractLiabilities, company.operatingCashFlow].filter(Boolean).join("；") || "待按定期报告补充"}</td><td className="px-3 py-3 align-top">{company.advantage}</td><td className="px-3 py-3 align-top text-danger">{company.risk}</td><td className="px-3 py-3 align-top">{company.dataDate}<br />{company.sourceIds.map((id) => { const source = researchSourceById.get(id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer noopener" className="mt-1 block text-primary hover:underline">{source.name}</a> : null; })}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!rows.length ? <p className="py-8 text-center text-sm text-muted-foreground">没有符合当前筛选条件的公司。</p> : null}
    </section>
  );
}

function MobileField({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-semibold text-foreground">{label}</dt><dd className="mt-0.5 leading-relaxed text-muted-foreground">{value || "暂无可靠公开数据"}</dd></div>;
}

export function UnifiedCertaintyMap({ sector, title }: { sector?: ResearchSectorKey; title: string }) {
  const [sectorFilter, setSectorFilter] = useState<"all" | ResearchSectorKey>(sector ?? "all");
  const effectiveSector = sector ?? (sectorFilter === "all" ? undefined : sectorFilter);
  const selected = researchRecords.filter((record) => !effectiveSector || record.sector === effectiveSector);
  const groups: { level: CertaintyLevel; definition: string }[] = [
    { level: "green", definition: "关键客户/任务、批量或运营、收入证据中至少多项已验证；仍不代表低风险。" },
    { level: "yellow", definition: "方向或产品较明确，但客户份额、良率、交付或财务证据仍有缺口。" },
    { level: "red", definition: "规划、样品或概念为主；不能按全面渗透或收入兑现计算。" },
  ];
  return (
    <section>
      <div className="mb-4 rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">分档为机械证据状态，不是荐股或主观投资评分。任何四证链致命短板仍单独显示。</p></div>
          {!sector ? <div className="w-full sm:w-44"><Select value={sectorFilter} onChange={(value) => setSectorFilter(value as "all" | ResearchSectorKey)} label="板块" options={[["all", "全部板块"], ["ai-computing", "AI算力"], ["hbm", "HBM"], ["cpo", "光互联"], ["business-space", "商业航天"]]} /></div> : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">{groups.map((group) => { const items = selected.filter((record) => record.certainty === group.level); return <section key={group.level} className={`overflow-hidden rounded-2xl border ${certaintyClass(group.level)}`}><header className="border-b border-current/20 px-4 py-4"><div className="flex items-center justify-between"><h4 className="font-extrabold">{CERTAINTY_LABELS[group.level]}</h4><span className="text-xs">{items.length} 项</span></div><p className="mt-2 text-xs leading-relaxed text-foreground/80">{group.definition}</p></header><div className="divide-y divide-border/40 bg-background/20">{items.map((record) => <article key={record.id} className="p-4"><p className="text-sm font-bold text-foreground">{record.title}</p><p className="mt-1 text-xs text-muted-foreground">{record.company} · {record.stage}</p><p className="mt-2 text-[11px] leading-relaxed text-warning">下一锚点：{record.pending[0] ?? "持续更新"}</p></article>)}{!items.length ? <p className="p-4 text-xs text-muted-foreground">当前无项目。</p> : null}</div></section>; })}</div>
    </section>
  );
}

export function ResearchCatalystCalendar({ sector, title }: { sector?: ResearchSectorKey; title: string }) {
  const rows = catalysts.filter((event) => !sector || event.sector === sector);
  return (
    <figure className="overflow-hidden rounded-xl border border-border/50"><figcaption className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-4 py-3 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-primary" />{title}</figcaption><div className="overflow-x-auto"><table className="min-w-[1450px] w-full text-left text-xs"><thead className="bg-primary/10"><tr>{["板块", "公司/产品", "事件", "预计日期/精度", "市场预期", "关键观察指标", "正面情景", "负面情景", "实际结果", "影响", "更新"].map((head) => <th key={head} className="whitespace-nowrap px-3 py-3 font-semibold">{head}</th>)}</tr></thead><tbody>{rows.map((event, index) => <tr key={event.id} className={index % 2 === 0 ? "bg-muted/20" : ""}><td className="px-3 py-3 align-top">{SECTOR_LABELS[event.sector]}</td><td className="px-3 py-3 align-top font-semibold">{event.company}<br /><span className="font-normal text-primary">{event.product}</span></td><td className="px-3 py-3 align-top">{event.eventType}</td><td className="px-3 py-3 align-top">{event.expectedAt}<br /><span className="text-muted-foreground">{event.datePrecision}</span></td><td className="px-3 py-3 align-top">{event.consensus}</td><td className="px-3 py-3 align-top">{event.metric}</td><td className="px-3 py-3 align-top text-success">{event.positive}</td><td className="px-3 py-3 align-top text-danger">{event.negative}</td><td className="px-3 py-3 align-top">{event.actual ?? "待事件发生"}</td><td className="px-3 py-3 align-top">{event.impact ?? "待复盘"}</td><td className="px-3 py-3 align-top text-muted-foreground">{event.updatedAt}</td></tr>)}</tbody></table></div></figure>
  );
}

export function ResearchFailureLibrary({ sector, title }: { sector?: ResearchSectorKey; title: string }) {
  const items = failureCases.filter((item) => !sector || item.sector === sector);
  return <section><div className="mb-3 flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-warning" /><h3 className="text-sm font-bold">{title}</h3></div><div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{items.map((item) => <article key={item.id} className="glass p-4"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-bold">{item.project}</h4><span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">{SECTOR_LABELS[item.sector]}</span></div><p className="mt-1 text-xs text-muted-foreground">发生/复盘口径：{item.occurredAt}</p><dl className="mt-3 space-y-2 text-xs leading-relaxed"><MobileField label="原计划" value={item.plan} /><MobileField label="实际结果" value={item.outcome} /><MobileField label="失败原因" value={item.cause} /><MobileField label="产业链/公司影响" value={`${item.chainImpact}；${item.companyImpact}`} /><MobileField label="是否修复" value={item.repaired} /><MobileField label="启示" value={item.lesson} /></dl><div className="mt-3"><SourceLinks sourceIds={item.sourceIds} /></div><p className="mt-2 text-[11px] text-muted-foreground">更新 {item.updatedAt}</p></article>)}</div></section>;
}

export function CrossSectorEvidenceGraph({ title }: { title: string }) {
  return <section className="glass overflow-hidden"><div className="border-b border-border/50 px-5 py-4"><div className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" /><h3 className="text-base font-bold">{title}</h3></div><p className="mt-1 text-xs text-muted-foreground">关联只证明系统关系，不把相关性自动转换为公司订单或收入。</p></div><div className="grid gap-3 p-4 lg:grid-cols-2">{crossSectorLinks.map((link) => { const from = researchRecordById.get(link.fromId); const to = researchRecordById.get(link.toId); const fallbackCompany = listedCompanies.find((company) => company.id === link.toId); return <article key={link.id} className="rounded-xl border border-border/50 bg-muted/15 p-4"><div className="flex flex-wrap items-center gap-2 text-xs font-semibold"><span className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-primary">{from?.title ?? link.fromId}</span><span className="text-muted-foreground">{link.relation}</span><span className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-primary">{to?.title ?? fallbackCompany?.company ?? link.toId}</span></div><p className="mt-3 text-xs leading-relaxed text-foreground/80">{link.evidence}</p><details className="group mt-3"><summary className="cursor-pointer list-none text-[11px] text-primary marker:hidden">展开关联来源</summary><div className="mt-2"><SourceLinks sourceIds={link.sourceIds} /></div></details></article>; })}</div></section>;
}

export function ResearchSourceIndex({ sector, title }: { sector?: ResearchSectorKey; title: string }) {
  const items = researchSources.filter((source) => !sector || source.sectors.includes(sector));
  return <section className="rounded-xl border border-border/50 bg-muted/15"><div className="border-b border-border/50 px-4 py-3"><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-xs text-muted-foreground">共 {items.length} 条；A/B级优先，D/E级不得单独支撑确定性结论。</p></div><div className="space-y-2 p-3">{items.map((source) => <details key={source.id} className="group rounded-lg border border-border/45 bg-background/20"><summary className="flex cursor-pointer list-none items-start gap-2 p-3 marker:hidden"><EvidencePill grade={source.grade} /><div className="min-w-0"><p className="text-xs font-semibold text-foreground">{source.originalTitle}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{source.name} · {source.publishedAt}</p></div><ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-primary transition group-open:rotate-180" /></summary><div className="border-t border-border/40 px-3 py-3 text-xs leading-relaxed"><p>类型：{source.sourceType} · 事件：{source.eventAt ?? "不适用/未披露"} · 数据期：{source.period ?? "未披露"} · 抓取：{source.accessedAt}</p><p className="mt-1 text-warning">边界：{source.note}</p><a href={source.url} target="_blank" rel="noreferrer noopener" className="mt-2 inline-flex items-center gap-1 text-primary hover:underline">打开原文 <ExternalLink className="h-3 w-3" /></a></div></details>)}</div></section>;
}

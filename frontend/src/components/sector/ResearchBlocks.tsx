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
  specialCardDefinitionByType,
  valuationCounterEvidence,
} from "@/data/research";
import type {
  CertaintyLevel,
  EvidenceGrade,
  ResearchRecord,
  ResearchSectorKey,
  SpecialCardDefinition,
} from "@/data/research";

const SECTOR_LABELS: Record<ResearchSectorKey, string> = {
  "ai-computing": "AI算力",
  hbm: "HBM",
  cpo: "光互联",
  "business-space": "商业航天",
  semiconductor: "半导体国产替代",
  "solid-state-battery": "固态电池",
  "low-altitude": "低空经济",
  "smart-driving": "智能驾驶",
  "innovative-drug": "创新药",
  "power-grid": "电网与特高压",
  defense: "军工",
  fusion: "可控核聚变",
};

const SECTOR_OPTIONS: [ResearchSectorKey, string][] = Object.entries(SECTOR_LABELS) as [ResearchSectorKey, string][];

const EVIDENCE_DIMENSION_LABELS: Record<ResearchRecord["evidence"][number]["dimension"], string> = {
  demand: "真实需求",
  technology: "技术路线",
  customer: "客户证据",
  validation: "客户/监管/项目验证",
  capacity: "产能证据",
  delivery: "产能/良率/交付",
  financial: "收入/利润/现金流",
};

const SCORE_DIMENSIONS = [
  ["demand", "真实需求"],
  ["technology", "技术路线"],
  ["validation", "客户/监管/项目验证"],
  ["delivery", "产能/良率/交付"],
  ["financial", "收入/利润/现金流"],
] as const;

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
          {source.lastVerifiedAt ? <span className="mt-1 block text-[11px] text-muted-foreground">最后核验 {source.lastVerifiedAt}</span> : null}
          {source.originalStatement ? <span className="mt-1 block text-[11px] leading-relaxed text-foreground/75">原始表述：{source.originalStatement}</span> : null}
          {source.summary ? <span className="mt-1 block text-[11px] leading-relaxed text-foreground/75">摘要：{source.summary}</span> : null}
          {source.supportingEvidence?.length ? <span className="mt-1 block text-[11px] text-success">支持证据：{source.supportingEvidence.join("、")}</span> : null}
          {source.conflictingEvidence?.length ? <span className="mt-1 block text-[11px] text-danger">冲突证据：{source.conflictingEvidence.join("、")}</span> : null}
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
          <h5 className="mb-2 text-xs font-bold text-foreground">证据链（分开展示）</h5>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {record.evidence.map((item) => (
              <article key={item.dimension} className="rounded-lg border border-border/50 bg-muted/20 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                  {EVIDENCE_DIMENSION_LABELS[item.dimension]}
                </p>
                <p className="mt-1 text-xs font-semibold text-foreground">{item.stage}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.summary}</p>
                {item.fatalShortfall ? <p className="mt-2 text-[11px] font-medium text-danger">致命短板：{item.fatalShortfall}</p> : null}
              </article>
            ))}
          </div>
        </section>

        {record.certaintyAssessment ? (
          <section className="mt-4">
            <h5 className="mb-2 text-xs font-bold text-foreground">五维确定性原始分</h5>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {SCORE_DIMENSIONS.map(([key, label]) => (
                <article key={key} className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="mt-1 text-lg font-extrabold tabular-nums text-foreground">{record.certaintyAssessment?.scores[key]}<span className="text-xs font-normal text-muted-foreground">/5</span></p>
                </article>
              ))}
            </div>
            {record.certaintyAssessment.fatalShortfall ? (
              <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                致命短板：{record.certaintyAssessment.fatalShortfall}
              </p>
            ) : null}
          </section>
        ) : null}

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
        {!records.length && recordType && query === "" && certainty === "all" && grade === "all"
          ? <SpecialCardTemplate definition={specialCardDefinitionByType.get(recordType)} />
          : null}
        {!records.length && (!recordType || query !== "" || certainty !== "all" || grade !== "all")
          ? <p className="py-8 text-center text-sm text-muted-foreground">没有符合当前筛选条件的数据。</p>
          : null}
      </div>
    </section>
  );
}

function SpecialCardTemplate({ definition }: { definition?: SpecialCardDefinition }) {
  if (!definition) {
    return <p className="py-8 text-center text-sm text-muted-foreground">暂无已核验卡片。</p>;
  }
  return (
    <article className="overflow-hidden rounded-xl border border-warning/30 bg-warning/[0.045]">
      <header className="border-b border-warning/20 px-4 py-4">
        <p className="text-sm font-bold text-foreground">{definition.title} · 空白模板</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          卡片结构已建立。具体公司、产品、订单、良率和收入只有在取得可追溯来源后才录入；当前空值统一显示“{definition.emptyValue}”。
        </p>
      </header>
      <div className="grid gap-2 p-3 sm:grid-cols-2">
        {definition.fieldGroups.map((group) => (
          <details key={group.title} className="group rounded-lg border border-border/50 bg-background/25 p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-primary marker:hidden">
              {group.title}<span className="text-[10px] font-normal text-muted-foreground">{group.fields.length} 字段</span>
            </summary>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-3">
              {group.fields.map((field) => (
                <span key={field} className="rounded-md border border-border/50 bg-muted/30 px-2 py-1 text-[11px] text-foreground/80">{field}</span>
              ))}
            </div>
          </details>
        ))}
      </div>
      <div className="border-t border-warning/20 px-4 py-3">
        <p className="text-[11px] font-semibold text-warning">不可跨越的阶段边界</p>
        <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
          {definition.stageBoundary.map((boundary) => <li key={boundary}>• {boundary}</li>)}
        </ul>
      </div>
    </article>
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
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          “涉及相关业务”不等于进入核心供应链、获得订单、形成收入或成为核心受益公司；所有阶段均分栏记录。
        </p>
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
            <dl className="mt-3 space-y-2 border-t border-border/40 pt-3 text-xs"><MobileField label="核心产品/阶段" value={[company.products, company.productStage].filter(Boolean).join("；")} /><MobileField label="客户/验证/供应角色" value={[company.customers, company.customerValidation, company.qualification, company.supplierRole].filter(Boolean).join("；")} /><MobileField label="收入/订单" value={[company.relatedRevenue, company.relatedRevenueShare, company.orders, company.newOrders, company.deliveredOrders].filter(Boolean).join("；")} /><MobileField label="产能/良率/扩产" value={[company.capacity, company.effectiveCapacity, company.utilization, company.yield, company.expansion].filter(Boolean).join("；")} /><MobileField label="优势" value={company.advantage} /><MobileField label="风险" value={company.risk} /></dl>
            <div className="mt-3"><SourceLinks sourceIds={company.sourceIds} /></div>
          </details>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-[1500px] w-full text-left text-xs">
          <thead className="bg-primary/10"><tr>{["公司/代码", "市场", "产业位置", "核心产品", "客户/认证", "相关收入/占比", "订单/产能/扩产", "经营与财务观察", "优势", "最大风险", "数据日期/来源"].map((head) => <th key={head} className="whitespace-nowrap px-3 py-3 font-semibold">{head}</th>)}</tr></thead>
          <tbody>{rows.map((company, index) => <tr key={company.id} className={index % 2 === 0 ? "bg-muted/20" : ""}>
            <td className="px-3 py-3 align-top font-semibold">{company.company}<br /><span className="font-normal text-primary">{company.ticker}</span>{company.certainty ? <span className={`mt-1 block w-fit rounded-full border px-1.5 py-0.5 text-[10px] ${certaintyClass(company.certainty)}`}>{CERTAINTY_LABELS[company.certainty]}</span> : null}</td><td className="px-3 py-3 align-top">{company.market}</td><td className="px-3 py-3 align-top">{company.chainPosition}</td><td className="px-3 py-3 align-top">{[company.products, company.productStage].filter(Boolean).join("；")}</td><td className="px-3 py-3 align-top">{[company.customers, company.customerValidation, company.qualification, company.supplierRole].filter(Boolean).join("；") || "暂无可靠公开数据"}</td><td className="px-3 py-3 align-top">{[company.relatedRevenue, company.relatedRevenueShare, company.relatedGrossMargin].filter(Boolean).join("；") || "暂无可靠公开数据"}</td><td className="px-3 py-3 align-top">{[company.orders, company.newOrders, company.deliveredOrders, company.capacity, company.effectiveCapacity, company.utilization, company.yield, company.expansion].filter(Boolean).join("；") || "暂无可靠公开数据"}</td><td className="px-3 py-3 align-top">{[company.capex, company.inventory, company.receivables, company.contractLiabilities, company.operatingCashFlow].filter(Boolean).join("；") || "待按定期报告补充"}</td><td className="px-3 py-3 align-top">{company.advantage}</td><td className="px-3 py-3 align-top text-danger">{company.risk}</td><td className="px-3 py-3 align-top">{company.dataDate}{company.evidenceGrade ? <><br />证据{company.evidenceGrade}级</> : null}<br />{company.sourceIds.map((id) => { const source = researchSourceById.get(id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer noopener" className="mt-1 block text-primary hover:underline">{source.name}</a> : null; })}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!rows.length ? <CompanyMappingTemplate /> : null}
    </section>
  );
}

function CompanyMappingTemplate() {
  const groups = [
    ["身份与产品", "公司、代码、市场、所属板块、产业链环节、核心产品、产品当前阶段"],
    ["客户与验证", "主要客户、客户验证状态、头部供应链、独家/主供/二供/普通供应商"],
    ["订单与制造", "在手/新增/已交付订单、产能、有效产能、利用率、良率、扩产与资本开支"],
    ["财务与风险", "相关收入/占比/毛利、存货、应收、合同负债、现金流、研发、客户集中、海外占比、估值"],
    ["证据与分档", "优势、最大风险、数据日期、来源、证据等级、五维确定性等级"],
  ];
  return (
    <div className="border-t border-border/50 bg-warning/[0.035] p-4">
      <p className="text-center text-sm font-semibold text-foreground">当前没有满足来源门槛的公司记录</p>
      <p className="mt-1 text-center text-xs text-muted-foreground">公司卡结构已建立，待交易所公告、年报或客户侧材料核验后录入。</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {groups.map(([title, fields]) => (
          <article key={title} className="rounded-lg border border-border/50 bg-background/25 p-3">
            <p className="text-[11px] font-semibold text-primary">{title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{fields}</p>
          </article>
        ))}
      </div>
    </div>
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
          {!sector ? <div className="w-full sm:w-52"><Select value={sectorFilter} onChange={(value) => setSectorFilter(value as "all" | ResearchSectorKey)} label="板块" options={[["all", "全部板块"], ...SECTOR_OPTIONS]} /></div> : null}
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {SCORE_DIMENSIONS.map(([, label], index) => (
          <article key={label} className="rounded-lg border border-border/50 bg-muted/15 px-3 py-2 text-center">
            <p className="text-[10px] text-muted-foreground">维度 {index + 1}</p>
            <p className="mt-1 text-xs font-semibold text-foreground">{label}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">0—5 分</p>
          </article>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">{groups.map((group) => { const items = selected.filter((record) => record.certainty === group.level); return <section key={group.level} className={`overflow-hidden rounded-2xl border ${certaintyClass(group.level)}`}><header className="border-b border-current/20 px-4 py-4"><div className="flex items-center justify-between"><h4 className="font-extrabold">{CERTAINTY_LABELS[group.level]}</h4><span className="text-xs">{items.length} 项</span></div><p className="mt-2 text-xs leading-relaxed text-foreground/80">{group.definition}</p></header><div className="divide-y divide-border/40 bg-background/20">{items.map((record) => <article key={record.id} className="p-4"><p className="text-sm font-bold text-foreground">{record.title}</p><p className="mt-1 text-xs text-muted-foreground">{record.company} · {record.stage}</p><p className="mt-2 text-[11px] leading-relaxed text-warning">下一锚点：{record.pending[0] ?? "持续更新"}</p></article>)}{!items.length ? <p className="p-4 text-xs text-muted-foreground">当前无项目。</p> : null}</div></section>; })}</div>
    </section>
  );
}

export function ResearchCatalystCalendar({ sector, title }: { sector?: ResearchSectorKey; title: string }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"date" | "company" | "updated">("date");
  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return catalysts
      .filter((event) => !sector || event.sector === sector)
      .filter((event) => !normalized || `${event.company} ${event.product} ${event.eventType} ${event.expectedAt} ${event.metric}`.toLocaleLowerCase("zh-CN").includes(normalized))
      .sort((a, b) => sort === "company"
        ? a.company.localeCompare(b.company, "zh-CN")
        : sort === "updated"
          ? b.updatedAt.localeCompare(a.updatedAt)
          : a.expectedAt.localeCompare(b.expectedAt, "zh-CN"));
  }, [query, sector, sort]);
  return (
    <figure className="overflow-hidden rounded-xl border border-border/50">
      <figcaption className="border-b border-border/50 bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-primary" />{title}</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(240px,1fr)_160px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <span className="sr-only">搜索催化剂</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司、产品、事件或指标" className="w-full rounded-lg border border-border/60 bg-background/35 py-2 pl-9 pr-3 text-xs outline-none focus:border-primary/50" />
          </label>
          <Select value={sort} onChange={(value) => setSort(value as "date" | "company" | "updated")} label="排序" options={[["date", "按预计日期"], ["company", "按公司"], ["updated", "按更新时间"]]} />
        </div>
      </figcaption>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-[1450px] w-full text-left text-xs">
            <thead className="bg-primary/10"><tr>{["板块", "公司/产品", "事件", "预计日期/精度", "市场预期", "关键观察指标", "正面情景", "负面情景", "实际结果", "影响", "更新"].map((head) => <th key={head} className="whitespace-nowrap px-3 py-3 font-semibold">{head}</th>)}</tr></thead>
            <tbody>{rows.map((event, index) => (
              <tr key={event.id} className={index % 2 === 0 ? "bg-muted/20" : ""}>
                <td className="px-3 py-3 align-top">{SECTOR_LABELS[event.sector]}</td>
                <td className="px-3 py-3 align-top font-semibold">{event.company}<br /><span className="font-normal text-primary">{event.product}</span></td>
                <td className="px-3 py-3 align-top">{event.eventType}</td>
                <td className="px-3 py-3 align-top">{event.expectedAt}<br /><span className="text-muted-foreground">{event.datePrecision}</span></td>
                <td className="px-3 py-3 align-top">{event.consensus}</td>
                <td className="px-3 py-3 align-top">{event.metric}</td>
                <td className="px-3 py-3 align-top text-success">{event.positive}</td>
                <td className="px-3 py-3 align-top text-danger">{event.negative}</td>
                <td className="px-3 py-3 align-top">{event.actual ?? "待事件发生"}</td>
                <td className="px-3 py-3 align-top">{event.impact ?? "待复盘"}</td>
                <td className="px-3 py-3 align-top text-muted-foreground">{event.updatedAt}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {query ? "没有符合搜索条件的事件。" : "已建立日历字段；当前没有附带可核验日期的事件，待正式公告后录入。"}
        </p>
      )}
    </figure>
  );
}

export function ResearchFailureLibrary({ sector, title }: { sector?: ResearchSectorKey; title: string }) {
  const items = failureCases.filter((item) => !sector || item.sector === sector);
  return <section><div className="mb-3 flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-warning" /><h3 className="text-sm font-bold">{title}</h3></div>{items.length ? <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{items.map((item) => <article key={item.id} className="glass p-4"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-bold">{item.project}</h4><span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">{SECTOR_LABELS[item.sector]}</span></div><p className="mt-1 text-xs text-muted-foreground">发生/复盘口径：{item.occurredAt}</p><dl className="mt-3 space-y-2 text-xs leading-relaxed"><MobileField label="原计划" value={item.plan} /><MobileField label="实际结果" value={item.outcome} /><MobileField label="失败原因" value={item.cause} /><MobileField label="产业链/公司影响" value={`${item.chainImpact}；${item.companyImpact}`} /><MobileField label="是否修复" value={item.repaired} /><MobileField label="启示" value={item.lesson} /></dl><div className="mt-3"><SourceLinks sourceIds={item.sourceIds} /></div><p className="mt-2 text-[11px] text-muted-foreground">更新 {item.updatedAt}</p></article>)}</div> : <p className="rounded-xl border border-border/50 bg-muted/15 px-4 py-8 text-center text-sm text-muted-foreground">复盘字段已建立；当前没有满足来源门槛的公开案例。</p>}</section>;
}

export function CrossSectorEvidenceGraph({ title }: { title: string }) {
  return <section className="glass overflow-hidden"><div className="border-b border-border/50 px-5 py-4"><div className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" /><h3 className="text-base font-bold">{title}</h3></div><p className="mt-1 text-xs text-muted-foreground">关联只证明系统关系，不把相关性自动转换为公司订单或收入。</p></div><div className="grid gap-3 p-4 lg:grid-cols-2">{crossSectorLinks.map((link) => { const from = researchRecordById.get(link.fromId); const to = researchRecordById.get(link.toId); const fallbackCompany = listedCompanies.find((company) => company.id === link.toId); return <article key={link.id} className="rounded-xl border border-border/50 bg-muted/15 p-4"><div className="flex flex-wrap items-center gap-2 text-xs font-semibold"><span className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-primary">{from?.title ?? link.fromLabel ?? link.fromId}</span><span className="text-muted-foreground">{link.relation}</span><span className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-primary">{to?.title ?? fallbackCompany?.company ?? link.toLabel ?? link.toId}</span></div><p className="mt-3 text-xs leading-relaxed text-foreground/80">{link.evidence}</p><details className="group mt-3"><summary className="cursor-pointer list-none text-[11px] text-primary marker:hidden">展开关联来源</summary><div className="mt-2"><SourceLinks sourceIds={link.sourceIds} /></div></details></article>; })}</div></section>;
}

export function ResearchSourceIndex({ sector, title }: { sector?: ResearchSectorKey; title: string }) {
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState<"all" | EvidenceGrade>("all");
  const [sort, setSort] = useState<"verified" | "published" | "grade">("verified");
  const items = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    const gradeOrder: Record<EvidenceGrade, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
    return researchSources
      .filter((source) => !sector || source.sectors.includes(sector))
      .filter((source) => grade === "all" || source.grade === grade)
      .filter((source) => !normalized || `${source.name} ${source.originalTitle} ${source.summary ?? ""} ${source.companies.join(" ")} ${(source.products ?? []).join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalized))
      .sort((a, b) => sort === "grade"
        ? gradeOrder[a.grade] - gradeOrder[b.grade]
        : sort === "published"
          ? b.publishedAt.localeCompare(a.publishedAt, "zh-CN")
          : (b.lastVerifiedAt ?? b.accessedAt).localeCompare(a.lastVerifiedAt ?? a.accessedAt));
  }, [grade, query, sector, sort]);
  return (
    <section className="rounded-xl border border-border/50 bg-muted/15">
      <div className="border-b border-border/50 px-4 py-3">
        <h3 className="text-sm font-bold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">共 {items.length} 条；A/B级优先，D/E级不得单独支撑确定性结论。</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(240px,1fr)_120px_150px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <span className="sr-only">搜索来源</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索来源、标题、公司或项目" className="w-full rounded-lg border border-border/60 bg-background/35 py-2 pl-9 pr-3 text-xs outline-none focus:border-primary/50" />
          </label>
          <Select value={grade} onChange={(value) => setGrade(value as "all" | EvidenceGrade)} label="证据等级" options={[["all", "全部等级"], ["A", "A级"], ["B", "B级"], ["C", "C级"], ["D", "D级"], ["E", "E级"]]} />
          <Select value={sort} onChange={(value) => setSort(value as "verified" | "published" | "grade")} label="排序" options={[["verified", "按最后核验"], ["published", "按发布日期"], ["grade", "按证据等级"]]} />
        </div>
      </div>
      <div className="space-y-2 p-3">
        {items.map((source) => (
          <details key={source.id} className="group rounded-lg border border-border/45 bg-background/20">
            <summary className="flex cursor-pointer list-none items-start gap-2 p-3 marker:hidden">
              <EvidencePill grade={source.grade} />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">{source.originalTitle}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{source.name} · {source.publishedAt}</p>
              </div>
              <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-primary transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-border/40 px-3 py-3 text-xs leading-relaxed">
              <p>类型：{source.sourceType} · 事件：{source.eventAt ?? "不适用/未披露"} · 数据期：{source.period ?? "未披露"} · 抓取：{source.accessedAt} · 最后核验：{source.lastVerifiedAt ?? source.accessedAt}</p>
              {source.originalStatement ? <p className="mt-1 text-foreground/80">原始表述：{source.originalStatement}</p> : null}
              {source.summary ? <p className="mt-1 text-foreground/80">摘要：{source.summary}</p> : null}
              {source.supportingEvidence?.length ? <p className="mt-1 text-success">支持证据：{source.supportingEvidence.join("、")}</p> : null}
              {source.conflictingEvidence?.length ? <p className="mt-1 text-danger">冲突证据：{source.conflictingEvidence.join("、")}</p> : null}
              <p className="mt-1 text-warning">边界：{source.note}</p>
              <a href={source.url} target="_blank" rel="noreferrer noopener" className="mt-2 inline-flex items-center gap-1 text-primary hover:underline">打开原文 <ExternalLink className="h-3 w-3" /></a>
            </div>
          </details>
        ))}
        {!items.length ? <p className="py-8 text-center text-sm text-muted-foreground">没有符合当前筛选条件的来源。</p> : null}
      </div>
    </section>
  );
}

export function ValuationCounterEvidenceWorkbench({ sector, title }: { sector?: ResearchSectorKey; title: string }) {
  const items = valuationCounterEvidence.filter((item) => !sector || item.sector === sector);
  return (
    <section className="overflow-hidden rounded-xl border border-border/50">
      <header className="border-b border-border/50 bg-muted/25 px-4 py-3">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          只列叙事成立条件与可推翻条件；不输出目标价、买卖建议或主观估值高低。
        </p>
      </header>
      <div className="grid gap-3 p-3 lg:grid-cols-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-xl border border-border/50 bg-muted/15 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold text-foreground">{SECTOR_LABELS[item.sector]}</h4>
              <span className="rounded-full border border-border/60 bg-background/30 px-2 py-0.5 text-[10px] text-muted-foreground">{item.company}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-foreground/80">{item.narrative}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <ConditionList title="叙事成立条件" items={item.requiredConditions} tone="neutral" />
              <ConditionList title="已验证" items={item.verifiedConditions} tone="positive" />
              <ConditionList title="尚未验证" items={item.unverifiedConditions} tone="warning" />
              <ConditionList title="可能推翻叙事的反证" items={item.counterEvidence} tone="danger" />
            </div>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <MobileField label="收入敏感性" value={item.revenueSensitivity} />
              <MobileField label="毛利率敏感性" value={item.grossMarginSensitivity} />
              <MobileField label="资本开支压力" value={item.capexPressure} />
              <MobileField label="现金流风险" value={item.cashFlowRisk} />
              <MobileField label="当前估值口径" value={item.currentValuationBasis ?? "待按最新收盘日与同口径财务数据补充"} />
              <MobileField label="历史估值区间" value={item.historicalValuationRange ?? "待补：需固定估值指标、数据区间、复权与亏损处理口径"} />
              <MobileField label="同业估值比较" value={item.peerValuationComparison ?? "待补：需先统一业务范围、盈利阶段、币种与会计口径"} />
            </dl>
            <section className="mt-3 rounded-lg border border-border/50 bg-background/20 p-3">
              <p className="text-[11px] font-semibold text-foreground">情景条件（不含目标价或收益预测）</p>
              <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-3">
                <p><span className="font-semibold text-danger">谨慎：</span>{item.scenarios?.cautious ?? item.counterEvidence[0] ?? "关键条件被反证"}</p>
                <p><span className="font-semibold text-warning">中性：</span>{item.scenarios?.neutral ?? "已验证条件维持，尚未验证条件继续等待证据"}</p>
                <p><span className="font-semibold text-success">乐观：</span>{item.scenarios?.optimistic ?? "尚未验证条件逐项获得A/B/C级证据支持"}</p>
              </div>
            </section>
            <details className="group mt-3 rounded-lg border border-border/45 bg-background/20">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[11px] font-semibold text-primary marker:hidden">
                展开依据与边界
                <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
              </summary>
              <div className="border-t border-border/40 p-3"><SourceLinks sourceIds={item.sourceIds} /></div>
            </details>
            <p className="mt-2 text-[11px] text-muted-foreground">更新 {item.updatedAt}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ConditionList({ title, items, tone }: { title: string; items: string[]; tone: "neutral" | "positive" | "warning" | "danger" }) {
  const toneClass = tone === "positive"
    ? "border-success/25 bg-success/[0.06]"
    : tone === "warning"
      ? "border-warning/25 bg-warning/[0.06]"
      : tone === "danger"
        ? "border-danger/25 bg-danger/[0.06]"
        : "border-border/50 bg-background/20";
  return (
    <section className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-[11px] font-semibold text-foreground">{title}</p>
      <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </section>
  );
}

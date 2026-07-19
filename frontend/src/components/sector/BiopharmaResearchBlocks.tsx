import { Activity, CalendarClock, ChevronDown, ExternalLink, ShieldAlert } from "lucide-react";
import { catalystEvents, drugAssets, failureCases, sourceById } from "@/data/biopharma";
import type { CertaintyLevel, DrugAsset } from "@/data/biopharma";

interface AssetProps {
  title: string;
  intro?: string;
  assetIds?: string[];
}

function certaintyClass(level: CertaintyLevel) {
  if (level === "绿") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-500";
  if (level === "黄") return "border-amber-500/35 bg-amber-500/10 text-amber-500";
  return "border-rose-500/35 bg-rose-500/10 text-rose-500";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/45 bg-background/20 p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xs leading-relaxed text-foreground/85">{value || "暂无可靠公开数据"}</dd>
    </div>
  );
}

function AssetDetails({ asset }: { asset: DrugAsset }) {
  const sources = asset.sourceIds.flatMap((id) => {
    const source = sourceById.get(id);
    return source ? [source] : [];
  });

  return (
    <details className="group overflow-hidden rounded-xl border border-border/55 bg-muted/15 open:border-primary/35 open:bg-primary/[0.035]">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-4 marker:hidden">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-foreground">{asset.drug}</h4>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${certaintyClass(asset.certainty)}`}>
              {asset.certainty}档
            </span>
            <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
              可信度 {asset.confidence}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{asset.company} · {asset.modality} · {asset.overallStage}</p>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-foreground/75">{asset.indication}</p>
        </div>
        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-primary transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-border/45 px-4 py-4">
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="靶点 / 机制" value={asset.mechanism} />
          <Field label="单药 / 联合" value={asset.regimen} />
          <Field label="临床试验编号" value={asset.trialIds.join("；")} />
          <Field label="中国阶段" value={asset.chinaStage} />
          <Field label="海外阶段" value={asset.overseasStage} />
          <Field label="试验设计" value={asset.design} />
          <Field label="入组人数" value={asset.enrollment} />
          <Field label="患者人群" value={asset.population} />
          <Field label="治疗线数" value={asset.treatmentLine} />
          <Field label="对照组" value={asset.comparator} />
          <Field label="主要终点" value={asset.primaryEndpoints} />
          <Field label="次要终点" value={asset.secondaryEndpoints} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <section className="rounded-xl border border-primary/25 bg-primary/5 p-4">
            <p className="text-xs font-bold text-primary">已披露疗效</p>
            <p className="mt-2 text-xs leading-6 text-foreground/85">{asset.efficacy}</p>
          </section>
          <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
            <p className="text-xs font-bold text-amber-500">关键安全性</p>
            <p className="mt-2 text-xs leading-6 text-foreground/85">{asset.safety}</p>
          </section>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="数据截止 / 更新" value={asset.dataCutoff} />
          <Field label="下一关键催化剂" value={asset.nextCatalyst} />
          <Field label="监管资格" value={asset.designations} />
          <Field label="合作方" value={asset.partner} />
          <Field label="中国权益" value={asset.chinaRights} />
          <Field label="海外权益" value={asset.exChinaRights} />
        </div>

        <figure className="mt-4 overflow-hidden rounded-xl border border-border/50">
          <figcaption className="border-b border-border/50 bg-muted/30 px-4 py-2.5 text-xs font-semibold text-foreground">
            BD 经济条款（交易上限不等于已实现收入）
          </figcaption>
          <div className="overflow-x-auto">
            <table className="min-w-[920px] w-full text-left text-xs">
              <thead className="bg-primary/[0.07]">
                <tr>{["首付款", "近期付款", "研发里程碑", "销售里程碑", "总金额上限", "销售分成", "权益区域"].map((head) => <th key={head} className="px-3 py-2 font-semibold">{head}</th>)}</tr>
              </thead>
              <tbody><tr className="align-top text-foreground/80">
                {[asset.bd.upfront, asset.bd.nearTerm, asset.bd.developmentMilestones, asset.bd.salesMilestones, asset.bd.headlineCeiling, asset.bd.royalties, asset.bd.territory].map((value, index) => <td key={index} className="px-3 py-3 leading-relaxed">{value}</td>)}
              </tr></tbody>
            </table>
          </div>
        </figure>

        <div className="mt-4 rounded-xl border border-border/50 bg-muted/20 p-4">
          <p className="text-xs font-semibold text-foreground">确定性依据：{asset.certaintyReason}</p>
          <p className="mt-2 text-xs leading-relaxed text-amber-500">比较边界：{asset.comparisonBoundary}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">数据截至 {asset.asOf}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {sources.map((source) => (
            <a key={source.id} href={source.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-primary hover:bg-primary/10">
              {source.organization} · {source.date}<ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      </div>
    </details>
  );
}

export function DrugAssetCards({ title, intro, assetIds }: AssetProps) {
  const selected = assetIds?.length
    ? assetIds.flatMap((id) => {
        const asset = drugAssets.find((item) => item.id === id);
        return asset ? [asset] : [];
      })
    : drugAssets;

  return (
    <section className="glass overflow-hidden">
      <div className="border-b border-border/50 px-5 py-4">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h3 className="text-base font-bold text-foreground">{title}</h3>
        </div>
        {intro ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{intro}</p> : null}
      </div>
      <div className="space-y-3 p-4">
        {selected.map((asset) => <AssetDetails key={asset.id} asset={asset} />)}
      </div>
    </section>
  );
}

export function CatalystCalendar({ title }: { title: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-border/50">
      <figcaption className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-4 py-3 text-sm font-semibold">
        <CalendarClock className="h-4 w-4 text-primary" />{title}
      </figcaption>
      <div className="overflow-x-auto">
        <table className="min-w-[1500px] w-full text-left text-xs">
          <thead className="bg-primary/10">
            <tr>{["公司/药物", "靶点/适应症", "阶段/事件", "预计时间", "会议/节点", "一致预期", "关键指标", "正面定义", "负面定义", "实际结果", "截至"].map((head) => <th key={head} className="whitespace-nowrap px-3 py-3 font-semibold">{head}</th>)}</tr>
          </thead>
          <tbody>
            {catalystEvents.map((event, index) => (
              <tr key={`${event.company}-${event.drug}-${event.eventType}`} className={index % 2 === 0 ? "bg-muted/20" : ""}>
                <td className="px-3 py-3 align-top font-semibold">{event.company}<br /><span className="font-normal text-primary">{event.drug}</span></td>
                <td className="px-3 py-3 align-top">{event.target}<br /><span className="text-muted-foreground">{event.indication}</span></td>
                <td className="px-3 py-3 align-top">{event.stage}<br />{event.eventType}</td>
                <td className="px-3 py-3 align-top">{event.expected}</td>
                <td className="px-3 py-3 align-top">{event.venue}</td>
                <td className="px-3 py-3 align-top">{event.consensus}</td>
                <td className="px-3 py-3 align-top">{event.watch}</td>
                <td className="px-3 py-3 align-top text-emerald-500">{event.positive}</td>
                <td className="px-3 py-3 align-top text-rose-500">{event.negative}</td>
                <td className="px-3 py-3 align-top">{event.actual}</td>
                <td className="px-3 py-3 align-top text-muted-foreground">{event.asOf}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export function FailureLibrary({ title }: { title: string }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-amber-500" />
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {failureCases.map((item) => (
          <article key={`${item.company}-${item.asset}`} className="glass p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold">{item.asset}</h4>
              <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-500">{item.phase}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{item.company} · {item.indication}</p>
            <dl className="mt-3 space-y-2 text-xs leading-relaxed">
              <div><dt className="font-semibold text-foreground">设计</dt><dd className="text-muted-foreground">{item.design}</dd></div>
              <div><dt className="font-semibold text-foreground">结果</dt><dd className="text-muted-foreground">{item.outcome}</dd></div>
              <div><dt className="font-semibold text-foreground">主因归类</dt><dd className="text-rose-500">{item.primaryCause}</dd></div>
              <div><dt className="font-semibold text-foreground">复盘结论</dt><dd className="text-primary">{item.lesson}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              {item.sourceIds.flatMap((id) => {
                const source = sourceById.get(id);
                if (!source) return [];
                return [<a key={id} href={source.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">原始公告 <ExternalLink className="h-3 w-3" /></a>];
              })}
              <span className="text-[11px] text-muted-foreground">截至 {item.asOf}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

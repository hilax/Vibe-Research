import {
  ArrowDown,
  Check,
  CircleDashed,
  ExternalLink,
  ShieldCheck,
  X,
} from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import {
  ProductionAnchor,
  RouteCertaintyMap,
  TrackingSignals,
} from "@/components/sector/CertaintyMap";
import {
  CapabilityTiers,
  HardnessMoat,
  VendorLandscape,
} from "@/components/sector/OemVendorLandscape";
import type { ContentBlock } from "@/data/sectors";
import {
  CatalystCalendar,
  DrugAssetCards,
  FailureLibrary,
} from "@/components/sector/BiopharmaResearchBlocks";

interface Props {
  blocks: ContentBlock[];
}

/**
 * 渲染 tag 的结构化内容。每个 block type 对应一种视觉单元：
 * - lead：大字首段（板块定义、定性段）
 * - paragraph：标准正文段
 * - theses：并列论点卡（"为什么是趋势"这种多线讲法）
 * - kv：键值表（"产业地图/构成系统"这种结构化列举）
 * - table：可横向滚动的多列表格（路线、零部件等多字段盘点）
 * - list：有序/无序清单
 * - quote：引用
 * - callout：信息/警告块
 * - sources：来源底注
 * - heading：次级标题
 * - production-anchor / certainty-map / tracking-signals：确定性地图专属视觉
 */
export function TagContentView({ blocks }: Props) {
  return (
    <div className="space-y-6">
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  );
}

function renderBlock(b: ContentBlock, i: number) {
  switch (b.type) {
    case "lead":
      return (
        <p
          key={i}
          className="rounded-xl border border-primary/30 bg-primary/10 px-5 py-4 text-base font-medium leading-relaxed text-foreground shadow-glow"
        >
          {b.text}
        </p>
      );
    case "heading":
      return b.level === 3 ? (
        <h3 key={i} className="mt-2 text-sm font-semibold uppercase tracking-wide text-primary">
          {b.text}
        </h3>
      ) : (
        <h2 key={i} className="mt-2 text-xl font-extrabold tracking-tight text-foreground">
          {b.text}
        </h2>
      );
    case "paragraph":
      return (
        <p key={i} className="text-sm leading-7 text-foreground/85">
          {b.text}
        </p>
      );
    case "theses":
      return (
        <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {b.items.map((it, j) => (
            <GlassCard key={j} className="!p-4">
              <p className="text-sm font-semibold text-primary">{it.title}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{it.body}</p>
            </GlassCard>
          ))}
        </div>
      );
    case "kv":
      return (
        <div key={i} className="overflow-hidden rounded-xl border border-border/50">
          <table className="w-full text-sm">
            <tbody>
              {b.items.map((it, j) => (
                <tr key={j} className={j % 2 === 0 ? "bg-muted/30" : ""}>
                  <td className="w-1/3 px-4 py-3 align-top font-semibold text-foreground">{it.term}</td>
                  <td className="px-4 py-3 align-top text-foreground/85">
                    {it.value}
                    {it.note ? <span className="ml-1 text-xs text-muted-foreground">（{it.note}）</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "table":
      return (
        <figure key={i} className="overflow-hidden rounded-xl border border-border/50">
          {b.caption ? (
            <figcaption className="border-b border-border/50 bg-muted/30 px-4 py-3 text-sm font-semibold text-foreground">
              {b.caption}
            </figcaption>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-left text-sm">
              <thead className="bg-primary/10 text-xs text-foreground">
                <tr>
                  {b.headers.map((header, j) => (
                    <th key={j} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex % 2 === 0 ? "bg-muted/20" : ""}>
                    {b.headers.map((_, columnIndex) => (
                      <td
                        key={columnIndex}
                        className={
                          "px-4 py-3 align-top leading-relaxed text-foreground/80 " +
                          (columnIndex === 0 ? "font-semibold text-foreground" : "")
                        }
                      >
                        {row[columnIndex] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.note ? (
            <p className="border-t border-border/50 bg-muted/20 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
              {b.note}
            </p>
          ) : null}
        </figure>
      );
    case "value-bars":
      return (
        <section key={i} className="glass overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-border/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-foreground">单台硬件 BOM 价值分布</p>
              <p className="mt-1 text-xs text-muted-foreground">横条按参考中枢占比绘制，区间用于覆盖不同技术路线。</p>
            </div>
            <span className="w-fit rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {b.basis}
            </span>
          </div>
          <div className="divide-y divide-border/40">
            {b.items.map((it) => (
              <div
                key={it.label}
                className={"grid gap-3 px-5 py-4 lg:grid-cols-[140px_minmax(210px,1fr)_105px_110px_minmax(200px,1.1fr)] lg:items-center " +
                  (it.largest ? "bg-primary/[0.07]" : "")}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{it.label}</span>
                  {it.largest ? (
                    <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">最大层</span>
                  ) : null}
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground/80">中枢 {it.share}%</span>
                    <span className="text-muted-foreground">区间 {it.range}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={"h-full rounded-full " + (it.largest ? "bg-primary shadow-glow" : "bg-primary/55")}
                      style={{ width: `${it.share}%` }}
                    />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">典型用量</p>
                  <p className="mt-0.5 text-xs font-semibold text-foreground/85">{it.usage}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">参考金额</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{it.amount}</p>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{it.components}</p>
              </div>
            ))}
          </div>
          {b.note ? (
            <p className="border-t border-border/50 bg-muted/20 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
              {b.note}
            </p>
          ) : null}
        </section>
      );
    case "bottleneck-map":
      return (
        <section key={i}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {b.items.map((it) => (
              <article key={it.link} className="glass overflow-hidden p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-foreground">{it.link}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{it.value}</p>
                  </div>
                  <span className={"shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold " + chokeTypeClass(it.chokeType)}>
                    {it.chokeType}
                  </span>
                </div>
                <div className="my-3 flex items-center gap-2 text-xs">
                  <span className="rounded-md bg-muted/70 px-2 py-1 text-foreground/80">高价值环节</span>
                  <ArrowDown className="h-3.5 w-3.5 -rotate-90 text-primary" />
                  <span className="rounded-md border border-primary/25 bg-primary/10 px-2 py-1 font-medium text-primary">{it.upstream}</span>
                </div>
                <p className="text-xs leading-relaxed text-foreground/85">{it.choke}</p>
                <p className="mt-3 border-t border-border/40 pt-3 text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground/70">可绕过性：</span>{it.bypass}
                </p>
              </article>
            ))}
          </div>
          {b.note ? <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{b.note}</p> : null}
        </section>
      );
    case "supply-chain":
      return (
        <section key={i} className="overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.045] p-5">
          <div className="mb-5 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="text-base font-bold text-foreground">{b.title}</h3>
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-stretch">
            {b.items.map((it, itemIndex) => (
              <div key={it.title} className="contents">
                <article className={"rounded-xl border p-4 " + (it.highlight
                  ? "border-primary/45 bg-primary/10 shadow-glow"
                  : "border-border/50 bg-background/25")}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">{it.eyebrow}</p>
                  <p className="mt-1.5 text-sm font-bold text-foreground">{it.title}</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{it.text}</p>
                </article>
                {itemIndex < b.items.length - 1 ? (
                  <div className="flex items-center justify-center py-1 lg:px-1 lg:py-0">
                    <ArrowDown className="h-4 w-4 text-primary lg:-rotate-90" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-5 rounded-xl border border-primary/25 bg-background/30 px-4 py-3 text-sm font-medium leading-relaxed text-foreground">
            {b.conclusion}
          </p>
        </section>
      );
    case "three-gates":
      return (
        <section key={i} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {b.gates.map((gate) => (
              <article key={gate.number} className="glass relative overflow-hidden p-4">
                <span className="absolute right-3 top-2 text-5xl font-black text-primary/[0.08]">{gate.number}</span>
                <p className="text-xs font-bold text-primary">第 {gate.number} 关</p>
                <p className="mt-1 text-base font-bold text-foreground">{gate.title}</p>
                <p className="mt-2 text-xs font-medium text-foreground/80">{gate.question}</p>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">看证据：{gate.evidence}</p>
              </article>
            ))}
          </div>
          <figure className="overflow-hidden rounded-xl border border-border/50">
            <figcaption className="border-b border-border/50 bg-muted/30 px-4 py-3 text-sm font-semibold text-foreground">
              把候选环节逐个放进筛子（机械判断，不做主观打分）
            </figcaption>
            <div className="overflow-x-auto">
              <table className="min-w-[820px] w-full text-left text-sm">
                <thead className="bg-primary/10 text-xs text-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">候选环节</th>
                    <th scope="col" className="px-4 py-3 font-semibold">① 用量</th>
                    <th scope="col" className="px-4 py-3 font-semibold">② 刚需</th>
                    <th scope="col" className="px-4 py-3 font-semibold">③ 壁垒/纯环节</th>
                    <th scope="col" className="px-4 py-3 font-semibold">筛后结论</th>
                  </tr>
                </thead>
                <tbody>
                  {b.candidates.map((candidate, candidateIndex) => (
                    <tr key={candidate.label} className={candidateIndex % 2 === 0 ? "bg-muted/20" : ""}>
                      <td className="px-4 py-3 font-semibold text-foreground">{candidate.label}</td>
                      <td className="px-4 py-3">{gateBadge(candidate.volume)}</td>
                      <td className="px-4 py-3">{gateBadge(candidate.necessity)}</td>
                      <td className="px-4 py-3">{gateBadge(candidate.moat)}</td>
                      <td className="max-w-[340px] px-4 py-3 text-xs leading-relaxed text-foreground/80">{candidate.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {b.note ? (
              <p className="border-t border-border/50 bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">{b.note}</p>
            ) : null}
          </figure>
        </section>
      );
    case "production-anchor":
      return <ProductionAnchor key={i} block={b} />;
    case "certainty-map":
      return <RouteCertaintyMap key={i} block={b} />;
    case "tracking-signals":
      return <TrackingSignals key={i} block={b} />;
    case "vendor-landscape":
      return <VendorLandscape key={i} block={b} />;
    case "capability-tiers":
      return <CapabilityTiers key={i} block={b} />;
    case "hardness-moat":
      return <HardnessMoat key={i} block={b} />;
    case "drug-assets":
      return <DrugAssetCards key={i} title={b.title} intro={b.intro} assetIds={b.assetIds} />;
    case "catalyst-calendar":
      return <CatalystCalendar key={i} title={b.title} />;
    case "failure-library":
      return <FailureLibrary key={i} title={b.title} />;
    case "list":
      if (b.ordered) {
        return (
          <ol key={i} className="list-decimal space-y-1.5 pl-5 text-sm leading-7 text-foreground/85">
            {b.items.map((it, j) => (
              <li key={j}>{it}</li>
            ))}
          </ol>
        );
      }
      return (
        <ul key={i} className="list-disc space-y-1.5 pl-5 text-sm leading-7 text-foreground/85">
          {b.items.map((it, j) => (
            <li key={j}>{it}</li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote key={i} className="rounded-r-xl border-l-2 border-primary/60 bg-muted/30 px-4 py-2.5 text-sm italic text-foreground/80">
          “{b.text}”
          {b.cite ? <span className="ml-1 text-xs not-italic text-muted-foreground">— {b.cite}</span> : null}
        </blockquote>
      );
    case "callout":
      return (
        <div
          key={i}
          className={
            "rounded-xl border px-4 py-3 text-sm leading-relaxed " +
            (b.tone === "warn"
              ? "border-amber-500/40 bg-amber-500/10 text-foreground"
              : "border-primary/30 bg-primary/5 text-foreground/85")
          }
        >
          {b.text}
        </div>
      );
    case "sources":
      return (
        <section key={i} className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            来源 / 底注
          </p>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {b.items.map((s, j) => (
              <li key={j} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-foreground/80">[{j + 1}] {s.label}</span>
                {s.date ? <span>{s.date}</span> : null}
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  >
                    原文 <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      );
    default:
      return null;
  }
}

function chokeTypeClass(chokeType: string): string {
  switch (chokeType) {
    case "材料":
      return "border-amber-500/35 bg-amber-500/10 text-amber-400";
    case "设备":
      return "border-blue-500/35 bg-blue-500/10 text-blue-400";
    case "工艺/检测":
      return "border-violet-500/35 bg-violet-500/10 text-violet-400";
    case "芯片/器件":
      return "border-rose-500/35 bg-rose-500/10 text-rose-400";
    default:
      return "border-border/60 bg-muted/50 text-muted-foreground";
  }
}

function gateBadge(state: "pass" | "conditional" | "fail") {
  if (state === "pass") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-1 text-[11px] font-semibold text-success">
        <Check className="h-3 w-3" /> 通过
      </span>
    );
  }
  if (state === "conditional") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] font-semibold text-warning">
        <CircleDashed className="h-3 w-3" /> 条件性
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-muted-foreground/25 bg-muted/40 px-2 py-1 text-[11px] font-semibold text-muted-foreground">
      <X className="h-3 w-3" /> 未过
    </span>
  );
}

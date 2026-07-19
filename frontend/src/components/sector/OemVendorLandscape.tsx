import {
  ArrowRight,
  BrainCircuit,
  CircleAlert,
  Factory,
  Globe2,
  Layers3,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import type { ContentBlock } from "@/data/sectors";

type VendorLandscapeBlock = Extract<ContentBlock, { type: "vendor-landscape" }>;
type CapabilityTiersBlock = Extract<ContentBlock, { type: "capability-tiers" }>;
type HardnessMoatBlock = Extract<ContentBlock, { type: "hardness-moat" }>;

const stageMeta: Record<
  VendorLandscapeBlock["groups"][number]["vendors"][number]["stage"],
  { label: string; className: string }
> = {
  "scaled-operation": {
    label: "规模运行",
    className: "border-success/35 bg-success/10 text-success",
  },
  "batch-delivery": {
    label: "批量交付",
    className: "border-primary/35 bg-primary/10 text-primary",
  },
  ramping: {
    label: "量产爬坡",
    className: "border-amber-500/35 bg-amber-500/10 text-amber-400",
  },
  pilot: {
    label: "客户试点",
    className: "border-sky-500/35 bg-sky-500/10 text-sky-400",
  },
  "production-prep": {
    label: "量产准备",
    className: "border-violet-500/35 bg-violet-500/10 text-violet-400",
  },
  preorder: {
    label: "预售待交付",
    className: "border-border/70 bg-muted/60 text-muted-foreground",
  },
};

export function VendorLandscape({ block }: { block: VendorLandscapeBlock }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{block.scope}</p>
        <span className="w-fit shrink-0 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          截至 {block.asOf}
        </span>
      </div>

      {block.groups.map((group) => {
        const isChina = group.accent === "china";
        return (
          <section key={group.region} className="overflow-hidden rounded-2xl border border-border/55 bg-background/20">
            <div className={"flex flex-col gap-2 border-b px-5 py-4 sm:flex-row sm:items-end sm:justify-between " + (isChina
              ? "border-primary/20 bg-primary/[0.055]"
              : "border-sky-500/20 bg-sky-500/[0.045]")}
            >
              <div className="flex items-center gap-2">
                {isChina ? <Factory className="h-4 w-4 text-primary" /> : <Globe2 className="h-4 w-4 text-sky-400" />}
                <h3 className="text-base font-bold text-foreground">{group.region}</h3>
              </div>
              <p className="text-xs text-muted-foreground">观察镜头：{group.lens}</p>
            </div>

            <div className="overflow-x-auto p-4">
              <div className="grid grid-flow-col auto-cols-[minmax(260px,1fr)] gap-3">
                {group.vendors.map((vendor) => {
                  const stage = stageMeta[vendor.stage];
                  return (
                    <article key={vendor.name} className="glass flex min-h-[272px] flex-col p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-extrabold tracking-tight text-foreground">{vendor.name}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{vendor.country} · {vendor.product}</p>
                        </div>
                        <span className={"shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold " + stage.className}>
                          {stage.label}
                        </span>
                      </div>
                      <p className="mt-4 text-sm font-medium leading-relaxed text-foreground/90">{vendor.positioning}</p>
                      <div className="mt-auto border-t border-border/45 pt-4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">当前阶段</p>
                        <p className="mt-1 text-xs font-semibold leading-relaxed text-foreground">{vendor.status}</p>
                        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">公开锚点：{vendor.evidence}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}

      {block.note ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{block.note}</p>
      ) : null}
    </section>
  );
}

const tierMeta = {
  leading: {
    title: "全球领先",
    definition: "在跨国客户、关键性能和规模化上都有公开验证",
    className: "border-success/30 bg-success/[0.055]",
    badgeClass: "border-success/35 bg-success/10 text-success",
  },
  catching: {
    title: "快速追赶",
    definition: "已形成产品与供给，但高端性能或长期运行仍需追平",
    className: "border-primary/30 bg-primary/[0.055]",
    badgeClass: "border-primary/35 bg-primary/10 text-primary",
  },
  gap: {
    title: "仍有明显差距",
    definition: "关键底层、数据或通用能力仍由海外前沿牵引",
    className: "border-violet-500/30 bg-violet-500/[0.055]",
    badgeClass: "border-violet-500/35 bg-violet-500/10 text-violet-400",
  },
} as const;

export function CapabilityTiers({ block }: { block: CapabilityTiersBlock }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border border-primary/25 bg-primary/[0.045] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs leading-relaxed text-foreground/85">{block.rule}</p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">截面：{block.asOf}</span>
      </div>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
        {(["leading", "catching", "gap"] as const).map((tier) => {
          const meta = tierMeta[tier];
          const items = block.items.filter((item) => item.tier === tier);
          return (
            <section key={tier} className={"overflow-hidden rounded-2xl border " + meta.className}>
              <div className="border-b border-border/40 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-foreground">{meta.title}</h3>
                  <span className={"rounded-full border px-2 py-0.5 text-[10px] font-bold " + meta.badgeClass}>
                    {items.length} 个环节
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{meta.definition}</p>
              </div>
              <div className="space-y-3 p-3">
                {items.length ? items.map((item) => (
                  <article key={item.link} className="rounded-xl border border-border/50 bg-background/25 p-3.5">
                    <p className="text-sm font-bold text-foreground">{item.link}</p>
                    <p className="mt-1 text-xs font-semibold leading-relaxed text-foreground/85">{item.verdict}</p>
                    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{item.evidence}</p>
                    <p className="mt-3 border-t border-border/40 pt-2.5 text-[11px] leading-relaxed text-foreground/70">
                      <span className="font-semibold text-foreground/85">档位边界：</span>{item.boundary}
                    </p>
                  </article>
                )) : (
                  <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-border/55 px-5 text-center text-xs leading-relaxed text-muted-foreground">
                    当前没有一个完整环节同时满足该档的跨国性能与规模证据；不等于不存在单点领先。
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {block.note ? <p className="text-xs leading-relaxed text-muted-foreground">{block.note}</p> : null}
    </section>
  );
}

export function HardnessMoat({ block }: { block: HardnessMoatBlock }) {
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.07] px-4 py-3">
        <div className="flex items-start gap-2">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-sm font-medium leading-relaxed text-foreground">{block.rule}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-sky-500/25 bg-sky-500/[0.035]">
          <div className="flex items-center gap-2 border-b border-sky-500/20 px-4 py-3">
            <Globe2 className="h-4 w-4 text-sky-400" />
            <div>
              <p className="text-sm font-bold text-foreground">全球都绕不开</p>
              <p className="text-[11px] text-muted-foreground">换国家、换客户、甚至换技术路线，问题仍在</p>
            </div>
          </div>
          <div className="divide-y divide-border/35 px-4">
            {block.universal.map((item) => (
              <div key={item.title} className="py-3">
                <p className="text-xs font-semibold text-foreground">{item.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.035]">
          <div className="flex items-center gap-2 border-b border-primary/20 px-4 py-3">
            <RefreshCcw className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-bold text-foreground">只在国产替代语境成立</p>
              <p className="text-[11px] text-muted-foreground">解决本地供应安全或进口价差，不自动等于全球壁垒</p>
            </div>
          </div>
          <div className="divide-y divide-border/35 px-4">
            {block.substitution.map((item) => (
              <div key={item.title} className="py-3">
                <p className="text-xs font-semibold text-foreground">{item.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border/55 bg-background/20">
        <div className="flex items-center gap-2 border-b border-border/50 bg-muted/25 px-4 py-3">
          <Layers3 className="h-4 w-4 text-primary" />
          <div>
            <p className="text-sm font-bold text-foreground">本体整机的壁垒：从“能动”到“能干活”逐层变硬</p>
            <p className="text-[11px] text-muted-foreground">外形和单次演示不是护城河，长期闭环才是</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 p-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-stretch">
          {block.layers.map((layer, index) => (
            <div key={layer.number} className="contents">
              <article className={"relative overflow-hidden rounded-xl border p-4 " + (layer.highlight
                ? "border-primary/40 bg-primary/[0.08] shadow-glow"
                : "border-border/50 bg-muted/15")}
              >
                <span className="absolute right-2 top-0 text-5xl font-black text-primary/[0.07]">{layer.number}</span>
                <span className="relative rounded-full border border-border/60 bg-background/35 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {layer.barrier}
                </span>
                <p className="relative mt-3 text-sm font-bold text-foreground">{layer.title}</p>
                <p className="relative mt-2 text-[11px] leading-relaxed text-muted-foreground">{layer.body}</p>
              </article>
              {index < block.layers.length - 1 ? (
                <div className="flex items-center justify-center py-1 lg:px-0.5 lg:py-0">
                  <ArrowRight className="h-4 w-4 rotate-90 text-primary/60 lg:rotate-0" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex items-start gap-2 border-t border-primary/20 bg-primary/[0.05] px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm font-medium leading-relaxed text-foreground">{block.conclusion}</p>
        </div>
      </section>
    </section>
  );
}

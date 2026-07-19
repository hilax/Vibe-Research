import {
  Anchor,
  ArrowDown,
  CheckCircle2,
  CircleDashed,
  Factory,
  FileCheck2,
  Gauge,
  LockKeyhole,
  MoveHorizontal,
  RadioTower,
  Rotate3D,
  TriangleAlert,
} from "lucide-react";
import type { ContentBlock } from "@/data/sectors";

type ProductionAnchorBlock = Extract<ContentBlock, { type: "production-anchor" }>;
type CertaintyMapBlock = Extract<ContentBlock, { type: "certainty-map" }>;
type TrackingSignalsBlock = Extract<ContentBlock, { type: "tracking-signals" }>;
type CertaintyLevel = CertaintyMapBlock["levels"][number]["level"];

const LEVEL_STYLES: Record<CertaintyLevel, {
  border: string;
  surface: string;
  text: string;
  dot: string;
}> = {
  formed: {
    border: "border-success/35",
    surface: "bg-success/[0.07]",
    text: "text-success",
    dot: "bg-success",
  },
  converging: {
    border: "border-warning/35",
    surface: "bg-warning/[0.07]",
    text: "text-warning",
    dot: "bg-warning",
  },
  open: {
    border: "border-danger/35",
    surface: "bg-danger/[0.07]",
    text: "text-danger",
    dot: "bg-danger",
  },
};

export function ProductionAnchor({ block }: { block: ProductionAnchorBlock }) {
  return (
    <section className="glass glass-glow overflow-hidden" aria-label="量产设计参照锚">
      <div className="relative border-b border-border/50 px-5 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">
              <Anchor className="h-4 w-4" aria-hidden="true" />
              {block.eyebrow}
            </p>
            <h3 className="mt-2 text-lg font-extrabold tracking-tight text-foreground">{block.title}</h3>
          </div>
          <span className="w-fit shrink-0 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            {block.asOf}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {block.metrics.map((metric) => (
            <div
              key={metric.label}
              className={
                "rounded-xl border px-4 py-3 " +
                (metric.tone === "positive"
                  ? "border-success/30 bg-success/[0.06]"
                  : metric.tone === "caution"
                    ? "border-warning/30 bg-warning/[0.06]"
                    : "border-border/50 bg-background/25")
              }
            >
              <p className="text-[11px] font-semibold text-muted-foreground">{metric.label}</p>
              <p className="mt-1 text-xl font-extrabold tracking-tight text-foreground">{metric.value}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{metric.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {block.jointGroups.map((group) => {
            const JointIcon = group.kind === "rotary" ? Rotate3D : MoveHorizontal;
            return (
              <div key={group.kind} className="flex items-start gap-3 rounded-xl border border-border/50 bg-background/20 px-4 py-3">
                <JointIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-xs font-bold text-foreground">
                    {group.label} <span className="ml-1 text-primary">{group.total}</span>
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{group.positions}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-5 py-5">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-stretch">
          {block.steps.map((step, stepIndex) => (
            <div key={step.label} className="contents">
              <div
                className={
                  "rounded-xl border p-4 " +
                  (step.state === "confirmed"
                    ? "border-success/25 bg-success/[0.045]"
                    : "border-warning/35 bg-warning/[0.07]")
                }
              >
                <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                  {step.state === "confirmed" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                  ) : (
                    <TriangleAlert className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                  )}
                  {step.label}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.text}</p>
              </div>
              {stepIndex < block.steps.length - 1 ? (
                <div className="flex items-center justify-center py-1 lg:px-1 lg:py-0">
                  <ArrowDown className="h-4 w-4 text-muted-foreground lg:-rotate-90" aria-hidden="true" />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
          <p className="rounded-xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-xs leading-relaxed text-foreground/85">
            <span className="font-bold text-warning">结构参照边界：</span>{block.reference}
          </p>
          <p className="rounded-xl border border-primary/25 bg-primary/[0.055] px-4 py-3 text-xs font-medium leading-relaxed text-foreground">
            <LockKeyhole className="mr-1.5 inline h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {block.conclusion}
          </p>
        </div>
      </div>
    </section>
  );
}

export function RouteCertaintyMap({ block }: { block: CertaintyMapBlock }) {
  return (
    <section aria-label="人形机器人技术路线确定性地图">
      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-4xl text-xs leading-relaxed text-foreground/80">
          <span className="font-bold text-foreground">机械分档口径：</span>{block.rule}
        </p>
        <span className="shrink-0 text-xs text-muted-foreground">{block.asOf}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {block.levels.map((group) => {
          const style = LEVEL_STYLES[group.level];
          return (
            <section
              key={group.level}
              className={`overflow-hidden rounded-2xl border ${style.border} ${style.surface}`}
              aria-label={group.title}
            >
              <header className="border-b border-border/40 px-4 py-4">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} aria-hidden="true" />
                  <h3 className="text-base font-extrabold text-foreground">{group.title}</h3>
                  <span className={`ml-auto text-xs font-semibold ${style.text}`}>{group.items.length} 个环节</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-foreground/80">{group.definition}</p>
                <p className={`mt-2 text-[11px] font-semibold ${style.text}`}>{group.action}</p>
              </header>

              <div className="divide-y divide-border/35">
                {group.items.map((item) => (
                  <article key={item.title} className="bg-background/15 px-4 py-4">
                    <div className="flex items-start gap-2">
                      {levelIcon(group.level, style.text)}
                      <div>
                        <h4 className="text-sm font-bold text-foreground">{item.title}</h4>
                        <p className="mt-1 text-xs font-semibold leading-relaxed text-foreground/85">{item.route}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{item.evidence}</p>
                    <p className="mt-3 border-t border-border/35 pt-2 text-[11px] leading-relaxed text-foreground/75">
                      <span className="font-semibold text-foreground">下一信号：</span>{item.watch}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {block.note ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{block.note}</p>
      ) : null}
    </section>
  );
}

export function TrackingSignals({ block }: { block: TrackingSignalsBlock }) {
  const signalIcons = [Factory, FileCheck2, Gauge];

  return (
    <section className="space-y-4" aria-label="免费公开跟踪信号">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {block.signals.map((signal, signalIndex) => {
          const SignalIcon = signalIcons[signalIndex] ?? RadioTower;
          return (
            <article key={signal.number} className="glass relative overflow-hidden p-5">
              <span className="absolute right-3 top-1 text-6xl font-black text-primary/[0.07]" aria-hidden="true">
                {signal.number}
              </span>
              <SignalIcon className="h-5 w-5 text-primary" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-bold text-foreground">{signal.title}</h3>
              <p className="mt-2 text-xs font-semibold leading-relaxed text-foreground/85">{signal.question}</p>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">看证据：{signal.evidence}</p>
              <p className="mt-3 border-t border-border/40 pt-3 text-[11px] leading-relaxed text-muted-foreground">
                <RadioTower className="mr-1 inline h-3 w-3 text-primary" aria-hidden="true" />
                免费入口：{signal.freeSources}
              </p>
            </article>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-border/50">
        {block.rules.map((rule, ruleIndex) => {
          const style = LEVEL_STYLES[rule.level];
          return (
            <div
              key={rule.level}
              className={
                `grid gap-2 px-4 py-3 sm:grid-cols-[170px_1fr] sm:items-start ${style.surface} ` +
                (ruleIndex < block.rules.length - 1 ? "border-b border-border/40" : "")
              }
            >
              <p className={`flex items-center gap-2 text-xs font-bold ${style.text}`}>
                <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden="true" />
                {rule.title}
              </p>
              <p className="text-xs leading-relaxed text-foreground/80">{rule.text}</p>
            </div>
          );
        })}
      </div>

      {block.note ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{block.note}</p>
      ) : null}
    </section>
  );
}

function levelIcon(level: CertaintyLevel, className: string) {
  if (level === "formed") {
    return <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} aria-hidden="true" />;
  }
  if (level === "converging") {
    return <CircleDashed className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} aria-hidden="true" />;
  }
  return <TriangleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} aria-hidden="true" />;
}

import { useState } from "react";
import { ChevronDown, CircleHelp, Eye, Layers3, type LucideIcon } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import type { CoreNodeDetail } from "@/data/sectorNodeDetails";

interface Props {
  sectorKey: string;
  nodes: string[];
  details?: Record<string, CoreNodeDetail>;
}

export function CoreNodeExplorer({ sectorKey, nodes, details }: Props) {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const activeDetail = activeNode ? details?.[activeNode] : undefined;
  const panelId = `core-node-${sectorKey}`;

  return (
    <div>
      <div className="flex flex-wrap gap-2.5" aria-label="核心环节">
        {nodes.map((node) => {
          const hasDetail = Boolean(details?.[node]);
          const active = activeNode === node;

          if (!hasDetail) {
            return (
              <span
                key={node}
                className="rounded-full border border-primary/40 bg-primary/15 px-3.5 py-1.5 text-sm font-medium text-foreground shadow-glow"
              >
                {node}
              </span>
            );
          }

          return (
            <button
              key={node}
              type="button"
              aria-expanded={active}
              aria-controls={panelId}
              onClick={() => setActiveNode(active ? null : node)}
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium shadow-glow transition-colors " +
                (active
                  ? "border-primary bg-primary/25 text-primary"
                  : "border-primary/40 bg-primary/15 text-foreground hover:bg-primary/25")
              }
            >
              {node}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${active ? "rotate-180" : ""}`} />
            </button>
          );
        })}
      </div>

      {activeNode && activeDetail ? (
        <div id={panelId} className="mt-4" aria-live="polite">
          <GlassCard glow className="border-primary/25 !p-4 sm:!p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary">核心环节解释</span>
              <h4 className="text-base font-bold text-foreground">{activeNode}</h4>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <ExplanationItem icon={CircleHelp} label="它是什么" text={activeDetail.summary} />
              <ExplanationItem icon={Layers3} label="为什么关键" text={activeDetail.role} />
              <ExplanationItem icon={Eye} label="持续跟踪什么" text={activeDetail.watch} />
            </div>
          </GlassCard>
        </div>
      ) : details ? (
        <p className="mt-3 text-xs text-muted-foreground">点击任一核心环节，查看它的作用、产业位置和关键跟踪指标。</p>
      ) : null}
    </div>
  );
}

function ExplanationItem({
  icon: Icon,
  label,
  text,
}: {
  icon: LucideIcon;
  label: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-primary">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

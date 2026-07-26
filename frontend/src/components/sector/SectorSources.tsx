import { BookOpenCheck, ChevronDown, ExternalLink } from "lucide-react";
import type { SectorSource } from "@/data/sectors";

interface Props {
  sources: SectorSource[];
}

export function SectorSources({ sources }: Props) {
  return (
    <details className="group mt-5 overflow-hidden rounded-xl border border-border/60 bg-muted/15">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 marker:hidden">
        <BookOpenCheck className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">核验来源与口径</span>
        <span className="text-xs text-muted-foreground">{sources.length} 项公开资料</span>
        <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/50 px-4 py-3">
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          环节骨架依据公开的一手政策、监管、标准或科研机构资料归纳；仅描述产业分工，不构成标的推荐。
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="group/source flex min-w-0 items-start gap-2 rounded-lg border border-border/45 bg-background/25 p-3 transition-colors hover:border-primary/35 hover:bg-primary/5"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium leading-relaxed text-foreground">{source.label}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {source.organization}{source.date ? ` · ${source.date}` : ""}
                </p>
              </div>
              <ExternalLink className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover/source:text-primary" />
            </a>
          ))}
        </div>
      </div>
    </details>
  );
}

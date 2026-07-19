import { Link } from "react-router-dom";
import { CheckCircle2, ChevronRight, Clock } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { sectorTagIcons, sectorTagFallbackIcon } from "@/components/sector/iconMap";
import type { Sector } from "@/data/sectors";

interface Props {
  sector: Sector;
}

export function TagGrid({ sector }: Props) {
  if (!sector.tags?.length) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sector.tags.map((t) => {
        const Icon = sectorTagIcons[t.icon] ?? sectorTagFallbackIcon;
        return (
          <Link key={t.key} to={`/sectors/${sector.key}/${t.key}`}>
            <GlassCard glow className="!p-4 flex h-full flex-col justify-between transition-transform hover:-translate-y-0.5">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <Icon className="h-5 w-5 text-primary" />
                  <h3 className="text-base font-bold">{t.label}</h3>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.description}</p>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3 text-xs">
                {t.verified ? (
                  <span className="flex items-center gap-1 text-primary">
                    <CheckCircle2 className="h-3 w-3" /> 已核实
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" /> 待补充
                  </span>
                )}
                <ChevronRight className="h-4 w-4 text-primary" />
              </div>
            </GlassCard>
          </Link>
        );
      })}
    </div>
  );
}

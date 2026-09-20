import { useEffect, useState } from "react";
import { Search, Sun, Moon, RefreshCw } from "lucide-react";
import { api, type IndexQuote } from "@/lib/api";
import { useDarkMode } from "@/hooks/useDarkMode";
import { cn } from "@/lib/utils";

interface TopTickerBarProps {
  onOpenSearch: () => void;
}

export function TopTickerBar({ onOpenSearch }: TopTickerBarProps) {
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const { dark, toggle } = useDarkMode();

  const fetchIndices = () => {
    setLoading(true);
    api.indices()
      .then((data) => setIndices(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchIndices();
    const timer = setInterval(fetchIndices, 20000);
    return () => clearInterval(timer);
  }, []);

  // Determine if currently in A-share trading session (approximate 09:30-11:30, 13:00-15:00)
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentMinutes = hours * 60 + minutes;
  const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
  const isTrading =
    isWeekday &&
    ((currentMinutes >= 570 && currentMinutes <= 690) || (currentMinutes >= 780 && currentMinutes <= 900));

  return (
    <header className="sticky top-0 z-30 flex h-11 w-full items-center justify-between border-b border-border/50 bg-[#090b10]/90 px-3 sm:px-5 backdrop-blur-md transition-colors">
      {/* Left: Live Ticker Pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
        {/* Trading Status Indicator */}
        <div className="flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-full border border-border/60 bg-surface-2/40 text-[11px] font-mono">
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              isTrading ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/60"
            )}
          />
          <span className="text-muted-foreground hidden sm:inline">
            {isTrading ? "交易中" : "已收市"}
          </span>
        </div>

        {/* Index Pills */}
        {indices.length > 0 ? (
          indices.map((idx) => {
            const isUp = idx.change_pct > 0;
            const isDown = idx.change_pct < 0;
            return (
              <div
                key={idx.name}
                className="ticker-pill shrink-0 select-none cursor-default"
                title={`${idx.name} ${idx.price} (${isUp ? "+" : ""}${idx.change_pct}%)`}
              >
                <span className="text-foreground/80 font-medium text-[11px]">{idx.name}</span>
                <span className="font-num text-[11px] text-foreground font-semibold">
                  {idx.price.toFixed(2)}
                </span>
                <span
                  className={cn(
                    "font-num text-[11px] flex items-center gap-0.5",
                    isUp ? "text-market-up font-semibold" : isDown ? "text-market-down font-semibold" : "text-muted-foreground"
                  )}
                >
                  {isUp && "+"}
                  {idx.change_pct.toFixed(2)}%
                </span>
              </div>
            );
          })
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>行情连接中...</span>
          </div>
        )}
      </div>

      {/* Right: Search trigger + Theme + Refresh */}
      <div className="flex items-center gap-2 shrink-0 ml-3">
        {/* Command Palette Trigger */}
        <button
          onClick={onOpenSearch}
          className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface-2/60 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
          title="搜索功能与代码 (Ctrl+K)"
        >
          <Search className="h-3.5 w-3.5 text-primary" />
          <span className="hidden md:inline">搜索股票 / 菜单...</span>
          <kbd className="hidden lg:inline-flex rounded border border-border/80 bg-black/30 px-1.5 py-0.2 text-[10px] font-mono text-muted-foreground">
            Ctrl K
          </kbd>
        </button>

        {/* Refresh Indicator */}
        <button
          onClick={fetchIndices}
          disabled={loading}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors disabled:opacity-50"
          title="刷新大盘行情"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin text-primary")} />
        </button>

        {/* Theme Toggle */}
        <button
          onClick={toggle}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
          title={dark ? "切换亮色主题" : "切换暗色主题"}
        >
          {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>
    </header>
  );
}

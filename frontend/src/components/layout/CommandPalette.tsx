import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Activity,
  Radar,
  LayoutGrid,
  BarChart3,
  SlidersHorizontal,
  Search as SearchIcon,
  Star,
  Wallet,
  FileText,
  NotebookPen,
  Settings as SettingsIcon,
  LineChart,
  ArrowRight,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const NAV_COMMANDS = [
  { path: "/daily-review", label: "每日复盘", group: "市场看盘", icon: Activity, desc: "大盘全景、情绪与大单资金" },
  { path: "/intel", label: "资讯雷达", group: "市场看盘", icon: Radar, desc: "全网财经资讯与快讯流" },
  { path: "/sectors", label: "板块中心", group: "市场看盘", icon: LayoutGrid, desc: "核心产业链、概念与图谱" },
  { path: "/sector-strength", label: "板块强度", group: "市场看盘", icon: BarChart3, desc: "通达信板块 RPS5/10/15/20 排名" },
  { path: "/quant-screening", label: "量化选股", group: "量化策略", icon: SlidersHorizontal, desc: "通达信公式叠加两阶段量化筛选" },
  { path: "/stock-data", label: "个股数据", group: "量化策略", icon: SearchIcon, desc: "财务、估值、资金与龙虎榜" },
  { path: "/watchlist", label: "自选股", group: "资产投研", icon: Star, desc: "本地重点关注股票列表" },
  { path: "/portfolio", label: "我的持仓", group: "资产投研", icon: Wallet, desc: "持仓盈亏与历史平仓记录" },
  { path: "/my-reports", label: "我的研报", group: "资产投研", icon: FileText, desc: "本地研报库与 AI 解读" },
  { path: "/notes", label: "研究记录", group: "资产投研", icon: NotebookPen, desc: "交易日志与投资笔记" },
  { path: "/settings", label: "接入 AI", group: "系统配置", icon: SettingsIcon, desc: "配置本地或云端大模型 API" },
];

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Check if query is 6-digit stock code
  const isStockCode = /^\d{6}$/.test(query.trim());
  const trimmed = query.trim().toLowerCase();

  const filteredCommands = NAV_COMMANDS.filter((cmd) => {
    if (!trimmed) return true;
    return (
      cmd.label.toLowerCase().includes(trimmed) ||
      cmd.desc.toLowerCase().includes(trimmed) ||
      cmd.path.toLowerCase().includes(trimmed)
    );
  });

  const totalItems = (isStockCode ? 2 : 0) + filteredCommands.length;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = (idx: number) => {
    if (isStockCode) {
      const code = query.trim();
      if (idx === 0) {
        navigate(`/stock-kline/${code}`);
      } else if (idx === 1) {
        navigate(`/stock-data?code=${code}`);
      }
      onClose();
      return;
    }

    const targetCmd = filteredCommands[idx];
    if (targetCmd) {
      navigate(targetCmd.path);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (totalItems || 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + (totalItems || 1)) % (totalItems || 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(selectedIndex);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 sm:pt-28">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-xl mx-4 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl shadow-black/20 dark:border-white/10 dark:bg-[#0f131a] dark:shadow-black/80">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5 dark:border-white/10">
          <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索功能或直接输入6位股票代码 (如 600519)..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="p-1 rounded text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-block rounded border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-mono text-muted-foreground dark:border-white/15 dark:bg-white/5">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {/* If stock code, show direct jumps */}
          {isStockCode && (
            <div className="mb-2 pb-2 border-b border-border dark:border-white/10">
              <div className="px-2 py-1 text-[11px] font-semibold text-primary uppercase tracking-wider">
                个股直达
              </div>
              <div
                onClick={() => handleSelect(0)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors",
                  selectedIndex === 0 ? "bg-primary/20 text-primary font-medium" : "hover:bg-surface-2 dark:hover:bg-white/5 text-foreground"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <LineChart className="h-4 w-4 text-primary" />
                  <span>查看股票 <strong className="font-mono text-primary">{query.trim()}</strong> K线图与技术指标</span>
                </div>
                <ArrowRight className="h-4 w-4 opacity-70" />
              </div>
              <div
                onClick={() => handleSelect(1)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors",
                  selectedIndex === 1 ? "bg-primary/20 text-primary font-medium" : "hover:bg-surface-2 dark:hover:bg-white/5 text-foreground"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <SearchIcon className="h-4 w-4 text-accent" />
                  <span>查看股票 <strong className="font-mono text-accent">{query.trim()}</strong> 深度财务与龙虎榜</span>
                </div>
                <ArrowRight className="h-4 w-4 opacity-70" />
              </div>
            </div>
          )}

          {/* Navigation Commands */}
          {filteredCommands.length > 0 ? (
            filteredCommands.map((cmd, idx) => {
              const currentItemIdx = (isStockCode ? 2 : 0) + idx;
              const isSelected = selectedIndex === currentItemIdx;
              const Icon = cmd.icon;

              return (
                <div
                  key={cmd.path}
                  onClick={() => handleSelect(currentItemIdx)}
                  onMouseEnter={() => setSelectedIndex(currentItemIdx)}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors",
                    isSelected
                      ? "bg-primary/15 text-foreground font-medium"
                      : "hover:bg-surface-2 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs",
                        isSelected
                          ? "border-primary/40 bg-primary/20 text-primary"
                          : "border-border bg-surface-2 text-muted-foreground dark:border-white/10 dark:bg-white/5"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-foreground font-medium">{cmd.label}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{cmd.desc}</div>
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60 font-mono">
                    {cmd.group}
                  </span>
                </div>
              );
            })
          ) : !isStockCode ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              未找到匹配项，可尝试搜索功能名称或输入 6 位代码
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-surface-2/60 px-4 py-2 text-[11px] text-muted-foreground dark:border-white/10 dark:bg-black/20">
          <div className="flex items-center gap-3">
            <span>↑↓ 导航</span>
            <span>↵ 确认跳转</span>
            <span>ESC 退出</span>
          </div>
          <span className="text-primary font-mono text-[10px]">VibeResearch Terminal</span>
        </div>
      </div>
    </div>
  );
}

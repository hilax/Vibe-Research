import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  Activity, Radar, LayoutGrid, Wallet, Settings, Search, NotebookPen,
  EyeOff, Palette, ChevronsLeft, ChevronsRight, LineChart,
  Cog, Cpu, Database, Cable, Rocket, FlaskConical, Star, FileText,
  SlidersHorizontal, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarketPalette } from "@/hooks/useMarketPalette";
import { TopTickerBar } from "./TopTickerBar";
import { CommandPalette } from "./CommandPalette";

const APP_VERSION = "v0.1.3";

// 分组导航：市场看盘 / 量化策略 / 资产投研 / 系统配置
const NAV_GROUPS = [
  {
    group: "市场看盘",
    items: [
      { to: "/daily-review", icon: Activity, label: "每日复盘" },
      { to: "/intel", icon: Radar, label: "资讯雷达" },
      { to: "/sectors", icon: LayoutGrid, label: "板块中心" },
      { to: "/sector-strength", icon: BarChart3, label: "板块强度" },
    ],
  },
  {
    group: "量化策略",
    items: [
      { to: "/quant-screening", icon: SlidersHorizontal, label: "量化选股" },
      { to: "/stock-data", icon: Search, label: "个股数据" },
    ],
  },
  {
    group: "资产投研",
    items: [
      { to: "/watchlist", icon: Star, label: "自选股" },
      { to: "/portfolio", icon: Wallet, label: "我的持仓" },
      { to: "/my-reports", icon: FileText, label: "我的研报" },
      { to: "/notes", icon: NotebookPen, label: "研究记录" },
    ],
  },
  {
    group: "系统配置",
    items: [
      { to: "/settings", icon: Settings, label: "接入 AI" },
    ],
  },
];

// 常看的板块，作为「板块中心」下的快捷入口（缩进显示）。
const SECTOR_LINKS = [
  { to: "/sectors/humanoid", icon: Cog, label: "人形机器人" },
  { to: "/sectors/ai-computing", icon: Cpu, label: "AI 算力" },
  { to: "/sectors/hbm", icon: Database, label: "HBM" },
  { to: "/sectors/cpo", icon: Cable, label: "光互联" },
  { to: "/sectors/business-space", icon: Rocket, label: "商业航天" },
  { to: "/sectors/ai-pharma", icon: FlaskConical, label: "生物医药" },
];

export function Layout() {
  const { pathname } = useLocation();
  const { subtle, toggle: toggleMarketPalette } = useMarketPalette();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("vr-sidebar") === "collapsed");
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("vr-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:h-screen md:flex-row">
      {/* Sidebar */}
      <aside
        className={cn(
          "z-20 flex shrink-0 flex-row border-r border-border bg-surface-1 dark:bg-[#0c0f17] transition-all duration-200 md:flex-col",
          collapsed ? "md:w-16" : "md:w-60"
        )}
      >
        {/* Brand Header */}
        <div
          className={cn(
            "hidden border-b border-border/50 md:flex items-center justify-between",
            collapsed ? "p-3 justify-center" : "px-4 py-3.5"
          )}
        >
          <Link
            to="/daily-review"
            className={cn("flex items-center", collapsed ? "justify-center" : "gap-2.5")}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/40 shadow-sm shadow-primary/20">
              <LineChart className="h-5 w-5 text-primary text-glow" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <span className="text-base font-extrabold tracking-tight">
                  Hi<span className="text-primary">lax</span>
                  <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-primary/15 text-primary border border-primary/30 font-medium">
                    PRO
                  </span>
                </span>
                <p className="text-[10px] text-muted-foreground truncate leading-tight">
                  极客量化投研终端
                </p>
              </div>
            )}
          </Link>
        </div>

        {/* Navigation with Categories */}
        <nav
          className={cn(
            "flex flex-1 gap-1 overflow-x-auto p-2 md:block md:space-y-4 md:overflow-y-auto",
            collapsed ? "md:p-2" : "md:px-3 md:py-3"
          )}
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.group} className="space-y-1">
              {!collapsed && (
                <div className="hidden md:block px-2.5 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground/85 uppercase font-mono">
                  {group.group}
                </div>
              )}
              {group.items.map(({ to, icon: Icon, label }) => {
                const active = pathname === to;
                return (
                  <div key={to} className="shrink-0">
                    <Link
                      to={to}
                      title={collapsed ? label : undefined}
                      className={cn(
                        "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-all",
                        collapsed
                          ? "md:justify-center md:p-2.5"
                          : "md:px-2.5 md:py-2",
                        active
                          ? "bg-primary/15 text-primary font-semibold border border-primary/30 shadow-sm shadow-primary/10"
                          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                      <span className={collapsed ? "md:hidden" : ""}>{label}</span>
                    </Link>

                    {/* 板块中心下方：常看板块的快捷入口（缩进） */}
                    {to === "/sectors" && (
                      <div
                        className={cn(
                          "mt-0.5 hidden space-y-0.5 md:block",
                          !collapsed && "ml-3.5 border-l border-border/40 pl-2"
                        )}
                      >
                        {SECTOR_LINKS.map(({ to: st, icon: SIcon, label: slabel }) => {
                          const sactive = pathname === st || pathname.startsWith(`${st}/`);
                          return (
                            <Link
                              key={st}
                              to={st}
                              title={collapsed ? slabel : undefined}
                              className={cn(
                                "flex items-center rounded-md transition-colors",
                                collapsed ? "justify-center p-1.5" : "gap-2 px-2 py-1 text-[11px]",
                                sactive
                                  ? "bg-primary/10 font-medium text-primary"
                                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                              )}
                            >
                              <SIcon className="h-3 w-3 shrink-0" />
                              {!collapsed && slabel}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div
          className={cn(
            "hidden border-t border-border/50 md:block",
            collapsed ? "p-2 text-center space-y-2" : "p-3 space-y-2"
          )}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMarketPalette}
                className="rounded p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
                title={subtle ? "恢复涨红跌绿" : "切换为低调涨跌色"}
              >
                {subtle ? <Palette className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setCollapsed(false)}
                className="rounded-lg p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
                title="展开导航栏"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={toggleMarketPalette}
                  aria-pressed={subtle}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  title={subtle ? "恢复涨红跌绿" : "切换为低调涨跌色"}
                >
                  {subtle ? <Palette className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {subtle ? "正常红绿" : "低调模式"}
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground/70">
                    {APP_VERSION}
                  </span>
                  <button
                    onClick={() => setCollapsed(true)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
                    title="收起侧边栏"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Ticker Bar */}
        <TopTickerBar onOpenSearch={() => setCmdOpen(true)} />

        {/* Page Content Viewport */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1720px] p-3 sm:p-5 lg:p-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global Command Palette */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}

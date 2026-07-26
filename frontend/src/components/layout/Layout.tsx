import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  Activity, Radar, LayoutGrid, Wallet, Settings, Search, NotebookPen,
  EyeOff, Moon, Palette, Sun, ChevronsLeft, ChevronsRight, LineChart,
  Cog, Cpu, Database, Cable, Rocket, FlaskConical, Star, FileText,
  Orbit, ShieldCheck,
  SlidersHorizontal, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";
import { useMarketPalette } from "@/hooks/useMarketPalette";

const APP_VERSION = "v0.1.3";

const NAV = [
  { to: "/daily-review", icon: Activity, label: "每日复盘" },
  { to: "/intel", icon: Radar, label: "资讯雷达" },
  { to: "/sectors", icon: LayoutGrid, label: "板块中心" },
  { to: "/stock-data", icon: Search, label: "个股数据" },
  { to: "/quant-screening", icon: SlidersHorizontal, label: "量化选股" },
  { to: "/sector-strength", icon: BarChart3, label: "板块强度" },
  { to: "/watchlist", icon: Star, label: "自选股" },
  { to: "/portfolio", icon: Wallet, label: "我的持仓" },
  { to: "/my-reports", icon: FileText, label: "我的研报" },
  { to: "/notes", icon: NotebookPen, label: "研究记录" },
  { to: "/settings", icon: Settings, label: "接入 AI" },
];

// 常看的板块，作为「板块中心」下的快捷入口（缩进显示）。
const SECTOR_LINKS = [
  { to: "/sectors/humanoid", icon: Cog, label: "人形机器人" },
  { to: "/sectors/ai-computing", icon: Cpu, label: "AI 算力" },
  { to: "/sectors/hbm", icon: Database, label: "HBM" },
  { to: "/sectors/cpo", icon: Cable, label: "光互联" },
  { to: "/sectors/business-space", icon: Rocket, label: "商业航天" },
  { to: "/sectors/ai-pharma", icon: FlaskConical, label: "生物医药" },
  { to: "/sectors/semiconductor", icon: Cpu, label: "半导体国产替代" },
  { to: "/sectors/solid-state-battery", icon: Database, label: "固态电池" },
  { to: "/sectors/low-altitude", icon: Rocket, label: "低空经济" },
  { to: "/sectors/smart-driving", icon: Cog, label: "智能驾驶" },
  { to: "/sectors/innovative-drug", icon: FlaskConical, label: "创新药" },
  { to: "/sectors/power-grid", icon: Cable, label: "电网与特高压" },
  { to: "/sectors/defense", icon: ShieldCheck, label: "军工" },
  { to: "/sectors/fusion", icon: Orbit, label: "可控核聚变" },
];

export function Layout() {
  const { pathname } = useLocation();
  const { dark, toggle } = useDarkMode();
  const { subtle, toggle: toggleMarketPalette } = useMarketPalette();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("vr-sidebar") === "collapsed");

  useEffect(() => {
    localStorage.setItem("vr-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  return (
    <div className="flex min-h-screen flex-col md:h-screen md:flex-row">
      {/* Sidebar */}
      <aside className={cn(
        "glass z-10 mx-2 mt-2 flex shrink-0 flex-row rounded-2xl transition-all duration-200 md:m-2 md:flex-col",
        collapsed ? "md:w-14" : "md:w-60",
      )}>
        {/* Brand */}
        <div className={cn("hidden border-b border-border/50 md:block", collapsed ? "md:flex md:justify-center md:p-3" : "md:p-4")}>
          <Link to="/daily-review" className={cn("flex items-center", collapsed ? "justify-center" : "gap-2")}>
            <LineChart className="h-6 w-6 shrink-0 text-primary text-glow" />
            {!collapsed && (
              <span className="text-lg font-extrabold tracking-tight">
                Hi<span className="text-primary">lax</span>
              </span>
            )}
          </Link>
          {!collapsed && <p className="mt-1 text-[11px] text-muted-foreground">个人 AI 投研系统 · A股/美股/港股</p>}
        </div>

        {/* Nav */}
        <nav className={cn("flex flex-1 gap-1 overflow-x-auto p-2 md:block md:space-y-1 md:overflow-auto", collapsed ? "md:p-1.5" : "md:p-2.5")}>
          {NAV.map(({ to, icon: Icon, label }) => {
            const active = pathname === to;
            return (
              <div key={to} className="shrink-0">
                <Link
                  to={to}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm transition-colors md:px-3",
                    collapsed ? "md:justify-center md:p-2.5" : "md:gap-2.5 md:px-3 md:py-2.5",
                    active
                      ? "bg-primary/15 font-medium text-primary shadow-glow"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className={collapsed ? "md:hidden" : ""}>{label}</span>
                </Link>

                {/* 板块中心下方：常看板块的快捷入口（缩进） */}
                {to === "/sectors" && (
                  <div className={cn("mt-1 hidden space-y-0.5 md:block", !collapsed && "ml-4 border-l border-border/40 pl-1.5")}>
                    {SECTOR_LINKS.map(({ to: st, icon: SIcon, label: slabel }) => {
                      const sactive = pathname === st || pathname.startsWith(`${st}/`);
                      return (
                        <Link
                          key={st}
                          to={st}
                          title={collapsed ? slabel : undefined}
                          className={cn(
                            "flex items-center rounded-lg transition-colors",
                            collapsed ? "justify-center p-2" : "gap-2 px-2.5 py-1.5 text-[13px]",
                            sactive
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-muted-foreground/80 hover:bg-muted/40 hover:text-foreground",
                          )}
                        >
                          <SIcon className="h-3.5 w-3.5 shrink-0" />
                          {!collapsed && slabel}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={cn("hidden border-t border-border/50 md:block", collapsed ? "md:flex md:flex-col md:items-center md:gap-2 md:p-2" : "md:space-y-2 md:p-3")}>
          {collapsed ? (
            <>
              <button onClick={toggle} className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground" title={dark ? "亮色" : "暗色"}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={toggleMarketPalette}
                aria-pressed={subtle}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                title={subtle ? "恢复涨红跌绿" : "切换为低调涨跌色"}
              >
                {subtle ? <Palette className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
              <button onClick={() => setCollapsed(false)} className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground" title="展开">
                <ChevronsRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={toggle} className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                    {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                    {dark ? "亮色" : "暗色"}
                  </button>
                  <button
                    type="button"
                    onClick={toggleMarketPalette}
                    aria-pressed={subtle}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    title={subtle ? "恢复涨红跌绿" : "切换为低调涨跌色"}
                  >
                    {subtle ? <Palette className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {subtle ? "涨跌色" : "低调色"}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setCollapsed(true)} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground" title="收起">
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                {APP_VERSION} · 不荐股 · 不预测 · 无倾向
              </p>
            </>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 overflow-visible md:overflow-auto">
        <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { DailyReview } from "@/pages/DailyReview";

// 每日复盘是默认入口，其余页面在首次访问时再加载。
const Intel = lazy(() => import("@/pages/Intel").then(({ Intel }) => ({ default: Intel })));
const Sectors = lazy(() => import("@/pages/Sectors").then(({ Sectors }) => ({ default: Sectors })));
const SectorDetail = lazy(() => import("@/pages/SectorDetail").then(({ SectorDetail }) => ({ default: SectorDetail })));
const SectorTagDetail = lazy(() => import("@/pages/SectorTagDetail").then(({ SectorTagDetail }) => ({ default: SectorTagDetail })));
const Portfolio = lazy(() => import("@/pages/Portfolio").then(({ Portfolio }) => ({ default: Portfolio })));
const StockData = lazy(() => import("@/pages/StockData").then(({ StockData }) => ({ default: StockData })));
const Watchlist = lazy(() => import("@/pages/Watchlist").then(({ Watchlist }) => ({ default: Watchlist })));
const MyReports = lazy(() => import("@/pages/MyReports").then(({ MyReports }) => ({ default: MyReports })));
const Notes = lazy(() => import("@/pages/Notes").then(({ Notes }) => ({ default: Notes })));
const Settings = lazy(() => import("@/pages/Settings").then(({ Settings }) => ({ default: Settings })));
const QuantScreening = lazy(() => import("@/pages/QuantScreening").then(({ QuantScreening }) => ({ default: QuantScreening })));
const SectorStrength = lazy(() => import("@/pages/SectorStrength").then(({ SectorStrength }) => ({ default: SectorStrength })));
const StockKline = lazy(() => import("@/pages/StockKline").then(({ StockKline }) => ({ default: StockKline })));
const IndexKline = lazy(() => import("@/pages/IndexKline").then(({ IndexKline }) => ({ default: IndexKline })));

function deferredPage(content: ReactNode) {
  return (
    <Suspense fallback={<div role="status" className="flex min-h-60 items-center justify-center text-sm text-muted-foreground">页面加载中…</div>}>
      {content}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Navigate to="/daily-review" replace /> },
      { path: "/daily-review", element: <DailyReview /> },
      { path: "/intel", element: deferredPage(<Intel />) },
      { path: "/sectors", element: deferredPage(<Sectors />) },
      { path: "/sectors/:key", element: deferredPage(<SectorDetail />) },
      { path: "/sectors/:key/:tag", element: deferredPage(<SectorTagDetail />) },
      { path: "/sector-strength", element: deferredPage(<SectorStrength />) },
      { path: "/portfolio", element: deferredPage(<Portfolio />) },
      { path: "/stock-data", element: deferredPage(<StockData />) },
      { path: "/quant-screening", element: deferredPage(<QuantScreening />) },
      { path: "/stock-kline/:code", element: deferredPage(<StockKline />) },
      { path: "/index-kline/:code", element: deferredPage(<IndexKline />) },
      { path: "/watchlist", element: deferredPage(<Watchlist />) },
      { path: "/my-reports", element: deferredPage(<MyReports />) },
      { path: "/notes", element: deferredPage(<Notes />) },
      { path: "/settings", element: deferredPage(<Settings />) },
    ],
  },
]);

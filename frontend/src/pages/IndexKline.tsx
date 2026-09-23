import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import * as echarts from "echarts";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, ApiError, type IndexKlineData } from "@/lib/api";
import { useLightTheme } from "@/hooks/useLightTheme";
import { useMarketPalette } from "@/hooks/useMarketPalette";
import { KLINE_FREQ, klineChartColors, klineMarketColors } from "@/lib/klinePalette";
import { cn } from "@/lib/utils";

export function IndexKline() {
  const { code = "" } = useParams<{ code: string }>();
  const [category, setCategory] = useState<number>(4);
  const [data, setData] = useState<IndexKlineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const light = useLightTheme();
  const { subtle } = useMarketPalette();
  const chartColors = useMemo(() => klineChartColors(light), [light]);
  const marketColors = useMemo(() => klineMarketColors(subtle), [subtle]);
  const chartDom = useRef<HTMLDivElement | null>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    api.indexKline(code, category, controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof ApiError ? reason.message : "指数 K 线暂不可用");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [code, category]);

  useEffect(() => {
    if (!chartDom.current) return;
    const instance = echarts.init(chartDom.current);
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(chartDom.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const bars = data?.bars ?? [];
    if (!chart.current || bars.length === 0) {
      chart.current?.clear();
      return;
    }
    const dates = bars.map((bar) => bar.datetime);
    const candles = bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]);
    const volumes = bars.map((bar) => ({
      value: bar.vol,
      itemStyle: { color: bar.close >= bar.open ? marketColors.up : marketColors.down },
    }));
    chart.current.setOption({
      animation: false,
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [{ left: 62, right: 20, top: 24, height: "60%" }, { left: 62, right: 20, top: "72%", height: "16%" }],
      xAxis: [
        { type: "category", data: dates, boundaryGap: true, axisLabel: { show: false }, axisLine: { lineStyle: { color: chartColors.axis } }, splitLine: { show: false } },
        { type: "category", gridIndex: 1, data: dates, boundaryGap: true, axisLabel: { color: chartColors.text, hideOverlap: true }, axisLine: { lineStyle: { color: chartColors.axis } }, splitLine: { show: false } },
      ],
      yAxis: [
        { scale: true, axisLabel: { color: chartColors.text }, splitLine: { lineStyle: { color: chartColors.grid } } },
        { scale: true, gridIndex: 1, axisLabel: { color: chartColors.text }, splitLine: { lineStyle: { color: chartColors.grid } } },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: 65, end: 100 },
        { type: "slider", xAxisIndex: [0, 1], start: 65, end: 100, bottom: 8, height: 18, textStyle: { color: chartColors.text } },
      ],
      series: [
        { name: "K 线", type: "candlestick", data: candles, itemStyle: { color: marketColors.up, color0: marketColors.down, borderColor: marketColors.up, borderColor0: marketColors.down } },
        { name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: volumes, barMaxWidth: 10 },
      ],
    }, true);
  }, [data, chartColors, marketColors]);

  const bars = data?.bars ?? [];
  const latest = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  const changePct = latest && previous && previous.close > 0
    ? (latest.close - previous.close) / previous.close * 100
    : null;

  return (
    <div>
      <Link to="/daily-review" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> 返回每日复盘
      </Link>
      <PageHeader title={data?.name ?? "指数 K 线"} subtitle={`${code} · 通达信指数行情 · 最近最多 400 根`} />
      <GlassCard>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className={cn("font-mono font-num text-2xl font-bold", changePct == null ? "text-foreground" : changePct > 0 ? "text-market-up" : changePct < 0 ? "text-market-down" : "text-foreground")}>{latest?.close.toFixed(2) ?? "—"}</span>
            <span className={cn("ml-3 font-mono font-num text-sm", changePct == null ? "text-muted-foreground" : changePct > 0 ? "text-market-up" : changePct < 0 ? "text-market-down" : "text-muted-foreground")}>{changePct == null ? "—" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%`}</span>
            <p className="mt-1 text-xs text-muted-foreground">{latest?.datetime ?? ""} · 当前周期相对前一根收盘涨跌</p>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="K 线周期">
            {KLINE_FREQ.map((option) => (
              <button key={option.value} type="button" onClick={() => setCategory(option.value)}
                className={cn("rounded-lg px-3 py-1.5 text-xs transition-colors", category === option.value ? "bg-primary/20 font-semibold text-primary" : "bg-muted/30 text-muted-foreground hover:text-foreground")}
                aria-pressed={category === option.value}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {loading && <p role="status" className="py-3 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />加载 K 线…</p>}
        {error && <p role="alert" className="flex items-center gap-2 py-3 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}</p>}
        {!loading && !error && bars.length === 0 && <p className="py-3 text-sm text-muted-foreground">该指数当前周期暂无 K 线数据。</p>}
        <div ref={chartDom} className={cn("h-[460px] w-full", bars.length === 0 && "hidden")} role="img" aria-label={`${data?.name ?? "指数"} K 线与成交量图`} />
      </GlassCard>
    </div>
  );
}

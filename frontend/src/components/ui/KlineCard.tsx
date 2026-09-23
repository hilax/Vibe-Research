import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertCircle, LineChart } from "lucide-react";
import * as echarts from "echarts";
import { GlassCard } from "@/components/ui/GlassCard";
import { KlineFormulaEditor } from "@/components/kline/KlineFormulaEditor";
import { api, ApiError, type KlineBar, type Quote, type RpsPoint } from "@/lib/api";
import { useKlineMainFormula } from "@/hooks/useKlineMainFormula";
import { useMarketPalette } from "@/hooks/useMarketPalette";
import { useLightTheme } from "@/hooks/useLightTheme";
import {
  KLINE_RPS_HOT_LINE as RPS_HOT_LINE,
  KLINE_FREQ,
  klineMarketColors,
  klineChartColors,
  klineFormatVol as fmtVol,
  tdxDrawIconLabel,
  tdxDrawIconSymbol,
} from "@/lib/klinePalette";
import { cn } from "@/lib/utils";

type Frequency = 3 | 4 | 5 | 6; // 60分钟 / 日 / 周 / 月
const FREQ_OPTIONS = KLINE_FREQ as unknown as { value: Frequency; label: string }[];

interface KlineCardProps {
  code: string;
  // 可选：若父级已有名称（如 StockData 头部 metrics），避免重复请求 quote。
  name?: string;
}

// 个股 K 线主图卡：嵌入到「个股数据」页 A 股分支内。
// 视觉、ECharts 配置与原 /stock-kline/:code 路由保持一致；输出 5 套通达信公式信号标记。
export function KlineCard({ code, name: nameHint }: KlineCardProps) {
  const { subtle } = useMarketPalette();
  const light = useLightTheme();
  const chartColors = useMemo(() => klineChartColors(light), [light]);
  const { up: RED, down: GREEN } = klineMarketColors(subtle);
  const [freq, setFreq] = useState<Frequency>(4);
  const [bars, setBars] = useState<KlineBar[] | null>(null);
  const [rps, setRps] = useState<RpsPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const formula = useKlineMainFormula(code, freq, bars, rps);

  // 当日涨跌使用实时行情的现价 / 昨收口径，与当前选择的 K 线频率解耦。
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setQuote(null);
    api.quote(code)
      .then((result) => {
        if (!cancelled) setQuote(result[code] ?? null);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      });
    return () => { cancelled = true; };
  }, [code]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const [k, rh] = await Promise.all([
          api.kline(code, { category: freq, fullHistory: true }),
          // 仅日 K 拉 RPS（其他频率 RPS 没必要切），且失败降级静默。
          freq === 4
            ? api.rpsHistory(code).catch(() => [])
            : Promise.resolve([] as RpsPoint[]),
        ]);
        if (cancelled) return;
        setBars(k ?? []);
        setRps(rh ?? []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : String(e));
        setBars([]); setRps([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code, freq]);

  // ECharts：主图 K 线 + MA + 副图成交量 + RPS（自适应高度，下方占主图 1/4）
  const domRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!domRef.current) return;
    const c = echarts.init(domRef.current);
    chartRef.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(domRef.current);
    return () => { ro.disconnect(); c.dispose(); chartRef.current = null; };
  }, []);

  // 计算 series：OHLC + 副图 RPS + 后端安全解释器返回的动态主图公式结果。
  const series = useMemo(() => {
    if (!bars || bars.length === 0) return null;
    const dates = bars.map((b) => b.datetime);
    const ohlc = bars.map((b) => [b.open, b.close, b.low, b.high]);
    const vols = bars.map((b, i) => ({
      value: b.vol,
      itemStyle: { color: b.close >= (i > 0 ? bars[i - 1].close : b.open) ? RED : GREEN },
    }));

    const fillNull = (n: number) => new Array(n).fill(null) as (number | null)[];
    let rps50Base = fillNull(bars.length), rps50Hot = fillNull(bars.length);
    let rps120Base = fillNull(bars.length), rps120Hot = fillNull(bars.length);
    let rps250Base = fillNull(bars.length), rps250Hot = fillNull(bars.length);
    let showRps = rps.length > 0;
    if (showRps) {
      const idx = new Map<string, number>();
      bars.forEach((b, i) => idx.set(b.datetime.slice(0, 10), i));
      for (const p of rps) {
        const i = idx.get(p.trade_date.slice(0, 10));
        if (i == null) continue;
        ([
          [p.rps50, rps50Base, rps50Hot],
          [p.rps120, rps120Base, rps120Hot],
          [p.rps250, rps250Base, rps250Hot],
        ] as const).forEach(([v, base, hot]) => {
          // 通达信口径：RPS 原色线始终连续；>=90 时额外叠加红线。
          // 不能把 base 在强势区置空，否则跨越 90 的两个独立 series 会断开。
          base[i] = v;
          if (v >= RPS_HOT_LINE) hot[i] = v;
        });
      }
      const anyHit =
        rps50Base.some((v) => v != null) ||
        rps120Base.some((v) => v != null) ||
        rps250Base.some((v) => v != null);
      if (!anyHit) showRps = false;
    }

    const formulaLines = (formula.evaluation?.lines ?? []).filter(
      (line) => line.values.length === bars.length,
    );
    const formulaIcons = (formula.evaluation?.icons ?? []).flatMap((layer) =>
      layer.points
        .filter((point) => point.index >= 0 && point.index < bars.length && Number.isFinite(point.price))
        .map((point) => ({ ...point, icon: point.icon || layer.icon })),
    );

    return {
      dates, ohlc, vols, formulaLines, formulaIcons,
      rps50Base, rps50Hot,
      rps120Base, rps120Hot,
      rps250Base, rps250Hot,
      showRps,
    };
  }, [GREEN, RED, bars, formula.evaluation, rps]);

  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    if (!series) { c.clear(); return; }

    const grids = series.showRps
      ? [
          { left: 56, right: 16, top: 36, height: "52%" },
          { left: 56, right: 16, top: "66%", height: "12%" },
          { left: 56, right: 16, top: "82%", height: "14%" },
        ]
      : [
          { left: 56, right: 16, top: 36, height: "62%" },
          { left: 56, right: 16, top: "78%", height: "16%" },
        ];

    const xAxes: any[] = [
      {
        type: "category", data: series.dates, scale: true, boundaryGap: false,
        axisLine: { lineStyle: { color: chartColors.axis } },
        axisLabel: { color: chartColors.text, fontSize: 10 },
        splitLine: { show: false },
      },
      {
        type: "category", data: series.dates, gridIndex: 1, scale: true, boundaryGap: false,
        axisLine: { lineStyle: { color: chartColors.axis } },
        axisLabel: { show: false },
      },
    ];
    const yAxes: any[] = [
      {
        scale: true, position: "left",
        axisLine: { lineStyle: { color: chartColors.axis } },
        axisLabel: { color: chartColors.text, fontSize: 10 },
        splitLine: { lineStyle: { color: chartColors.grid } },
      },
      {
        scale: true, gridIndex: 1, position: "left",
        axisLine: { lineStyle: { color: chartColors.axis } },
        axisLabel: { color: chartColors.text, fontSize: 10, formatter: (v: number) => fmtVol(v) },
        splitLine: { show: false },
      },
    ];
    if (series.showRps) {
      xAxes.push({
        type: "category", data: series.dates, gridIndex: 2, scale: true, boundaryGap: false,
        axisLine: { lineStyle: { color: chartColors.axis } },
        axisLabel: { color: chartColors.text, fontSize: 10 },
        splitLine: { show: false },
      });
      yAxes.push({
        min: 0, max: 100, gridIndex: 2, position: "left",
        axisLine: { lineStyle: { color: chartColors.axis } },
        axisLabel: { color: chartColors.text, fontSize: 10 },
        splitLine: { lineStyle: { color: chartColors.grid } },
      });
    }

    const dataSeries: any[] = [
      {
        name: "K线", type: "candlestick", data: series.ohlc,
        itemStyle: { color: RED, color0: GREEN, borderColor: RED, borderColor0: GREEN },
        markPoint: {
          symbolSize: 24,
          data: series.formulaIcons.map((point) => ({
            name: tdxDrawIconLabel(point.icon),
            coord: [series.dates[point.index], point.price],
            symbol: tdxDrawIconSymbol(point.icon),
            symbolSize: 24,
            label: { show: false },
          })),
        },
      },
      { name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: series.vols },
    ];

    series.formulaLines.forEach((line, index) => {
      dataSeries.push({
        name: line.name,
        type: "line",
        data: line.values,
        smooth: false,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1, color: chartColors.ma[index % chartColors.ma.length] },
      });
    });

    const legendData = ["K线", ...series.formulaLines.map((line) => line.name), "成交量"];
    const xAxisIndices = [0, 1];
    if (series.showRps) {
      const rpsLines = [
        { name: "RPS50", base: series.rps50Base, hot: series.rps50Hot, color: chartColors.rps.rps50 },
        { name: "RPS120", base: series.rps120Base, hot: series.rps120Hot, color: chartColors.rps.rps120 },
        { name: "RPS250", base: series.rps250Base, hot: series.rps250Hot, color: chartColors.rps.rps250 },
      ];
      for (const { name, base, hot, color } of rpsLines) {
        dataSeries.push(
          { name, type: "line", data: base, xAxisIndex: 2, yAxisIndex: 2,
            smooth: false, showSymbol: false, connectNulls: false,
            lineStyle: { width: 1, color, cap: "round", join: "round" } },
          { name: `${name} ≥ ${RPS_HOT_LINE}`, type: "line", data: hot, xAxisIndex: 2, yAxisIndex: 2,
            smooth: false, showSymbol: false, connectNulls: false,
            lineStyle: { width: 1.8, color: chartColors.rps.hot, cap: "round", join: "round" }, z: 5,
            legendHoverLink: false },
        );
      }
      legendData.push("RPS50", "RPS120", "RPS250");
      xAxisIndices.push(2);
    }

    const defaultStartValue = Math.max(0, series.dates.length - 240);
    c.setOption({
      animation: false,
      legend: {
        top: 4, left: "center",
        textStyle: { color: chartColors.text, fontSize: 11 },
        data: legendData,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(15,23,42,0.92)",
        borderColor: "#334155",
        textStyle: { color: "#e2e8f0", fontSize: 12 },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return "";
          const idx = params[0].dataIndex as number;
          const date = series.dates[idx] ?? "";
          const lines: string[] = [`<div style="font-weight:600;margin-bottom:4px">${date}</div>`];
          const candle = params.find((p: any) => p.seriesName === "K线");
          if (candle && Array.isArray(candle.data)) {
            const [o, c, l, h] = candle.data;
            const up = c >= o;
            const color = up ? RED : GREEN;
            lines.push(
              `<div>开 <span style="color:${color}">${(+o).toFixed(2)}</span> ` +
              `收 <span style="color:${color}">${(+c).toFixed(2)}</span> ` +
              `高 <span style="color:${color}">${(+h).toFixed(2)}</span> ` +
              `低 <span style="color:${color}">${(+l).toFixed(2)}</span></div>`,
            );
            const previousClose = idx > 0 ? series.ohlc[idx - 1][1] : null;
            if (previousClose != null && Number.isFinite(+previousClose) && +previousClose !== 0) {
              const change = +c - +previousClose;
              const changePct = (change / +previousClose) * 100;
              const changeColor = change > 0 ? RED : change < 0 ? GREEN : "#94a3b8";
              const sign = change > 0 ? "+" : "";
              lines.push(
                `<div style="color:#94a3b8">涨跌 ` +
                `<span style="color:${changeColor}">${sign}${change.toFixed(2)}</span> · 涨跌幅 ` +
                `<span style="color:${changeColor}">${sign}${changePct.toFixed(2)}%</span></div>`,
              );
            }
          }
          const vol = params.find((p: any) => p.seriesName === "成交量");
          if (vol && typeof vol.data === "number") {
            lines.push(`<div style="color:#94a3b8">成交量 <span style="color:#e2e8f0">${fmtVol(vol.data)}</span></div>`);
          }
          const maLines: string[] = [];
          for (const line of series.formulaLines) {
            const p = params.find((x: any) => x.seriesName === line.name);
            const v = p && typeof p.data === "number" ? p.data : null;
            if (v != null) maLines.push(`${line.name} <span style="color:#e2e8f0">${v.toFixed(2)}</span>`);
          }
          if (maLines.length) lines.push(`<div style="color:#94a3b8">${maLines.join(" · ")}</div>`);
          if (series.showRps) {
            const rpsRow = ([
              ["RPS50", series.rps50Base[idx], series.rps50Hot[idx]],
              ["RPS120", series.rps120Base[idx], series.rps120Hot[idx]],
              ["RPS250", series.rps250Base[idx], series.rps250Hot[idx]],
            ] as const).map(([n, b, h]) => {
              const v = h ?? b;
              if (v == null) return `${n} <span style="color:#64748b">—</span>`;
              const hot = (v as number) >= RPS_HOT_LINE;
              const color = hot ? "#ef4444" : "#e2e8f0";
              return `${n} <span style="color:${color}">${(v as number).toFixed(1)}</span>${hot ? " 🔥" : ""}`;
            });
            lines.push(`<div style="color:#94a3b8">${rpsRow.join(" · ")}</div>`);
          }
          return lines.join("");
        },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }], label: { backgroundColor: "#1e293b" } },
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      dataZoom: [
        { type: "inside", xAxisIndex: xAxisIndices,
          startValue: defaultStartValue, endValue: series.dates.length - 1 },
        { type: "slider", xAxisIndex: xAxisIndices, bottom: 6, height: 18,
          startValue: defaultStartValue, endValue: series.dates.length - 1,
          borderColor: "#334155", fillerColor: "rgba(99,102,241,0.18)",
          handleStyle: { color: "#6366f1" }, textStyle: { color: chartColors.text, fontSize: 10 } },
      ],
      series: dataSeries,
    }, { notMerge: true });
  }, [series, chartColors]);

  const latestDailyBar = freq === 4 && bars?.length ? bars[bars.length - 1] : null;
  const previousDailyBar = freq === 4 && bars && bars.length > 1 ? bars[bars.length - 2] : null;
  const currentPrice = quote?.price ?? latestDailyBar?.close ?? null;
  const previousClose = quote?.last_close ?? previousDailyBar?.close ?? null;
  const dailyChange = currentPrice != null && previousClose != null
    ? currentPrice - previousClose
    : null;
  const dailyChangePct = quote && Number.isFinite(quote.change_pct)
    ? quote.change_pct
    : dailyChange != null && previousClose
      ? (dailyChange / previousClose) * 100
      : null;
  const dailyTone = dailyChange == null
    ? "text-muted-foreground"
    : dailyChange > 0
      ? "text-market-up"
      : dailyChange < 0
        ? "text-market-down"
        : "text-muted-foreground";
  const dailySign = dailyChange != null && dailyChange > 0 ? "+" : "";

  return (
    <GlassCard className="relative">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <LineChart className="h-4 w-4 text-primary" /> K 线主图
          {nameHint && <span className="text-xs font-normal text-muted-foreground/70">· {nameHint} ({code})</span>}
          {bars && bars.length > 0 && (
            <span className="text-[11px] font-normal text-muted-foreground/60">
              · {freq === 3 ? "数据源可用全量" : "上市以来"} {bars[0].datetime.slice(0, 10)} 至今 · {bars.length.toLocaleString("zh-CN")} 根
            </span>
          )}
          <span className="text-[11px] font-normal text-muted-foreground/60">· 均线与图标由可编辑公式绘制</span>
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-surface-2/55 dark:bg-black/20 p-1 text-xs">
            {FREQ_OPTIONS.map((o) => (
              <button key={o.value}
                onClick={() => setFreq(o.value)}
                className={cn("rounded-md px-2.5 py-1 transition-colors",
                  freq === o.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>
                {o.label}
              </button>
            ))}
          </div>
          <Link to={`/stock-kline/${code}`} className="text-xs text-muted-foreground hover:text-primary">
            全屏查看 →
          </Link>
        </div>
      </div>
      {currentPrice != null && (
        <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg bg-surface-2/45 dark:bg-black/15 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            现价 <b className={cn("ml-1 font-mono text-base", dailyTone)}>{currentPrice.toFixed(2)}</b>
          </span>
          <span className="text-muted-foreground">
            当日涨跌 <b className={cn("ml-1 font-mono", dailyTone)}>
              {dailyChange == null || dailyChangePct == null
                ? "—"
                : `${dailySign}${dailyChange.toFixed(2)} (${dailySign}${dailyChangePct.toFixed(2)}%)`}
            </b>
          </span>
          <span className="font-mono text-muted-foreground">
            昨收 {previousClose == null ? "—" : previousClose.toFixed(2)}
          </span>
        </div>
      )}
      {error && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}
      <div ref={domRef} className="h-[560px] w-full" />
      <KlineFormulaEditor formula={formula} />
      {loading && !bars && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 拉取完整 K 线历史…
        </div>
      )}
      {!loading && bars && bars.length === 0 && !error && (
        <div className="absolute inset-x-0 bottom-10 flex items-center justify-center text-sm text-muted-foreground">
          该品种暂无 K 线数据
        </div>
      )}
    </GlassCard>
  );
}

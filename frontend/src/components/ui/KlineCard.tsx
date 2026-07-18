import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertCircle, LineChart } from "lucide-react";
import * as echarts from "echarts";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, ApiError, type KlineBar, type RpsPoint } from "@/lib/api";
import { calcMA, computeSignals } from "@/lib/klineSignals";
import {
  KLINE_RED as RED,
  KLINE_MA_COLOR as MA_COLOR,
  KLINE_RPS_COLOR as RPS_COLOR,
  KLINE_RPS_HOT_LINE as RPS_HOT_LINE,
  KLINE_SIGNAL_GLYPHS as SIGNAL_GLYPHS,
  KLINE_SIGNAL_COLORS as SIGNAL_COLORS,
  KLINE_SIGNAL_LABEL as SIGNAL_LABEL,
  KLINE_FREQ,
  klineFormatVol as fmtVol,
} from "@/lib/klinePalette";
import { cn } from "@/lib/utils";

type Frequency = 4 | 5 | 6 | 11; // 日 / 周 / 月 / 60分钟
const FREQ_OPTIONS = KLINE_FREQ as unknown as { value: Frequency; label: string; offset: number }[];

interface KlineCardProps {
  code: string;
  // 可选：若父级已有名称（如 StockData 头部 metrics），避免重复请求 quote。
  name?: string;
}

// 个股 K 线主图卡：嵌入到「个股数据」页 A 股分支内。
// 视觉、ECharts 配置与原 /stock-kline/:code 路由保持一致；输出 4 套通达信公式信号标记。
export function KlineCard({ code, name: nameHint }: KlineCardProps) {
  const [freq, setFreq] = useState<Frequency>(4);
  const offset = FREQ_OPTIONS.find((f) => f.value === freq)?.offset ?? 240;
  const [bars, setBars] = useState<KlineBar[] | null>(null);
  const [rps, setRps] = useState<RpsPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const [k, rh] = await Promise.all([
          api.kline(code, { category: freq, offset }),
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
  }, [code, freq, offset]);

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

  // 计算 series：OHLC + 副图所需数组 + RPS 按 bars 对齐 + 4 套公式信号
  const series = useMemo(() => {
    if (!bars || bars.length === 0) return null;
    const dates = bars.map((b) => b.datetime);
    const ohlc = bars.map((b) => [b.open, b.close, b.low, b.high]);
    const closes = bars.map((b) => b.close);
    const vols = bars.map((b, i) => ({
      value: b.vol,
      itemStyle: { color: b.close >= (i > 0 ? bars[i - 1].close : b.open) ? RED : "#22c55e" },
    }));

    const fillNull = (n: number) => new Array(n).fill(null) as (number | null)[];
    let rps5Aligned = fillNull(bars.length);
    let rps10Aligned = fillNull(bars.length);
    let rps15Aligned = fillNull(bars.length);
    let rps50Base = fillNull(bars.length), rps50Hot = fillNull(bars.length);
    let rps120Base = fillNull(bars.length), rps120Hot = fillNull(bars.length);
    let rps250Base = fillNull(bars.length), rps250Hot = fillNull(bars.length);
    let rps20Aligned = fillNull(bars.length);
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
          if (v >= RPS_HOT_LINE) hot[i] = v;
          else base[i] = v;
        });
        rps5Aligned[i] = p.rps5 ?? null;
        rps10Aligned[i] = p.rps10 ?? null;
        rps15Aligned[i] = p.rps15 ?? null;
        rps20Aligned[i] = p.rps20 ?? null;
      }
      const anyHit =
        rps50Base.some((v) => v != null) || rps50Hot.some((v) => v != null) ||
        rps120Base.some((v) => v != null) || rps120Hot.some((v) => v != null) ||
        rps250Base.some((v) => v != null) || rps250Hot.some((v) => v != null);
      if (!anyHit) showRps = false;
    }

    const signals = computeSignals(bars, {
      rps5: rps5Aligned, rps10: rps10Aligned, rps15: rps15Aligned,
      rps20: rps20Aligned, rps50: rps50Base.map((v, i) => v ?? rps50Hot[i] ?? null),
      rps120: rps120Base.map((v, i) => v ?? rps120Hot[i] ?? null),
      rps250: rps250Base.map((v, i) => v ?? rps250Hot[i] ?? null),
    });

    return {
      dates, ohlc, closes, vols,
      ma5: calcMA(closes, 5),
      ma10: calcMA(closes, 10),
      ma20: calcMA(closes, 20),
      ma60: calcMA(closes, 60),
      rps50Base, rps50Hot,
      rps120Base, rps120Hot,
      rps250Base, rps250Hot,
      signals,
      showRps,
    };
  }, [bars, rps]);

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
        axisLine: { lineStyle: { color: "#334155" } },
        axisLabel: { color: "#94a3b8", fontSize: 10 },
        splitLine: { show: false },
      },
      {
        type: "category", data: series.dates, gridIndex: 1, scale: true, boundaryGap: false,
        axisLine: { lineStyle: { color: "#334155" } },
        axisLabel: { show: false },
      },
    ];
    const yAxes: any[] = [
      {
        scale: true, position: "left",
        axisLine: { lineStyle: { color: "#334155" } },
        axisLabel: { color: "#94a3b8", fontSize: 10 },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.08)" } },
      },
      {
        scale: true, gridIndex: 1, position: "left",
        axisLine: { lineStyle: { color: "#334155" } },
        axisLabel: { color: "#94a3b8", fontSize: 10, formatter: (v: number) => fmtVol(v) },
        splitLine: { show: false },
      },
    ];
    if (series.showRps) {
      xAxes.push({
        type: "category", data: series.dates, gridIndex: 2, scale: true, boundaryGap: false,
        axisLine: { lineStyle: { color: "#334155" } },
        axisLabel: { color: "#94a3b8", fontSize: 10 },
        splitLine: { show: false },
      });
      yAxes.push({
        min: 0, max: 100, gridIndex: 2, position: "left",
        axisLine: { lineStyle: { color: "#334155" } },
        axisLabel: { color: "#94a3b8", fontSize: 10 },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.08)" } },
      });
    }

    const dataSeries: any[] = [
      {
        name: "K线", type: "candlestick", data: series.ohlc,
        itemStyle: { color: RED, color0: "#22c55e", borderColor: RED, borderColor0: "#22c55e" },
        markPoint: freq === 4 ? {
          symbol: "pin", symbolSize: 26,
          data: [
            ...(series.signals?.sxhcg || []).flatMap((on, i) => on ? [{ name: SIGNAL_LABEL.sxhcg,
              coord: [series.dates[i], series.ohlc[i][2]],
              symbol: SIGNAL_GLYPHS.sxhcg, symbolOffset: [0, -10],
              itemStyle: { color: SIGNAL_COLORS.sxhcg },
              label: { show: false } }] : []),
            ...(series.signals?.zcdx || []).flatMap((on, i) => on ? [{ name: SIGNAL_LABEL.zcdx,
              coord: [series.dates[i], series.ohlc[i][2]],
              symbol: SIGNAL_GLYPHS.zcdx, symbolOffset: [0, -24],
              itemStyle: { color: SIGNAL_COLORS.zcdx },
              label: { show: false } }] : []),
            ...(series.signals?.yxfz || []).flatMap((on, i) => on ? [{ name: SIGNAL_LABEL.yxfz,
              coord: [series.dates[i], series.ohlc[i][2]],
              symbol: SIGNAL_GLYPHS.yxfz, symbolOffset: [0, -38],
              itemStyle: { color: SIGNAL_COLORS.yxfz },
              label: { show: false } }] : []),
            ...(series.signals?.xhr || []).flatMap((on, i) => on ? [{ name: SIGNAL_LABEL.xhr,
              coord: [series.dates[i], series.ohlc[i][2]],
              symbol: SIGNAL_GLYPHS.xhr, symbolOffset: [0, -52],
              itemStyle: { color: SIGNAL_COLORS.xhr },
              label: { show: false } }] : []),
          ],
        } : undefined,
      },
      { name: "MA5", type: "line", data: series.ma5, smooth: true, showSymbol: false,
        lineStyle: { width: 1, color: MA_COLOR[0] } },
      { name: "MA10", type: "line", data: series.ma10, smooth: true, showSymbol: false,
        lineStyle: { width: 1, color: MA_COLOR[1] } },
      { name: "MA20", type: "line", data: series.ma20, smooth: true, showSymbol: false,
        lineStyle: { width: 1, color: MA_COLOR[2] } },
      { name: "MA60", type: "line", data: series.ma60, smooth: true, showSymbol: false,
        lineStyle: { width: 1, color: MA_COLOR[3] } },
      { name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: series.vols },
    ];

    const legendData = ["K线", "MA5", "MA10", "MA20", "MA60", "成交量"];
    const xAxisIndices = [0, 1];
    if (series.showRps) {
      const rpsLines = [
        { name: "RPS50", base: series.rps50Base, hot: series.rps50Hot, color: RPS_COLOR.rps50 },
        { name: "RPS120", base: series.rps120Base, hot: series.rps120Hot, color: RPS_COLOR.rps120 },
        { name: "RPS250", base: series.rps250Base, hot: series.rps250Hot, color: RPS_COLOR.rps250 },
      ];
      for (const { name, base, hot, color } of rpsLines) {
        dataSeries.push(
          { name, type: "line", data: base, xAxisIndex: 2, yAxisIndex: 2,
            smooth: true, showSymbol: false, connectNulls: false,
            lineStyle: { width: 1, color } },
          { name: `${name} ≥ ${RPS_HOT_LINE}`, type: "line", data: hot, xAxisIndex: 2, yAxisIndex: 2,
            smooth: true, showSymbol: false, connectNulls: false,
            lineStyle: { width: 1.8, color: RPS_COLOR.hot }, z: 5,
            legendHoverLink: false },
        );
      }
      legendData.push("RPS50", "RPS120", "RPS250");
      xAxisIndices.push(2);
    }

    c.setOption({
      animation: false,
      legend: {
        top: 4, left: "center",
        textStyle: { color: "#94a3b8", fontSize: 11 },
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
            const color = up ? "#ef4444" : "#22c55e";
            lines.push(
              `<div>开 <span style="color:${color}">${(+o).toFixed(2)}</span> ` +
              `收 <span style="color:${color}">${(+c).toFixed(2)}</span> ` +
              `高 <span style="color:${color}">${(+h).toFixed(2)}</span> ` +
              `低 <span style="color:${color}">${(+l).toFixed(2)}</span></div>`,
            );
          }
          const vol = params.find((p: any) => p.seriesName === "成交量");
          if (vol && typeof vol.data === "number") {
            lines.push(`<div style="color:#94a3b8">成交量 <span style="color:#e2e8f0">${fmtVol(vol.data)}</span></div>`);
          }
          const maLines: string[] = [];
          for (const ma of ["MA5", "MA10", "MA20", "MA60"] as const) {
            const p = params.find((x: any) => x.seriesName === ma);
            const v = p && typeof p.data === "number" ? p.data : null;
            if (v != null) maLines.push(`${ma} <span style="color:#e2e8f0">${v.toFixed(2)}</span>`);
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
        { type: "inside", xAxisIndex: xAxisIndices, start: 70, end: 100 },
        { type: "slider", xAxisIndex: xAxisIndices, bottom: 6, height: 18,
          borderColor: "#334155", fillerColor: "rgba(99,102,241,0.18)",
          handleStyle: { color: "#6366f1" }, textStyle: { color: "#94a3b8", fontSize: 10 } },
      ],
      series: dataSeries,
    });
  }, [series]);

  return (
    <GlassCard className="relative">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <LineChart className="h-4 w-4 text-primary" /> K 线主图
          {nameHint && <span className="text-xs font-normal text-muted-foreground/70">· {nameHint} ({code})</span>}
          <span className="text-[11px] font-normal text-muted-foreground/60">· 主图叠加 MA5/10/20/60 + 4 套公式信号</span>
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-black/20 p-1 text-xs">
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
      {error && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}
      <div ref={domRef} className="h-[560px] w-full" />
      {loading && !bars && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 拉取 K 线…
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

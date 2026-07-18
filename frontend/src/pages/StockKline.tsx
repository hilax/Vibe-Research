import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import * as echarts from "echarts";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, ApiError, type KlineBar, type RpsPoint } from "@/lib/api";
import { calcMA, computeSignals } from "@/lib/klineSignals";
import {
  KLINE_RED as RED,
  KLINE_GREEN as GREEN,
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

export function StockKline() {
  const { code = "" } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [freq, setFreq] = useState<Frequency>(4);
  const offset = FREQ_OPTIONS.find((f) => f.value === freq)?.offset ?? 240;
  const [bars, setBars] = useState<KlineBar[] | null>(null);
  const [rps, setRps] = useState<RpsPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string>(""); // 来自第一行 bar 不可得，回退到接口 quote；这里用 quote 兜底

  // 拉 K 线 + RPS 历史 + 名称（RPS 历史失败不影响主图，静默置空即可）
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const [k, q, rh] = await Promise.all([
          api.kline(code, { category: freq, offset }),
          api.quote(code).catch(() => null),
          // 仅日 K 拉 RPS（其他频率 RPS 没必要切），且失败降级静默。
          freq === 4
            ? api.rpsHistory(code).catch(() => [])
            : Promise.resolve([] as RpsPoint[]),
        ]);
        if (cancelled) return;
        setBars(k ?? []);
        setRps(rh ?? []);
        if (q && q[code]?.name) setName(q[code].name);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : String(e));
        setBars([]);
        setRps([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code, freq, offset]);

  // ECharts：主图 K 线 + MA + 副图成交量（自适应高度，下方占主图 1/4）
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

  // 计算 MA + 副图所需数组 + RPS 按 bars 对齐
  const series = useMemo(() => {
    if (!bars || bars.length === 0) return null;
    const dates = bars.map((b) => b.datetime);
    const ohlc = bars.map((b) => [b.open, b.close, b.low, b.high]);
    const closes = bars.map((b) => b.close);
    const vols = bars.map((b, i) => ({
      value: b.vol,
      itemStyle: { color: b.close >= (i > 0 ? bars[i - 1].close : b.open) ? RED : GREEN },
    }));

    // RPS：把后端按交易日返回的稀疏序列对齐到 K 线的稠密 x 轴。
    // 没匹配上的位置用 null 占位，ECharts 会断开，避免误以为是 0。
    // 每条 RPS 线再拆成 base/hot 两段：
    //   - base：值 < 90 的连续段用线本色绘制；
    //   - hot：值 >= 90 的连续段用红色覆盖（对应通达信 IF(RPSx>=M, RPSx, DRAWNULL)）。
    // 用 null 在不需要绘制的位置断开，ECharts 会自动分段。
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
      // bars 的 datetime 通常形如 "2024-01-02 00:00:00"，trade_date 形如 "2024-01-02"。
      // 用日期前 10 位作 key 兼容两种格式。
      bars.forEach((b, i) => idx.set(b.datetime.slice(0, 10), i));
      for (const p of rps) {
        const i = idx.get(p.trade_date.slice(0, 10));
        if (i == null) continue;
        // 三条线独立拆段，不互相干扰。
        ([
          [p.rps50, rps50Base, rps50Hot],
          [p.rps120, rps120Base, rps120Hot],
          [p.rps250, rps250Base, rps250Hot],
        ] as const).forEach(([v, base, hot]) => {
          if (v >= RPS_HOT_LINE) hot[i] = v;
          else base[i] = v;
        });
        // 短周期 RPS 用于公式计算（小黄人 / 蓝钻等），不画到副图上。
        rps5Aligned[i] = p.rps5 ?? null;
        rps10Aligned[i] = p.rps10 ?? null;
        rps15Aligned[i] = p.rps15 ?? null;
        rps20Aligned[i] = p.rps20 ?? null;
      }
      // 如果所有点都对齐不上，就不画 RPS 副图。
      const anyHit =
        rps50Base.some((v) => v != null) || rps50Hot.some((v) => v != null) ||
        rps120Base.some((v) => v != null) || rps120Hot.some((v) => v != null) ||
        rps250Base.some((v) => v != null) || rps250Hot.some((v) => v != null);
      if (!anyHit) showRps = false;
    }

    // ── 通达信公式信号：所有频率都算 ──
    // 金手指（DMI.PDI<7）原本要求 PERIOD=7 周线，但用户确认日线和周线都画；
    // 顺向火车轨/蓝钻/月线反转三套公式逻辑本身是日线量级的，在周线上重新跑一遍
    // 也会得到合理解读（语义上等同于"周线视角下这套公式是否触发"）。
    // 因此这里把判断频率的开关下放到调用方（mainChart 的 markPoint），
    // 当前实现下金手指也保留触发，便于用户在任何周期下都能看到所有 5 类信号。
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

    // 三段式 grid：主图 / 成交量 / RPS（如果没有 RPS 历史就只显示前两段）
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
        itemStyle: { color: RED, color0: GREEN, borderColor: RED, borderColor0: GREEN },
        // 通达信公式信号：5 类标记（金手指/顺向火车轨/蓝钻/月线反转/小黄人），
        // 所有频率下都画。每类公式独立 markPoint，用 Unicode 符号代替通达信原图标位图，
        // 触发当日画在 K 线最低价下方。用户选「日/周都触发」后金手指在两个 tab 都可见。
        markPoint: {
          symbol: "pin", symbolSize: 26,
          data: [
            ...(series.signals?.jsz || []).flatMap((on, i) => on ? [{ name: SIGNAL_LABEL.jsz,
              coord: [series.dates[i], series.ohlc[i][2]], // low
              symbol: SIGNAL_GLYPHS.jsz, symbolOffset: [0, -10],
              itemStyle: { color: SIGNAL_COLORS.jsz },
              label: { show: false } }] : []),
            ...(series.signals?.sxhcg || []).flatMap((on, i) => on ? [{ name: SIGNAL_LABEL.sxhcg,
              coord: [series.dates[i], series.ohlc[i][2]], // low
              symbol: SIGNAL_GLYPHS.sxhcg, symbolOffset: [0, -24],
              itemStyle: { color: SIGNAL_COLORS.sxhcg },
              label: { show: false } }] : []),
            ...(series.signals?.zcdx || []).flatMap((on, i) => on ? [{ name: SIGNAL_LABEL.zcdx,
              coord: [series.dates[i], series.ohlc[i][2]],
              symbol: SIGNAL_GLYPHS.zcdx, symbolOffset: [0, -38],
              itemStyle: { color: SIGNAL_COLORS.zcdx },
              label: { show: false } }] : []),
            ...(series.signals?.yxfz || []).flatMap((on, i) => on ? [{ name: SIGNAL_LABEL.yxfz,
              coord: [series.dates[i], series.ohlc[i][2]],
              symbol: SIGNAL_GLYPHS.yxfz, symbolOffset: [0, -52],
              itemStyle: { color: SIGNAL_COLORS.yxfz },
              label: { show: false } }] : []),
            ...(series.signals?.xhr || []).flatMap((on, i) => on ? [{ name: SIGNAL_LABEL.xhr,
              coord: [series.dates[i], series.ohlc[i][2]],
              symbol: SIGNAL_GLYPHS.xhr, symbolOffset: [0, -66],
              itemStyle: { color: SIGNAL_COLORS.xhr },
              label: { show: false } }] : []),
          ],
        },
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
      // 通达信写法：RPSx 用原色，IF(RPSx>=90, RPSx, DRAWNULL) 整段叠红色。
      // 实现：每条线拆成两条 series 共享同一个 name（legend 自动合并），base 用线本色，
      // hot 在 ≥90 处填值、其他位置 null，z 抬高避免被 base 压住。
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
          // 同名系列第二条：图例自动合并为一项，只在 ≥90 的位置可见。
          { name: `${name} ≥ ${RPS_HOT_LINE}`, type: "line", data: hot, xAxisIndex: 2, yAxisIndex: 2,
            smooth: true, showSymbol: false, connectNulls: false,
            lineStyle: { width: 1.8, color: RPS_COLOR.hot }, z: 5,
            legendHoverLink: false },
        );
      }
      // 只把 3 条主名推入图例，"≥90" 子层不占位（同名合并后自动隐藏第二条的图例项）。
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
        // 自定义 tooltip：默认会列出 RPS base/hot 6 条子 series，过于杂乱。
        // 这里手动挑选需要展示的项 + 直接从 series 读 RPS 值拼成一行。
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return "";
          const idx = params[0].dataIndex as number;
          const date = series.dates[idx] ?? "";
          const lines: string[] = [`<div style="font-weight:600;margin-bottom:4px">${date}</div>`];
          // K 线 OHLC
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
          // 成交量
          const vol = params.find((p: any) => p.seriesName === "成交量");
          if (vol && typeof vol.data === "number") {
            lines.push(`<div style="color:#94a3b8">成交量 <span style="color:#e2e8f0">${fmtVol(vol.data)}</span></div>`);
          }
          // MA
          const maLines: string[] = [];
          for (const ma of ["MA5", "MA10", "MA20", "MA60"] as const) {
            const p = params.find((x: any) => x.seriesName === ma);
            const v = p && typeof p.data === "number" ? p.data : null;
            if (v != null) maLines.push(`${ma} <span style="color:#e2e8f0">${v.toFixed(2)}</span>`);
          }
          if (maLines.length) lines.push(`<div style="color:#94a3b8">${maLines.join(" · ")}</div>`);
          // RPS 三条：直接读 base/hot 数组，没匹配上（!= null）就用 —
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

  const last = bars && bars.length ? bars[bars.length - 1] : null;
  const prev = bars && bars.length > 1 ? bars[bars.length - 2] : null;
  const changePct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : null;
  const up = (changePct ?? 0) >= 0;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-black/20 px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 返回
        </button>
        <Link to={`/stock-data?code=${code}`} className="text-xs text-muted-foreground hover:text-primary">
          跳到个股详情页 →
        </Link>
      </div>

      <PageHeader
        title={name ? `${name} (${code})` : code}
        subtitle="日 / 周 / 月 / 60 分钟 K 线 · 主图叠加 MA5/10/20/60 · 副图成交量"
      />

      {/* 顶部摘要：当前价 + 涨跌 + 频率切换 */}
      <GlassCard className="mb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-baseline gap-4">
            {last ? (
              <>
                <span className={cn("font-mono text-2xl font-bold", up ? "text-danger" : "text-success")}>
                  {last.close.toFixed(2)}
                </span>
                <span className={cn("font-mono text-sm", up ? "text-danger" : "text-success")}>
                  {changePct == null ? "—" : `${up ? "+" : ""}${changePct.toFixed(2)}%`}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  最高 {last.high.toFixed(2)} · 最低 {last.low.toFixed(2)} · 量 {fmtVol(last.vol)}
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">{loading ? "加载中…" : "—"}</span>
            )}
          </div>
          <div className="flex rounded-lg bg-black/20 p-1 text-xs">
            {FREQ_OPTIONS.map((o) => (
              <button key={o.value}
                onClick={() => setFreq(o.value)}
                className={cn("rounded-md px-3 py-1.5 transition-colors",
                  freq === o.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>

      {/* K 线图本体 */}
      <GlassCard className="relative">
        {error && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}
        <div ref={domRef} className="h-[640px] w-full" />
        {loading && !bars && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 拉取 K 线…
          </div>
        )}
        {!loading && bars && bars.length === 0 && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            该品种暂无 K 线数据
          </div>
        )}
      </GlassCard>
    </div>
  );
}
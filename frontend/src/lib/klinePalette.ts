// 共享给 K 线视图（KlineCard、StockKline）的视觉常量。
// 抽出来避免两边组件重复维护，配色 / 信号字符变时只改一处。

export const KLINE_RED = "#ef4444";
export const KLINE_GREEN = "#22c55e";
export const KLINE_MA_COLOR = ["#fbbf24", "#60a5fa", "#a78bfa", "#34d399"]; // MA5 / MA10 / MA20 / MA60
// RPS 配色：与通达信公式中的习惯保持一致——RPS120 绿、RPS250 白、RPS50 黄；
// 红线是强弱势分界（M=90），超过 90 时用红色高亮，便于一眼看到强势区。
export const KLINE_RPS_COLOR = {
  rps50: "#facc15",   // 黄
  rps120: "#22c55e",  // 绿
  rps250: "#e2e8f0",  // 白
  hot: "#ef4444",     // 红：>= 90 时整条线变红
};
export const KLINE_RPS_HOT_LINE = 90;

export const KLINE_FREQ = [
  { value: 4,  label: "日K",   offset: 240 },
  { value: 5,  label: "周K",   offset: 240 },
  { value: 6,  label: "月K",   offset: 120 },
  { value: 11, label: "60分",  offset: 240 },
] as const;
export type KlineFrequency = typeof KLINE_FREQ[number]["value"];

// 通达信图标 → 前端 ECharts 标记。ECharts markPoint 用图片或符号字符；通达信图标位图
// 没有现成资源，用相近含义的 Unicode 字符代替，并在图例里标注。
export const KLINE_SIGNAL_GLYPHS = {
  jsz:   "★",  // 金手指（图标11）
  sxhcg: "▲",  // 顺向火车轨（图标13）
  zcdx:  "◆",  // 蓝钻（图标24）
  yxfz:  "☺",  // 月线反转（图标34）
  xhr:   "▼",  // 小黄人（图标15）
};
export const KLINE_SIGNAL_COLORS = {
  jsz:   "#fb7185",  // 玫红（图标 11 通达信原色相近）
  sxhcg: "#60a5fa",
  zcdx:  "#a78bfa",
  yxfz:  "#facc15",
  xhr:   "#facc15",
};
export const KLINE_SIGNAL_LABEL = {
  jsz:   "金手指",
  sxhcg: "顺向火车轨",
  zcdx:  "蓝钻左侧低吸",
  yxfz:  "月线反转",
  xhr:   "小黄人",
};

export function klineFormatVol(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return v.toFixed(0);
}

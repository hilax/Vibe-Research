// 共享给 K 线视图（KlineCard、StockKline）的视觉常量。
// 抽出来避免两边组件重复维护，配色 / 信号字符变时只改一处。

export const KLINE_RED = "#ef4444";
export const KLINE_GREEN = "#22c55e";
export const KLINE_SUBTLE_UP = "#9b8c84";
export const KLINE_SUBTLE_DOWN = "#7f929d";

export function klineMarketColors(subtle: boolean) {
  return subtle
    ? { up: KLINE_SUBTLE_UP, down: KLINE_SUBTLE_DOWN }
    : { up: KLINE_RED, down: KLINE_GREEN };
}
export const KLINE_MA_COLOR = [
  "#fbbf24", "#60a5fa", "#a78bfa", "#34d399",
  "#f472b6", "#22d3ee", "#fb923c", "#e2e8f0",
];
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
  { value: 4, label: "日K" },
  { value: 5, label: "周K" },
  { value: 6, label: "月K" },
  // 通达信频率 3 才是 60 分钟；11 是年线。此前误用 11 会只返回每年一根。
  { value: 3, label: "60分" },
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

const svgSymbol = (svg: string) =>
  `image://data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

/**
 * 通达信 DRAWICON 的图标渲染。
 *
 * 通达信官方只公开 1–51 的编号约定，不分发终端内置位图资源。这里对本项目
 * 默认公式使用的 11/13/24/34 号按终端辨识特征绘制 SVG；其它合法编号用带
 * 编号的圆形兜底，保证用户粘贴任意 DRAWICON 后不会“公式触发但图标消失”。
 */
export function tdxDrawIconSymbol(icon: number): string {
  if (icon === 11) {
    return svgSymbol('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="m12 1.7 2.65 5.38 5.94.86-4.3 4.19 1.02 5.92L12 15.25l-5.31 2.8 1.02-5.92-4.3-4.19 5.94-.86Z" fill="#ff4f81" stroke="#7f123d" stroke-width="1.25"/><circle cx="12" cy="11" r="2.1" fill="#fff3a3"/></svg>');
  }
  if (icon === 13) {
    return svgSymbol('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 22 20H2Z" fill="#39a9ff" stroke="#075985" stroke-width="1.5"/><path d="M12 6.2 17 17H7Z" fill="#a9e6ff"/></svg>');
  }
  if (icon === 24) {
    return svgSymbol('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 1.7 22.3 12 12 22.3 1.7 12Z" fill="#38bdf8" stroke="#1d4ed8" stroke-width="1.5"/><path d="m12 4.5 4.2 7.5L12 19.5 7.8 12Z" fill="#d9f4ff" opacity=".9"/></svg>');
  }
  if (icon === 34) {
    return svgSymbol('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ffe535" stroke="#a16207" stroke-width="1.4"/><circle cx="8.4" cy="9.2" r="1.45" fill="#422006"/><circle cx="15.6" cy="9.2" r="1.45" fill="#422006"/><path d="M6.8 13.2c1.15 4.2 9.25 4.2 10.4 0" fill="none" stroke="#422006" stroke-width="1.7" stroke-linecap="round"/></svg>');
  }
  const label = Number.isInteger(icon) && icon >= 1 && icon <= 51 ? icon : "?";
  return svgSymbol(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#334155" stroke="#94a3b8" stroke-width="1.3"/><text x="12" y="15.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="700" fill="#f8fafc">${label}</text></svg>`);
}

export function tdxDrawIconLabel(icon: number): string {
  return ({ 11: "金手指", 13: "顺向火车轨", 24: "蓝钻左侧低吸", 34: "月线反转" } as Record<number, string>)[icon]
    || `通达信图标 ${icon}`;
}

export function klineFormatVol(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return v.toFixed(0);
}

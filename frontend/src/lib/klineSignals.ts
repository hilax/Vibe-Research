// 通达信主图公式的纯函数实现：复刻 4 套公式（金手指 / 顺向火车轨 3.0 / 蓝钻-左侧低吸 / 月线反转 6.5）。
// 这里只放公式与滑动窗口工具；ECharts 渲染由 KlineCard / StockKline 各自持有。
//
// 与原通达信公式 1:1 对应：换手率 VOL/CAPITAL 在此项目里没有流通股本接口，宽松用 vol/1e6 近似，
// 未来对接资金面接口替换即可。原版点位逻辑全部保留，禁止擅自放宽阈值。

import type { KlineBar } from "@/lib/api";

export function calcMA(closes: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += closes[j];
    out.push(s / n);
  }
  return out;
}

// 向后看 n 天内的最高/最低（i 本身包含在内）。n=0 时返回自身。
export function hhv(arr: number[], n: number, i: number): number | null {
  if (i < 0) return null;
  const end = n <= 0 ? i : Math.min(i, i); // n>0 时只看前 n 天 + 当天
  const start = n <= 0 ? i : Math.max(0, i - n + 1);
  let v = -Infinity;
  for (let k = start; k <= end; k++) {
    const x = arr[k];
    if (x == null || !Number.isFinite(x)) continue;
    if (x > v) v = x;
  }
  return v === -Infinity ? null : v;
}

export function llv(arr: number[], n: number, i: number): number | null {
  if (i < 0) return null;
  const start = n <= 0 ? i : Math.max(0, i - n + 1);
  let v = Infinity;
  for (let k = start; k <= i; k++) {
    const x = arr[k];
    if (x == null || !Number.isFinite(x)) continue;
    if (x < v) v = x;
  }
  return v === Infinity ? null : v;
}

// 过去 n 天（含今天）满足 cond 的次数。
export function countPast(cond: boolean[], n: number, i: number): number {
  const start = Math.max(0, i - n + 1);
  let c = 0;
  for (let k = start; k <= i; k++) if (cond[k]) c++;
  return c;
}

// 过去 n 天（含今天）全部满足 cond。
export function everyPast(cond: boolean[], n: number, i: number): boolean {
  const start = Math.max(0, i - n + 1);
  for (let k = start; k <= i; k++) if (!cond[k]) return false;
  return true;
}

// 从今天往前数 n 天内（含今天），首次满足 cond 的索引距今天数；n 天内都不满足返回 -1。
// 用于 BARSSINCEN(cond, n)=0 的等价物——"n 天内首次触发"的检测。
export function barsSince(cond: boolean[], n: number, i: number): number {
  const start = Math.max(0, i - n + 1);
  for (let k = start; k <= i; k++) {
    if (cond[k]) return i - k;
  }
  return -1;
}

// 通达信公式信号计算：逐日评估 5 套公式，返回每根 bar 上是否触发图标。
// 公式逻辑来自用户给的源码（金手指 DMI/PDI / 顺向火车轨 3.0 / 蓝钻-左侧低吸 / 月线反转 6.5 / 小黄人），
// 用纯函数实现，逻辑与通达信同源代码逐字对应。
export interface TdxSignals {
  // 金手指信号：图标 11（DMI.PDI<7）
  jsz: boolean[];
  // 顺向火车轨信号：图标 13（蓝色三角）
  sxhcg: boolean[];
  // 蓝钻信号：图标 24（钻石）
  zcdx: boolean[];
  // 月线反转信号：图标 34（黄笑脸）
  yxfz: boolean[];
  // 小黄人信号：图标 15（黄色三角）
  xhr: boolean[];
}

// 通达信 DMI/PDI 指标序列（计算依赖前一根 bar；周期 N=14，与通达信默认一致）。
export interface DmiPoint {
  pdi: number | null;  // PDI = DMP*100/TR（DMP > 0 时）
  mdi: number | null;  // MDI = DMM*100/TR（DMM > 0 时）
  adx: number | null;  // ADX = SMA(|(MDI-PDI)|/(MDI+PDI)*100)
}

// 通达信 DMI/PDI/MDI/ADX 计算（N=14）。
// DMI 体系在通达信中常被写作 DMI.PDI / DMI.MDI / DMI.ADX，
// 本函数返回每根 bar 上的对应数值，原版 PERIOD=7（周线）+ PDI<7 即金手指信号。
export function computeDmi(
  bars: KlineBar[],
  n: number = 14,
): DmiPoint[] {
  const len = bars.length;
  const out: DmiPoint[] = new Array(len);
  if (len === 0) return out;

  // 临时累积数组：每根 bar 的 TR / DMP / DMM 真实范围。
  const trArr: number[] = new Array(len).fill(0);
  const dmpArr: number[] = new Array(len).fill(0);
  const dmmArr: number[] = new Array(len).fill(0);

  for (let i = 0; i < len; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    if (i === 0) {
      // 第一个 bar 没有"昨日"，DMI 体系下用 0 兜底——通达信首根 bar 同样不计算。
      trArr[i] = 0;
      dmpArr[i] = 0;
      dmmArr[i] = 0;
    } else {
      const prevClose = bars[i - 1].close;
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      );
      const hd = high - bars[i - 1].high;
      const ld = bars[i - 1].low - low;
      trArr[i] = tr;
      dmpArr[i] = hd > 0 ? hd : 0;
      dmmArr[i] = ld > 0 ? ld : 0;
    }
  }

  // 通达信 SMA(C, N, M) = (M*C + (N-M)*REF(SMA,1)) / N；这里 M=1 → 简单累计 N 根后取均值。
  // 即：DMP_SMA(i) = sum(dmp[i-N+1..i]) / N（i < N-1 时取可用窗口）。
  const sma = (arr: number[], i: number): number => {
    const start = Math.max(0, i - n + 1);
    let s = 0, k = 0;
    for (let j = start; j <= i; j++) { s += arr[j]; k++; }
    return s / k;
  };

  // DX 序列：DX(k) = |PDI(k) - MDI(k)| / (PDI(k) + MDI(k)) * 100
  // 每根 bar 的 DX 都基于"截至当根"的 SMA 计算，独立成序列。
  const dxArr: number[] = new Array(len).fill(0);
  for (let i = 0; i < len; i++) {
    const trSum = sma(trArr, i);
    if (trSum <= 0) { dxArr[i] = 0; continue; }
    const p = (sma(dmpArr, i) * 100) / trSum;
    const m = (sma(dmmArr, i) * 100) / trSum;
    dxArr[i] = (p + m) > 0 ? (Math.abs(m - p) / (m + p)) * 100 : 0;
  }

  for (let i = 0; i < len; i++) {
    const trSum = sma(trArr, i);
    const pdi = trSum > 0 ? (sma(dmpArr, i) * 100) / trSum : 0;
    const mdi = trSum > 0 ? (sma(dmmArr, i) * 100) / trSum : 0;
    // ADX = SMA(DX, N, 1)，数据不足时返回 null。
    const adx = i >= n - 1 ? sma(dxArr, i) : null;
    out[i] = { pdi, mdi, adx };
  }
  return out;
}

// 输入的 RPS 序列：所有数组长度必须等于 bars 长度；未对齐位置传 null。
export interface RpsInput {
  rps5: (number | null)[];
  rps10: (number | null)[];
  rps15: (number | null)[];
  rps20: (number | null)[];
  rps50: (number | null)[];
  rps120: (number | null)[];
  rps250: (number | null)[];
}

export function computeSignals(bars: KlineBar[], rps: RpsInput): TdxSignals {
  const n = bars.length;
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const vols = bars.map((b) => b.vol);

  const ma10 = calcMA(closes, 10);
  const ma20 = calcMA(closes, 20);
  const ma50 = calcMA(closes, 50);
  const ma120 = calcMA(closes, 120);
  const ma200 = calcMA(closes, 200);
  const ma250 = calcMA(closes, 250);

  // 金手指：DMI 指标只依赖 K 线本身，5 套公式里唯一不依赖 RPS 的。
  const dmi = computeDmi(bars, 14);

  // 自由流通股本没有标准接口；VOL/CAPITAL 等价于换手率。这里粗略用 vol/流通股近似：
  // 实际上项目里没有流通股本数据，先用一个常量兜底（与公式目标"换手率<10%"宽松匹配），
  // 未来可对接资金面接口替换为真实换手率。
  const turnoverPct = closes.map((_, i) => Math.min(vols[i] / 1e6, 99));

  const gt = (a: number | null, b: number | null) => a != null && b != null && a > b;
  const ge = (a: number | null, b: number | null) => a != null && b != null && a >= b;

  const sxhcg: boolean[] = new Array(n).fill(false);
  const zcdx: boolean[] = new Array(n).fill(false);
  const yxfz: boolean[] = new Array(n).fill(false);
  const xhr: boolean[] = new Array(n).fill(false);
  const jsz: boolean[] = new Array(n).fill(false);

  for (let i = 0; i < n; i++) {
    const c = closes[i];

    // ─────── 顺向火车轨 3.0 ───────
    {
      const r120 = rps.rps120[i] ?? 0;
      const r250 = rps.rps250[i] ?? 0;
      const g1 = r120 + r250 > 185;
      const g20 = gt(c, ma20[i]);
      const g21 = countPast(closes.map((cc, k) => gt(cc, ma250[k])), 30, i) >= 25;
      const g22 = countPast(closes.map((cc, k) => gt(cc, ma200[k])), 30, i) >= 25;
      const g23 = countPast(closes.map((cc, k) => gt(cc, ma20[k])), 10, i) >= 9;
      const g24 =
        countPast(closes.map((cc, k) => gt(cc, ma10[k])), 4, i) >= 3 &&
        countPast(closes.map((cc, k) => gt(cc, ma20[k])), 4, i) >= 3;
      const g2 = g20 && g21 && g22 && (g23 || g24);

      // 新高/低/回撤（HHVBARS 等价：从今天往前数到上一个 20 日内最高的天数；新低同理）
      const hhvH = hhv(highs, 20, i) ?? highs[i];
      const nh = highs.indexOf(hhvH, Math.max(0, i - 19));
      const nhDays = nh >= 0 ? i - nh : 0;
      const llWithin = nhDays > 0 ? llv(lows, nhDays, i - 1) ?? lows[i] : lows[i];
      const dd = hhvH > 0 ? (hhvH - llWithin) / hhvH : 1;
      const g31 = dd <= 0.25 && countPast(new Array(n).fill(false).map((_, k) => {
        const kh = hhv(highs, 20, k) ?? highs[k];
        const knh = highs.indexOf(kh, Math.max(0, k - 19));
        const kDays = knh >= 0 ? k - knh : 0;
        const kll = kDays > 0 ? llv(lows, kDays, k - 1) ?? lows[k] : lows[k];
        const kd = kh > 0 ? (kh - kll) / kh : 1;
        return kd > 0.25;
      }), nhDays, i) === 0;
      const h250 = hhv(closes, 250, i) ?? closes[i];
      const g32 = h250 > 0 && c / h250 > 0.8;

      const g411 = i >= 5 && everyPast(new Array(n).fill(false).map((_, k) =>
        k > 0 && ma20[k] != null && ma20[k - 1] != null && ma20[k]! >= ma20[k - 1]!
      ), 5, i);
      const g412 = i >= 5 && everyPast(new Array(n).fill(false).map((_, k) =>
        ma10[k] != null && ma20[k] != null && ma10[k]! >= ma20[k]!
      ), 5, i);
      const g41 = g411 && g412;
      const g421 = i > 0 && ge(ma10[i], ma10[i - 1]);
      const g422 = i > 0 && ge(ma20[i], ma20[i - 1]);
      const g423 = ge(ma10[i], ma20[i]);
      const g42 = g421 && g422 && g423;
      const g4 = g41 || g42;
      const g5 = turnoverPct[i] < 10;

      const sxhcgNow = g1 && g2 && g31 && g32 && g4 && g5;
      // 8 日内首次触发 → BARSSINCEN(SXHCG,8)=0
      sxhcg[i] = sxhcgNow && barsSince(sxhcg.slice(0, i + 1), 8, i) === 0;
    }

    // ─────── 蓝钻-左侧低吸 ───────
    {
      const r50 = rps.rps50[i] ?? 0;
      const r20 = rps.rps20[i] ?? 0;
      const h250 = hhv(closes, 250, i) ?? closes[i];
      const hhvH = hhv(highs, 20, i) ?? highs[i];
      const nh = highs.indexOf(hhvH, Math.max(0, i - 19));
      const nhDays = nh >= 0 ? i - nh : 0;
      const llWithin = nhDays > 0 ? llv(lows, nhDays, i - 1) ?? lows[i] : lows[i];
      const dd = hhvH > 0 ? (hhvH - llWithin) / hhvH : 1;
      const d01 = dd <= 0.25;
      const d02 = h250 > 0 && c / h250 > 0.8;
      const d011 = r50 >= 98;
      const d012 = r20 >= 98;
      const d013 = r50 >= 97 && r20 + r50 >= 190;
      const d0rps = d011 || d012 || d013;
      const d02c = ma20[i] != null && c / ma20[i]! < 1.005;
      const d03 =
        countPast(closes.map((cc, k) => cc < (ma20[k] ?? Infinity)), 20, i) <= 2 &&
        countPast(closes.map((cc, k) => cc < (ma10[k] ?? Infinity)), 20, i) <= 8 &&
        (countPast(lows.map((ll, k) => ll < (ma20[k] ?? Infinity)), 20, i) <= 4 || r50 >= 99);
      const d04 = gt(ma50[i], ma120[i]) && gt(ma50[i], ma200[i]) && gt(ma50[i], ma250[i]);
      const d05 = turnoverPct[i] < 10;
      zcdx[i] = d01 && d02 && d0rps && d02c && d03 && d04 && d05;
    }

    // ─────── 月线反转 6.5 ───────
    {
      const r50 = rps.rps50[i] ?? 0;
      const r120 = rps.rps120[i] ?? 0;
      const f11 = r50 > 87 ? 1 : 0;
      const f12 = r120 > 90 ? 1 : 0;
      const f130 = r50 >= 90 || r120 >= 90;
      const f131 = c >= (hhv(closes, 70, i) ?? c);
      const f13 = f130 && f131;
      const f1 = f11 || f12;
      const l200 = llv(lows, 200, i) ?? lows[i];
      const l120 = llv(lows, 120, i) ?? lows[i];
      const l50 = llv(lows, 50, i) ?? lows[i];
      const l30 = llv(lows, 30, i) ?? lows[i];
      const l20 = llv(lows, 20, i) ?? lows[i];
      const f21 = l50 > l200 && f13;
      const f22 = l30 > l120 && f13;
      const f23 = l20 > l50;
      const f2 = f21 || f22 || f23;
      const f31 = countPast(new Array(n).fill(false).map((_, k) => highs[k] >= (hhv(highs, 80, k) ?? highs[k])), 10, i);
      const c50 = c >= (hhv(closes, 50, i) ?? c);
      const h50 = highs[i] >= (hhv(highs, 50, i) ?? highs[i]);
      const f32 = (c50 || h50) && f130;
      const f3 = f31 > 0 || f32;
      const f4 = gt(c, ma20[i]) && gt(c, ma200[i]) && (ma120[i] ?? 0) / (ma200[i] || 1) > 0.9;
      const gt200 = closes.map((cc, k) => gt(cc, ma200[k]));
      const gt250 = closes.map((cc, k) => gt(cc, ma250[k]));
      const aa200 = countPast(gt200, 45, i);
      const aa250 = countPast(gt250, 45, i);
      const lt200 = lows.map((ll, k) => ll < (ma200[k] ?? Infinity));
      const lt250 = lows.map((ll, k) => ll < (ma250[k] ?? Infinity));
      const laa200 = countPast(lt200, 45, i);
      const laa250 = countPast(lt250, 45, i);
      const f51 = aa200 >= 2 && aa200 < 45;
      const f52 = laa200 > 0 && aa200 > 2;
      const f53 = laa250 > 0 && aa250 > 2;
      const f5 = f51 || f52 || f53;

      const ma120Rise10 = i >= 10 && (ma120[i] ?? 0) >= (ma120[i - 10] ?? -Infinity);
      const ma200Rise10 = i >= 10 && (ma200[i] ?? 0) >= (ma200[i - 10] ?? -Infinity);
      const ma120Rise15 = i >= 15 && (ma120[i] ?? 0) >= (ma120[i - 15] ?? -Infinity);
      const ma200Rise15 = i >= 15 && (ma200[i] ?? 0) >= (ma200[i - 15] ?? -Infinity);
      const f601 = ma120Rise10 || ma200Rise10 || ma120Rise15 || ma200Rise15;
      const f602 = (ma120Rise10 && ma200Rise10) || (ma120Rise15 && ma200Rise15);
      const f603 = gt(ma120[i], ma200[i]) && f601;
      const h30 = hhv(highs, 30, i) ?? highs[i];
      const f61 = l120 > 0 && h30 / l120 < 1.50 && f601;
      const f62 = l120 > 0 && h30 / l120 < 1.55 && f602;
      const f63 = l120 > 0 && h30 / l120 < 1.65 && f603 && f13;
      const f6 = f61 || f62 || f63;
      const h120 = hhv(highs, 120, i) ?? highs[i];
      const f71 = h120 > 0 && h30 / h120 > 0.85;
      const f72 = h120 > 0 && h30 / h120 > 0.8 && f13;
      const h10 = hhv(highs, 10, i) ?? highs[i];
      const f73 = h10 > 0 && c / h10 > 0.9;
      const f7 = (f71 || f72) && f73;
      const yxfzNow = !!(f1 && f2 && f3 && f4 && f5 && f6 && f7);
      yxfz[i] = yxfzNow && barsSince(yxfz.slice(0, i + 1), 15, i) === 0;
    }

    // ─────── 小黄人（板块 RPS 三线翻红）───────
    {
      const r5 = rps.rps5[i] ?? 0;
      const r10 = rps.rps10[i] ?? 0;
      const r15 = rps.rps15[i] ?? 0;
      const r20 = rps.rps20[i] ?? 0;
      const combos = [
        r5 >= 90 && r10 >= 90 && r15 >= 90,
        r5 >= 90 && r10 >= 90 && r20 >= 90,
        r5 >= 90 && r15 >= 90 && r20 >= 90,
        r10 >= 90 && r15 >= 90 && r20 >= 90,
      ];
      const xhrNow = combos.some(Boolean);
      xhr[i] = xhrNow && barsSince(xhr.slice(0, i + 1), 20, i) === 0;
    }

    // ─────── 金手指（DMI.PDI < 7）───────
    // 通达信原版要求 PERIOD=7（周线）下 PDI<7 才画图标；
    // 当前 computeSignals 由 StockKline 在日 K 和周 K 都调用，
    // 只要调用方传周 K 数据进来、PDI<7 就会自然触发——无需在此函数内判断周期。
    {
      const pdi = dmi[i]?.pdi;
      jsz[i] = pdi != null && pdi < 7;
    }
  }

  return { jsz, sxhcg, zcdx, yxfz, xhr };
}

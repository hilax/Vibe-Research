import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "vr-market-palette";
const subscribers = new Set<(subtle: boolean) => void>();

function readSubtlePreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "subtle";
  } catch {
    return false;
  }
}

function applyMarketPalette(subtle: boolean) {
  document.documentElement.classList.toggle("market-subtle", subtle);
  try {
    localStorage.setItem(STORAGE_KEY, subtle ? "subtle" : "classic");
  } catch {
    // 隐私模式或禁用存储时仍保留当前会话的切换结果。
  }
}

export function useMarketPalette() {
  const [subtle, setSubtle] = useState(readSubtlePreference);

  useEffect(() => {
    subscribers.add(setSubtle);
    applyMarketPalette(subtle);
    return () => {
      subscribers.delete(setSubtle);
    };
  }, [subtle]);

  const toggle = useCallback(() => {
    const next = !subtle;
    applyMarketPalette(next);
    subscribers.forEach(update => update(next));
  }, [subtle]);

  return { subtle, toggle };
}

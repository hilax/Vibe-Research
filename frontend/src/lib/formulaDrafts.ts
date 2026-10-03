import type { TdxFormulaPreset } from "@/lib/api";

// 只替换完整匹配旧默认公式的草稿，保留用户编辑过的源码及自定义策略。
export async function initializeFormulaDrafts(
  saved: Record<string, string>,
  presets: TdxFormulaPreset[],
): Promise<Record<string, string>> {
  const next: Record<string, string> = {};
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    Object.entries(saved).forEach(([key, value]) => {
      if (typeof value === "string") next[key] = value;
    });
  }
  await Promise.all(presets.map(async (preset) => {
    const draft = next[preset.strategy];
    if (!draft?.trim()) {
      next[preset.strategy] = preset.default_source;
      return;
    }
    if (!preset.previous_default_hashes?.length) return;
    try {
      const normalized = draft.replace(/\r\n/g, "\n").trim() + "\n";
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (preset.previous_default_hashes.includes(hash)) {
        next[preset.strategy] = preset.default_source;
      }
    } catch {
      // 不支持 Web Crypto 时保留已有草稿，仍可使用编辑器的“恢复默认”。
    }
  }));
  return next;
}

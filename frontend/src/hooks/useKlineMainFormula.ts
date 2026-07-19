import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  type KlineBar,
  type KlineFormulaEvaluation,
  type KlineFormulaPreset,
  type RpsPoint,
  type TdxFormulaIssue,
} from "@/lib/api";

const STORAGE_KEY = "vibe-research-kline-main-formula-v1";

function loadSavedSource(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveSource(source: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, source);
  } catch {
    /* 隐私模式下仍可在当前页面使用，只是不持久化。 */
  }
}

function formulaError(error: unknown): { message: string; issues: TdxFormulaIssue[] } {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      issues: Array.isArray(error.details) ? error.details as TdxFormulaIssue[] : [],
    };
  }
  return { message: String(error), issues: [] };
}

export type FormulaRunStatus = "idle" | "loading" | "valid" | "invalid";

export function useKlineMainFormula(
  code: string,
  category: number,
  bars: KlineBar[] | null,
  rpsHistory: RpsPoint[],
) {
  const initialSource = useRef(loadSavedSource()).current;
  const [preset, setPreset] = useState<KlineFormulaPreset | null>(null);
  const [draftSource, setDraftSource] = useState(initialSource);
  const [appliedSource, setAppliedSource] = useState(initialSource);
  const [evaluation, setEvaluation] = useState<KlineFormulaEvaluation | null>(null);
  const [status, setStatus] = useState<FormulaRunStatus>("idle");
  const [message, setMessage] = useState<string>("");
  const [issues, setIssues] = useState<TdxFormulaIssue[]>([]);
  const skipNextAutomaticRun = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api.klineFormulaPreset()
      .then((nextPreset) => {
        if (cancelled) return;
        setPreset(nextPreset);
        if (!initialSource) {
          setDraftSource(nextPreset.default_source);
          setAppliedSource(nextPreset.default_source);
        }
      })
      .catch((error) => {
        if (!cancelled) setMessage(formulaError(error).message);
      });
    return () => { cancelled = true; };
  }, [initialSource]);

  useEffect(() => {
    if (skipNextAutomaticRun.current) {
      skipNextAutomaticRun.current = false;
      return;
    }
    if (!code || !bars?.length || !appliedSource.trim()) return;
    const controller = new AbortController();
    setStatus("loading");
    setMessage("正在按完整 K 线历史计算主图公式…");
    setIssues([]);
    setEvaluation(null);
    api.evaluateKlineFormula(
      code, category, appliedSource, bars, rpsHistory, controller.signal,
    ).then((result) => {
      setEvaluation(result);
      setStatus("valid");
      setMessage(`公式已绘制：${result.lines.length} 条输出线，${result.icons.reduce((sum, layer) => sum + layer.points.length, 0)} 个图标`);
    }).catch((error) => {
      if ((error as any)?.name === "AbortError") return;
      const detail = formulaError(error);
      setStatus("invalid");
      setMessage(detail.message);
      setIssues(detail.issues);
    });
    return () => controller.abort();
  }, [appliedSource, bars, category, code, rpsHistory]);

  const applySource = useCallback(async (source: string) => {
    if (!code || !bars?.length || !source.trim()) return false;
    setStatus("loading");
    setMessage("正在校验并绘制公式…");
    setIssues([]);
    try {
      const result = await api.evaluateKlineFormula(code, category, source, bars, rpsHistory);
      skipNextAutomaticRun.current = source !== appliedSource;
      setAppliedSource(source);
      setDraftSource(source);
      setEvaluation(result);
      saveSource(source);
      setStatus("valid");
      setMessage(`公式已保存并绘制：${result.lines.length} 条输出线，${result.icons.reduce((sum, layer) => sum + layer.points.length, 0)} 个图标`);
      return true;
    } catch (error) {
      const detail = formulaError(error);
      setStatus("invalid");
      setMessage(detail.message);
      setIssues(detail.issues);
      return false;
    }
  }, [appliedSource, bars, category, code, rpsHistory]);

  const apply = useCallback(() => applySource(draftSource), [applySource, draftSource]);
  const reset = useCallback(() => {
    if (!preset) return Promise.resolve(false);
    setDraftSource(preset.default_source);
    return applySource(preset.default_source);
  }, [applySource, preset]);

  return {
    preset,
    draftSource,
    appliedSource,
    evaluation,
    status,
    message,
    issues,
    isDirty: draftSource !== appliedSource,
    setDraftSource,
    apply,
    reset,
  };
}

export type KlineMainFormulaState = ReturnType<typeof useKlineMainFormula>;

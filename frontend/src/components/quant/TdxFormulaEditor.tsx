import { useRef, type KeyboardEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Code2,
  LoaderCircle,
  RotateCcw,
  ScanSearch,
} from "lucide-react";

export type TdxFormulaValidationStatus = "idle" | "validating" | "valid" | "invalid";

export interface TdxFormulaIssue {
  message: string;
  line?: number | null;
  column?: number | null;
  code?: string | null;
  severity?: "error" | "warning";
}

export interface TdxFormulaValidationState {
  status: TdxFormulaValidationStatus;
  issues?: TdxFormulaIssue[];
  message?: string | null;
}

export interface TdxFormulaEditorProps {
  source: string;
  defaultSource: string;
  strategyLabel: string;
  validation: TdxFormulaValidationState;
  disabled?: boolean;
  onSourceChange: (source: string) => void;
  onValidate: () => void | Promise<void>;
  onReset: () => void;
}

const SUPPORTED_FUNCTIONS = [
  "MA",
  "HHV",
  "LLV",
  "REF",
  "COUNT",
  "EVERY",
  "IF",
  "HHVBARS",
  "LLVBARS",
  "BARSSINCEN",
  "EXTDATA_USER",
  "FINANCE",
  "CODELIKE",
  "DRAWICON",
] as const;

function issueLocation(issue: TdxFormulaIssue): string | null {
  const parts: string[] = [];
  if (typeof issue.line === "number") parts.push(`第 ${issue.line} 行`);
  if (typeof issue.column === "number") parts.push(`第 ${issue.column} 列`);
  return parts.length > 0 ? parts.join("，") : null;
}

export function TdxFormulaEditor({
  source,
  defaultSource,
  strategyLabel,
  validation,
  disabled = false,
  onSourceChange,
  onValidate,
  onReset,
}: TdxFormulaEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isDirty = source.trim() !== defaultSource.trim();
  const issues = validation.issues ?? [];
  const isValidating = validation.status === "validating";
  const lineCount = source.length === 0 ? 1 : source.split(/\r?\n/).length;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || disabled) return;
    event.preventDefault();

    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const nextSource = `${source.slice(0, start)}\t${source.slice(end)}`;
    onSourceChange(nextSource);

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.selectionStart = start + 1;
      textarea.selectionEnd = start + 1;
      textarea.focus();
    });
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-black/15">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Code2 className="h-4 w-4 shrink-0 text-primary" />
            <h3 className="truncate text-sm font-semibold">{strategyLabel} · 公式源码</h3>
            <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              通达信兼容语法
            </span>
            {isDirty && (
              <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                已修改
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            可直接粘贴通达信选股公式；按 Tab 插入缩进，运行前建议先校验。
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            disabled={disabled || !isDirty}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-black/15 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认
          </button>
          <button
            type="button"
            onClick={onValidate}
            disabled={disabled || isValidating || source.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isValidating ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ScanSearch className="h-3.5 w-3.5" />
            )}
            {isValidating ? "正在校验…" : "校验公式"}
          </button>
        </div>
      </div>

      <div className="relative">
        <textarea
          ref={textareaRef}
          data-testid="tdx-formula-source"
          aria-label={`${strategyLabel}通达信公式源码`}
          value={source}
          rows={16}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          disabled={disabled}
          onChange={(event) => onSourceChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="请粘贴通达信条件选股公式，例如：&#10;XG:=C&gt;MA(C,20) AND C&gt;MA(C,200);&#10;XG;"
          className="block min-h-[24rem] w-full resize-y bg-[#080b10]/80 px-4 py-4 font-mono text-[13px] leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus:bg-[#080b10] disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {lineCount} 行 · {source.length} 字符
        </div>
      </div>

      {(validation.status !== "idle" || issues.length > 0) && (
        <div className="border-t border-border/60 px-4 py-3">
          <div
            className={
              validation.status === "invalid"
                ? "flex items-center gap-2 text-xs font-medium text-destructive"
                : validation.status === "valid"
                  ? "flex items-center gap-2 text-xs font-medium text-emerald-400"
                  : "flex items-center gap-2 text-xs font-medium text-muted-foreground"
            }
          >
            {validation.status === "validating" && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {validation.status === "valid" && <CheckCircle2 className="h-4 w-4" />}
            {validation.status === "invalid" && <AlertCircle className="h-4 w-4" />}
            <span>
              {validation.message
                || (validation.status === "validating"
                  ? "正在检查变量、函数和表达式…"
                  : validation.status === "valid"
                    ? "公式校验通过，可以开始选股。"
                    : "公式存在问题，请根据下方提示修改。")}
            </span>
          </div>

          {issues.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {issues.map((issue, index) => {
                const severity = issue.severity ?? "error";
                const location = issueLocation(issue);
                return (
                  <li
                    key={`${issue.code ?? "issue"}-${issue.line ?? 0}-${issue.column ?? 0}-${index}`}
                    className={
                      severity === "warning"
                        ? "flex gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning"
                        : "flex gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                    }
                  >
                    {severity === "warning" ? (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>
                      {location && <span className="mr-1.5 font-mono font-semibold">{location}</span>}
                      {issue.code && <span className="mr-1.5 font-mono opacity-75">[{issue.code}]</span>}
                      {issue.message}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="border-t border-border/60 bg-black/10 px-4 py-3">
        <p className="text-[11px] leading-5 text-muted-foreground">
          <span className="font-medium text-foreground/80">常用支持函数：</span>{" "}
          <span className="font-mono">{SUPPORTED_FUNCTIONS.join(" · ")}</span>
          <span className="ml-2">以及 AND、OR、NOT 等逻辑运算；具体以校验结果为准。</span>
        </p>
      </div>
    </section>
  );
}

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Loader2,
  Play,
  RotateCcw,
} from "lucide-react";
import type { KlineMainFormulaState } from "@/hooks/useKlineMainFormula";

function issueLocation(line?: number | null, column?: number | null): string {
  if (!line) return "";
  return column ? `第 ${line} 行，第 ${column} 列：` : `第 ${line} 行：`;
}

export function KlineFormulaEditor({ formula }: { formula: KlineMainFormulaState }) {
  const [open, setOpen] = useState(false);
  const busy = formula.status === "loading";

  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-black/15">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.025]"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Code2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">可编辑主图公式</span>
          <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
            通达信语法
          </span>
          {formula.isDirty && (
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
              未应用
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          {formula.status === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {formula.status === "valid" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          {formula.status === "invalid" && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
          <span className="hidden sm:inline">{formula.message || "点击展开并编辑"}</span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
            <p className="text-[11px] leading-5 text-muted-foreground">
              使用 <span className="font-mono text-foreground/80">名称:表达式;</span> 绘制主图线，
              <span className="font-mono text-foreground/80">名称:=表达式;</span> 只定义变量；
              <span className="font-mono text-foreground/80">DRAWICON(条件,价格,1~51)</span> 绘制信号。
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void formula.reset()}
                disabled={busy || !formula.preset}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" /> 恢复默认
              </button>
              <button
                type="button"
                onClick={() => void formula.apply()}
                disabled={busy || !formula.draftSource.trim() || (!formula.isDirty && formula.status === "valid")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                应用并保存
              </button>
            </div>
          </div>
          <textarea
            data-testid="kline-main-formula-source"
            aria-label="K线主图通达信公式源码"
            value={formula.draftSource}
            onChange={(event) => formula.setDraftSource(event.target.value)}
            rows={18}
            spellCheck={false}
            className="block min-h-[28rem] w-full resize-y bg-[#080b10]/85 px-4 py-4 font-mono text-[12px] leading-5 text-foreground outline-none focus:bg-[#080b10]"
          />
          {(formula.message || formula.issues.length > 0) && (
            <div className={`border-t px-4 py-3 text-xs ${formula.status === "invalid" ? "border-destructive/30 text-destructive" : "border-border/50 text-muted-foreground"}`}>
              <p>{formula.message}</p>
              {formula.issues.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {formula.issues.map((issue, index) => (
                    <li key={`${issue.code || "issue"}-${index}`}>
                      {issueLocation(issue.line, issue.column)}{issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

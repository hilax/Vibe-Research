"""浏览器默认公式升级只迁移未编辑草稿，不接触用户自定义源码。"""

from pathlib import Path
import shutil
import subprocess

import pytest


def test_default_formula_upgrade_preserves_custom_drafts():
    frontend = Path(__file__).resolve().parents[2] / "frontend"
    compiler = frontend / "node_modules/typescript/lib/typescript.js"
    node = shutil.which("node")
    if node is None or not compiler.is_file():
        pytest.skip("浏览器草稿回归需要前端开发依赖和 Node.js")

    script = r"""
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require(process.argv[2]);
const compiled = ts.transpileModule(readFileSync(process.argv[1], "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { initializeFormulaDrafts } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
const oldSource = "{旧默认}\nXG:C>10;\n";
const oldHash = Buffer.from(await webcrypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(oldSource),
)).toString("hex");
const preset = {
  strategy: "monthly_reversal_62", default_source: "XG:C>12;",
  previous_default_hashes: [oldHash],
};

const saved = {
  monthly_reversal_62: "  {旧默认}\r\nXG:C>10;\r\n  ",
  custom_strategy: "自定义:C>8;",
};
const upgraded = await initializeFormulaDrafts(saved, [preset]);
assert.equal(upgraded.monthly_reversal_62, preset.default_source);
assert.equal(upgraded.custom_strategy, saved.custom_strategy);
assert.equal(saved.monthly_reversal_62.includes("C>10"), true);

const edited = { monthly_reversal_62: "{旧默认}\nXG:C>11;\n" };
assert.deepEqual(await initializeFormulaDrafts(edited, [preset]), edited);
assert.equal((await initializeFormulaDrafts({}, [preset])).monthly_reversal_62, preset.default_source);
assert.equal((await initializeFormulaDrafts({monthly_reversal_62: 42}, [preset])).monthly_reversal_62, preset.default_source);
assert.equal((await initializeFormulaDrafts([], [preset])).monthly_reversal_62, preset.default_source);
assert.deepEqual(await initializeFormulaDrafts(edited, [{...preset, previous_default_hashes: []}]), edited);

Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
assert.deepEqual(await initializeFormulaDrafts(saved, [preset]), saved);
"""
    result = subprocess.run(
        [node, "--input-type=module", "-e", script,
         str(frontend / "src/lib/formulaDrafts.ts"), str(compiler)],
        capture_output=True, text=True, timeout=20,
    )
    assert result.returncode == 0, result.stderr

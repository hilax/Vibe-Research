import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = new URL(
  "../../src/data/research/certainty.ts",
  import.meta.url,
);
const source = await readFile(moduleUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: moduleUrl.pathname,
});
const certainty = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
);

const { scoreCertainty } = certainty;

function scores(demand, technology, validation, delivery, financial) {
  return { demand, technology, validation, delivery, financial };
}

test("green requires every dimension >= 4, total >= 22, and an A-C source", () => {
  const result = scoreCertainty({
    scores: scores(4, 4, 4, 5, 5),
    sourceGrades: ["B", "D"],
  });

  assert.equal(result.level, "green");
  assert.equal(result.total, 22);
  assert.equal(result.minimum, 4);
  assert.equal(result.reason, "green-threshold");
});

test("a dimension below 4 prevents green even when the total is high", () => {
  const result = scoreCertainty({
    scores: scores(3, 5, 5, 5, 5),
    sourceGrades: ["A"],
  });

  assert.equal(result.level, "yellow");
  assert.equal(result.total, 23);
  assert.equal(result.reason, "yellow-threshold");
});

test("yellow requires every dimension >= 2 and total >= 14", () => {
  const exactThreshold = scoreCertainty({
    scores: scores(2, 2, 2, 4, 4),
    sourceGrades: ["A"],
  });
  const lowDimension = scoreCertainty({
    scores: scores(1, 3, 3, 3, 4),
    sourceGrades: ["A"],
  });
  const lowTotal = scoreCertainty({
    scores: scores(2, 2, 2, 2, 2),
    sourceGrades: ["A"],
  });

  assert.equal(exactThreshold.level, "yellow");
  assert.equal(exactThreshold.total, 14);
  assert.equal(lowDimension.level, "red");
  assert.equal(lowTotal.level, "red");
});

test("any fatal shortfall forces red", () => {
  const result = scoreCertainty({
    scores: scores(5, 5, 5, 5, 5),
    sourceGrades: ["A"],
    fatalShortfall: ["", "production validation failed"],
  });

  assert.equal(result.level, "red");
  assert.equal(result.hasFatalShortfall, true);
  assert.equal(result.reason, "fatal-shortfall");
});

test("D/E-only or missing sources cannot independently support green", () => {
  const lowGradeOnly = scoreCertainty({
    scores: scores(5, 5, 5, 5, 5),
    sourceGrades: ["D", "E"],
  });
  const noSources = scoreCertainty({
    scores: scores(5, 5, 5, 5, 5),
  });
  const gradeC = scoreCertainty({
    scores: scores(5, 5, 5, 5, 5),
    sourceGrades: ["C", "E"],
  });

  assert.equal(lowGradeOnly.level, "yellow");
  assert.equal(lowGradeOnly.blockedFromGreenBySources, true);
  assert.equal(lowGradeOnly.reason, "source-grade-block");
  assert.equal(noSources.level, "yellow");
  assert.equal(noSources.blockedFromGreenBySources, true);
  assert.equal(gradeC.level, "green");
});

test("invalid scores fail fast", () => {
  assert.throws(
    () =>
      scoreCertainty({
        scores: scores(6, 4, 4, 4, 4),
        sourceGrades: ["A"],
      }),
    RangeError,
  );
  assert.throws(
    () =>
      scoreCertainty({
        scores: scores(Number.NaN, 4, 4, 4, 4),
        sourceGrades: ["A"],
      }),
    RangeError,
  );
});

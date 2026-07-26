export const CERTAINTY_DIMENSIONS = [
  "demand",
  "technology",
  "validation",
  "delivery",
  "financial",
] as const;

export type CertaintyDimension = (typeof CERTAINTY_DIMENSIONS)[number];
export type CertaintyScores = Record<CertaintyDimension, number>;
export type CertaintyLevel = "green" | "yellow" | "red";
export type CertaintyEvidenceGrade = "A" | "B" | "C" | "D" | "E";
export type FatalShortfall =
  | boolean
  | string
  | readonly string[]
  | null
  | undefined;

export const CERTAINTY_THRESHOLDS = {
  green: {
    minimumPerDimension: 4,
    minimumTotal: 22,
  },
  yellow: {
    minimumPerDimension: 2,
    minimumTotal: 14,
  },
} as const;

export interface CertaintyInput {
  scores: CertaintyScores;
  sourceGrades?: readonly CertaintyEvidenceGrade[];
  fatalShortfall?: FatalShortfall;
}

export type CertaintyReason =
  | "fatal-shortfall"
  | "green-threshold"
  | "source-grade-block"
  | "yellow-threshold"
  | "below-yellow-threshold";

export interface CertaintyResult {
  level: CertaintyLevel;
  total: number;
  minimum: number;
  hasFatalShortfall: boolean;
  hasGreenEligibleSource: boolean;
  blockedFromGreenBySources: boolean;
  reason: CertaintyReason;
}

const VALID_SOURCE_GRADES = new Set<CertaintyEvidenceGrade>([
  "A",
  "B",
  "C",
  "D",
  "E",
]);

function validateScores(scores: CertaintyScores): void {
  for (const dimension of CERTAINTY_DIMENSIONS) {
    const score = scores[dimension];
    if (!Number.isFinite(score) || score < 0 || score > 5) {
      throw new RangeError(
        `certainty score "${dimension}" must be a finite number from 0 to 5`,
      );
    }
  }
}

function validateSourceGrades(
  sourceGrades: readonly CertaintyEvidenceGrade[],
): void {
  for (const grade of sourceGrades) {
    if (!VALID_SOURCE_GRADES.has(grade)) {
      throw new TypeError(`unknown certainty evidence grade "${grade}"`);
    }
  }
}

function containsFatalShortfall(fatalShortfall: FatalShortfall): boolean {
  if (typeof fatalShortfall === "boolean") {
    return fatalShortfall;
  }
  if (typeof fatalShortfall === "string") {
    return fatalShortfall.trim().length > 0;
  }
  if (Array.isArray(fatalShortfall)) {
    return fatalShortfall.some((item) => item.trim().length > 0);
  }
  return false;
}

/**
 * Scores evidence maturity only. It does not express an investment rating.
 *
 * Green additionally requires at least one A/B/C source. An empty source list
 * or evidence supported exclusively by D/E sources can score at most yellow.
 */
export function scoreCertainty(input: CertaintyInput): CertaintyResult {
  const sourceGrades = input.sourceGrades ?? [];
  validateScores(input.scores);
  validateSourceGrades(sourceGrades);

  const dimensionScores = CERTAINTY_DIMENSIONS.map(
    (dimension) => input.scores[dimension],
  );
  const total = dimensionScores.reduce((sum, score) => sum + score, 0);
  const minimum = Math.min(...dimensionScores);
  const hasFatalShortfall = containsFatalShortfall(input.fatalShortfall);
  const hasGreenEligibleSource = sourceGrades.some(
    (grade) => grade === "A" || grade === "B" || grade === "C",
  );
  const meetsGreenScore =
    minimum >= CERTAINTY_THRESHOLDS.green.minimumPerDimension &&
    total >= CERTAINTY_THRESHOLDS.green.minimumTotal;
  const meetsYellowScore =
    minimum >= CERTAINTY_THRESHOLDS.yellow.minimumPerDimension &&
    total >= CERTAINTY_THRESHOLDS.yellow.minimumTotal;
  const blockedFromGreenBySources =
    meetsGreenScore && !hasGreenEligibleSource;

  if (hasFatalShortfall) {
    return {
      level: "red",
      total,
      minimum,
      hasFatalShortfall,
      hasGreenEligibleSource,
      blockedFromGreenBySources,
      reason: "fatal-shortfall",
    };
  }

  if (meetsGreenScore && hasGreenEligibleSource) {
    return {
      level: "green",
      total,
      minimum,
      hasFatalShortfall,
      hasGreenEligibleSource,
      blockedFromGreenBySources,
      reason: "green-threshold",
    };
  }

  if (meetsYellowScore) {
    return {
      level: "yellow",
      total,
      minimum,
      hasFatalShortfall,
      hasGreenEligibleSource,
      blockedFromGreenBySources,
      reason: blockedFromGreenBySources
        ? "source-grade-block"
        : "yellow-threshold",
    };
  }

  return {
    level: "red",
    total,
    minimum,
    hasFatalShortfall,
    hasGreenEligibleSource,
    blockedFromGreenBySources,
    reason: "below-yellow-threshold",
  };
}

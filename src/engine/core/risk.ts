import type { CauseOfDeath, RiskBreakdown, VitalSigns } from "../types";

/**
 * Risk scorer (Requirement 8). Pure: no clock, env or random.
 *
 * Every contribution is a non-negative integer. The vulnerability term depends
 * only on the open vulnerabilities, the cause terms only on the causes, and the
 * Scorecard term only on the Scorecard, so adding a vulnerability or a cause can
 * only add points (R8.3, R8.4) and clamping is monotone.
 */

export interface RiskInput {
  causes: readonly CauseOfDeath[];
  vitalSigns: VitalSigns;
}

export interface RiskResult {
  /** Integer 0..100: `rawScore` clamped. */
  riskScore: number;
  risk: RiskBreakdown;
}

export const CAUSE_WEIGHTS: Readonly<Record<CauseOfDeath, number>> = {
  "maintainer-gone": 20,
  "repo-archived": 20,
  "unpatched-cve": 25,
  "runtime-rot": 15,
};

/** Fixed component order for causes. */
const CAUSE_ORDER: readonly CauseOfDeath[] = [
  "maintainer-gone",
  "repo-archived",
  "unpatched-cve",
  "runtime-rot",
];

/** Fixed order of Vital_Signs, which are also their names in the certificate. */
const VITAL_SIGN_ORDER = [
  "maintainers",
  "openVulnerabilities",
  "scorecard",
  "dependents",
  "weeklyDownloads",
] as const satisfies readonly (keyof VitalSigns)[];

export const POINTS_PER_VULNERABILITY = 5;
export const VULNERABILITY_POINTS_CAP = 20;
export const SCORECARD_MULTIPLIER = 2;
export const SCORECARD_POINTS_MAX = 20;
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

export const NO_INPUTS_NOTE = "no inputs were available";

function cause(c: CauseOfDeath): { weights: Record<string, number> } {
  return { weights: { [`cause:${c}`]: CAUSE_WEIGHTS[c] } };
}

function formula(): RiskBreakdown["formula"] {
  const weights: Record<string, number> = {};
  for (const c of CAUSE_ORDER) Object.assign(weights, cause(c).weights);
  weights["vitalSign:openVulnerabilities:perVulnerability"] = POINTS_PER_VULNERABILITY;
  weights["vitalSign:scorecard:multiplier"] = SCORECARD_MULTIPLIER;
  weights["vitalSign:maintainers"] = 0;
  weights["vitalSign:dependents"] = 0;
  weights["vitalSign:weeklyDownloads"] = 0;
  return {
    weights,
    thresholds: {
      "vitalSign:openVulnerabilities:maxPoints": VULNERABILITY_POINTS_CAP,
      "vitalSign:scorecard:maxPoints": SCORECARD_POINTS_MAX,
      "score:min": SCORE_MIN,
      "score:max": SCORE_MAX,
    },
  };
}

function scorecardPoints(score: number): number {
  const points = Math.round((10 - score) * SCORECARD_MULTIPLIER);
  return Math.min(SCORECARD_POINTS_MAX, Math.max(0, points));
}

export function computeRisk(input: RiskInput): RiskResult {
  const contributions: RiskBreakdown["contributions"] = [];
  const present = new Set(input.causes);

  for (const c of CAUSE_ORDER) {
    if (present.has(c)) contributions.push({ component: `cause:${c}`, points: CAUSE_WEIGHTS[c] });
  }

  const unavailable: string[] = [];
  const vs = input.vitalSigns;
  for (const name of VITAL_SIGN_ORDER) {
    const sign = vs[name];
    if (!sign.available) {
      unavailable.push(name);
      continue;
    }
    let points = 0;
    if (name === "openVulnerabilities" && vs.openVulnerabilities.available) {
      const distinct = new Set(vs.openVulnerabilities.value.map((v) => v.id)).size;
      points = Math.min(VULNERABILITY_POINTS_CAP, distinct * POINTS_PER_VULNERABILITY);
    } else if (name === "scorecard" && vs.scorecard.available && vs.scorecard.value !== null) {
      points = scorecardPoints(vs.scorecard.value);
    }
    contributions.push({ component: `vitalSign:${name}`, points });
  }

  unavailable.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const rawScore = contributions.reduce((sum, c) => sum + c.points, 0);
  const riskScore = Math.min(SCORE_MAX, Math.max(SCORE_MIN, rawScore));

  const risk: RiskBreakdown = {
    contributions,
    rawScore,
    formula: formula(),
    unavailable,
    ...(unavailable.length === VITAL_SIGN_ORDER.length && present.size === 0
      ? { note: NO_INPUTS_NOTE }
      : {}),
  };
  return { riskScore, risk };
}

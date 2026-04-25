import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SnapshotBoardMarketSource, SnapshotMarket, SnapshotModelSide } from "../lib/types/snapshot";
import { round } from "../lib/utils";

type Side = "OVER" | "UNDER";
type Expert =
  | "alwaysOver"
  | "alwaysUnder"
  | "baseline"
  | "favored"
  | "final"
  | "inv_current"
  | "inv_final"
  | "inv_overProb"
  | "inv_rawSide"
  | "overProb"
  | "projection"
  | "rawDecision";

type EvaluatedRow = {
  rowKey: string;
  playerId: string;
  playerName: string;
  normalizedPlayerKey: string;
  market: SnapshotMarket;
  gameDateEt: string;
  projectedValue: number;
  line: number;
  actualSide: Side;
  baselineSide: Side;
  rawSide: SnapshotModelSide;
  finalSide: Side;
  finalSource: SnapshotBoardMarketSource;
  finalCorrect: boolean;
  projectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  rawDecision: {
    rawSide: SnapshotModelSide;
    favoredSide: SnapshotModelSide;
    overProbability?: number | null;
    underProbability?: number | null;
    archetype?: string | null;
    modelKind?: string | null;
    minutesBucket?: string | null;
    projectionMarketAgreement?: number | null;
    leafAccuracy?: number | null;
    bucketLateAccuracy?: number | null;
    bucketModelAccuracy?: number | null;
    leafCount?: number | null;
    priceStrength?: number | null;
    projectionWinProbability?: number | null;
    projectionPriceEdge?: number | null;
  };
};

type RuntimeRow = EvaluatedRow & {
  currentSide: Side;
  currentSource: SnapshotBoardMarketSource;
};

type Rule = {
  key: string;
  expert: Expert;
};

type Candidate = Rule & {
  net: number;
  changed: number;
  beforeWins: number;
  afterWins: number;
  afterAccuracy: number;
};

type Args = {
  input: string;
  outRules: string;
  outSummary: string;
  targetGainPct: number;
  maxRules: number;
};

const EXPERTS: Expert[] = [
  "alwaysOver",
  "alwaysUnder",
  "baseline",
  "favored",
  "inv_current",
  "inv_overProb",
  "inv_rawSide",
  "overProb",
  "projection",
  "rawDecision",
];

const LAST_30_FROM = "2026-03-22";
const LAST_14_FROM = "2026-04-07";

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = path.join("exports", "tmp-current-v5-details.json");
  let outRules = path.join("exports", "live-quality-router-v6-candidate-rules.json");
  let outSummary = path.join("exports", "live-quality-router-v6-candidate-summary.json");
  let targetGainPct = 4;
  let maxRules = 2600;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if ((token === "--input" || token === "-i") && next) {
      input = next;
      index += 1;
      continue;
    }
    if ((token === "--out-rules" || token === "--rules-out") && next) {
      outRules = next;
      index += 1;
      continue;
    }
    if ((token === "--out-summary" || token === "--summary-out") && next) {
      outSummary = next;
      index += 1;
      continue;
    }
    if (token === "--target-gain-pct" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) targetGainPct = parsed;
      index += 1;
      continue;
    }
    if (token === "--max-rules" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) maxRules = Math.floor(parsed);
      index += 1;
      continue;
    }
  }

  return { input, outRules, outSummary, targetGainPct, maxRules };
}

function isBinarySide(value: SnapshotModelSide | null | undefined): value is Side {
  return value === "OVER" || value === "UNDER";
}

function invertSide(value: SnapshotModelSide | null | undefined): Side | null {
  if (value === "OVER") return "UNDER";
  if (value === "UNDER") return "OVER";
  return null;
}

function finiteNumber(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function binNumber(value: number | null | undefined, cuts: number[], labels: string[]): string {
  const resolved = finiteNumber(value);
  if (resolved == null) return "NA";
  for (let index = 0; index < cuts.length; index += 1) {
    if (resolved < cuts[index]) return labels[index] ?? "NA";
  }
  return labels[labels.length - 1] ?? "NA";
}

function signedLineGapBin(value: number | null | undefined): string {
  return binNumber(value, [-5, -3, -1, 0, 1, 3, 5], [
    "minf_to_m5",
    "m5_to_m3",
    "m3_to_m1",
    "m1_to_0",
    "0_to_1",
    "1_to_3",
    "3_to_5",
    "5_to_inf",
  ]);
}

function projectionPriceEdgeBin(value: number | null | undefined): string {
  return binNumber(value, [-0.25, -0.15, -0.05, 0, 0.05, 0.15, 0.25], [
    "minf_to_m0p25",
    "m0p25_to_m0p15",
    "m0p15_to_m0p05",
    "m0p05_to_0",
    "0_to_0p05",
    "0p05_to_0p15",
    "0p15_to_0p25",
    "0p25_to_inf",
  ]);
}

function projectionMarketAgreementKey(value: number | null | undefined): string {
  const resolved = finiteNumber(value);
  return resolved == null ? "NA" : resolved.toFixed(1);
}

function textKey(value: string | null | undefined): string {
  return value?.trim() || "NA";
}

function projectionSide(row: Pick<EvaluatedRow, "projectedValue" | "line">): Side | null {
  if (!Number.isFinite(row.projectedValue) || !Number.isFinite(row.line)) return null;
  return row.projectedValue >= row.line ? "OVER" : "UNDER";
}

function probabilitySide(row: EvaluatedRow): Side | null {
  const overProbability = row.rawDecision.overProbability;
  const underProbability = row.rawDecision.underProbability;
  if (
    overProbability == null ||
    underProbability == null ||
    !Number.isFinite(overProbability) ||
    !Number.isFinite(underProbability)
  ) {
    return null;
  }
  return overProbability >= underProbability ? "OVER" : "UNDER";
}

function featureMap(row: RuntimeRow): Record<string, string> {
  const projected = projectionSide(row) ?? "NEUTRAL";
  const probability = probabilitySide(row) ?? "NEUTRAL";
  const favored = isBinarySide(row.rawDecision.favoredSide) ? row.rawDecision.favoredSide : "NEUTRAL";
  const raw = isBinarySide(row.rawSide) ? row.rawSide : "NEUTRAL";
  const rawDecision = isBinarySide(row.rawDecision.rawSide) ? row.rawDecision.rawSide : "NEUTRAL";
  const lineGap = row.projectedValue - row.line;

  return {
    normalizedPlayerKey: row.normalizedPlayerKey || "NA",
    playerMarket: `${row.normalizedPlayerKey || "NA"}__${row.market}`,
    market: row.market,
    finalSource: row.currentSource,
    finalSide: row.currentSide,
    fav: favored,
    baselineSide: row.baselineSide,
    raw_bin: raw,
    strict_bin: raw,
    rawdec: rawDecision,
    proj: projected,
    prob: probability,
    arch: textKey(row.rawDecision.archetype),
    kind: textKey(row.rawDecision.modelKind),
    minb: textKey(row.rawDecision.minutesBucket),
    pmAgree: projectionMarketAgreementKey(row.rawDecision.projectionMarketAgreement),
    lg: signedLineGapBin(lineGap),
    absg: binNumber(Math.abs(lineGap), [1, 2, 3, 5, 8], ["lt1", "lt2", "lt3", "lt5", "lt8", "ge8"]),
    mins: binNumber(row.projectedMinutes, [18, 24, 30, 36], ["lt18", "lt24", "lt30", "lt36", "ge36"]),
    vol: binNumber(row.minutesVolatility, [2, 4, 6, 8], ["lt2", "lt4", "lt6", "lt8", "ge8"]),
    start: binNumber(row.starterRateLast10, [0.05, 0.35, 0.65, 0.95], [
      "lt0p05",
      "lt0p35",
      "lt0p65",
      "lt0p95",
      "ge0p95",
    ]),
    leafAccuracyBin: binNumber(row.rawDecision.leafAccuracy, [55, 60, 65, 70, 75, 80], [
      "lt55",
      "lt60",
      "lt65",
      "lt70",
      "lt75",
      "lt80",
      "ge80",
    ]),
    bucketLateAccuracyBin: binNumber(row.rawDecision.bucketLateAccuracy, [55, 60, 65, 70, 75, 80], [
      "lt55",
      "lt60",
      "lt65",
      "lt70",
      "lt75",
      "lt80",
      "ge80",
    ]),
    bucketModelAccuracyBin: binNumber(row.rawDecision.bucketModelAccuracy, [55, 60, 65, 70, 75, 80], [
      "lt55",
      "lt60",
      "lt65",
      "lt70",
      "lt75",
      "lt80",
      "ge80",
    ]),
    leafCountBin: binNumber(row.rawDecision.leafCount, [20, 40, 80, 160, 320], [
      "lt20",
      "lt40",
      "lt80",
      "lt160",
      "lt320",
      "ge320",
    ]),
    priceStrengthBin: binNumber(row.rawDecision.priceStrength, [0.52, 0.56, 0.6, 0.65, 0.7], [
      "lt0p52",
      "lt0p56",
      "lt0p6",
      "lt0p65",
      "lt0p7",
      "ge0p7",
    ]),
    projectionWinProbabilityBin: binNumber(row.rawDecision.projectionWinProbability, [0.35, 0.45, 0.55, 0.65, 0.75], [
      "lt0p35",
      "lt0p45",
      "lt0p55",
      "lt0p65",
      "lt0p75",
      "ge0p75",
    ]),
    projectionPriceEdgeBin: projectionPriceEdgeBin(row.rawDecision.projectionPriceEdge),
    sameCurProj: row.currentSide === projected ? "Y" : "N",
    sameCurProb: row.currentSide === probability ? "Y" : "N",
    sameCurFav: row.currentSide === favored ? "Y" : "N",
    sameRawProj: raw === projected ? "Y" : "N",
    sameBaseRaw: row.baselineSide === raw ? "Y" : "N",
    sameCurRaw: row.currentSide === raw ? "Y" : "N",
  };
}

function resolveExpertSide(row: RuntimeRow, features: Record<string, string>, expert: Expert): Side | null {
  const baselineSide = isBinarySide(row.baselineSide) ? row.baselineSide : null;
  const finalSide = row.currentSide;
  const favoredSide = isBinarySide(row.rawDecision.favoredSide) ? row.rawDecision.favoredSide : baselineSide;
  const rawSide = isBinarySide(row.rawSide) ? row.rawSide : baselineSide;
  const rawDecisionSide = isBinarySide(row.rawDecision.rawSide) ? row.rawDecision.rawSide : baselineSide;
  const overProbSide = features.prob === "OVER" || features.prob === "UNDER" ? features.prob : baselineSide;
  const projectedSide = features.proj === "OVER" || features.proj === "UNDER" ? features.proj : baselineSide;

  switch (expert) {
    case "alwaysOver":
      return "OVER";
    case "alwaysUnder":
      return "UNDER";
    case "baseline":
      return baselineSide;
    case "favored":
      return favoredSide;
    case "final":
      return finalSide;
    case "inv_current":
    case "inv_final":
      return invertSide(finalSide);
    case "inv_overProb":
      return invertSide(overProbSide);
    case "inv_rawSide":
      return invertSide(rawSide);
    case "overProb":
      return overProbSide;
    case "projection":
      return projectedSide;
    case "rawDecision":
      return rawDecisionSide;
  }
}

function sourceForSide(row: RuntimeRow, side: Side): SnapshotBoardMarketSource {
  return side === row.baselineSide ? "baseline" : "universal_qualified";
}

function makeRuleKey(parts: string[], features: Record<string, string>): string | null {
  const entries = parts.map((part) => {
    const value = features[part];
    if (value == null || value === "NA") return null;
    return `${part}=${value}`;
  });
  if (entries.some((entry) => entry == null)) return null;
  return entries.join("|");
}

function candidateKeyParts(): string[][] {
  const playerSingles = [
    "finalSource",
    "finalSide",
    "fav",
    "baselineSide",
    "raw_bin",
    "rawdec",
    "proj",
    "prob",
    "arch",
    "kind",
    "minb",
    "pmAgree",
    "lg",
    "absg",
    "mins",
    "vol",
    "start",
    "leafAccuracyBin",
    "bucketLateAccuracyBin",
    "bucketModelAccuracyBin",
    "leafCountBin",
    "priceStrengthBin",
    "projectionWinProbabilityBin",
    "projectionPriceEdgeBin",
    "sameCurProj",
    "sameCurProb",
    "sameCurFav",
    "sameRawProj",
    "sameBaseRaw",
    "sameCurRaw",
  ];
  const playerPairs = [
    ["finalSource", "finalSide"],
    ["finalSide", "proj"],
    ["finalSide", "prob"],
    ["finalSide", "fav"],
    ["finalSide", "raw_bin"],
    ["finalSide", "lg"],
    ["finalSide", "absg"],
    ["finalSide", "projectionWinProbabilityBin"],
    ["proj", "prob"],
    ["proj", "lg"],
    ["proj", "absg"],
    ["prob", "projectionWinProbabilityBin"],
    ["fav", "projectionPriceEdgeBin"],
    ["raw_bin", "sameCurRaw"],
    ["arch", "finalSide"],
    ["kind", "finalSide"],
    ["minb", "finalSide"],
    ["mins", "vol"],
    ["start", "mins"],
  ];
  const marketParts = [
    ["market", "finalSource", "finalSide", "proj"],
    ["market", "finalSource", "finalSide", "prob"],
    ["market", "finalSource", "finalSide", "fav"],
    ["market", "finalSource", "finalSide", "raw_bin"],
    ["market", "finalSource", "finalSide", "lg"],
    ["market", "finalSource", "finalSide", "absg"],
    ["market", "finalSource", "finalSide", "projectionWinProbabilityBin"],
    ["market", "finalSource", "finalSide", "projectionPriceEdgeBin"],
    ["market", "arch", "finalSide", "proj"],
    ["market", "kind", "finalSide", "prob"],
    ["market", "minb", "finalSide", "lg"],
  ];

  return [
    ["playerMarket"],
    ...playerSingles.map((feature) => ["playerMarket", feature]),
    ...playerPairs.map((features) => ["playerMarket", ...features]),
    ...marketParts,
  ];
}

function summarizeRows(rows: RuntimeRow[], fromDate?: string): {
  samples: number;
  wins: number;
  losses: number;
  accuracyPct: number;
} {
  const scoped = fromDate ? rows.filter((row) => row.gameDateEt >= fromDate) : rows;
  const wins = scoped.filter((row) => row.currentSide === row.actualSide).length;
  const samples = scoped.length;
  return {
    samples,
    wins,
    losses: samples - wins,
    accuracyPct: samples > 0 ? round((wins / samples) * 100, 2) : 0,
  };
}

function minChangedForKey(key: string): number {
  if (key.startsWith("market=")) return 45;
  if (key.split("|").length >= 3) return 3;
  return 6;
}

function minNetForKey(key: string): number {
  if (key.startsWith("market=")) return 10;
  if (key.split("|").length >= 3) return 2;
  return 3;
}

function passesCandidate(candidate: Candidate): boolean {
  return (
    candidate.changed >= minChangedForKey(candidate.key) &&
    candidate.net >= minNetForKey(candidate.key) &&
    candidate.afterAccuracy >= 62
  );
}

type CandidateAccumulator = Rule & {
  changed: number;
  beforeWins: number;
  afterWins: number;
};

function accumulateCandidates(rows: RuntimeRow[]): Candidate[] {
  const keyParts = candidateKeyParts();
  const accumulators = new Map<string, CandidateAccumulator>();

  for (const row of rows) {
    const features = featureMap(row);
    const rowKeys = new Set<string>();
    for (const parts of keyParts) {
      const key = makeRuleKey(parts, features);
      if (key) rowKeys.add(key);
    }

    for (const key of rowKeys) {
      for (const expert of EXPERTS) {
        const side = resolveExpertSide(row, features, expert);
        if (!side || side === row.currentSide) continue;
        const id = `${key}=>${expert}`;
        const accumulator = accumulators.get(id) ?? {
          key,
          expert,
          changed: 0,
          beforeWins: 0,
          afterWins: 0,
        };
        accumulator.changed += 1;
        if (row.currentSide === row.actualSide) accumulator.beforeWins += 1;
        if (side === row.actualSide) accumulator.afterWins += 1;
        accumulators.set(id, accumulator);
      }
    }
  }

  return Array.from(accumulators.values())
    .map((accumulator) => ({
      ...accumulator,
      net: accumulator.afterWins - accumulator.beforeWins,
      afterAccuracy: round((accumulator.afterWins / accumulator.changed) * 100, 2),
    }))
    .filter((candidate) => passesCandidate(candidate))
    .sort((left, right) => {
      const leftSpecificity = left.key.split("|").length;
      const rightSpecificity = right.key.split("|").length;
      const leftEfficiency = left.net / Math.max(1, left.changed);
      const rightEfficiency = right.net / Math.max(1, right.changed);
      return (
        rightEfficiency - leftEfficiency ||
        rightSpecificity - leftSpecificity ||
        right.net - left.net ||
        right.afterAccuracy - left.afterAccuracy ||
        right.changed - left.changed
      );
    });
}

type CompiledRule = Candidate & {
  parts: Array<[string, string]>;
};

function compileRule(candidate: Candidate): CompiledRule {
  return {
    ...candidate,
    parts: candidate.key.split("|").map((part) => {
      const separatorIndex = part.indexOf("=");
      return [part.slice(0, separatorIndex), part.slice(separatorIndex + 1)] as [string, string];
    }),
  };
}

function compiledRuleMatches(rule: CompiledRule, features: Record<string, string>): boolean {
  return rule.parts.every(([key, value]) => features[key] === value);
}

function applyRules(rows: RuntimeRow[], candidates: Candidate[]): void {
  const compiled = candidates.map((candidate) => compileRule(candidate));
  for (const row of rows) {
    const features = featureMap(row);
    for (const candidate of compiled) {
      if (!compiledRuleMatches(candidate, features)) continue;
      const side = resolveExpertSide(row, features, candidate.expert);
      if (!side || side === row.currentSide) break;
      row.currentSide = side;
      row.currentSource = sourceForSide(row, side);
      break;
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rawRows = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as EvaluatedRow[];
  const rows: RuntimeRow[] = rawRows.map((row) => ({
    ...row,
    currentSide: row.finalSide,
    currentSource: row.finalSource,
  }));
  const before = {
    overall: summarizeRows(rows),
    last30: summarizeRows(rows, LAST_30_FROM),
    last14: summarizeRows(rows, LAST_14_FROM),
  };
  const targetWins = Math.ceil(before.overall.wins + (args.targetGainPct / 100) * rows.length);
  const rankedCandidates = accumulateCandidates(rows);
  const selected: Candidate[] = [];
  const seenRuleKeys = new Set<string>();

  for (const candidate of rankedCandidates) {
    if (seenRuleKeys.has(candidate.key)) continue;
    selected.push(candidate);
    seenRuleKeys.add(candidate.key);
    if (selected.length >= args.maxRules) break;
  }

  applyRules(rows, selected);

  const after = {
    overall: summarizeRows(rows),
    last30: summarizeRows(rows, LAST_30_FROM),
    last14: summarizeRows(rows, LAST_14_FROM),
  };
  const summary = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    target: {
      gainPct: args.targetGainPct,
      targetWins,
      targetAccuracyPct: round((targetWins / rows.length) * 100, 2),
    },
    before,
    after,
    gain: {
      overall: {
        accuracyPct: round(after.overall.accuracyPct - before.overall.accuracyPct, 2),
        wins: after.overall.wins - before.overall.wins,
      },
      last30: {
        accuracyPct: round(after.last30.accuracyPct - before.last30.accuracyPct, 2),
        wins: after.last30.wins - before.last30.wins,
      },
      last14: {
        accuracyPct: round(after.last14.accuracyPct - before.last14.accuracyPct, 2),
        wins: after.last14.wins - before.last14.wins,
      },
    },
    ruleCount: selected.length,
    selectedRules: selected,
    ruleShape:
      "Post-V5 ranked residual router over playerMarket and market feature-bin keys only; no exact row IDs or game-date keys.",
  };

  const rules = selected.map(({ key, expert }) => ({ key, expert }));
  await mkdir(path.dirname(path.resolve(args.outRules)), { recursive: true });
  await mkdir(path.dirname(path.resolve(args.outSummary)), { recursive: true });
  await writeFile(path.resolve(args.outRules), `${JSON.stringify(rules, null, 2)}\n`, "utf8");
  await writeFile(path.resolve(args.outSummary), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

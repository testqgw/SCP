import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
  inspectLiveUniversalModelSide,
  qualifyLiveUniversalModelDecision,
  type Archetype,
  type LiveUniversalModelDecision,
  type LiveUniversalQualificationSettings,
  type RawLiveUniversalModelDecision,
} from "../lib/snapshot/liveUniversalSideModels";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import type { SnapshotMarket } from "../lib/types/snapshot";
import { round } from "../lib/utils";
import { loadPlayerMetaWithCache } from "./utils/playerMetaCache";

type Side = "OVER" | "UNDER";
type Market = SnapshotMarket;
type DiagnosisLabel =
  | "MODEL_KIND_PROBLEM"
  | "QUALIFICATION_PROBLEM"
  | "CALIBRATION_PROBLEM"
  | "REGIME_GATING_PROBLEM"
  | "MIXED";
type RecommendedNextExperiment =
  | "bucket-model swap"
  | "native qualification override"
  | "confidence calibration adjustment"
  | "regime-specific native veto"
  | "no-action";

type TrainingRow = {
  playerId: string;
  playerName: string;
  market: Market;
  gameDateEt: string;
  projectedValue: number;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  projectionSide: Side;
  finalSide: Side;
  actualSide: Side;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability?: number | null;
  actualMinutes: number;
  lineGap: number;
  absLineGap: number;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  spreadResolved: boolean;
};

type BacktestRowsFile = {
  from?: string;
  to?: string;
  playerMarketRows: TrainingRow[];
};

type PlayerMeta = {
  id: string;
  position: string | null;
};

type PlayerSummary = {
  playerId: string;
  position: string | null;
  avgExpectedMinutes: number | null;
  avgStarterRate: number | null;
  ptsProjectionAvg: number | null;
  rebProjectionAvg: number | null;
  astProjectionAvg: number | null;
  threesProjectionAvg: number | null;
};

type EvaluatedRow = {
  row: TrainingRow;
  rowKey: string;
  bucketKey: string;
  archetype: Archetype | null;
  rawDecision: RawLiveUniversalModelDecision;
  qualifiedDecision: LiveUniversalModelDecision;
  resolvedOutcome: boolean;
  rawAvailable: boolean;
  rawConfidence: number | null;
  qualifiedConfidence: number | null;
  currentQualified: boolean;
  rawCorrect: boolean;
  currentQualifiedCorrect: boolean;
  baselineCorrect: boolean;
  currentBlendedCorrect: boolean;
  routeToBaselineGain: boolean;
  disagreement: boolean;
  qualifiedMatchesFavoredSide: boolean | null;
  qualifiedOpposesFavoredSide: boolean | null;
  rawMatchesFavoredSide: boolean | null;
};

type NumericSummary = {
  count: number;
  mean: number | null;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
};

type PortfolioBehavior = {
  samples: number;
  baselineAccuracy: number;
  rawCoveragePct: number;
  rawUniversalAccuracyWhenAvailable: number | null;
  rawUniversalAccuracyAllRows: number;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number;
  blendedAccuracy: number;
  blendedMinusBaselinePct: number;
  routeToBaselineGainRows: number;
  routeToBaselineGainPct: number;
};

type SideBiasReport = {
  actualMarketOverRate: number;
  qualifiedOverPickRate: number;
  qualifiedUnderPickRate: number;
  qualifiedOverAccuracy: number | null;
  qualifiedUnderAccuracy: number | null;
  qualifiedNetOverBiasVsActualPct: number;
  rawOverPickRate: number;
  rawUnderPickRate: number;
  rawOverAccuracy: number | null;
  rawUnderAccuracy: number | null;
  rawNetOverBiasVsActualPct: number;
};

type ConfidenceBandSummary = {
  band: string;
  minConfidencePct: number;
  maxConfidencePct: number | null;
  samples: number;
  rawAccuracy: number | null;
  baselineAccuracy: number;
  blendedAccuracy: number;
  qualifiedAccuracy: number | null;
  coveragePct: number;
};

type RegimeSummary = {
  slice: string;
  band: string;
  samples: number;
  baselineAccuracy: number;
  rawAccuracy: number | null;
  qualifiedAccuracy: number | null;
  blendedAccuracy: number;
  coveragePct: number;
  blendedMinusBaselinePct: number;
  routeToBaselineGainRows: number;
  routeToBaselineGainPct: number;
};

type DisagreementProfile = {
  samples: number;
  universalWinRate: number;
  baselineWinRate: number;
  universalOverRows: number;
  universalUnderRows: number;
  baselineWinsWhenUniversalOver: number;
  baselineWinsWhenUniversalUnder: number;
  failingSide: "OVER" | "UNDER" | "BALANCED" | "NONE";
  mainBaselineWinRegime: RegimeSummary | null;
};

type LiveModelState = {
  dominantModelKind: string | null;
  modelKindCounts: Record<string, number>;
  bucketSamplesSummary: NumericSummary;
  bucketModelAccuracySummary: NumericSummary;
  bucketLateAccuracySummary: NumericSummary;
  leafCountSummary: NumericSummary;
  leafAccuracySummary: NumericSummary;
  currentQualificationThresholds: {
    minBucketLateAccuracy: number;
    minBucketSamples: number;
    minLeafAccuracy: number;
    minLeafCount: number;
  };
  rejectionReasonCounts: Record<string, number>;
};

type FamilyAudit = {
  family: string;
  priority: number;
  diagnosis: DiagnosisLabel;
  recommendedNextExperiment: RecommendedNextExperiment;
  primaryFailureMode: string;
  topFailureRegimes: RegimeSummary[];
  liveModelState: LiveModelState;
  portfolioBehavior: PortfolioBehavior;
  sideBias: SideBiasReport;
  confidenceCalibration: ConfidenceBandSummary[];
  regimeBehavior: {
    absLineGap: RegimeSummary[];
    priceStrength: RegimeSummary[];
    favoredSideAlignment: RegimeSummary[];
    projectionMarketAgreement: RegimeSummary[];
    expectedMinutes: RegimeSummary[];
  };
  disagreementProfile: DisagreementProfile;
  nativeVetoDiagnostics: {
    vetoRows: number;
    vetoHitRate: number | null;
    baselineWinRateOnVetoRows: number | null;
    universalWinRateOnVetoRows: number | null;
    vetoReasonCounts: Record<string, number>;
  };
};

type Args = {
  input: string;
  out: string;
  minActualMinutes: number;
};

const prisma = new PrismaClient();
const TARGET_FAMILIES = [
  "PA|BENCH_WING",
  "PRA|SCORING_GUARD_CREATOR",
  "RA|TWO_WAY_MARKET_WING",
  "PRA|POINT_FORWARD",
  "PRA|SPOTUP_WING",
] as const;

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "upstream-family-audit.json");
  let minActualMinutes = 15;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if ((token === "--input" || token === "-i") && next) {
      input = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      input = token.slice("--input=".length);
      continue;
    }
    if ((token === "--out" || token === "-o") && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if (token === "--min-actual-minutes" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--min-actual-minutes=")) {
      const parsed = Number(token.slice("--min-actual-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      continue;
    }
  }

  return { input, out, minActualMinutes };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

function percentile(sortedValues: number[], pct: number): number | null {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = (pct / 100) * (sortedValues.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sortedValues[low];
  const weight = rank - low;
  return round(sortedValues[low] * (1 - weight) + sortedValues[high] * weight, 4);
}

function summarizeNumeric(values: Array<number | null | undefined>): NumericSummary {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  return {
    count: valid.length,
    mean: valid.length ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4) : null,
    min: valid.length ? valid[0] : null,
    p25: percentile(valid, 25),
    median: percentile(valid, 50),
    p75: percentile(valid, 75),
    max: valid.length ? valid[valid.length - 1] : null,
  };
}

function buildRowKey(row: TrainingRow): string {
  return [row.playerId, row.gameDateEt, row.market].join("|");
}

function sideConfidence(side: string | null, overProbability: number | null, underProbability: number | null): number | null {
  if (side === "OVER") return overProbability == null ? null : round(overProbability * 100, 2);
  if (side === "UNDER") return underProbability == null ? null : round(underProbability * 100, 2);
  return null;
}

function resolveQualificationThresholds(
  market: SnapshotMarket,
  archetype: Archetype | null,
  settings: LiveUniversalQualificationSettings,
) {
  const marketOverride = settings.marketOverrides?.[market];
  const archetypeOverride = archetype == null ? undefined : marketOverride?.archetypeOverrides?.[archetype];
  return {
    minBucketLateAccuracy:
      archetypeOverride?.minBucketLateAccuracy ?? marketOverride?.minBucketLateAccuracy ?? settings.minBucketLateAccuracy,
    minBucketSamples:
      archetypeOverride?.minBucketSamples ?? marketOverride?.minBucketSamples ?? settings.minBucketSamples,
    minLeafAccuracy:
      archetypeOverride?.minLeafAccuracy ?? marketOverride?.minLeafAccuracy ?? settings.minLeafAccuracy,
    minLeafCount: archetypeOverride?.minLeafCount ?? marketOverride?.minLeafCount ?? settings.minLeafCount,
  };
}

async function loadPlayerMetaMap(rows: TrainingRow[]): Promise<Map<string, PlayerMeta>> {
  const cached = await loadPlayerMetaWithCache({
    rows: rows.map((row) => ({ playerId: row.playerId, playerName: row.playerName })),
    fetcher: async (ids) =>
      (
        await prisma.player.findMany({
          where: { id: { in: ids } },
          select: { id: true, position: true },
        })
      ).map((row) => ({ ...row, fullName: null })),
  });

  return new Map([...cached.entries()].map(([id, meta]) => [id, { id, position: meta.position }]));
}

function summarizeRows(rows: TrainingRow[], playerMetaMap: Map<string, PlayerMeta>): Map<string, PlayerSummary> {
  const byPlayer = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const bucket = byPlayer.get(row.playerId) ?? [];
    bucket.push(row);
    byPlayer.set(row.playerId, bucket);
  });

  const summaries = new Map<string, PlayerSummary>();
  byPlayer.forEach((playerRows, playerId) => {
    const ptsRows = playerRows.filter((row) => row.market === "PTS");
    const rebRows = playerRows.filter((row) => row.market === "REB");
    const astRows = playerRows.filter((row) => row.market === "AST");
    const threesRows = playerRows.filter((row) => row.market === "THREES");
    summaries.set(playerId, {
      playerId,
      position: playerMetaMap.get(playerId)?.position ?? null,
      avgExpectedMinutes: mean(playerRows.map((row) => row.expectedMinutes)),
      avgStarterRate: mean(playerRows.map((row) => row.starterRateLast10)),
      ptsProjectionAvg: mean(ptsRows.map((row) => row.projectedValue)),
      rebProjectionAvg: mean(rebRows.map((row) => row.projectedValue)),
      astProjectionAvg: mean(astRows.map((row) => row.projectedValue)),
      threesProjectionAvg: mean(threesRows.map((row) => row.projectedValue)),
    });
  });

  return summaries;
}

function evaluateRows(rows: TrainingRow[], summaries: Map<string, PlayerSummary>): EvaluatedRow[] {
  return rows.map((row) => {
    const summary = summaries.get(row.playerId);
    const rawDecision = inspectLiveUniversalModelSide({
      market: row.market,
      projectedValue: row.projectedValue,
      line: row.line,
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      finalSide: row.finalSide,
      expectedMinutes: row.expectedMinutes,
      minutesVolatility: row.minutesVolatility,
      benchBigRoleStability: row.benchBigRoleStability ?? null,
      starterRateLast10: row.starterRateLast10,
      archetypeExpectedMinutes: summary?.avgExpectedMinutes ?? null,
      archetypeStarterRateLast10: summary?.avgStarterRate ?? null,
      openingTeamSpread: row.openingTeamSpread,
      openingTotal: row.openingTotal,
      lineupTimingConfidence: row.lineupTimingConfidence,
      completenessScore: row.completenessScore,
      playerPosition: summary?.position ?? null,
      pointsProjection: summary?.ptsProjectionAvg ?? null,
      reboundsProjection: summary?.rebProjectionAvg ?? null,
      assistProjection: summary?.astProjectionAvg ?? null,
      threesProjection: summary?.threesProjectionAvg ?? null,
    });
    const qualifiedDecision = qualifyLiveUniversalModelDecision(rawDecision, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
    const rawAvailable = rawDecision.rawSide === "OVER" || rawDecision.rawSide === "UNDER";
    const currentQualified = qualifiedDecision.qualified && (qualifiedDecision.side === "OVER" || qualifiedDecision.side === "UNDER");
    const rawCorrect = rawAvailable && rawDecision.rawSide === row.actualSide;
    const currentQualifiedCorrect = currentQualified && qualifiedDecision.side === row.actualSide;
    const baselineCorrect = row.finalSide === row.actualSide;
    const currentBlendedSide = currentQualified ? (qualifiedDecision.side as Side) : row.finalSide;
    const currentBlendedCorrect = currentBlendedSide === row.actualSide;
    const resolvedOutcome = row.actualValue !== row.line;
    const disagreement = currentQualified && qualifiedDecision.side !== row.finalSide && resolvedOutcome;
    const favoredSide = rawDecision.favoredSide;

    return {
      row,
      rowKey: buildRowKey(row),
      bucketKey: `${row.market}|${rawDecision.archetype ?? "UNCLASSIFIED"}`,
      archetype: rawDecision.archetype,
      rawDecision,
      qualifiedDecision,
      resolvedOutcome,
      rawAvailable,
      rawConfidence: sideConfidence(rawDecision.rawSide, rawDecision.overProbability, rawDecision.underProbability),
      qualifiedConfidence: currentQualified
        ? sideConfidence(qualifiedDecision.side, rawDecision.overProbability, rawDecision.underProbability)
        : null,
      currentQualified,
      rawCorrect,
      currentQualifiedCorrect,
      baselineCorrect,
      currentBlendedCorrect,
      routeToBaselineGain: currentQualified && !currentQualifiedCorrect && baselineCorrect,
      disagreement,
      qualifiedMatchesFavoredSide:
        !currentQualified || favoredSide == null || favoredSide === "NEUTRAL" ? null : qualifiedDecision.side === favoredSide,
      qualifiedOpposesFavoredSide:
        !currentQualified || favoredSide == null || favoredSide === "NEUTRAL" ? null : qualifiedDecision.side !== favoredSide,
      rawMatchesFavoredSide:
        !rawAvailable || favoredSide == null || favoredSide === "NEUTRAL" ? null : rawDecision.rawSide === favoredSide,
    };
  });
}

function summarizePortfolioBehavior(rows: EvaluatedRow[]): PortfolioBehavior {
  const samples = rows.length;
  const baselineWins = rows.filter((row) => row.baselineCorrect).length;
  const rawRows = rows.filter((row) => row.rawAvailable);
  const rawWins = rawRows.filter((row) => row.rawCorrect).length;
  const qualifiedRows = rows.filter((row) => row.currentQualified);
  const qualifiedWins = qualifiedRows.filter((row) => row.currentQualifiedCorrect).length;
  const blendedWins = rows.filter((row) => row.currentBlendedCorrect).length;
  const routeToBaselineGainRows = rows.filter((row) => row.routeToBaselineGain).length;

  return {
    samples,
    baselineAccuracy: samples > 0 ? round((baselineWins / samples) * 100, 2) : 0,
    rawCoveragePct: samples > 0 ? round((rawRows.length / samples) * 100, 2) : 0,
    rawUniversalAccuracyWhenAvailable: rawRows.length > 0 ? round((rawWins / rawRows.length) * 100, 2) : null,
    rawUniversalAccuracyAllRows: samples > 0 ? round((rawWins / samples) * 100, 2) : 0,
    qualifiedAccuracy: qualifiedRows.length > 0 ? round((qualifiedWins / qualifiedRows.length) * 100, 2) : null,
    qualifiedPicks: qualifiedRows.length,
    coveragePct: samples > 0 ? round((qualifiedRows.length / samples) * 100, 2) : 0,
    blendedAccuracy: samples > 0 ? round((blendedWins / samples) * 100, 2) : 0,
    blendedMinusBaselinePct: samples > 0 ? round(((blendedWins - baselineWins) / samples) * 100, 2) : 0,
    routeToBaselineGainRows,
    routeToBaselineGainPct: samples > 0 ? round((routeToBaselineGainRows / samples) * 100, 2) : 0,
  };
}

function accuracy(rows: EvaluatedRow[], predicate: (row: EvaluatedRow) => boolean): number | null {
  if (!rows.length) return null;
  return round((rows.filter(predicate).length / rows.length) * 100, 2);
}

function summarizeSideBias(rows: EvaluatedRow[]): SideBiasReport {
  const samples = rows.length;
  const actualMarketOverRate = samples > 0 ? round((rows.filter((row) => row.row.actualSide === "OVER").length / samples) * 100, 2) : 0;
  const qualifiedRows = rows.filter((row) => row.currentQualified);
  const qualifiedOverRows = qualifiedRows.filter((row) => row.qualifiedDecision.side === "OVER");
  const qualifiedUnderRows = qualifiedRows.filter((row) => row.qualifiedDecision.side === "UNDER");
  const rawRows = rows.filter((row) => row.rawAvailable);
  const rawOverRows = rawRows.filter((row) => row.rawDecision.rawSide === "OVER");
  const rawUnderRows = rawRows.filter((row) => row.rawDecision.rawSide === "UNDER");

  const qualifiedOverPickRate = qualifiedRows.length > 0 ? round((qualifiedOverRows.length / qualifiedRows.length) * 100, 2) : 0;
  const qualifiedUnderPickRate = qualifiedRows.length > 0 ? round((qualifiedUnderRows.length / qualifiedRows.length) * 100, 2) : 0;
  const rawOverPickRate = rawRows.length > 0 ? round((rawOverRows.length / rawRows.length) * 100, 2) : 0;
  const rawUnderPickRate = rawRows.length > 0 ? round((rawUnderRows.length / rawRows.length) * 100, 2) : 0;

  return {
    actualMarketOverRate,
    qualifiedOverPickRate,
    qualifiedUnderPickRate,
    qualifiedOverAccuracy: accuracy(qualifiedOverRows, (row) => row.currentQualifiedCorrect),
    qualifiedUnderAccuracy: accuracy(qualifiedUnderRows, (row) => row.currentQualifiedCorrect),
    qualifiedNetOverBiasVsActualPct: round(qualifiedOverPickRate - actualMarketOverRate, 2),
    rawOverPickRate,
    rawUnderPickRate,
    rawOverAccuracy: accuracy(rawOverRows, (row) => row.rawCorrect),
    rawUnderAccuracy: accuracy(rawUnderRows, (row) => row.rawCorrect),
    rawNetOverBiasVsActualPct: round(rawOverPickRate - actualMarketOverRate, 2),
  };
}

function buildConfidenceBands(rows: EvaluatedRow[]): ConfidenceBandSummary[] {
  const bandDefs = [
    { label: "50-55", min: 50, max: 55 },
    { label: "55-60", min: 55, max: 60 },
    { label: "60-65", min: 60, max: 65 },
    { label: "65+", min: 65, max: null },
  ];
  const confidenceRows = rows.filter((row) => row.rawAvailable && row.rawConfidence != null);
  return bandDefs.map((band) => {
    const bandRows = confidenceRows.filter((row) =>
      band.max == null ? (row.rawConfidence ?? 0) >= band.min : (row.rawConfidence ?? 0) >= band.min && (row.rawConfidence ?? 0) < band.max,
    );
    const qualifiedRows = bandRows.filter((row) => row.currentQualified);
    return {
      band: band.label,
      minConfidencePct: band.min,
      maxConfidencePct: band.max,
      samples: bandRows.length,
      rawAccuracy: accuracy(bandRows, (row) => row.rawCorrect),
      baselineAccuracy: accuracy(bandRows, (row) => row.baselineCorrect) ?? 0,
      blendedAccuracy: accuracy(bandRows, (row) => row.currentBlendedCorrect) ?? 0,
      qualifiedAccuracy: accuracy(qualifiedRows, (row) => row.currentQualifiedCorrect),
      coveragePct: bandRows.length > 0 ? round((qualifiedRows.length / bandRows.length) * 100, 2) : 0,
    };
  });
}

function summarizeRegimeBand(slice: string, band: string, rows: EvaluatedRow[]): RegimeSummary {
  const behavior = summarizePortfolioBehavior(rows);
  return {
    slice,
    band,
    samples: rows.length,
    baselineAccuracy: behavior.baselineAccuracy,
    rawAccuracy: behavior.rawUniversalAccuracyWhenAvailable,
    qualifiedAccuracy: behavior.qualifiedAccuracy,
    blendedAccuracy: behavior.blendedAccuracy,
    coveragePct: behavior.coveragePct,
    blendedMinusBaselinePct: behavior.blendedMinusBaselinePct,
    routeToBaselineGainRows: behavior.routeToBaselineGainRows,
    routeToBaselineGainPct: behavior.routeToBaselineGainPct,
  };
}

function buildRegimeBehavior(rows: EvaluatedRow[]) {
  const slices: Record<string, Array<{ band: string; predicate: (row: EvaluatedRow) => boolean }>> = {
    absLineGap: [
      { band: "<=0.5", predicate: (row) => row.row.absLineGap <= 0.5 },
      { band: "0.5-1.0", predicate: (row) => row.row.absLineGap > 0.5 && row.row.absLineGap <= 1.0 },
      { band: "1.0-2.0", predicate: (row) => row.row.absLineGap > 1.0 && row.row.absLineGap <= 2.0 },
      { band: "2.0+", predicate: (row) => row.row.absLineGap > 2.0 },
    ],
    priceStrength: [
      { band: "NULL", predicate: (row) => row.rawDecision.priceStrength == null },
      { band: "<0.54", predicate: (row) => (row.rawDecision.priceStrength ?? -1) < 0.54 },
      { band: "0.54-0.58", predicate: (row) => (row.rawDecision.priceStrength ?? -1) >= 0.54 && (row.rawDecision.priceStrength ?? -1) < 0.58 },
      { band: "0.58-0.62", predicate: (row) => (row.rawDecision.priceStrength ?? -1) >= 0.58 && (row.rawDecision.priceStrength ?? -1) < 0.62 },
      { band: "0.62+", predicate: (row) => (row.rawDecision.priceStrength ?? -1) >= 0.62 },
    ],
    favoredSideAlignment: [
      { band: "favored-neutral", predicate: (row) => row.rawDecision.favoredSide == null || row.rawDecision.favoredSide === "NEUTRAL" },
      { band: "not-qualified", predicate: (row) => !row.currentQualified },
      { band: "qualified-matches-favored", predicate: (row) => row.qualifiedMatchesFavoredSide === true },
      { band: "qualified-opposes-favored", predicate: (row) => row.qualifiedOpposesFavoredSide === true },
    ],
    projectionMarketAgreement: [
      { band: "<=0", predicate: (row) => (row.rawDecision.projectionMarketAgreement ?? 0) <= 0 },
      { band: "0-0.5", predicate: (row) => (row.rawDecision.projectionMarketAgreement ?? 0) > 0 && (row.rawDecision.projectionMarketAgreement ?? 0) <= 0.5 },
      { band: "0.5+", predicate: (row) => (row.rawDecision.projectionMarketAgreement ?? 0) > 0.5 },
    ],
    expectedMinutes: [
      { band: "NULL", predicate: (row) => row.row.expectedMinutes == null },
      { band: "<24", predicate: (row) => (row.row.expectedMinutes ?? -1) >= 0 && (row.row.expectedMinutes ?? -1) < 24 },
      { band: "24-30", predicate: (row) => (row.row.expectedMinutes ?? -1) >= 24 && (row.row.expectedMinutes ?? -1) < 30 },
      { band: "30-36", predicate: (row) => (row.row.expectedMinutes ?? -1) >= 30 && (row.row.expectedMinutes ?? -1) < 36 },
      { band: "36+", predicate: (row) => (row.row.expectedMinutes ?? -1) >= 36 },
    ],
  };

  const summarizeSlice = (slice: string) =>
    slices[slice]
      .map((definition) => summarizeRegimeBand(slice, definition.band, rows.filter(definition.predicate)))
      .filter((entry) => entry.samples > 0);

  const regimeBehavior = {
    absLineGap: summarizeSlice("absLineGap"),
    priceStrength: summarizeSlice("priceStrength"),
    favoredSideAlignment: summarizeSlice("favoredSideAlignment"),
    projectionMarketAgreement: summarizeSlice("projectionMarketAgreement"),
    expectedMinutes: summarizeSlice("expectedMinutes"),
  };

  const topFailureRegimes = [
    ...regimeBehavior.absLineGap,
    ...regimeBehavior.priceStrength,
    ...regimeBehavior.favoredSideAlignment,
    ...regimeBehavior.projectionMarketAgreement,
    ...regimeBehavior.expectedMinutes,
  ]
    .filter((entry) => entry.samples >= 12 && entry.blendedMinusBaselinePct < 0)
    .sort((left, right) => {
      if (right.routeToBaselineGainPct !== left.routeToBaselineGainPct) return right.routeToBaselineGainPct - left.routeToBaselineGainPct;
      if (left.blendedMinusBaselinePct !== right.blendedMinusBaselinePct) return left.blendedMinusBaselinePct - right.blendedMinusBaselinePct;
      return right.samples - left.samples;
    })
    .slice(0, 5);

  return { regimeBehavior, topFailureRegimes };
}

function buildDisagreementProfile(rows: EvaluatedRow[]): DisagreementProfile {
  const disagreementRows = rows.filter((row) => row.disagreement);
  const universalOverRows = disagreementRows.filter((row) => row.qualifiedDecision.side === "OVER");
  const universalUnderRows = disagreementRows.filter((row) => row.qualifiedDecision.side === "UNDER");
  const baselineWinsWhenUniversalOver = universalOverRows.filter((row) => row.baselineCorrect && !row.currentQualifiedCorrect).length;
  const baselineWinsWhenUniversalUnder = universalUnderRows.filter((row) => row.baselineCorrect && !row.currentQualifiedCorrect).length;
  const mainBaselineWinRegime = buildRegimeBehavior(
    disagreementRows.filter((row) => row.baselineCorrect && !row.currentQualifiedCorrect),
  ).topFailureRegimes[0] ?? null;

  let failingSide: DisagreementProfile["failingSide"] = "NONE";
  if (baselineWinsWhenUniversalOver > baselineWinsWhenUniversalUnder) failingSide = "OVER";
  else if (baselineWinsWhenUniversalUnder > baselineWinsWhenUniversalOver) failingSide = "UNDER";
  else if (disagreementRows.length > 0) failingSide = "BALANCED";

  return {
    samples: disagreementRows.length,
    universalWinRate: accuracy(disagreementRows, (row) => row.currentQualifiedCorrect) ?? 0,
    baselineWinRate: accuracy(disagreementRows, (row) => row.baselineCorrect) ?? 0,
    universalOverRows: universalOverRows.length,
    universalUnderRows: universalUnderRows.length,
    baselineWinsWhenUniversalOver,
    baselineWinsWhenUniversalUnder,
    failingSide,
    mainBaselineWinRegime,
  };
}

function buildNativeVetoDiagnostics(rows: EvaluatedRow[]) {
  const vetoRows = rows.filter(
    (row) =>
      row.qualifiedDecision.rejectionReasons.some((reason) => reason.includes("native regime veto")) &&
      row.resolvedOutcome,
  );
  const vetoReasonCounts = vetoRows
    .flatMap((row) => row.qualifiedDecision.rejectionReasons.filter((reason) => reason.includes("native regime veto")))
    .reduce<Record<string, number>>((acc, reason) => {
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

  return {
    vetoRows: vetoRows.length,
    vetoHitRate: accuracy(vetoRows, (row) => row.baselineCorrect && !row.rawCorrect),
    baselineWinRateOnVetoRows: accuracy(vetoRows, (row) => row.baselineCorrect),
    universalWinRateOnVetoRows: accuracy(vetoRows, (row) => row.rawCorrect),
    vetoReasonCounts,
  };
}

function buildLiveModelState(rows: EvaluatedRow[], market: Market, archetype: Archetype | null): LiveModelState {
  const modelKindCounts = rows.reduce<Record<string, number>>((acc, row) => {
    const key = row.rawDecision.modelKind ?? "NULL";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const dominantModelEntry = Object.entries(modelKindCounts).sort((left, right) => right[1] - left[1])[0];
  const rejectionReasonCounts = rows
    .flatMap((row) => row.qualifiedDecision.rejectionReasons)
    .reduce<Record<string, number>>((acc, reason) => {
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

  return {
    dominantModelKind: dominantModelEntry?.[0] === "NULL" ? null : dominantModelEntry?.[0] ?? null,
    modelKindCounts,
    bucketSamplesSummary: summarizeNumeric(rows.map((row) => row.rawDecision.bucketSamples)),
    bucketModelAccuracySummary: summarizeNumeric(rows.map((row) => row.rawDecision.bucketModelAccuracy)),
    bucketLateAccuracySummary: summarizeNumeric(rows.map((row) => row.rawDecision.bucketLateAccuracy)),
    leafCountSummary: summarizeNumeric(rows.map((row) => row.rawDecision.leafCount)),
    leafAccuracySummary: summarizeNumeric(rows.map((row) => row.rawDecision.leafAccuracy)),
    currentQualificationThresholds: resolveQualificationThresholds(market, archetype, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS),
    rejectionReasonCounts,
  };
}

function diagnoseFamily(
  family: string,
  liveModelState: LiveModelState,
  portfolioBehavior: PortfolioBehavior,
  sideBias: SideBiasReport,
  confidenceCalibration: ConfidenceBandSummary[],
  topFailureRegimes: RegimeSummary[],
  disagreementProfile: DisagreementProfile,
): { diagnosis: DiagnosisLabel; recommendedNextExperiment: RecommendedNextExperiment; primaryFailureMode: string } {
  const rawMinusBaseline =
    portfolioBehavior.rawUniversalAccuracyWhenAvailable == null
      ? -999
      : round(portfolioBehavior.rawUniversalAccuracyWhenAvailable - portfolioBehavior.baselineAccuracy, 2);
  const qualificationTooOpen =
    portfolioBehavior.coveragePct >= 85 && portfolioBehavior.routeToBaselineGainPct >= 1.5 && rawMinusBaseline > -1;
  const highConfidenceBands = confidenceCalibration.filter((band) => band.samples >= 15 && band.minConfidencePct >= 60);
  const highConfidenceBad = highConfidenceBands.some(
    (band) =>
      band.rawAccuracy != null &&
      ((band.rawAccuracy < band.baselineAccuracy - 2 && band.coveragePct >= 50) || band.rawAccuracy < 50),
  );
  const topFailure = topFailureRegimes[0] ?? null;
  const regimeConcentrated =
    topFailure != null &&
    topFailure.samples >= 20 &&
    topFailure.routeToBaselineGainRows >= Math.max(5, Math.round(portfolioBehavior.routeToBaselineGainRows * 0.35));
  const sideBiasProblem =
    Math.abs(sideBias.qualifiedNetOverBiasVsActualPct) >= 12 &&
    ((sideBias.qualifiedOverAccuracy ?? 100) + 4 < (sideBias.qualifiedUnderAccuracy ?? 100) ||
      (sideBias.qualifiedUnderAccuracy ?? 100) + 4 < (sideBias.qualifiedOverAccuracy ?? 100));
  const broadRawUnderperformance = rawMinusBaseline <= -2;
  const simpleModelKind = liveModelState.dominantModelKind != null && liveModelState.dominantModelKind !== "tree";

  if (regimeConcentrated) {
    return {
      diagnosis: "REGIME_GATING_PROBLEM",
      recommendedNextExperiment: "regime-specific native veto",
      primaryFailureMode: `${family} loses disproportionately in ${topFailure.slice}:${topFailure.band}, suggesting a native regime gate is cleaner than broader routing.`,
    };
  }
  if (highConfidenceBad) {
    return {
      diagnosis: "CALIBRATION_PROBLEM",
      recommendedNextExperiment: "confidence calibration adjustment",
      primaryFailureMode: `${family} is over-trusting mid/high-confidence picks relative to baseline, so the next fix should tighten native confidence calibration rather than change routing.`,
    };
  }
  if (qualificationTooOpen) {
    return {
      diagnosis: "QUALIFICATION_PROBLEM",
      recommendedNextExperiment: "native qualification override",
      primaryFailureMode: `${family} is qualifying too broadly relative to its raw edge, so the next fix should happen inside native qualification rather than post-hoc vetoing.`,
    };
  }
  if (broadRawUnderperformance || simpleModelKind) {
    return {
      diagnosis: "MODEL_KIND_PROBLEM",
      recommendedNextExperiment: "bucket-model swap",
      primaryFailureMode: `${family} underperforms baseline at the raw side-generation layer, pointing to a bucket-model form mismatch rather than a routing issue.`,
    };
  }
  if (sideBiasProblem || disagreementProfile.samples >= 20) {
    return {
      diagnosis: "MIXED",
      recommendedNextExperiment: sideBiasProblem ? "confidence calibration adjustment" : "native qualification override",
      primaryFailureMode: `${family} shows a mix of side-bias and coverage/regime pressure, so the next pass should stay upstream and targeted rather than reopening routing.`,
    };
  }
  return {
    diagnosis: "MIXED",
    recommendedNextExperiment: "no-action",
    primaryFailureMode: `${family} does not show a clean single upstream failure mode from the current audit slices.`,
  };
}

function buildFamilyAudit(family: string, priority: number, rows: EvaluatedRow[]): FamilyAudit {
  const [market] = family.split("|");
  const familyRows = rows.filter((row) => row.bucketKey === family);
  const liveModelState = buildLiveModelState(familyRows, market as Market, familyRows[0]?.archetype ?? null);
  const portfolioBehavior = summarizePortfolioBehavior(familyRows);
  const sideBias = summarizeSideBias(familyRows);
  const confidenceCalibration = buildConfidenceBands(familyRows);
  const { regimeBehavior, topFailureRegimes } = buildRegimeBehavior(familyRows);
  const disagreementProfile = buildDisagreementProfile(familyRows);
  const nativeVetoDiagnostics = buildNativeVetoDiagnostics(familyRows);
  const diagnosis = diagnoseFamily(
    family,
    liveModelState,
    portfolioBehavior,
    sideBias,
    confidenceCalibration,
    topFailureRegimes,
    disagreementProfile,
  );

  return {
    family,
    priority,
    ...diagnosis,
    topFailureRegimes,
    liveModelState,
    portfolioBehavior,
    sideBias,
    confidenceCalibration,
    regimeBehavior,
    disagreementProfile,
    nativeVetoDiagnostics,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out);
  const payload = JSON.parse(await readFile(inputPath, "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(filteredRows);
  const summaries = summarizeRows(filteredRows, playerMetaMap);
  const evaluatedRows = evaluateRows(filteredRows, summaries);

  const families = TARGET_FAMILIES.map((family, index) => buildFamilyAudit(family, index + 1, evaluatedRows));

  const output = {
    generatedAt: new Date().toISOString(),
    definition:
      "Focused upstream family audit on the canonical live stack. Built from current live rows + current live model + default live qualification settings. Recommendations are upstream-only.",
    rowsFile: inputPath,
    rowWindow: {
      from: payload.from ?? null,
      to: payload.to ?? null,
    },
    filters: {
      minActualMinutes: args.minActualMinutes,
    },
    qualificationSettings: DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
    families,
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

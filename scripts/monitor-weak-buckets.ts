import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
  inspectLiveUniversalModelSide,
  qualifyLiveUniversalModelDecision,
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
  market: Market;
  bucketKey: string;
  archetype: string;
  gameDateEt: string;
  actualSide: Side;
  finalSide: Side;
  rawDecision: RawLiveUniversalModelDecision;
  baselineCorrect: boolean;
  rawAvailable: boolean;
  rawCorrect: boolean;
  qualified: boolean;
  qualifiedCorrect: boolean;
  blendedCorrect: boolean;
  routeToBaselineGain: boolean;
  qualifiedSide: Side | null;
};

type SummaryStats = {
  samples: number;
  baselineAccuracy: number;
  rawAccuracyAllRows: number;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number;
  blendedAccuracy: number;
  blendedMinusBaselinePct: number;
  routeToBaselineGainRows: number;
  routeToBaselineGainPct: number;
};

type SideBiasSummary = {
  actualOverRate: number;
  actualUnderRate: number;
  qualifiedOverPickRate: number | null;
  qualifiedUnderPickRate: number | null;
  qualifiedOverAccuracy: number | null;
  qualifiedUnderAccuracy: number | null;
  overBiasVsActualPct: number | null;
};

type ModelStateSummary = {
  modelKind: string | null;
  bucketSamples: number | null;
  bucketModelAccuracy: number | null;
  bucketLateAccuracy: number | null;
  leafCount: number | null;
  leafAccuracy: number | null;
  qualificationThresholds: LiveUniversalQualificationSettings;
};

type WeakBucketReport = {
  bucket: string;
  market: Market;
  archetype: string;
  diagnosis: "WATCH" | "TIGHTEN_QUALIFICATION" | "FORCE_BASELINE_OR_OVERRIDE";
  recommendation: string;
  modelState: ModelStateSummary;
  overall: SummaryStats;
  last14d: SummaryStats;
  last30d: SummaryStats;
  sideBias: SideBiasSummary;
  persistence: {
    firstSeenDate: string;
    lastSeenDate: string | null;
    previousBlendedAccuracy: number | null;
    previousRouteToBaselineGainPct: number | null;
    deltaBlendedAccuracy: number | null;
    deltaRouteToBaselineGainPct: number | null;
    consecutiveWeakRuns: number;
    consecutiveLiveRiskRuns: number;
    isNewWeakBucket: boolean;
    isNewLiveRiskBucket: boolean;
    isPersistentWeakBucket: boolean;
    isPersistentLiveRiskBucket: boolean;
    isWorsening: boolean;
  };
};

type ReportPayload = {
  generatedAt: string;
  source: {
    rowsFile: string;
    rowWindow: {
      from: string | null;
      to: string | null;
    };
    filters: {
      minActualMinutes: number;
      minSamples: number;
      weakThreshold: number;
    };
  };
  summary: {
    actionableBucketCount: number;
    weakestBucket: string | null;
    topRouteToBaselineBucket: string | null;
    persistentWeakBucketCount: number;
    persistentLiveRiskBucketCount: number;
    worseningBucketCount: number;
  };
  alerts: {
    newWeakBuckets: string[];
    newLiveRiskBuckets: string[];
    persistentWeakBuckets: string[];
    persistentLiveRiskBuckets: string[];
    worseningBuckets: string[];
    resolvedBuckets: string[];
  };
  buckets: WeakBucketReport[];
};

type Args = {
  input: string;
  out: string;
  mdOut: string;
  historyOut: string;
  minActualMinutes: number;
  minSamples: number;
  weakThreshold: number;
  persistentRuns: number;
  worseningDelta: number;
};

type MonitorBucketState = {
  bucket: string;
  firstSeenDate: string;
  lastSeenDate: string;
  lastDiagnosis: WeakBucketReport["diagnosis"];
  lastBlendedAccuracy: number;
  lastRouteToBaselineGainPct: number;
  lastCoveragePct: number;
  consecutiveWeakRuns: number;
  consecutiveLiveRiskRuns: number;
};

type MonitorHistoryFile = {
  updatedAt: string;
  latestReportDate: string;
  buckets: MonitorBucketState[];
};

const prisma = new PrismaClient();

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "weak-buckets-daily-report.json");
  let mdOut = path.join("exports", "weak-buckets-daily-report.md");
  let historyOut = path.join("exports", "weak-buckets-monitor-state.json");
  let minActualMinutes = 15;
  let minSamples = 50;
  let weakThreshold = 52.5;
  let persistentRuns = 2;
  let worseningDelta = 0.25;

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
    if (token === "--md-out" && next) {
      mdOut = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--md-out=")) {
      mdOut = token.slice("--md-out=".length);
      continue;
    }
    if (token === "--history-out" && next) {
      historyOut = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--history-out=")) {
      historyOut = token.slice("--history-out=".length);
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
    if (token === "--min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minSamples = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-samples=")) {
      const parsed = Number(token.slice("--min-samples=".length));
      if (Number.isFinite(parsed) && parsed > 0) minSamples = Math.floor(parsed);
      continue;
    }
    if (token === "--weak-threshold" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) weakThreshold = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--weak-threshold=")) {
      const parsed = Number(token.slice("--weak-threshold=".length));
      if (Number.isFinite(parsed)) weakThreshold = parsed;
      continue;
    }
    if (token === "--persistent-runs" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) persistentRuns = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--persistent-runs=")) {
      const parsed = Number(token.slice("--persistent-runs=".length));
      if (Number.isFinite(parsed) && parsed > 0) persistentRuns = Math.floor(parsed);
      continue;
    }
    if (token === "--worsening-delta" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) worseningDelta = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--worsening-delta=")) {
      const parsed = Number(token.slice("--worsening-delta=".length));
      if (Number.isFinite(parsed) && parsed >= 0) worseningDelta = parsed;
      continue;
    }
  }

  return { input, out, mdOut, historyOut, minActualMinutes, minSamples, weakThreshold, persistentRuns, worseningDelta };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 2);
}

function mode(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    if (!value) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  let bestValue: string | null = null;
  let bestCount = -1;
  counts.forEach((count, value) => {
    if (count > bestCount) {
      bestCount = count;
      bestValue = value;
    }
  });
  return bestValue;
}

function meanInt(values: Array<number | null | undefined>): number | null {
  const averaged = mean(values);
  if (averaged == null) return null;
  return Math.round(averaged);
}

async function loadPlayerMetaMap(rows: TrainingRow[]): Promise<Map<string, PlayerMeta>> {
  const cached = await loadPlayerMetaWithCache({
    rows: rows.map((row) => ({ playerId: row.playerId, playerName: row.playerName })),
    fetcher: async (ids) =>
      (
        await prisma.player.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            position: true,
          },
        })
      ).map((row) => ({ ...row, fullName: null })),
  });

  return new Map([...cached.entries()].map(([id, meta]) => [id, { id, position: meta.position }]));
}

function summarizePlayers(rows: TrainingRow[], playerMetaMap: Map<string, PlayerMeta>): Map<string, PlayerSummary> {
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

function resolveQualificationSettings(market: Market, archetype: string): LiveUniversalQualificationSettings {
  const defaults = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS;
  const marketOverride = defaults.marketOverrides?.[market];
  const archetypeOverrides = marketOverride?.archetypeOverrides as
    | Record<string, Partial<LiveUniversalQualificationSettings>>
    | undefined;
  const archetypeOverride = archetypeOverrides?.[archetype];

  return {
    minBucketLateAccuracy: archetypeOverride?.minBucketLateAccuracy ?? marketOverride?.minBucketLateAccuracy ?? defaults.minBucketLateAccuracy,
    minBucketSamples: archetypeOverride?.minBucketSamples ?? marketOverride?.minBucketSamples ?? defaults.minBucketSamples,
    minLeafAccuracy: archetypeOverride?.minLeafAccuracy ?? marketOverride?.minLeafAccuracy ?? defaults.minLeafAccuracy,
    minLeafCount: archetypeOverride?.minLeafCount ?? marketOverride?.minLeafCount ?? defaults.minLeafCount,
    minProjectionWinProbability:
      archetypeOverride?.minProjectionWinProbability ??
      marketOverride?.minProjectionWinProbability ??
      defaults.minProjectionWinProbability,
    minProjectionPriceEdge:
      archetypeOverride?.minProjectionPriceEdge ??
      marketOverride?.minProjectionPriceEdge ??
      defaults.minProjectionPriceEdge,
  };
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
    const rawCorrect = rawAvailable && rawDecision.rawSide === row.actualSide;
    const baselineCorrect = row.finalSide === row.actualSide;
    const qualified = qualifiedDecision.side === "OVER" || qualifiedDecision.side === "UNDER";
    const qualifiedCorrect = qualified && qualifiedDecision.side === row.actualSide;
    const blendedSide = qualified ? qualifiedDecision.side : row.finalSide;
    const blendedCorrect = blendedSide === row.actualSide;
    const archetype = rawDecision.archetype ?? "UNCLASSIFIED";

    return {
      market: row.market,
      bucketKey: `${row.market}|${archetype}`,
      archetype,
      gameDateEt: row.gameDateEt,
      actualSide: row.actualSide,
      finalSide: row.finalSide,
      rawDecision,
      baselineCorrect,
      rawAvailable,
      rawCorrect,
      qualified,
      qualifiedCorrect,
      blendedCorrect,
      routeToBaselineGain: qualified && !qualifiedCorrect && baselineCorrect,
      qualifiedSide: qualified ? (qualifiedDecision.side as Side) : null,
    };
  });
}

function summarizeStats(rows: EvaluatedRow[]): SummaryStats {
  const samples = rows.length;
  const baselineCorrect = rows.filter((row) => row.baselineCorrect).length;
  const rawCorrect = rows.filter((row) => row.rawCorrect).length;
  const qualifiedRows = rows.filter((row) => row.qualified);
  const qualifiedCorrect = qualifiedRows.filter((row) => row.qualifiedCorrect).length;
  const blendedCorrect = rows.filter((row) => row.blendedCorrect).length;
  const routeToBaselineGainRows = rows.filter((row) => row.routeToBaselineGain).length;

  return {
    samples,
    baselineAccuracy: samples > 0 ? round((baselineCorrect / samples) * 100, 2) : 0,
    rawAccuracyAllRows: samples > 0 ? round((rawCorrect / samples) * 100, 2) : 0,
    qualifiedAccuracy: qualifiedRows.length > 0 ? round((qualifiedCorrect / qualifiedRows.length) * 100, 2) : null,
    qualifiedPicks: qualifiedRows.length,
    coveragePct: samples > 0 ? round((qualifiedRows.length / samples) * 100, 2) : 0,
    blendedAccuracy: samples > 0 ? round((blendedCorrect / samples) * 100, 2) : 0,
    blendedMinusBaselinePct: samples > 0 ? round(((blendedCorrect - baselineCorrect) / samples) * 100, 2) : 0,
    routeToBaselineGainRows,
    routeToBaselineGainPct: samples > 0 ? round((routeToBaselineGainRows / samples) * 100, 2) : 0,
  };
}

function summarizeSideBias(rows: EvaluatedRow[]): SideBiasSummary {
  const samples = rows.length;
  const qualifiedRows = rows.filter((row) => row.qualified && row.qualifiedSide != null);
  const qualifiedOverRows = qualifiedRows.filter((row) => row.qualifiedSide === "OVER");
  const qualifiedUnderRows = qualifiedRows.filter((row) => row.qualifiedSide === "UNDER");
  const actualOverRows = rows.filter((row) => row.actualSide === "OVER");
  const actualUnderRows = rows.filter((row) => row.actualSide === "UNDER");

  const actualOverRate = samples > 0 ? round((actualOverRows.length / samples) * 100, 2) : 0;
  const actualUnderRate = samples > 0 ? round((actualUnderRows.length / samples) * 100, 2) : 0;
  const qualifiedOverPickRate =
    qualifiedRows.length > 0 ? round((qualifiedOverRows.length / qualifiedRows.length) * 100, 2) : null;
  const qualifiedUnderPickRate =
    qualifiedRows.length > 0 ? round((qualifiedUnderRows.length / qualifiedRows.length) * 100, 2) : null;
  const qualifiedOverAccuracy =
    qualifiedOverRows.length > 0
      ? round((qualifiedOverRows.filter((row) => row.qualifiedCorrect).length / qualifiedOverRows.length) * 100, 2)
      : null;
  const qualifiedUnderAccuracy =
    qualifiedUnderRows.length > 0
      ? round((qualifiedUnderRows.filter((row) => row.qualifiedCorrect).length / qualifiedUnderRows.length) * 100, 2)
      : null;

  return {
    actualOverRate,
    actualUnderRate,
    qualifiedOverPickRate,
    qualifiedUnderPickRate,
    qualifiedOverAccuracy,
    qualifiedUnderAccuracy,
    overBiasVsActualPct:
      qualifiedOverPickRate == null ? null : round(qualifiedOverPickRate - actualOverRate, 2),
  };
}

function summarizeModelState(rows: EvaluatedRow[]): ModelStateSummary {
  const rawRows = rows.map((row) => row.rawDecision);
  const archetype = rows[0]?.archetype ?? "UNCLASSIFIED";
  const market = rows[0]?.market;

  return {
    modelKind: mode(rawRows.map((row) => row.modelKind)),
    bucketSamples: meanInt(rawRows.map((row) => row.bucketSamples)),
    bucketModelAccuracy: mean(rawRows.map((row) => row.bucketModelAccuracy)),
    bucketLateAccuracy: mean(rawRows.map((row) => row.bucketLateAccuracy)),
    leafCount: meanInt(rawRows.map((row) => row.leafCount)),
    leafAccuracy: mean(rawRows.map((row) => row.leafAccuracy)),
    qualificationThresholds: resolveQualificationSettings(market, archetype),
  };
}

function selectRecentWindow(rows: EvaluatedRow[], uniqueDateCount: number): EvaluatedRow[] {
  const orderedDates = [...new Set(rows.map((row) => row.gameDateEt))].sort((left, right) => right.localeCompare(left));
  const allowedDates = new Set(orderedDates.slice(0, uniqueDateCount));
  return rows.filter((row) => allowedDates.has(row.gameDateEt));
}

function buildRecommendation(overall: SummaryStats): { diagnosis: WeakBucketReport["diagnosis"]; recommendation: string } {
  const baselineIsBetter = overall.baselineAccuracy > overall.blendedAccuracy;

  if (baselineIsBetter && overall.routeToBaselineGainPct >= 3) {
    return {
      diagnosis: "FORCE_BASELINE_OR_OVERRIDE",
      recommendation: "Tighten qualification immediately or force baseline for a narrow audit pass.",
    };
  }
  if (baselineIsBetter && overall.routeToBaselineGainPct >= 1) {
    return {
      diagnosis: "TIGHTEN_QUALIFICATION",
      recommendation: "Test a narrow qualification raise or safe marketFavored/lowQuality override.",
    };
  }
  return {
    diagnosis: "WATCH",
    recommendation: "Watch only. Weakness is present, but baseline rescue is too small for an immediate intervention.",
  };
}

function isLiveRiskDiagnosis(diagnosis: WeakBucketReport["diagnosis"]): boolean {
  return diagnosis === "FORCE_BASELINE_OR_OVERRIDE" || diagnosis === "TIGHTEN_QUALIFICATION";
}

function calendarDayDiff(currentDate: string, previousDate: string): number {
  const current = new Date(`${currentDate}T00:00:00Z`).getTime();
  const previous = new Date(`${previousDate}T00:00:00Z`).getTime();
  return Math.round((current - previous) / 86_400_000);
}

async function loadHistory(filePath: string): Promise<Map<string, MonitorBucketState>> {
  if (!fs.existsSync(filePath)) return new Map();
  try {
    const payload = JSON.parse(await readFile(filePath, "utf8")) as MonitorHistoryFile;
    return new Map((payload.buckets ?? []).map((bucket) => [bucket.bucket, bucket]));
  } catch {
    return new Map();
  }
}

function buildMarkdownReport(payload: ReportPayload): string {
  const lines: string[] = [];
  lines.push(`# Daily Weak-Bucket Report - ${payload.generatedAt.slice(0, 10)}`);
  lines.push("");
  lines.push(`Rows: \`${payload.source.rowsFile}\``);
  lines.push(`Window: \`${payload.source.rowWindow.from ?? "unknown"}\` -> \`${payload.source.rowWindow.to ?? "unknown"}\``);
  lines.push(
    `Filters: minActualMinutes=${payload.source.filters.minActualMinutes}, minSamples=${payload.source.filters.minSamples}, weakThreshold=${payload.source.filters.weakThreshold}`,
  );
  lines.push("");
  lines.push(
    `Actionable buckets: ${payload.summary.actionableBucketCount}. Weakest: ${payload.summary.weakestBucket ?? "none"}. Top baseline-rescue candidate: ${payload.summary.topRouteToBaselineBucket ?? "none"}. Persistent weak buckets: ${payload.summary.persistentWeakBucketCount}. Persistent live-risk buckets: ${payload.summary.persistentLiveRiskBucketCount}.`,
  );
  lines.push("");
  lines.push("Alerts:");
  lines.push(`- New weak buckets: ${payload.alerts.newWeakBuckets.join(", ") || "none"}`);
  lines.push(`- New live-risk buckets: ${payload.alerts.newLiveRiskBuckets.join(", ") || "none"}`);
  lines.push(`- Persistent weak buckets: ${payload.alerts.persistentWeakBuckets.join(", ") || "none"}`);
  lines.push(`- Persistent live-risk buckets: ${payload.alerts.persistentLiveRiskBuckets.join(", ") || "none"}`);
  lines.push(`- Worsening buckets: ${payload.alerts.worseningBuckets.join(", ") || "none"}`);
  lines.push(`- Resolved buckets: ${payload.alerts.resolvedBuckets.join(", ") || "none"}`);
  lines.push("");
  lines.push("| Bucket | Model | Blended | Base | Cov | Route->Base | 14d | 30d | Weak Streak | Risk Streak | Rec |");
  lines.push("|--------|-------|---------|------|-----|-------------|-----|-----|-------------|-------------|-----|");
  payload.buckets.forEach((bucket) => {
    lines.push(
      `| ${bucket.bucket} | ${bucket.modelState.modelKind ?? "n/a"} | ${bucket.overall.blendedAccuracy}% | ${bucket.overall.baselineAccuracy}% | ${bucket.overall.coveragePct}% | +${bucket.overall.routeToBaselineGainPct}% | ${bucket.last14d.blendedAccuracy}% | ${bucket.last30d.blendedAccuracy}% | ${bucket.persistence.consecutiveWeakRuns} | ${bucket.persistence.consecutiveLiveRiskRuns} | ${bucket.diagnosis} |`,
    );
  });
  lines.push("");
  lines.push("Top bucket notes:");
  payload.buckets.slice(0, 5).forEach((bucket) => {
    lines.push(
      `- ${bucket.bucket}: ${bucket.recommendation} Model=${bucket.modelState.modelKind ?? "n/a"}, late=${bucket.modelState.bucketLateAccuracy ?? "n/a"}, leaf=${bucket.modelState.leafAccuracy ?? "n/a"}, overBias=${bucket.sideBias.overBiasVsActualPct ?? "n/a"}%, weakStreak=${bucket.persistence.consecutiveWeakRuns}, riskStreak=${bucket.persistence.consecutiveLiveRiskRuns}.`,
    );
  });
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out);
  const mdOutPath = path.resolve(args.mdOut);
  const historyOutPath = path.resolve(args.historyOut);
  const previousHistory = await loadHistory(historyOutPath);
  const currentDate = new Date().toISOString().slice(0, 10);

  const payload = JSON.parse(await readFile(inputPath, "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(filteredRows);
  const summaries = summarizePlayers(filteredRows, playerMetaMap);
  const evaluatedRows = evaluateRows(filteredRows, summaries);

  const byBucket = new Map<string, EvaluatedRow[]>();
  evaluatedRows.forEach((row) => {
    const bucket = byBucket.get(row.bucketKey) ?? [];
    bucket.push(row);
    byBucket.set(row.bucketKey, bucket);
  });

  const weakBuckets: WeakBucketReport[] = [...byBucket.entries()]
    .map(([bucketKey, rows]) => {
      const overall = summarizeStats(rows);
      const last14d = summarizeStats(selectRecentWindow(rows, 14));
      const last30d = summarizeStats(selectRecentWindow(rows, 30));
      const sideBias = summarizeSideBias(rows);
      const modelState = summarizeModelState(rows);
      const recommendation = buildRecommendation(overall);
      const previous = previousHistory.get(bucketKey) ?? null;
      const previousGapDays = previous ? calendarDayDiff(currentDate, previous.lastSeenDate) : null;
      const previousWasLiveRisk = previous ? isLiveRiskDiagnosis(previous.lastDiagnosis) : false;
      const isLiveRisk = isLiveRiskDiagnosis(recommendation.diagnosis);
      const sameDay = previousGapDays === 0;
      const consecutiveWeakRuns =
        previous == null
          ? 1
          : sameDay
            ? previous.consecutiveWeakRuns
            : previousGapDays === 1
              ? previous.consecutiveWeakRuns + 1
              : 1;
      const consecutiveLiveRiskRuns =
        !isLiveRisk
          ? 0
          : previous == null
            ? 1
            : sameDay
              ? previousWasLiveRisk
                ? previous.consecutiveLiveRiskRuns
                : 1
              : previousGapDays === 1 && previousWasLiveRisk
                ? previous.consecutiveLiveRiskRuns + 1
                : 1;
      const deltaBlendedAccuracy =
        previous == null ? null : round(overall.blendedAccuracy - previous.lastBlendedAccuracy, 2);
      const deltaRouteToBaselineGainPct =
        previous == null ? null : round(overall.routeToBaselineGainPct - previous.lastRouteToBaselineGainPct, 2);
      const isNewWeakBucket = previous == null || (previousGapDays != null && previousGapDays > 1);
      const isNewLiveRiskBucket = isLiveRisk && (previous == null || !previousWasLiveRisk || (previousGapDays != null && previousGapDays > 1));
      const isPersistentWeakBucket = consecutiveWeakRuns >= args.persistentRuns;
      const isPersistentLiveRiskBucket = consecutiveLiveRiskRuns >= args.persistentRuns;
      const isWorsening =
        previous != null &&
        ((deltaBlendedAccuracy != null && deltaBlendedAccuracy <= -args.worseningDelta) ||
          (deltaRouteToBaselineGainPct != null && deltaRouteToBaselineGainPct >= args.worseningDelta));

      return {
        bucket: bucketKey,
        market: rows[0].market,
        archetype: rows[0].archetype,
        diagnosis: recommendation.diagnosis,
        recommendation: recommendation.recommendation,
        modelState,
        overall,
        last14d,
        last30d,
        sideBias,
        persistence: {
          firstSeenDate: previous?.firstSeenDate ?? currentDate,
          lastSeenDate: previous?.lastSeenDate ?? null,
          previousBlendedAccuracy: previous?.lastBlendedAccuracy ?? null,
          previousRouteToBaselineGainPct: previous?.lastRouteToBaselineGainPct ?? null,
          deltaBlendedAccuracy,
          deltaRouteToBaselineGainPct,
          consecutiveWeakRuns,
          consecutiveLiveRiskRuns,
          isNewWeakBucket,
          isNewLiveRiskBucket,
          isPersistentWeakBucket,
          isPersistentLiveRiskBucket,
          isWorsening,
        },
      };
    })
    .filter((bucket) => bucket.overall.samples >= args.minSamples && bucket.overall.blendedAccuracy < args.weakThreshold)
    .sort((left, right) => {
      const diagnosisRank = (diagnosis: WeakBucketReport["diagnosis"]): number => {
        if (diagnosis === "FORCE_BASELINE_OR_OVERRIDE") return 3;
        if (diagnosis === "TIGHTEN_QUALIFICATION") return 2;
        return 1;
      };
      if (diagnosisRank(left.diagnosis) !== diagnosisRank(right.diagnosis)) {
        return diagnosisRank(right.diagnosis) - diagnosisRank(left.diagnosis);
      }
      if (left.overall.coveragePct !== right.overall.coveragePct) {
        return right.overall.coveragePct - left.overall.coveragePct;
      }
      if (left.overall.routeToBaselineGainPct !== right.overall.routeToBaselineGainPct) {
        return right.overall.routeToBaselineGainPct - left.overall.routeToBaselineGainPct;
      }
      if (left.overall.blendedAccuracy !== right.overall.blendedAccuracy) {
        return left.overall.blendedAccuracy - right.overall.blendedAccuracy;
      }
      return right.overall.samples - left.overall.samples;
    });

  const resolvedBuckets = [...previousHistory.values()]
    .filter((bucket) => !weakBuckets.some((current) => current.bucket === bucket.bucket))
    .map((bucket) => bucket.bucket)
    .sort();

  const nextHistoryBuckets = new Map(previousHistory);
  weakBuckets.forEach((bucket) => {
    nextHistoryBuckets.set(bucket.bucket, {
      bucket: bucket.bucket,
      firstSeenDate: bucket.persistence.firstSeenDate,
      lastSeenDate: currentDate,
      lastDiagnosis: bucket.diagnosis,
      lastBlendedAccuracy: bucket.overall.blendedAccuracy,
      lastRouteToBaselineGainPct: bucket.overall.routeToBaselineGainPct,
      lastCoveragePct: bucket.overall.coveragePct,
      consecutiveWeakRuns: bucket.persistence.consecutiveWeakRuns,
      consecutiveLiveRiskRuns: bucket.persistence.consecutiveLiveRiskRuns,
    });
  });

  const alerts = {
    newWeakBuckets: weakBuckets.filter((bucket) => bucket.persistence.isNewWeakBucket).map((bucket) => bucket.bucket),
    newLiveRiskBuckets: weakBuckets.filter((bucket) => bucket.persistence.isNewLiveRiskBucket).map((bucket) => bucket.bucket),
    persistentWeakBuckets: weakBuckets
      .filter((bucket) => bucket.persistence.isPersistentWeakBucket)
      .map((bucket) => bucket.bucket),
    persistentLiveRiskBuckets: weakBuckets
      .filter((bucket) => bucket.persistence.isPersistentLiveRiskBucket)
      .map((bucket) => bucket.bucket),
    worseningBuckets: weakBuckets.filter((bucket) => bucket.persistence.isWorsening).map((bucket) => bucket.bucket),
    resolvedBuckets,
  };

  const report: ReportPayload = {
    generatedAt: new Date().toISOString(),
    source: {
      rowsFile: inputPath,
      rowWindow: {
        from: payload.from ?? null,
        to: payload.to ?? null,
      },
      filters: {
        minActualMinutes: args.minActualMinutes,
        minSamples: args.minSamples,
        weakThreshold: args.weakThreshold,
      },
    },
    summary: {
      actionableBucketCount: weakBuckets.length,
      weakestBucket: weakBuckets[0]?.bucket ?? null,
      topRouteToBaselineBucket:
        weakBuckets.slice().sort((left, right) => right.overall.routeToBaselineGainPct - left.overall.routeToBaselineGainPct)[0]
          ?.bucket ?? null,
      persistentWeakBucketCount: alerts.persistentWeakBuckets.length,
      persistentLiveRiskBucketCount: alerts.persistentLiveRiskBuckets.length,
      worseningBucketCount: alerts.worseningBuckets.length,
    },
    alerts,
    buckets: weakBuckets,
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdOutPath, buildMarkdownReport(report), "utf8");
  await writeFile(
    historyOutPath,
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        latestReportDate: currentDate,
        buckets: [...nextHistoryBuckets.values()].sort((left, right) => left.bucket.localeCompare(right.bucket)),
      } satisfies MonitorHistoryFile,
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Weak-bucket report generated: ${weakBuckets.length} actionable buckets`);
  console.log(`JSON: ${outPath}`);
  console.log(`Markdown: ${mdOutPath}`);
  console.log(`History: ${historyOutPath}`);
  console.log(
    `Alerts -> newWeak=${alerts.newWeakBuckets.length}, newLiveRisk=${alerts.newLiveRiskBuckets.length}, persistentWeak=${alerts.persistentWeakBuckets.length}, persistentLiveRisk=${alerts.persistentLiveRiskBuckets.length}, worsening=${alerts.worseningBuckets.length}, resolved=${alerts.resolvedBuckets.length}`,
  );
  if (weakBuckets.length === 0) {
    console.log("No buckets are below the current weak threshold.");
    return;
  }
  weakBuckets.slice(0, 10).forEach((bucket) => {
    console.log(
      `${bucket.bucket.padEnd(35)} | blended ${bucket.overall.blendedAccuracy.toFixed(2)}% | base ${bucket.overall.baselineAccuracy.toFixed(2)}% | cov ${bucket.overall.coveragePct.toFixed(2)}% | route->base +${bucket.overall.routeToBaselineGainPct.toFixed(2)}% | 14d ${bucket.last14d.blendedAccuracy.toFixed(2)}% | 30d ${bucket.last30d.blendedAccuracy.toFixed(2)}% | ${bucket.diagnosis}`,
    );
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
import { attachCurrentLineRecencyMetrics } from "../lib/snapshot/currentLineRecency";
import { round } from "../lib/utils";
import { loadPlayerMetaWithCache } from "./utils/playerMetaCache";

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";

type TrainingRow = {
  playerId: string;
  playerName: string;
  market: Market;
  gameDateEt: string;
  projectedValue: number;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection?: number | null;
  threesProjection?: number | null;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  projectionSide: Side;
  finalSide: Side;
  actualSide: Side;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  seasonMinutesAvg?: number | null;
  minutesLiftPct?: number | null;
  activeCorePts?: number | null;
  activeCoreAst?: number | null;
  missingCorePts?: number | null;
  missingCoreAst?: number | null;
  missingCoreShare?: number | null;
  stepUpRoleFlag?: number | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability?: number | null;
  l5CurrentLineDeltaAvg?: number | null;
  l5CurrentLineOverRate?: number | null;
  l5MinutesAvg?: number | null;
  emaCurrentLineDelta?: number | null;
  emaCurrentLineOverRate?: number | null;
  emaMinutesAvg?: number | null;
  l15ValueMean?: number | null;
  l15ValueMedian?: number | null;
  l15ValueStdDev?: number | null;
  l15ValueSkew?: number | null;
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
  from: string;
  to: string;
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
  playerId: string;
  playerName: string;
  gameDateEt: string;
  market: Market;
  projectedValue: number;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistProjection: number | null;
  threesProjection: number | null;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  seasonMinutesAvg: number | null;
  minutesLiftPct: number | null;
  activeCorePts: number | null;
  activeCoreAst: number | null;
  missingCorePts: number | null;
  missingCoreAst: number | null;
  missingCoreShare: number | null;
  stepUpRoleFlag: number | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability: number | null;
  l5CurrentLineDeltaAvg: number | null;
  l5CurrentLineOverRate: number | null;
  l5MinutesAvg: number | null;
  emaCurrentLineDelta: number | null;
  emaCurrentLineOverRate: number | null;
  emaMinutesAvg: number | null;
  l15ValueMean: number | null;
  l15ValueMedian: number | null;
  l15ValueStdDev: number | null;
  l15ValueSkew: number | null;
  actualMinutes: number;
  lineGap: number;
  absLineGap: number;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  spreadResolved: boolean;
  actualSide: Side;
  finalSide: Side;
  rawDecision: RawLiveUniversalModelDecision;
};

type SummaryStats = {
  samples: number;
  rawAccuracy: number;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number;
  blendedAccuracy: number;
};

type HeadlineMetrics = {
  rawAccuracy: number;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number;
  blendedAccuracy: number;
};

type SweepResult = SummaryStats & LiveUniversalQualificationSettings;

type Args = {
  input: string;
  out: string | null;
  detailsOut: string | null;
  minActualMinutes: number;
  minBucketLateAccuracy: number;
  minBucketSamples: number;
  minLeafAccuracy: number;
  minLeafCount: number;
  minProjectionWinProbability: number;
  minProjectionPriceEdge: number;
  useMarketOverrides: boolean;
  sweep: boolean;
  disableLiveCalibration: boolean;
  disableLiveProjectionDistribution: boolean;
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
  let out: string | null = path.join("exports", "universal-model-qualification-eval.json");
  let detailsOut: string | null = null;
  let minActualMinutes = 15;
  let minBucketLateAccuracy = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS.minBucketLateAccuracy;
  let minBucketSamples = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS.minBucketSamples;
  let minLeafAccuracy = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS.minLeafAccuracy;
  let minLeafCount = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS.minLeafCount;
  let minProjectionWinProbability = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS.minProjectionWinProbability;
  let minProjectionPriceEdge = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS.minProjectionPriceEdge;
  let useMarketOverrides = true;
  let sweep = false;
  let disableLiveCalibration = false;
  let disableLiveProjectionDistribution = false;

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
    if (token === "--no-out") {
      out = null;
      continue;
    }
    if ((token === "--details-out" || token === "--row-details-out") && next) {
      detailsOut = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--details-out=") || token.startsWith("--row-details-out=")) {
      detailsOut = token.includes("--row-details-out=")
        ? token.slice("--row-details-out=".length)
        : token.slice("--details-out=".length);
      continue;
    }
    if (token === "--no-market-overrides") {
      useMarketOverrides = false;
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
    if (token === "--min-bucket-late-accuracy" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) minBucketLateAccuracy = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--min-bucket-late-accuracy=")) {
      const parsed = Number(token.slice("--min-bucket-late-accuracy=".length));
      if (Number.isFinite(parsed)) minBucketLateAccuracy = parsed;
      continue;
    }
    if (token === "--min-bucket-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minBucketSamples = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-bucket-samples=")) {
      const parsed = Number(token.slice("--min-bucket-samples=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minBucketSamples = Math.floor(parsed);
      continue;
    }
    if (token === "--min-leaf-accuracy" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) minLeafAccuracy = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--min-leaf-accuracy=")) {
      const parsed = Number(token.slice("--min-leaf-accuracy=".length));
      if (Number.isFinite(parsed)) minLeafAccuracy = parsed;
      continue;
    }
    if (token === "--min-leaf-count" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minLeafCount = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-leaf-count=")) {
      const parsed = Number(token.slice("--min-leaf-count=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minLeafCount = Math.floor(parsed);
      continue;
    }
    if (token === "--sweep") {
      sweep = true;
      continue;
    }
    if (token === "--disable-live-calibration") {
      disableLiveCalibration = true;
      continue;
    }
    if (token === "--disable-live-projection-distribution") {
      disableLiveProjectionDistribution = true;
      continue;
    }
    if (token === "--min-projection-win-probability" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) minProjectionWinProbability = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--min-projection-win-probability=")) {
      const parsed = Number(token.slice("--min-projection-win-probability=".length));
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) minProjectionWinProbability = parsed;
      continue;
    }
    if (token === "--min-projection-price-edge" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) minProjectionPriceEdge = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--min-projection-price-edge=")) {
      const parsed = Number(token.slice("--min-projection-price-edge=".length));
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) minProjectionPriceEdge = parsed;
      continue;
    }
  }

  return {
    input,
    out,
    detailsOut,
    minActualMinutes,
    minBucketLateAccuracy,
    minBucketSamples,
    minLeafAccuracy,
    minLeafCount,
    minProjectionWinProbability,
    minProjectionPriceEdge,
    useMarketOverrides,
    sweep,
    disableLiveCalibration,
    disableLiveProjectionDistribution,
  };
}

function cloneMarketOverrides(): NonNullable<LiveUniversalQualificationSettings["marketOverrides"]> | undefined {
  if (!DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS.marketOverrides) return undefined;
  return Object.fromEntries(
    Object.entries(DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS.marketOverrides).map(([market, override]) => [
      market,
      override
        ? {
            ...override,
            archetypeOverrides: override.archetypeOverrides
              ? Object.fromEntries(
                  Object.entries(override.archetypeOverrides).map(([archetype, archetypeOverride]) => [
                    archetype,
                    archetypeOverride ? { ...archetypeOverride } : archetypeOverride,
                  ]),
                )
              : undefined,
          }
        : override,
    ]),
  );
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

async function loadPlayerMetaMap(playerIds: string[]): Promise<Map<string, PlayerMeta>> {
  const cached = await loadPlayerMetaWithCache({
    rows: playerIds.map((playerId) => ({ playerId })),
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
  const ungatedSettings: LiveUniversalQualificationSettings = {
    minBucketLateAccuracy: 0,
    minBucketSamples: 0,
    minLeafAccuracy: 0,
    minLeafCount: 0,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
  };

  return rows.map((row) => {
    const summary = summaries.get(row.playerId);
    const rawDecision = qualifyLiveUniversalModelDecision(
      inspectLiveUniversalModelSide({
        market: row.market,
        projectedValue: row.projectedValue,
        line: row.line,
        overPrice: row.overPrice,
        underPrice: row.underPrice,
        finalSide: row.finalSide,
        l5CurrentLineDeltaAvg: row.l5CurrentLineDeltaAvg ?? null,
        l5CurrentLineOverRate: row.l5CurrentLineOverRate ?? null,
        l5MinutesAvg: row.l5MinutesAvg ?? null,
        emaCurrentLineDelta: row.emaCurrentLineDelta ?? null,
        emaCurrentLineOverRate: row.emaCurrentLineOverRate ?? null,
        emaMinutesAvg: row.emaMinutesAvg ?? null,
        l15ValueMean: row.l15ValueMean ?? null,
        l15ValueMedian: row.l15ValueMedian ?? null,
        l15ValueStdDev: row.l15ValueStdDev ?? null,
        l15ValueSkew: row.l15ValueSkew ?? null,
        projectionMedianDelta:
          row.l15ValueMedian == null ? null : round(row.projectedValue - row.l15ValueMedian, 4),
        medianLineGap: row.l15ValueMedian == null ? null : round(row.l15ValueMedian - row.line, 4),
        competitivePaceFactor:
          row.openingTotal == null ? null : round(row.openingTotal / Math.max(Math.abs(row.openingTeamSpread ?? 0), 1), 4),
        blowoutRisk:
          row.openingTotal == null || row.openingTeamSpread == null
            ? null
            : round(Math.abs(row.openingTeamSpread) / Math.max(row.openingTotal, 1), 4),
        seasonMinutesAvg: row.seasonMinutesAvg ?? null,
        minutesLiftPct: row.minutesLiftPct ?? null,
        activeCorePts: row.activeCorePts ?? null,
        activeCoreAst: row.activeCoreAst ?? null,
        missingCorePts: row.missingCorePts ?? null,
        missingCoreAst: row.missingCoreAst ?? null,
        missingCoreShare: row.missingCoreShare ?? null,
        stepUpRoleFlag: row.stepUpRoleFlag ?? null,
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
        pointsProjection: row.pointsProjection ?? summary?.ptsProjectionAvg ?? null,
        reboundsProjection: row.reboundsProjection ?? summary?.rebProjectionAvg ?? null,
        assistProjection: row.assistProjection ?? summary?.astProjectionAvg ?? null,
        threesProjection: row.threesProjection ?? summary?.threesProjectionAvg ?? null,
      }),
      ungatedSettings,
    );

    return {
      playerId: row.playerId,
      playerName: row.playerName,
      gameDateEt: row.gameDateEt,
      market: row.market,
      projectedValue: row.projectedValue,
      pointsProjection: row.pointsProjection ?? null,
      reboundsProjection: row.reboundsProjection ?? null,
      assistProjection: row.assistProjection ?? null,
      threesProjection: row.threesProjection ?? null,
      actualValue: row.actualValue,
      line: row.line,
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      priceLean: row.priceLean,
      favoredSide: row.favoredSide,
      seasonMinutesAvg: row.seasonMinutesAvg ?? null,
      minutesLiftPct: row.minutesLiftPct ?? null,
      activeCorePts: row.activeCorePts ?? null,
      activeCoreAst: row.activeCoreAst ?? null,
      missingCorePts: row.missingCorePts ?? null,
      missingCoreAst: row.missingCoreAst ?? null,
      missingCoreShare: row.missingCoreShare ?? null,
      stepUpRoleFlag: row.stepUpRoleFlag ?? null,
      expectedMinutes: row.expectedMinutes,
      minutesVolatility: row.minutesVolatility,
      starterRateLast10: row.starterRateLast10,
      benchBigRoleStability: row.benchBigRoleStability ?? null,
      l5CurrentLineDeltaAvg: row.l5CurrentLineDeltaAvg ?? null,
      l5CurrentLineOverRate: row.l5CurrentLineOverRate ?? null,
      l5MinutesAvg: row.l5MinutesAvg ?? null,
      emaCurrentLineDelta: row.emaCurrentLineDelta ?? null,
      emaCurrentLineOverRate: row.emaCurrentLineOverRate ?? null,
      emaMinutesAvg: row.emaMinutesAvg ?? null,
      l15ValueMean: row.l15ValueMean ?? null,
      l15ValueMedian: row.l15ValueMedian ?? null,
      l15ValueStdDev: row.l15ValueStdDev ?? null,
      l15ValueSkew: row.l15ValueSkew ?? null,
      actualMinutes: row.actualMinutes,
      lineGap: row.lineGap,
      absLineGap: row.absLineGap,
      openingTeamSpread: row.openingTeamSpread,
      openingTotal: row.openingTotal,
      lineupTimingConfidence: row.lineupTimingConfidence,
      completenessScore: row.completenessScore,
      spreadResolved: row.spreadResolved,
      actualSide: row.actualSide,
      finalSide: row.finalSide,
      rawDecision,
    };
  });
}

function summarizeEvaluatedRows(rows: EvaluatedRow[], settings: LiveUniversalQualificationSettings): SummaryStats {
  let rawCorrect = 0;
  let qualifiedPicks = 0;
  let qualifiedCorrect = 0;
  let blendedCorrect = 0;

  rows.forEach((row) => {
    const decision = qualifyLiveUniversalModelDecision(row.rawDecision, settings);
    if (row.rawDecision.rawSide === row.actualSide) rawCorrect += 1;
    if (decision.side !== "NEUTRAL") {
      qualifiedPicks += 1;
      if (decision.side === row.actualSide) qualifiedCorrect += 1;
    }
    const blendedSide = decision.side === "NEUTRAL" ? row.finalSide : decision.side;
    if (blendedSide === row.actualSide) blendedCorrect += 1;
  });

  return {
    samples: rows.length,
    rawAccuracy: round((rawCorrect / rows.length) * 100, 2),
    qualifiedAccuracy: qualifiedPicks > 0 ? round((qualifiedCorrect / qualifiedPicks) * 100, 2) : null,
    qualifiedPicks,
    coveragePct: round((qualifiedPicks / rows.length) * 100, 2),
    blendedAccuracy: round((blendedCorrect / rows.length) * 100, 2),
  };
}

function buildHeadlineMetrics(stats: SummaryStats): HeadlineMetrics {
  return {
    rawAccuracy: stats.rawAccuracy,
    qualifiedAccuracy: stats.qualifiedAccuracy,
    qualifiedPicks: stats.qualifiedPicks,
    coveragePct: stats.coveragePct,
    blendedAccuracy: stats.blendedAccuracy,
  };
}

function buildSweep(rows: EvaluatedRow[]): SweepResult[] {
  const bucketLateThresholds = [58, 60, 62, 64, 66, 68];
  const bucketSampleThresholds = [0, 25, 50, 100];
  const leafAccuracyThresholds = [0, 55, 60, 65, 70];
  const leafCountThresholds = [0, 5, 10, 20, 30];
  const projectionWinProbabilityThresholds = [0, 0.52, 0.54, 0.56];
  const projectionPriceEdgeThresholds = [0, 0.005, 0.01, 0.02];

  const results: SweepResult[] = [];

  for (const minBucketLateAccuracy of bucketLateThresholds) {
    for (const minBucketSamples of bucketSampleThresholds) {
      for (const minLeafAccuracy of leafAccuracyThresholds) {
        for (const minLeafCount of leafCountThresholds) {
          for (const minProjectionWinProbability of projectionWinProbabilityThresholds) {
            for (const minProjectionPriceEdge of projectionPriceEdgeThresholds) {
              const settings: LiveUniversalQualificationSettings = {
                minBucketLateAccuracy,
                minBucketSamples,
                minLeafAccuracy,
                minLeafCount,
                minProjectionWinProbability,
                minProjectionPriceEdge,
              };
              const summary = summarizeEvaluatedRows(rows, settings);
              results.push({
                ...settings,
                ...summary,
              });
            }
          }
        }
      }
    }
  }

  return results
    .filter((result) => result.qualifiedAccuracy != null && result.qualifiedAccuracy >= 70)
    .sort((left, right) => {
      if (right.coveragePct !== left.coveragePct) return right.coveragePct - left.coveragePct;
      if (right.blendedAccuracy !== left.blendedAccuracy) return right.blendedAccuracy - left.blendedAccuracy;
      return (right.qualifiedAccuracy ?? 0) - (left.qualifiedAccuracy ?? 0);
    });
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.disableLiveCalibration) {
    process.env.SNAPSHOT_UNIVERSAL_DISABLE_CALIBRATION = "1";
  } else {
    delete process.env.SNAPSHOT_UNIVERSAL_DISABLE_CALIBRATION;
  }
  if (args.disableLiveProjectionDistribution) {
    process.env.SNAPSHOT_UNIVERSAL_DISABLE_PROJECTION_DISTRIBUTION = "1";
  } else {
    delete process.env.SNAPSHOT_UNIVERSAL_DISABLE_PROJECTION_DISTRIBUTION;
  }
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const filteredRows = attachCurrentLineRecencyMetrics(
    payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes),
  );
  const playerMetaMap = await loadPlayerMetaMap([...new Set(filteredRows.map((row) => row.playerId))]);
  const summaries = summarizeRows(filteredRows, playerMetaMap);
  const evaluatedRows = evaluateRows(filteredRows, summaries);
  const settings: LiveUniversalQualificationSettings = {
    minBucketLateAccuracy: args.minBucketLateAccuracy,
    minBucketSamples: args.minBucketSamples,
    minLeafAccuracy: args.minLeafAccuracy,
    minLeafCount: args.minLeafCount,
    minProjectionWinProbability: args.minProjectionWinProbability,
    minProjectionPriceEdge: args.minProjectionPriceEdge,
    marketOverrides: args.useMarketOverrides ? cloneMarketOverrides() : undefined,
  };

  const overall = summarizeEvaluatedRows(evaluatedRows, settings);
  const byMarket = Object.fromEntries(
    (["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"] as Market[]).map((market) => [
      market,
      summarizeEvaluatedRows(
        evaluatedRows.filter((row) => row.market === market),
        settings,
      ),
    ]),
  );

  const output = {
    input: args.input,
    from: payload.from,
    to: payload.to,
    metricPriority: ["rawAccuracy", "qualifiedAccuracy", "blendedAccuracy"],
    metricDefinitions: {
      rawAccuracy: "True model-side accuracy on every row before the qualification gate.",
      qualifiedAccuracy: "Accuracy on rows that pass the qualification gate.",
      blendedAccuracy: "Portfolio accuracy after non-qualified rows fall back to the baseline finalSide.",
    },
    filters: {
      minActualMinutes: args.minActualMinutes,
    },
    settings,
    headlineMetrics: buildHeadlineMetrics(overall),
    overall,
    byMarket,
    sweepTopResults: args.sweep && !settings.marketOverrides ? buildSweep(evaluatedRows).slice(0, 25) : [],
  };

  if (args.out) {
    const outPath = path.resolve(args.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
  if (args.detailsOut) {
    const detailsOutPath = path.resolve(args.detailsOut);
    await mkdir(path.dirname(detailsOutPath), { recursive: true });
    await writeFile(detailsOutPath, `${JSON.stringify(evaluatedRows, null, 2)}\n`, "utf8");
  }

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

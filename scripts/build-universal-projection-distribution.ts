import { mkdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";
import {
  inspectLiveUniversalModelSide,
  type Archetype,
} from "../lib/snapshot/liveUniversalSideModels";
import {
  DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_PROJECTION_DISTRIBUTION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { attachCurrentLineRecencyMetrics } from "../lib/snapshot/currentLineRecency";
import {
  buildUniversalProjectionDistributionKey,
  type UniversalProjectionDistributionFile,
  type UniversalProjectionDistributionRecord,
  type UniversalProjectionDistributionScope,
} from "../lib/snapshot/universalProjectionDistribution";
import type { SnapshotMarket, SnapshotModelSide } from "../lib/types/snapshot";

type Side = "OVER" | "UNDER";
type Market = SnapshotMarket;

type TrainingRow = {
  playerId: string;
  playerName: string;
  gameDateEt: string;
  market: Market;
  projectedValue: number;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection?: number | null;
  threesProjection?: number | null;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  finalSide: Side;
  actualSide: Side;
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
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
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

type Args = {
  input: string;
  out: string;
  modelFile: string | null;
  minSamples: number;
};

type GroupStat = {
  scope: UniversalProjectionDistributionScope;
  market: Market;
  archetype: Archetype | null;
  minutesBucket: UniversalProjectionDistributionRecord["minutesBucket"];
  residuals: number[];
};

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return null;
  return round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length);
}

function median(values: number[]): number | null {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (filtered.length === 0) return null;
  const middle = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 1) return round(filtered[middle]);
  return round((filtered[middle - 1] + filtered[middle]) / 2);
}

function percentile(values: number[], pct: number): number | null {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (filtered.length === 0) return null;
  if (filtered.length === 1) return round(filtered[0]);
  const clampedPct = Math.max(0, Math.min(1, pct));
  const index = clampedPct * (filtered.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round(filtered[lower]);
  const weight = index - lower;
  return round(filtered[lower] * (1 - weight) + filtered[upper] * weight);
}

function standardDeviation(values: number[]): number | null {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length < 2) return null;
  const avg = filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
  const variance =
    filtered.reduce((sum, value) => {
      const diff = value - avg;
      return sum + diff * diff;
    }, 0) / filtered.length;
  return round(Math.sqrt(Math.max(variance, 0)));
}

function medianAbsoluteDeviation(values: number[], med: number | null): number | null {
  if (med == null) return null;
  const deviations = values.filter((value) => Number.isFinite(value)).map((value) => Math.abs(value - med));
  return median(deviations);
}

function resolveDefaultRowsInput(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function resolveDefaultModelInput(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultRowsInput();
  let out = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_PROJECTION_DISTRIBUTION_RELATIVE_PATH);
  let modelFile: string | null = null;
  let minSamples = 18;

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    const next = raw[i + 1];
    if ((token === "--input" || token === "-i") && next) {
      input = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      input = token.slice("--input=".length);
      continue;
    }
    if ((token === "--out" || token === "-o") && next) {
      out = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if (token === "--model-file" && next) {
      modelFile = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--model-file=")) {
      modelFile = token.slice("--model-file=".length);
      continue;
    }
    if (token === "--min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) minSamples = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (token.startsWith("--min-samples=")) {
      const parsed = Number(token.slice("--min-samples=".length));
      if (Number.isFinite(parsed) && parsed >= 1) minSamples = Math.floor(parsed);
    }
  }

  return {
    input: path.isAbsolute(input) ? input : path.join(process.cwd(), input),
    out: path.isAbsolute(out) ? out : path.join(process.cwd(), out),
    modelFile: modelFile == null ? null : path.isAbsolute(modelFile) ? modelFile : path.join(process.cwd(), modelFile),
    minSamples,
  };
}

async function loadRows(inputPath: string): Promise<TrainingRow[]> {
  const raw = JSON.parse(await readFile(inputPath, "utf8")) as { playerMarketRows?: TrainingRow[] } | TrainingRow[];
  const rows = Array.isArray(raw) ? raw : raw.playerMarketRows ?? [];
  return attachCurrentLineRecencyMetrics(
    rows.filter(
      (row): row is TrainingRow =>
        (row.actualSide === "OVER" || row.actualSide === "UNDER") &&
        Number.isFinite(row.projectedValue) &&
        Number.isFinite(row.actualValue),
    ),
  );
}

async function loadPlayerMetaMap(playerIds: string[]): Promise<Map<string, PlayerMeta>> {
  const rows = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: {
      id: true,
      position: true,
    },
  });
  return new Map(rows.map((row) => [row.id, row]));
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
      avgExpectedMinutes: mean(playerRows.map((row) => row.expectedMinutes ?? Number.NaN)) ?? null,
      avgStarterRate: mean(playerRows.map((row) => row.starterRateLast10 ?? Number.NaN)) ?? null,
      ptsProjectionAvg: mean(ptsRows.map((row) => row.projectedValue)) ?? null,
      rebProjectionAvg: mean(rebRows.map((row) => row.projectedValue)) ?? null,
      astProjectionAvg: mean(astRows.map((row) => row.projectedValue)) ?? null,
      threesProjectionAvg: mean(threesRows.map((row) => row.projectedValue)) ?? null,
    });
  });

  return summaries;
}

function pushResidual(
  grouped: Map<string, GroupStat>,
  scope: UniversalProjectionDistributionScope,
  market: Market,
  archetype: Archetype | null,
  minutesBucket: UniversalProjectionDistributionRecord["minutesBucket"],
  residual: number,
): void {
  const key = buildUniversalProjectionDistributionKey(scope, market, archetype, minutesBucket);
  const existing = grouped.get(key) ?? {
    scope,
    market,
    archetype,
    minutesBucket,
    residuals: [],
  };
  existing.residuals.push(residual);
  grouped.set(key, existing);
}

function toRecord(group: GroupStat, minSamples: number): UniversalProjectionDistributionRecord | null {
  if (group.residuals.length < minSamples) return null;
  const residualMedian = median(group.residuals);
  const residualMean = mean(group.residuals);
  const residualStdDev = standardDeviation(group.residuals);
  if (residualMedian == null || residualMean == null || residualStdDev == null) return null;
  return {
    scope: group.scope,
    market: group.market,
    archetype: group.archetype,
    minutesBucket: group.minutesBucket,
    sampleCount: group.residuals.length,
    residualMean,
    residualMedian,
    residualStdDev,
    residualMad: medianAbsoluteDeviation(group.residuals, residualMedian) ?? 0,
    residualQ10: percentile(group.residuals, 0.1),
    residualQ25: percentile(group.residuals, 0.25),
    residualQ75: percentile(group.residuals, 0.75),
    residualQ90: percentile(group.residuals, 0.9),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  process.env.SNAPSHOT_UNIVERSAL_DISABLE_CALIBRATION = "1";
  process.env.SNAPSHOT_UNIVERSAL_DISABLE_PROJECTION_DISTRIBUTION = "1";
  process.env.SNAPSHOT_UNIVERSAL_MODEL_FILE = args.modelFile ?? resolveDefaultModelInput();

  const rows = await loadRows(args.input);
  const playerMetaMap = await loadPlayerMetaMap(Array.from(new Set(rows.map((row) => row.playerId))));
  const summaries = summarizeRows(rows, playerMetaMap);
  const grouped = new Map<string, GroupStat>();

  rows.forEach((row) => {
    const summary = summaries.get(row.playerId);
    const decision = inspectLiveUniversalModelSide({
      market: row.market,
      projectedValue: row.projectedValue,
      line: row.line,
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      finalSide: row.finalSide as SnapshotModelSide,
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
    });

    if (!decision.archetype || !decision.minutesBucket) return;

    const residual = round(row.actualValue - row.projectedValue, 4);
    pushResidual(grouped, "market_archetype_minutes", row.market, decision.archetype, decision.minutesBucket, residual);
    pushResidual(grouped, "market_minutes", row.market, null, decision.minutesBucket, residual);
    pushResidual(grouped, "market", row.market, null, null, residual);
  });

  const records = [...grouped.values()]
    .map((group) => toRecord(group, args.minSamples))
    .filter((record): record is UniversalProjectionDistributionRecord => record != null)
    .sort((left, right) => {
      if (left.market !== right.market) return left.market.localeCompare(right.market);
      if (left.scope !== right.scope) return left.scope.localeCompare(right.scope);
      if ((left.archetype ?? "") !== (right.archetype ?? "")) return (left.archetype ?? "").localeCompare(right.archetype ?? "");
      return (left.minutesBucket ?? "").localeCompare(right.minutesBucket ?? "");
    });

  const payload: UniversalProjectionDistributionFile = {
    generatedAt: new Date().toISOString(),
    inputFile: args.input,
    modelFile: process.env.SNAPSHOT_UNIVERSAL_MODEL_FILE ?? resolveDefaultModelInput(),
    records,
  };

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        input: args.input,
        out: args.out,
        records: records.length,
        minSamples: args.minSamples,
        scopes: {
          marketArchetypeMinutes: records.filter((record) => record.scope === "market_archetype_minutes").length,
          marketMinutes: records.filter((record) => record.scope === "market_minutes").length,
          market: records.filter((record) => record.scope === "market").length,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

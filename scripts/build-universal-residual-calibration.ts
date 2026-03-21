import { mkdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";
import {
  inspectLiveUniversalModelSide,
  type Archetype,
} from "../lib/snapshot/liveUniversalSideModels";
import {
  DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { attachCurrentLineRecencyMetrics } from "../lib/snapshot/currentLineRecency";
import {
  buildUniversalResidualCalibrationKey,
  type UniversalResidualCalibrationFile,
  type UniversalResidualCalibrationRecord,
} from "../lib/snapshot/universalResidualCalibration";
import { etDateShift } from "../lib/snapshot/time";
import type { SnapshotMarket, SnapshotModelSide } from "../lib/types/snapshot";

type Side = "OVER" | "UNDER";
type Market = SnapshotMarket;

type TrainingRow = {
  playerId: string;
  playerName: string;
  gameDateEt: string;
  market: Market;
  projectedValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  finalSide: Side;
  actualSide: Side;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability?: number | null;
  l5CurrentLineDeltaAvg?: number | null;
  l5CurrentLineOverRate?: number | null;
  l5MinutesAvg?: number | null;
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
  shortWindowDays: number;
  longWindowDays: number;
  minSamples: number;
  minRecentSamples: number;
  maxAdjustment: number;
  adjustmentMode: "penalties_only" | "symmetric";
  markets: Market[];
  archetypes: string[];
  families: string[];
  scale: number;
};

type GroupStat = {
  market: Market;
  archetype: Archetype;
  minutesBucket: UniversalResidualCalibrationRecord["minutesBucket"];
  samples: Array<{ gameDateEt: string; correct: boolean }>;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length, 3);
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
  let out = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH);
  let modelFile: string | null = null;
  let shortWindowDays = 7;
  let longWindowDays = 14;
  let minSamples = 80;
  let minRecentSamples = 18;
  let maxAdjustment = 5;
  let adjustmentMode: Args["adjustmentMode"] = "penalties_only";
  const markets: Market[] = [];
  const archetypes: string[] = [];
  const families: string[] = [];
  let scale = 1;

  const pushList = (target: string[], value: string): void => {
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => target.push(entry));
  };

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
    if (token === "--short-window-days" && next) {
      shortWindowDays = Number(next) || shortWindowDays;
      i += 1;
      continue;
    }
    if (token.startsWith("--short-window-days=")) {
      shortWindowDays = Number(token.slice("--short-window-days=".length)) || shortWindowDays;
      continue;
    }
    if (token === "--long-window-days" && next) {
      longWindowDays = Number(next) || longWindowDays;
      i += 1;
      continue;
    }
    if (token.startsWith("--long-window-days=")) {
      longWindowDays = Number(token.slice("--long-window-days=".length)) || longWindowDays;
      continue;
    }
    if (token === "--min-samples" && next) {
      minSamples = Number(next) || minSamples;
      i += 1;
      continue;
    }
    if (token.startsWith("--min-samples=")) {
      minSamples = Number(token.slice("--min-samples=".length)) || minSamples;
      continue;
    }
    if (token === "--min-recent-samples" && next) {
      minRecentSamples = Number(next) || minRecentSamples;
      i += 1;
      continue;
    }
    if (token.startsWith("--min-recent-samples=")) {
      minRecentSamples = Number(token.slice("--min-recent-samples=".length)) || minRecentSamples;
      continue;
    }
    if (token === "--max-adjustment" && next) {
      maxAdjustment = Number(next) || maxAdjustment;
      i += 1;
      continue;
    }
    if (token.startsWith("--max-adjustment=")) {
      maxAdjustment = Number(token.slice("--max-adjustment=".length)) || maxAdjustment;
      continue;
    }
    if (token === "--adjustment-mode" && next) {
      adjustmentMode = next === "symmetric" ? "symmetric" : "penalties_only";
      i += 1;
      continue;
    }
    if (token.startsWith("--adjustment-mode=")) {
      const value = token.slice("--adjustment-mode=".length);
      adjustmentMode = value === "symmetric" ? "symmetric" : "penalties_only";
      continue;
    }
    if ((token === "--market" || token === "--markets") && next) {
      pushList(markets, next);
      i += 1;
      continue;
    }
    if (token.startsWith("--market=") || token.startsWith("--markets=")) {
      const value = token.includes("--markets=") ? token.slice("--markets=".length) : token.slice("--market=".length);
      pushList(markets, value);
      continue;
    }
    if ((token === "--archetype" || token === "--archetypes") && next) {
      pushList(archetypes, next);
      i += 1;
      continue;
    }
    if (token.startsWith("--archetype=") || token.startsWith("--archetypes=")) {
      const value = token.includes("--archetypes=")
        ? token.slice("--archetypes=".length)
        : token.slice("--archetype=".length);
      pushList(archetypes, value);
      continue;
    }
    if ((token === "--family" || token === "--families") && next) {
      pushList(families, next);
      i += 1;
      continue;
    }
    if (token.startsWith("--family=") || token.startsWith("--families=")) {
      const value = token.includes("--families=") ? token.slice("--families=".length) : token.slice("--family=".length);
      pushList(families, value);
      continue;
    }
    if (token === "--scale" && next) {
      scale = Number(next) || scale;
      i += 1;
      continue;
    }
    if (token.startsWith("--scale=")) {
      scale = Number(token.slice("--scale=".length)) || scale;
    }
  }

  return {
    input: path.isAbsolute(input) ? input : path.join(process.cwd(), input),
    out: path.isAbsolute(out) ? out : path.join(process.cwd(), out),
    modelFile: modelFile == null ? null : path.isAbsolute(modelFile) ? modelFile : path.join(process.cwd(), modelFile),
    shortWindowDays,
    longWindowDays,
    minSamples,
    minRecentSamples,
    maxAdjustment,
    adjustmentMode,
    markets: [...new Set(markets)],
    archetypes: [...new Set(archetypes)],
    families: [...new Set(families)],
    scale,
  };
}

async function loadRows(inputPath: string): Promise<TrainingRow[]> {
  const raw = JSON.parse(await readFile(inputPath, "utf8")) as { playerMarketRows?: TrainingRow[] } | TrainingRow[];
  const rows = Array.isArray(raw) ? raw : raw.playerMarketRows ?? [];
  return attachCurrentLineRecencyMetrics(
    rows.filter((row): row is TrainingRow => row.actualSide === "OVER" || row.actualSide === "UNDER"),
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

function accuracy(samples: Array<{ correct: boolean }>): number | null {
  if (samples.length === 0) return null;
  const correct = samples.filter((sample) => sample.correct).length;
  return round((correct / samples.length) * 100, 2);
}

function adjustmentFromDelta(delta: number, scale: number, maxAdjustment: number): number {
  const adjusted = delta * scale;
  if (Math.abs(adjusted) < 0.5) return 0;
  return round(Math.max(-maxAdjustment, Math.min(maxAdjustment, adjusted)), 2);
}

async function main(): Promise<void> {
  const args = parseArgs();
  process.env.SNAPSHOT_UNIVERSAL_DISABLE_CALIBRATION = "1";
  process.env.SNAPSHOT_UNIVERSAL_MODEL_FILE = args.modelFile ?? resolveDefaultModelInput();

  const rows = await loadRows(args.input);
  const latestDateEt = rows.reduce((latest, row) => (row.gameDateEt > latest ? row.gameDateEt : latest), "0000-00-00");
  const shortCutoff = etDateShift(latestDateEt, -(args.shortWindowDays - 1));
  const longCutoff = etDateShift(latestDateEt, -(args.longWindowDays - 1));

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

    const key = buildUniversalResidualCalibrationKey(row.market, decision.archetype, decision.minutesBucket);
    if (!key || decision.rawSide === "NEUTRAL" || !decision.archetype || !decision.minutesBucket) {
      return;
    }

    const existing = grouped.get(key) ?? {
      market: row.market,
      archetype: decision.archetype,
      minutesBucket: decision.minutesBucket,
      samples: [],
    };
    existing.samples.push({
      gameDateEt: row.gameDateEt,
      correct: decision.rawSide === row.actualSide,
    });
    grouped.set(key, existing);
  });

  const records: UniversalResidualCalibrationRecord[] = [];
  grouped.forEach((group) => {
    const fullAccuracy = accuracy(group.samples);
    if (fullAccuracy == null || group.samples.length < args.minSamples) {
      return;
    }

    const recent7 = group.samples.filter((sample) => sample.gameDateEt >= shortCutoff);
    const recent14 = group.samples.filter((sample) => sample.gameDateEt >= longCutoff);
    const recent7Accuracy = accuracy(recent7);
    const recent14Accuracy = accuracy(recent14);
    const weightedParts: Array<{ accuracy: number; weight: number }> = [];
    if (recent7Accuracy != null && recent7.length >= args.minRecentSamples) {
      weightedParts.push({ accuracy: recent7Accuracy, weight: 0.65 });
    }
    if (recent14Accuracy != null && recent14.length >= args.minRecentSamples) {
      weightedParts.push({ accuracy: recent14Accuracy, weight: 0.35 });
    }
    const recentWeightedAccuracy =
      weightedParts.length === 0
        ? null
        : round(
            weightedParts.reduce((sum, part) => sum + part.accuracy * part.weight, 0) /
              weightedParts.reduce((sum, part) => sum + part.weight, 0),
            2,
          );
    const rawDelta = recentWeightedAccuracy == null ? 0 : recentWeightedAccuracy - fullAccuracy;
    const delta = args.adjustmentMode === "penalties_only" ? Math.min(0, rawDelta) : rawDelta;

    records.push({
      market: group.market,
      archetype: group.archetype,
      minutesBucket: group.minutesBucket,
      sampleCount: group.samples.length,
      recent7Samples: recent7.length,
      recent14Samples: recent14.length,
      fullAccuracy,
      recent7Accuracy,
      recent14Accuracy,
      recentWeightedAccuracy,
      bucketAccuracyAdjustment:
        recentWeightedAccuracy == null ? 0 : adjustmentFromDelta(delta, 0.45, args.maxAdjustment),
      leafAccuracyAdjustment:
        recentWeightedAccuracy == null ? 0 : adjustmentFromDelta(delta, 0.7, args.maxAdjustment),
    });
  });

  records.sort((left, right) => {
    if (left.market !== right.market) return left.market.localeCompare(right.market);
    if (left.archetype !== right.archetype) return left.archetype.localeCompare(right.archetype);
    return left.minutesBucket.localeCompare(right.minutesBucket);
  });

  let filteredRecords = records;
  if (args.markets.length > 0) {
    const allowed = new Set(args.markets);
    filteredRecords = filteredRecords.filter((record) => allowed.has(record.market));
  }
  if (args.archetypes.length > 0) {
    const allowed = new Set(args.archetypes);
    filteredRecords = filteredRecords.filter((record) => allowed.has(record.archetype));
  }
  if (args.families.length > 0) {
    const allowed = new Set(args.families.map((entry) => entry.trim()).filter(Boolean));
    filteredRecords = filteredRecords.filter((record) => allowed.has(`${record.market}|${record.archetype}`));
  }
  if (Number.isFinite(args.scale) && Math.abs(args.scale - 1) > 1e-9) {
    filteredRecords = filteredRecords.map((record) => ({
      ...record,
      bucketAccuracyAdjustment: round(record.bucketAccuracyAdjustment * args.scale, 2),
      leafAccuracyAdjustment: round(record.leafAccuracyAdjustment * args.scale, 2),
    }));
  }

  const payload: UniversalResidualCalibrationFile = {
    generatedAt: new Date().toISOString(),
    inputFile: args.input,
    modelFile: process.env.SNAPSHOT_UNIVERSAL_MODEL_FILE ?? resolveDefaultModelInput(),
    shortWindowDays: args.shortWindowDays,
    longWindowDays: args.longWindowDays,
    adjustmentMode: args.adjustmentMode,
    records: filteredRecords,
  };

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const activeAdjustments = filteredRecords.filter(
    (record) => Math.abs(record.bucketAccuracyAdjustment) > 0 || Math.abs(record.leafAccuracyAdjustment) > 0,
  ).length;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        input: args.input,
        out: args.out,
        latestDateEt,
        adjustmentMode: args.adjustmentMode,
        records: filteredRecords.length,
        activeAdjustments,
        scale: args.scale,
        markets: args.markets,
        archetypes: args.archetypes,
        families: args.families,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

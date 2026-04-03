import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
  inspectLiveUniversalModelSide,
  qualifyLiveUniversalModelDecision,
} from "../lib/snapshot/liveUniversalSideModels";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
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

type SliceStats = {
  market: Market;
  archetype: string;
  samples: number;
  rawCorrect: number;
  rawAccuracy: number;
  qualifiedPicks: number;
  qualifiedCorrect: number;
  qualifiedAccuracy: number | null;
  coveragePct: number;
  blendedCorrect: number;
  blendedAccuracy: number;
};

type Args = {
  input: string;
  out: string | null;
  top: number;
  minActualMinutes: number;
  sortBy: "blended" | "qualified" | "raw";
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
  let out: string | null = null;
  let top = 25;
  let minActualMinutes = 15;
  let sortBy: "blended" | "qualified" | "raw" = "blended";

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
    if ((token === "--top" || token === "-n") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) top = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--top=")) {
      const parsed = Number(token.slice("--top=".length));
      if (Number.isFinite(parsed) && parsed > 0) top = Math.floor(parsed);
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
    if (token === "--sort-by" && next) {
      if (next === "blended" || next === "qualified" || next === "raw") sortBy = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--sort-by=")) {
      const value = token.slice("--sort-by=".length);
      if (value === "blended" || value === "qualified" || value === "raw") sortBy = value;
      continue;
    }
  }

  return { input, out, top, minActualMinutes, sortBy };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
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

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(filteredRows);
  const summaries = summarizeRows(filteredRows, playerMetaMap);
  const settings = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS;

  const sliceMap = new Map<string, { rows: Array<{ market: Market; actualSide: Side; finalSide: Side; rawSide: Side; qualified: boolean }> }>();

  for (const row of filteredRows) {
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
    const decision = qualifyLiveUniversalModelDecision(rawDecision, settings);
    const archetype = rawDecision.archetype ?? "UNKNOWN";
    const key = `${row.market}|${archetype}`;
    const slice = sliceMap.get(key) ?? { rows: [] };
    slice.rows.push({
      market: row.market,
      actualSide: row.actualSide,
      finalSide: row.finalSide,
      rawSide: rawDecision.rawSide === "NEUTRAL" ? row.finalSide : (rawDecision.rawSide as Side),
      qualified: decision.qualified,
    });
    sliceMap.set(key, slice);
  }

  const slices: SliceStats[] = [];
  sliceMap.forEach((slice, key) => {
    const [market, archetype] = key.split("|");
    let rawCorrect = 0;
    let qualifiedPicks = 0;
    let qualifiedCorrect = 0;
    let blendedCorrect = 0;

    slice.rows.forEach((row) => {
      if (row.rawSide === row.actualSide) rawCorrect += 1;
      if (row.qualified) {
        qualifiedPicks += 1;
        if (row.rawSide === row.actualSide) qualifiedCorrect += 1;
      }
      const blendedSide = row.qualified ? row.rawSide : row.finalSide;
      if (blendedSide === row.actualSide) blendedCorrect += 1;
    });

    const samples = slice.rows.length;
    slices.push({
      market: market as Market,
      archetype,
      samples,
      rawCorrect,
      rawAccuracy: round((rawCorrect / samples) * 100, 2),
      qualifiedPicks,
      qualifiedCorrect,
      qualifiedAccuracy: qualifiedPicks > 0 ? round((qualifiedCorrect / qualifiedPicks) * 100, 2) : null,
      coveragePct: round((qualifiedPicks / samples) * 100, 2),
      blendedCorrect,
      blendedAccuracy: round((blendedCorrect / samples) * 100, 2),
    });
  });

  const sortKey = args.sortBy === "qualified" ? "qualifiedAccuracy" : args.sortBy === "raw" ? "rawAccuracy" : "blendedAccuracy";
  slices.sort((left, right) => {
    const leftVal = left[sortKey] ?? 100;
    const rightVal = right[sortKey] ?? 100;
    if (leftVal !== rightVal) return leftVal - rightVal;
    return right.samples - left.samples;
  });

  const topSlices = slices.slice(0, args.top);

  console.log(`\nUniversal Model Slice Analysis (${payload.from} to ${payload.to})`);
  console.log(`Total slices: ${slices.length}  |  Sort: ${args.sortBy}  |  Showing top ${args.top} weakest\n`);
  console.log(
    "Market".padEnd(8) +
      "Archetype".padEnd(32) +
      "Samples".padStart(8) +
      "QualPicks".padStart(10) +
      "QualAcc".padStart(10) +
      "Coverage".padStart(10) +
      "Blended".padStart(10),
  );
  console.log("-".repeat(88));
  topSlices.forEach((slice) => {
    console.log(
      slice.market.padEnd(8) +
        slice.archetype.padEnd(32) +
        String(slice.samples).padStart(8) +
        String(slice.qualifiedPicks).padStart(10) +
        (slice.qualifiedAccuracy != null ? `${slice.qualifiedAccuracy}%` : "N/A").padStart(10) +
        `${slice.coveragePct}%`.padStart(10) +
        `${slice.blendedAccuracy}%`.padStart(10),
    );
  });

  if (args.out) {
    const outPath = path.resolve(args.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(
      outPath,
      `${JSON.stringify(
        {
          from: payload.from,
          to: payload.to,
          sortBy: args.sortBy,
          totalSlices: slices.length,
          slices: topSlices,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`\nWrote ${args.out}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

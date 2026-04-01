import { PrismaClient } from "@prisma/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildPrecision80Pick,
  comparePrecisionSignals,
  PRECISION_80_SYSTEM_SUMMARY,
  type PrecisionRankingMode,
} from "../lib/snapshot/precisionPickSystem";
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
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  finalSide: Side;
  actualSide: Side;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability?: number | null;
  actualMinutes: number;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection?: number | null;
  threesProjection?: number | null;
  l5CurrentLineDeltaAvg?: number | null;
  l5CurrentLineOverRate?: number | null;
  l5MinutesAvg?: number | null;
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
  position: string | null;
  avgExpectedMinutes: number | null;
  avgStarterRate: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistProjection: number | null;
  threesProjection: number | null;
};

type QualifiedPick = {
  row: TrainingRow;
  signal: NonNullable<ReturnType<typeof buildPrecision80Pick>>;
};

type Args = {
  input: string;
  out: string;
  minActualMinutes: number;
  rankingMode: PrecisionRankingMode;
};

const prisma = new PrismaClient();

function resolveDefaultInputPath(): string {
  try {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  } catch {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
  }
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "precision-pick-system-eval.json");
  let minActualMinutes = 15;
  let rankingMode: PrecisionRankingMode = "historical-prior-first";

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
    if (token === "--ranking-mode" && next) {
      if (next === "historical-prior-first" || next === "dynamic-edge-first") {
        rankingMode = next;
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--ranking-mode=")) {
      const parsed = token.slice("--ranking-mode=".length);
      if (parsed === "historical-prior-first" || parsed === "dynamic-edge-first") {
        rankingMode = parsed;
      }
    }
  }

  return { input, out, minActualMinutes, rankingMode };
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
    summaries.set(playerId, {
      position: playerMetaMap.get(playerId)?.position ?? null,
      avgExpectedMinutes: mean(playerRows.map((row) => row.expectedMinutes)),
      avgStarterRate: mean(playerRows.map((row) => row.starterRateLast10)),
      pointsProjection: mean(playerRows.map((row) => row.pointsProjection)),
      reboundsProjection: mean(playerRows.map((row) => row.reboundsProjection)),
      assistProjection: mean(playerRows.map((row) => row.assistProjection)),
      threesProjection: mean(playerRows.map((row) => row.threesProjection)),
    });
  });

  return summaries;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const rows = attachCurrentLineRecencyMetrics(
    payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes),
  );
  const playerMetaMap = await loadPlayerMetaMap([...new Set(rows.map((row) => row.playerId))]);
  const summaries = summarizeRows(rows, playerMetaMap);

  const byMarket = new Map<
    Market,
    {
      picks: number;
      correct: number;
    }
  >();
  let picks = 0;
  let correct = 0;
  const picksByDate = new Map<string, number>();
  const qualifiedPicks: QualifiedPick[] = [];

  rows.forEach((row) => {
    const summary = summaries.get(row.playerId);
    const signal = buildPrecision80Pick({
      playerId: row.playerId,
      market: row.market,
      projectedValue: row.projectedValue,
      line: row.line,
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      finalSide: row.finalSide,
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
      pointsProjection: row.pointsProjection ?? summary?.pointsProjection ?? null,
      reboundsProjection: row.reboundsProjection ?? summary?.reboundsProjection ?? null,
      assistProjection: row.assistProjection ?? summary?.assistProjection ?? null,
      threesProjection: row.threesProjection ?? summary?.threesProjection ?? null,
    });
    if (!signal?.qualified || signal.side === "NEUTRAL") return;

    qualifiedPicks.push({ row, signal });
  });

  qualifiedPicks.sort((left, right) => {
    const signalComparison = comparePrecisionSignals(left.signal, right.signal, args.rankingMode);
    if (signalComparison !== 0) return signalComparison;
    if (left.row.gameDateEt !== right.row.gameDateEt) return left.row.gameDateEt.localeCompare(right.row.gameDateEt);
    if (left.row.playerName !== right.row.playerName) return left.row.playerName.localeCompare(right.row.playerName);
    return left.row.market.localeCompare(right.row.market);
  });

  const selectedPicks: QualifiedPick[] = [];
  const selectedPlayerDates = new Set<string>();
  qualifiedPicks.forEach((candidate) => {
    const key = `${candidate.row.gameDateEt}:${candidate.row.playerId}`;
    if (selectedPlayerDates.has(key)) return;
    selectedPlayerDates.add(key);
    selectedPicks.push(candidate);
  });

  selectedPicks.forEach(({ row, signal }) => {
    picks += 1;
    picksByDate.set(row.gameDateEt, (picksByDate.get(row.gameDateEt) ?? 0) + 1);
    const bucket = byMarket.get(row.market) ?? { picks: 0, correct: 0 };
    bucket.picks += 1;
    if (signal.side === row.actualSide) {
      correct += 1;
      bucket.correct += 1;
    }
    byMarket.set(row.market, bucket);
  });

  const output = {
    generatedAt: new Date().toISOString(),
    input: args.input,
    from: payload.from,
    to: payload.to,
    filters: {
      minActualMinutes: args.minActualMinutes,
    },
    system: PRECISION_80_SYSTEM_SUMMARY,
    selectionPolicy: {
      onePickPerPlayerPerDay: true,
      ranking:
        args.rankingMode === "dynamic-edge-first"
          ? [
              "projectionWinProbability",
              "projectionPriceEdge",
              "absLineGap",
              "leafAccuracy",
              "bucketRecentAccuracy",
              "historicalAccuracy",
            ]
          : [
              "historicalAccuracy",
              "projectionWinProbability",
              "projectionPriceEdge",
              "absLineGap",
              "leafAccuracy",
              "bucketRecentAccuracy",
            ],
      rankingMode: args.rankingMode,
    },
    overall: {
      picks,
      correct,
      accuracyPct: picks > 0 ? round((correct / picks) * 100, 2) : null,
      coveragePct: rows.length > 0 ? round((picks / rows.length) * 100, 2) : 0,
      picksPerDay: rows.length > 0 ? round(picks / new Set(rows.map((row) => row.gameDateEt)).size, 2) : 0,
      activePickDates: picksByDate.size,
      sampleRows: rows.length,
    },
    byMarket: Object.fromEntries(
      [...byMarket.entries()].map(([market, stats]) => [
        market,
        {
          picks: stats.picks,
          correct: stats.correct,
          accuracyPct: stats.picks > 0 ? round((stats.correct / stats.picks) * 100, 2) : null,
        },
      ]),
    ),
    selectedPicks: selectedPicks.map(({ row, signal }) => ({
      gameDateEt: row.gameDateEt,
      playerId: row.playerId,
      playerName: row.playerName,
      market: row.market,
      side: signal.side,
      actualSide: row.actualSide,
      correct: signal.side === row.actualSide,
      historicalAccuracy: signal.historicalAccuracy,
      projectionWinProbability: signal.projectionWinProbability ?? null,
      projectionPriceEdge: signal.projectionPriceEdge ?? null,
      absLineGap: signal.absLineGap ?? null,
      leafAccuracy: signal.leafAccuracy ?? null,
      bucketRecentAccuracy: signal.bucketRecentAccuracy ?? null,
    })),
  };

  const outPath = path.resolve(args.out);
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




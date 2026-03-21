import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import { predictLiveUniversalModelSide } from "../lib/snapshot/liveUniversalSideModels";
import { round } from "../lib/utils";

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";

type PlayerMarketRow = {
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
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability?: number | null;
  actualMinutes: number;
  lineGap: number;
  absLineGap: number;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  openingTeamSpread?: number | null;
  openingTotal?: number | null;
  lineupTimingConfidence?: number | null;
  completenessScore?: number | null;
};

type BacktestRowsFile = {
  playerMarketRows: PlayerMarketRow[];
};

type FeatureName =
  | "lineGap"
  | "absLineGap"
  | "expectedMinutes"
  | "minutesVolatility"
  | "starterRateLast10"
  | "priceLean"
  | "priceAbsLean"
  | "line"
  | "projectedValue"
  | "favoredOver"
  | "overPrice"
  | "underPrice"
  | "overProbability"
  | "underProbability";

type LeafNode = {
  kind: "leaf";
  side: Side;
};

type SplitNode = {
  kind: "split";
  feature: FeatureName;
  threshold: number;
  left: TreeNode;
  right: TreeNode;
};

type TreeNode = LeafNode | SplitNode;

type ModelVariant =
  | { kind: "constant"; side: Side }
  | { kind: "projection" }
  | { kind: "finalOverride" }
  | { kind: "marketFavored" }
  | { kind: "gapThenProjection"; threshold: number }
  | { kind: "gapThenMarket"; threshold: number }
  | { kind: "tree"; tree: TreeNode; maxDepth: number; minLeaf: number };

type PlayerMarketModel = {
  playerId: string;
  playerName: string;
  market: Market;
  samples: number;
  modelAccuracy: number;
  model: ModelVariant;
};

type PlayerMarketModelFile = {
  playerMarketModels: PlayerMarketModel[];
};

type PlayerProjectionBundle = {
  PTS?: number | null;
  REB?: number | null;
  AST?: number | null;
  THREES?: number | null;
};

type MarketSummary = {
  playerAccuracy: number;
  universalAccuracy: number;
  delta: number;
  playerBetter: number;
  universalBetter: number;
  ties: number;
  samples: number;
};

type PlayerSummary = {
  playerId: string;
  playerName: string;
  totalMarkets: number;
  playerBetterMarkets: number;
  universalBetterMarkets: number;
  tiedMarkets: number;
  weightedPlayerAccuracy: number;
  weightedUniversalAccuracy: number;
  weightedDelta: number;
};

type Args = {
  rows: string;
  models: string;
  out: string | null;
  minActualMinutes: number;
};

const prisma = new PrismaClient();

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let rows = path.join("exports", "projection-backtest-allplayers-with-rows-2025-10-23-to-2026-03-09.json");
  let models = path.join("exports", "player-market-side-models-2025-10-23-to-2026-03-09.json");
  let out: string | null = path.join("exports", "player-vs-universal-v8-analysis.json");
  let minActualMinutes = 15;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];

    if ((token === "--rows" || token === "-r") && next) {
      rows = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--rows=")) {
      rows = token.slice("--rows=".length);
      continue;
    }
    if ((token === "--models" || token === "-m") && next) {
      models = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--models=")) {
      models = token.slice("--models=".length);
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

  return { rows, models, out, minActualMinutes };
}

function impliedProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function getFeature(row: PlayerMarketRow, feature: FeatureName): number | null {
  switch (feature) {
    case "lineGap":
      return row.lineGap;
    case "absLineGap":
      return row.absLineGap;
    case "expectedMinutes":
      return row.expectedMinutes;
    case "minutesVolatility":
      return row.minutesVolatility;
    case "starterRateLast10":
      return row.starterRateLast10;
    case "priceLean":
      return row.priceLean;
    case "priceAbsLean":
      return row.priceLean == null ? null : Math.abs(row.priceLean);
    case "line":
      return row.line;
    case "projectedValue":
      return row.projectedValue;
    case "favoredOver":
      return row.favoredSide === "OVER" ? 1 : row.favoredSide === "UNDER" ? -1 : 0;
    case "overPrice":
      return row.overPrice;
    case "underPrice":
      return row.underPrice;
    case "overProbability":
      return impliedProbability(row.overPrice);
    case "underProbability":
      return impliedProbability(row.underPrice);
    default:
      return null;
  }
}

function predictTree(node: TreeNode, row: PlayerMarketRow): Side {
  if (node.kind === "leaf") return node.side;
  const value = getFeature(row, node.feature);
  if (value == null) {
    return node.left.kind === "leaf" ? node.left.side : predictTree(node.left, row);
  }
  return value <= node.threshold ? predictTree(node.left, row) : predictTree(node.right, row);
}

function predictPlayerModel(model: ModelVariant, row: PlayerMarketRow): Side {
  switch (model.kind) {
    case "constant":
      return model.side;
    case "projection":
      return row.projectionSide;
    case "finalOverride":
      return row.finalSide;
    case "marketFavored":
      return row.favoredSide === "NEUTRAL" ? row.projectionSide : row.favoredSide;
    case "gapThenProjection":
      return row.absLineGap >= model.threshold
        ? row.projectionSide
        : row.favoredSide === "NEUTRAL"
          ? row.projectionSide
          : row.favoredSide;
    case "gapThenMarket":
      return row.absLineGap >= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.projectionSide
          : row.favoredSide
        : row.projectionSide;
    case "tree":
      return predictTree(model.tree, row);
    default:
      return row.projectionSide;
  }
}

async function main() {
  const args = parseArgs();
  const rowsPayload = JSON.parse(await fs.readFile(args.rows, "utf8")) as BacktestRowsFile;
  const modelPayload = JSON.parse(await fs.readFile(args.models, "utf8")) as PlayerMarketModelFile;

  const rows = rowsPayload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const modelMap = new Map(modelPayload.playerMarketModels.map((model) => [`${model.playerId}|${model.market}`, model]));

  const playerIds = [...new Set(rows.map((row) => row.playerId))];
  const players = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, fullName: true, position: true },
  });
  const playerMeta = new Map(players.map((player) => [player.id, player]));

  const projectionsByDate = new Map<string, PlayerProjectionBundle>();
  for (const row of rows) {
    const key = `${row.playerId}|${row.gameDateEt}`;
    const bucket = projectionsByDate.get(key) ?? {};
    if (row.market === "PTS") bucket.PTS = row.projectedValue;
    if (row.market === "REB") bucket.REB = row.projectedValue;
    if (row.market === "AST") bucket.AST = row.projectedValue;
    if (row.market === "THREES") bucket.THREES = row.projectedValue;
    projectionsByDate.set(key, bucket);
  }

  const playerMarketStats = new Map<
    string,
    {
      playerId: string;
      playerName: string;
      market: Market;
      samples: number;
      playerCorrect: number;
      universalCorrect: number;
    }
  >();

  for (const row of rows) {
    const model = modelMap.get(`${row.playerId}|${row.market}`);
    if (!model) continue;

    const playerSide = predictPlayerModel(model.model, row);
    const projections = projectionsByDate.get(`${row.playerId}|${row.gameDateEt}`) ?? {};
    const meta = playerMeta.get(row.playerId);

    const universalSide = predictLiveUniversalModelSide({
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
      openingTeamSpread: row.openingTeamSpread ?? null,
      openingTotal: row.openingTotal ?? null,
      lineupTimingConfidence: row.lineupTimingConfidence ?? null,
      completenessScore: row.completenessScore ?? null,
      playerPosition: meta?.position ?? null,
      assistProjection: projections.AST ?? null,
      pointsProjection: projections.PTS ?? null,
      reboundsProjection: projections.REB ?? null,
      threesProjection: projections.THREES ?? null,
    });

    const key = `${row.playerId}|${row.market}`;
    const stats = playerMarketStats.get(key) ?? {
      playerId: row.playerId,
      playerName: row.playerName,
      market: row.market,
      samples: 0,
      playerCorrect: 0,
      universalCorrect: 0,
    };
    stats.samples += 1;
    if (playerSide === row.actualSide) stats.playerCorrect += 1;
    if (universalSide === row.actualSide) stats.universalCorrect += 1;
    playerMarketStats.set(key, stats);
  }

  const byMarket = new Map<Market, { samples: number; playerCorrect: number; universalCorrect: number; playerBetter: number; universalBetter: number; ties: number }>();
  const byPlayer = new Map<string, PlayerSummary>();
  let overallSamples = 0;
  let overallPlayerCorrect = 0;
  let overallUniversalCorrect = 0;
  let playerBetterMarkets = 0;
  let universalBetterMarkets = 0;
  let tiedMarkets = 0;

  for (const stats of playerMarketStats.values()) {
    const playerAccuracy = stats.samples > 0 ? (stats.playerCorrect / stats.samples) * 100 : 0;
    const universalAccuracy = stats.samples > 0 ? (stats.universalCorrect / stats.samples) * 100 : 0;
    const comparison = playerAccuracy > universalAccuracy ? "PLAYER" : playerAccuracy < universalAccuracy ? "UNIVERSAL" : "TIE";

    overallSamples += stats.samples;
    overallPlayerCorrect += stats.playerCorrect;
    overallUniversalCorrect += stats.universalCorrect;
    if (comparison === "PLAYER") playerBetterMarkets += 1;
    else if (comparison === "UNIVERSAL") universalBetterMarkets += 1;
    else tiedMarkets += 1;

    const marketBucket = byMarket.get(stats.market) ?? {
      samples: 0,
      playerCorrect: 0,
      universalCorrect: 0,
      playerBetter: 0,
      universalBetter: 0,
      ties: 0,
    };
    marketBucket.samples += stats.samples;
    marketBucket.playerCorrect += stats.playerCorrect;
    marketBucket.universalCorrect += stats.universalCorrect;
    if (comparison === "PLAYER") marketBucket.playerBetter += 1;
    else if (comparison === "UNIVERSAL") marketBucket.universalBetter += 1;
    else marketBucket.ties += 1;
    byMarket.set(stats.market, marketBucket);

    const playerBucket = byPlayer.get(stats.playerId) ?? {
      playerId: stats.playerId,
      playerName: stats.playerName,
      totalMarkets: 0,
      playerBetterMarkets: 0,
      universalBetterMarkets: 0,
      tiedMarkets: 0,
      weightedPlayerAccuracy: 0,
      weightedUniversalAccuracy: 0,
      weightedDelta: 0,
    };
    playerBucket.totalMarkets += 1;
    if (comparison === "PLAYER") playerBucket.playerBetterMarkets += 1;
    else if (comparison === "UNIVERSAL") playerBucket.universalBetterMarkets += 1;
    else playerBucket.tiedMarkets += 1;
    playerBucket.weightedPlayerAccuracy += stats.playerCorrect;
    playerBucket.weightedUniversalAccuracy += stats.universalCorrect;
    playerBucket.weightedDelta += stats.playerCorrect - stats.universalCorrect;
    byPlayer.set(stats.playerId, playerBucket);
  }

  const byMarketSummary = Object.fromEntries(
    [...byMarket.entries()].map(([market, stats]) => [
      market,
      {
        playerAccuracy: stats.samples > 0 ? round((stats.playerCorrect / stats.samples) * 100, 2) : 0,
        universalAccuracy: stats.samples > 0 ? round((stats.universalCorrect / stats.samples) * 100, 2) : 0,
        delta: stats.samples > 0 ? round(((stats.playerCorrect - stats.universalCorrect) / stats.samples) * 100, 2) : 0,
        playerBetter: stats.playerBetter,
        universalBetter: stats.universalBetter,
        ties: stats.ties,
        samples: stats.samples,
      } satisfies MarketSummary,
    ]),
  );

  const playerSummaries = [...byPlayer.values()]
    .map((player) => {
      const playerRows = [...playerMarketStats.values()].filter((entry) => entry.playerId === player.playerId);
      const totalSamples = playerRows.reduce((sum, entry) => sum + entry.samples, 0);
      return {
        ...player,
        weightedPlayerAccuracy: totalSamples > 0 ? round((player.weightedPlayerAccuracy / totalSamples) * 100, 2) : 0,
        weightedUniversalAccuracy: totalSamples > 0 ? round((player.weightedUniversalAccuracy / totalSamples) * 100, 2) : 0,
        weightedDelta: totalSamples > 0 ? round((player.weightedDelta / totalSamples) * 100, 2) : 0,
      };
    })
    .sort((left, right) => right.weightedDelta - left.weightedDelta);

  const result = {
    comparedPlayerMarketCombos: playerMarketStats.size,
    comparedPlayers: byPlayer.size,
    totalRowsCompared: overallSamples,
    overall: {
      playerAccuracy: overallSamples > 0 ? round((overallPlayerCorrect / overallSamples) * 100, 2) : 0,
      universalAccuracy: overallSamples > 0 ? round((overallUniversalCorrect / overallSamples) * 100, 2) : 0,
      delta: overallSamples > 0 ? round(((overallPlayerCorrect - overallUniversalCorrect) / overallSamples) * 100, 2) : 0,
      playerBetterMarketCombos: playerBetterMarkets,
      universalBetterMarketCombos: universalBetterMarkets,
      tiedMarketCombos: tiedMarkets,
    },
    byMarket: byMarketSummary,
    players: {
      playerBetterOverall: playerSummaries.filter((player) => player.weightedDelta > 0).length,
      universalBetterOverall: playerSummaries.filter((player) => player.weightedDelta < 0).length,
      tiedOverall: playerSummaries.filter((player) => player.weightedDelta === 0).length,
      topPlayerModelEdges: playerSummaries.slice(0, 25),
      topUniversalEdges: [...playerSummaries].sort((left, right) => left.weightedDelta - right.weightedDelta).slice(0, 25),
    },
  };

  if (args.out) {
    await fs.mkdir(path.dirname(args.out), { recursive: true });
    await fs.writeFile(args.out, JSON.stringify(result, null, 2), "utf8");
  }

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

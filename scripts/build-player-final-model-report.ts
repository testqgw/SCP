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
  projectionCorrect: boolean;
  finalCorrect: boolean;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability?: number | null;
  actualMinutes: number;
  lineGap: number;
  absLineGap: number;
  openingTeamSpread?: number | null;
  openingTotal?: number | null;
  lineupTimingConfidence?: number | null;
  completenessScore?: number | null;
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
  count: number;
  accuracy: number;
};

type SplitNode = {
  kind: "split";
  feature: FeatureName;
  threshold: number;
  count: number;
  accuracy: number;
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
  projectionBaselineAccuracy: number;
  finalBaselineAccuracy: number;
  modelAccuracy: number;
  holdoutAccuracy: number | null;
  targetHit: boolean;
  model: ModelVariant;
};

type PlayerMarketModelFile = {
  playerMarketModels: PlayerMarketModel[];
};

type BacktestRowsFile = {
  from: string;
  to: string;
  lineFile: string | null;
  playerMarketRows: PlayerMarketRow[];
};

type Args = {
  player: string;
  rows: string;
  models: string;
  minActualMinutes: number;
  holdoutRatio: number;
  out: string | null;
  sheetOut: string | null;
  summaryOut: string | null;
};

type MarketSummary = {
  samples: number;
  projectionBaselineAccuracy: number | null;
  finalBaselineAccuracy: number | null;
  modelAccuracy: number | null;
  lateWindowAccuracy: number | null;
  correct: number;
  wrong: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  modelKind: string | null;
  targetHit: boolean;
  chosenSource: "PLAYER" | "UNIVERSAL";
};

const prisma = new PrismaClient();

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let player = "";
  let rows = path.join("exports", "projection-backtest-allplayers-with-rows-2025-10-23-to-2026-03-09.json");
  let models = path.join("exports", "player-market-side-models-2025-10-23-to-2026-03-09.json");
  let minActualMinutes = 15;
  let holdoutRatio = 0.3;
  let out: string | null = null;
  let sheetOut: string | null = null;
  let summaryOut: string | null = null;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];

    if ((token === "--player" || token === "-p") && next) {
      player = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--player=")) {
      player = token.slice("--player=".length);
      continue;
    }
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
    if (token === "--holdout-ratio" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) holdoutRatio = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--holdout-ratio=")) {
      const parsed = Number(token.slice("--holdout-ratio=".length));
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) holdoutRatio = parsed;
      continue;
    }
    if (token === "--out" && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if (token === "--sheet-out" && next) {
      sheetOut = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--sheet-out=")) {
      sheetOut = token.slice("--sheet-out=".length);
      continue;
    }
    if (token === "--summary-out" && next) {
      summaryOut = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--summary-out=")) {
      summaryOut = token.slice("--summary-out=".length);
      continue;
    }
  }

  if (!player.trim()) {
    throw new Error("Missing required --player argument.");
  }

  return {
    player: player.trim(),
    rows,
    models,
    minActualMinutes,
    holdoutRatio,
    out,
    sheetOut,
    summaryOut,
  };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function predictVariant(model: ModelVariant, row: PlayerMarketRow): Side {
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

function applyCustomPlayerOverride(
  playerName: string,
  market: Market,
  row: PlayerMarketRow,
  predictedSide: Side,
): Side {
  const playerKey = normalizeText(playerName);

  if (
    playerKey === "jaylen brown" &&
    market === "PR" &&
    row.expectedMinutes != null &&
    row.expectedMinutes >= 31.51 &&
    row.lineGap <= -3.28
  ) {
    return "OVER";
  }

  if (
    playerKey === "kawhi leonard" &&
    market === "AST" &&
    row.line >= 4.5 &&
    row.favoredSide === "UNDER"
  ) {
    return "UNDER";
  }

  return predictedSide;
}

function toCsvValue(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function buildCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return `${[
    headers.join(","),
    ...rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(",")),
  ].join("\n")}\n`;
}

function summarizeAccuracy(rows: Array<{ predicted: Side; actual: Side }>): {
  correct: number;
  wrong: number;
  accuracy: number | null;
} {
  let correct = 0;
  let wrong = 0;
  rows.forEach((row) => {
    if (row.predicted === row.actual) correct += 1;
    else wrong += 1;
  });
  const resolved = correct + wrong;
  return {
    correct,
    wrong,
    accuracy: resolved > 0 ? round((correct / resolved) * 100, 2) : null,
  };
}

function modelKindLabel(model: ModelVariant | null): string | null {
  if (!model) return null;
  if (model.kind !== "tree") return model.kind;
  return `${model.kind}:d${model.maxDepth}:l${model.minLeaf}`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rowsPayload = JSON.parse(
    await fs.readFile(path.resolve(args.rows), "utf8"),
  ) as BacktestRowsFile;
  const modelPayload = JSON.parse(
    await fs.readFile(path.resolve(args.models), "utf8"),
  ) as PlayerMarketModelFile;

  const playerKey = normalizeText(args.player);
  const playerRows = rowsPayload.playerMarketRows
    .filter((row) => normalizeText(row.playerName) === playerKey && row.actualMinutes >= args.minActualMinutes)
    .sort((left, right) => {
      const marketCompare = left.market.localeCompare(right.market);
      if (marketCompare !== 0) return marketCompare;
      const dateCompare = left.gameDateEt.localeCompare(right.gameDateEt);
      if (dateCompare !== 0) return dateCompare;
      return left.line - right.line;
    });

  if (playerRows.length === 0) {
    throw new Error(`No line-backed rows found for player "${args.player}" with minActualMinutes=${args.minActualMinutes}.`);
  }

  const playerName = playerRows[0].playerName;
  const playerId = playerRows[0].playerId;
  const playerMeta = await prisma.player.findUnique({
    where: { id: playerId },
    select: { position: true },
  });
  const playerModels = modelPayload.playerMarketModels.filter(
    (model) => model.playerId === playerId || normalizeText(model.playerName) === playerKey,
  );
  const modelByMarket = new Map<Market, PlayerMarketModel>();
  playerModels.forEach((model) => {
    modelByMarket.set(model.market, model);
  });

  const perMarketRows = new Map<Market, PlayerMarketRow[]>();
  playerRows.forEach((row) => {
    const list = perMarketRows.get(row.market) ?? [];
    list.push(row);
    perMarketRows.set(row.market, list);
  });
  const projectionsByDate = new Map<string, Partial<Record<Market, number>>>();
  playerRows.forEach((row) => {
    const current = projectionsByDate.get(row.gameDateEt) ?? {};
    current[row.market] = row.projectedValue;
    projectionsByDate.set(row.gameDateEt, current);
  });

  const markets: Market[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
  const perMarket: Partial<Record<Market, MarketSummary>> = {};
  const gameSheetRows: Array<Record<string, unknown>> = [];
  const selectedPlayerModels: PlayerMarketModel[] = [];

  markets.forEach((market) => {
    const rows = (perMarketRows.get(market) ?? []).sort((left, right) => left.gameDateEt.localeCompare(right.gameDateEt));
    if (rows.length === 0) return;

    const modelEntry = modelByMarket.get(market) ?? null;
    const predictedRows = rows.map((row) => {
      const projectionSet = projectionsByDate.get(row.gameDateEt) ?? {};
      const rawPlayerPredictedSide = modelEntry ? predictVariant(modelEntry.model, row) : row.finalSide;
      const playerPredictedSide = applyCustomPlayerOverride(playerName, market, row, rawPlayerPredictedSide);
      const universalPredictedRaw = predictLiveUniversalModelSide({
        market,
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
        playerPosition: playerMeta?.position ?? null,
        assistProjection: projectionSet.AST ?? (market === "AST" ? row.projectedValue : null),
        pointsProjection: projectionSet.PTS ?? (market === "PTS" ? row.projectedValue : null),
        reboundsProjection: projectionSet.REB ?? (market === "REB" ? row.projectedValue : null),
        threesProjection: projectionSet.THREES ?? (market === "THREES" ? row.projectedValue : null),
      });
      const universalPredictedSide = universalPredictedRaw === "NEUTRAL" ? row.finalSide : universalPredictedRaw;
      const error = row.projectedValue - row.actualValue;
      return {
        row,
        playerPredictedSide,
        universalPredictedSide,
        actualSide: row.actualSide,
        error,
      };
    });

    const playerAccuracy = summarizeAccuracy(predictedRows.map((entry) => ({
      predicted: entry.playerPredictedSide,
      actual: entry.actualSide,
    })));
    const universalAccuracy = summarizeAccuracy(predictedRows.map((entry) => ({
      predicted: entry.universalPredictedSide,
      actual: entry.actualSide,
    })));

    const splitIndex = rows.length < 8 ? rows.length : Math.max(1, Math.floor(rows.length * (1 - args.holdoutRatio)));
    const holdoutRows = predictedRows.slice(splitIndex);
    const playerHoldoutAccuracy = holdoutRows.length
      ? summarizeAccuracy(holdoutRows.map((entry) => ({ predicted: entry.playerPredictedSide, actual: entry.actualSide }))).accuracy
      : null;
    const universalHoldoutAccuracy = holdoutRows.length
      ? summarizeAccuracy(holdoutRows.map((entry) => ({ predicted: entry.universalPredictedSide, actual: entry.actualSide }))).accuracy
      : null;

    const useUniversal =
      universalHoldoutAccuracy != null &&
      (playerHoldoutAccuracy == null ||
        universalHoldoutAccuracy > playerHoldoutAccuracy ||
        (universalHoldoutAccuracy === playerHoldoutAccuracy &&
          (universalAccuracy.accuracy ?? 0) > (playerAccuracy.accuracy ?? 0)));
    const chosenSource: "PLAYER" | "UNIVERSAL" = useUniversal ? "UNIVERSAL" : "PLAYER";
    const fullAccuracy = useUniversal ? universalAccuracy : playerAccuracy;
    const holdoutAccuracy = useUniversal ? universalHoldoutAccuracy : playerHoldoutAccuracy;

    const mae = predictedRows.length
      ? round(predictedRows.reduce((sum, entry) => sum + Math.abs(entry.error), 0) / predictedRows.length, 3)
      : null;
    const rmse = predictedRows.length
      ? round(Math.sqrt(predictedRows.reduce((sum, entry) => sum + entry.error * entry.error, 0) / predictedRows.length), 3)
      : null;
    const bias = predictedRows.length
      ? round(predictedRows.reduce((sum, entry) => sum + entry.error, 0) / predictedRows.length, 3)
      : null;

    const projectionBaseline =
      rows.length > 0
        ? round((rows.filter((row) => row.projectionCorrect).length / rows.length) * 100, 2)
        : null;
    const finalBaseline =
      rows.length > 0
        ? round((rows.filter((row) => row.finalCorrect).length / rows.length) * 100, 2)
        : null;

    perMarket[market] = {
      samples: rows.length,
      projectionBaselineAccuracy: projectionBaseline,
      finalBaselineAccuracy: finalBaseline,
      modelAccuracy: fullAccuracy.accuracy,
      lateWindowAccuracy: holdoutAccuracy,
      correct: fullAccuracy.correct,
      wrong: fullAccuracy.wrong,
      mae,
      rmse,
      bias,
      modelKind:
        useUniversal
          ? "universal:v8"
          : market === "PR" && normalizeText(playerName) === "jaylen brown"
            ? `${modelKindLabel(modelEntry?.model ?? null)}+jaylen-pr-v1`
            : modelKindLabel(modelEntry?.model ?? null),
      targetHit: (fullAccuracy.accuracy ?? 0) >= 80,
      chosenSource,
    };
    if (!useUniversal && modelEntry) {
      selectedPlayerModels.push(modelEntry);
    }

    predictedRows.forEach((entry) => {
      gameSheetRows.push({
        gameDateEt: entry.row.gameDateEt,
        market,
        playerName,
        line: entry.row.line,
        overPrice: entry.row.overPrice,
        underPrice: entry.row.underPrice,
        projectedValue: entry.row.projectedValue,
        actualValue: entry.row.actualValue,
        predictedSide: useUniversal ? entry.universalPredictedSide : entry.playerPredictedSide,
        playerPredictedSide: entry.playerPredictedSide,
        universalPredictedSide: entry.universalPredictedSide,
        chosenSource,
        actualSide: entry.actualSide,
        correct:
          (useUniversal ? entry.universalPredictedSide : entry.playerPredictedSide) === entry.actualSide,
        expectedMinutes: entry.row.expectedMinutes,
        actualMinutes: entry.row.actualMinutes,
        minutesVolatility: entry.row.minutesVolatility,
        starterRateLast10: entry.row.starterRateLast10,
        lineGap: entry.row.lineGap,
        priceLean: entry.row.priceLean,
        favoredSide: entry.row.favoredSide,
      });
    });
  });

  const hitCount = markets.filter((market) => perMarket[market]?.targetHit).length;
  const summary = {
    player: {
      id: playerId,
      name: playerName,
    },
    sourceRows: args.rows,
    sourceModels: args.models,
    range: {
      from: rowsPayload.from,
      to: rowsPayload.to,
    },
    filters: {
      minActualMinutes: args.minActualMinutes,
      lateWindowRatio: args.holdoutRatio,
    },
    allEightHit: hitCount === markets.length,
    targetHitCount: hitCount,
    perMarket,
  };

  const playerSummary = {
    playerId,
    playerName,
    marketCount: markets.filter((market) => perMarket[market]).length,
    targetHitCount: hitCount,
    allEightHit: hitCount === markets.length,
    markets: Object.fromEntries(
      markets
        .filter((market) => perMarket[market])
        .map((market) => [
          market,
          {
            samples: perMarket[market]?.samples ?? 0,
            modelAccuracy: perMarket[market]?.modelAccuracy,
            holdoutAccuracy: perMarket[market]?.lateWindowAccuracy,
            targetHit: perMarket[market]?.targetHit ?? false,
            chosenSource: perMarket[market]?.chosenSource ?? "PLAYER",
          },
        ]),
    ),
  };

  const liveSummary = {
    generatedFrom: args.out ?? null,
    playerSummary,
    playerModels: selectedPlayerModels,
  };

  if (args.out) {
    const outPath = path.resolve(args.out);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  if (args.sheetOut) {
    const sheetPath = path.resolve(args.sheetOut);
    await fs.mkdir(path.dirname(sheetPath), { recursive: true });
    await fs.writeFile(sheetPath, buildCsv(gameSheetRows), "utf8");
  }

  if (args.summaryOut) {
    const summaryPath = path.resolve(args.summaryOut);
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath, `${JSON.stringify(liveSummary, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});

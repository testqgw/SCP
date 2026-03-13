import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { round } from "../lib/utils";

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
  projectionCorrect: boolean;
  finalCorrect: boolean;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  actualMinutes: number;
  lineGap: number;
  absLineGap: number;
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

type ModelScore = {
  accuracy: number;
  correct: number;
  wrong: number;
};

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

type Args = {
  input: string;
  out: string;
  minSamples: number;
  maxDepth: number;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = path.join(
    "exports",
    "projection-backtest-allplayers-with-rows-2025-10-23-to-2026-03-09.json",
  );
  let out = path.join("exports", "player-market-side-models-2025-10-23-to-2026-03-09.json");
  let minSamples = 1;
  let maxDepth = 5;

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
    if (token === "--min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) minSamples = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (token.startsWith("--min-samples=")) {
      const parsed = Number(token.slice("--min-samples=".length));
      if (Number.isFinite(parsed) && parsed >= 1) minSamples = Math.floor(parsed);
      continue;
    }
    if (token === "--max-depth" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) maxDepth = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (token.startsWith("--max-depth=")) {
      const parsed = Number(token.slice("--max-depth=".length));
      if (Number.isFinite(parsed) && parsed >= 0) maxDepth = Math.floor(parsed);
    }
  }

  return { input, out, minSamples, maxDepth };
}

function impliedProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function getFeature(row: TrainingRow, feature: FeatureName): number | null {
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

function majoritySide(rows: TrainingRow[]): Side {
  let over = 0;
  let under = 0;
  rows.forEach((row) => {
    if (row.actualSide === "OVER") over += 1;
    else under += 1;
  });
  return over >= under ? "OVER" : "UNDER";
}

function scoreSide(rows: TrainingRow[], sideSelector: (row: TrainingRow) => Side): ModelScore {
  let correct = 0;
  let wrong = 0;
  rows.forEach((row) => {
    if (sideSelector(row) === row.actualSide) correct += 1;
    else wrong += 1;
  });
  return {
    accuracy: correct + wrong > 0 ? round((correct / (correct + wrong)) * 100, 2) : 0,
    correct,
    wrong,
  };
}

function leafFromRows(rows: TrainingRow[]): LeafNode {
  const side = majoritySide(rows);
  const score = scoreSide(rows, () => side);
  return {
    kind: "leaf",
    side,
    count: rows.length,
    accuracy: score.accuracy,
  };
}

const TREE_FEATURES: FeatureName[] = [
  "lineGap",
  "absLineGap",
  "expectedMinutes",
  "minutesVolatility",
  "starterRateLast10",
  "priceLean",
  "priceAbsLean",
  "line",
  "projectedValue",
  "favoredOver",
  "overPrice",
  "underPrice",
  "overProbability",
  "underProbability",
];

function candidateThresholds(rows: TrainingRow[], feature: FeatureName): number[] {
  const values = rows
    .map((row) => getFeature(row, feature))
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (values.length < 2) return [];

  const thresholds: number[] = [];
  const pushMidpoint = (left: number, right: number) => {
    const midpoint = round((left + right) / 2, 4);
    if (!thresholds.includes(midpoint)) thresholds.push(midpoint);
  };

  if (values.length <= 24) {
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] !== values[i - 1]) pushMidpoint(values[i - 1], values[i]);
    }
    return thresholds;
  }

  const quantiles = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  quantiles.forEach((quantile) => {
    const index = Math.max(1, Math.min(values.length - 1, Math.floor(values.length * quantile)));
    if (values[index] !== values[index - 1]) pushMidpoint(values[index - 1], values[index]);
  });
  return thresholds;
}

function trainTree(rows: TrainingRow[], maxDepth: number, minLeaf: number): TreeNode {
  const baseLeaf = leafFromRows(rows);
  if (maxDepth <= 0 || rows.length < minLeaf * 2) {
    return baseLeaf;
  }

  let bestFeature: FeatureName | null = null;
  let bestThreshold: number | null = null;
  let bestLeft: TrainingRow[] | null = null;
  let bestRight: TrainingRow[] | null = null;
  let bestAccuracy = baseLeaf.accuracy;

  TREE_FEATURES.forEach((feature) => {
    candidateThresholds(rows, feature).forEach((threshold) => {
      const left = rows.filter((row) => {
        const value = getFeature(row, feature);
        return value != null && value <= threshold;
      });
      const right = rows.filter((row) => {
        const value = getFeature(row, feature);
        return value != null && value > threshold;
      });
      if (left.length < minLeaf || right.length < minLeaf) return;

      const leftLeaf = leafFromRows(left);
      const rightLeaf = leafFromRows(right);
      const accuracy = round(
        ((leftLeaf.accuracy / 100) * left.length + (rightLeaf.accuracy / 100) * right.length) / rows.length * 100,
        2,
      );
      if (accuracy > bestAccuracy) {
        bestAccuracy = accuracy;
        bestFeature = feature;
        bestThreshold = threshold;
        bestLeft = left;
        bestRight = right;
      }
    });
  });

  if (!bestFeature || bestThreshold == null || !bestLeft || !bestRight) {
    return baseLeaf;
  }

  const leftTree = trainTree(bestLeft, maxDepth - 1, minLeaf);
  const rightTree = trainTree(bestRight, maxDepth - 1, minLeaf);

  return {
    kind: "split",
    feature: bestFeature,
    threshold: bestThreshold,
    count: rows.length,
    accuracy: bestAccuracy,
    left: leftTree,
    right: rightTree,
  };
}

function predictTree(node: TreeNode, row: TrainingRow): Side {
  if (node.kind === "leaf") return node.side;
  const value = getFeature(row, node.feature);
  if (value == null) return node.left.kind === "leaf" ? node.left.side : predictTree(node.left, row);
  return value <= node.threshold ? predictTree(node.left, row) : predictTree(node.right, row);
}

function predictVariant(model: ModelVariant, row: TrainingRow): Side {
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
      return row.absLineGap >= model.threshold ? row.projectionSide : row.favoredSide === "NEUTRAL" ? row.projectionSide : row.favoredSide;
    case "gapThenMarket":
      return row.absLineGap >= model.threshold ? (row.favoredSide === "NEUTRAL" ? row.projectionSide : row.favoredSide) : row.projectionSide;
    case "tree":
      return predictTree(model.tree, row);
    default:
      return row.projectionSide;
  }
}

function scoreVariant(model: ModelVariant, rows: TrainingRow[]): ModelScore {
  return scoreSide(rows, (row) => predictVariant(model, row));
}

function fitBestModel(rows: TrainingRow[], maxDepth: number): { model: ModelVariant; score: ModelScore } {
  const candidates: ModelVariant[] = [
    { kind: "projection" },
    { kind: "finalOverride" },
    { kind: "marketFavored" },
    { kind: "constant", side: "OVER" },
    { kind: "constant", side: "UNDER" },
  ];

  [0.15, 0.25, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 2].forEach((threshold) => {
    candidates.push({ kind: "gapThenProjection", threshold });
    candidates.push({ kind: "gapThenMarket", threshold });
  });

  const maxMinLeaf = Math.max(1, Math.min(6, Math.floor(rows.length / 4) || 1));
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    for (let minLeaf = 1; minLeaf <= maxMinLeaf; minLeaf += 1) {
      candidates.push({ kind: "tree", tree: trainTree(rows, depth, minLeaf), maxDepth: depth, minLeaf });
    }
  }

  let best = candidates[0];
  let bestScore = scoreVariant(best, rows);
  candidates.slice(1).forEach((candidate) => {
    const score = scoreVariant(candidate, rows);
    if (
      score.accuracy > bestScore.accuracy ||
      (score.accuracy === bestScore.accuracy &&
        ((candidate.kind === "tree" ? candidate.maxDepth : 0) < (best.kind === "tree" ? best.maxDepth : 0)))
    ) {
      best = candidate;
      bestScore = score;
    }
  });
  return { model: best, score: bestScore };
}

function holdoutSplit(rows: TrainingRow[]): { train: TrainingRow[]; test: TrainingRow[] } {
  if (rows.length < 8) {
    return { train: rows, test: [] };
  }
  const splitIndex = Math.max(1, Math.floor(rows.length * 0.7));
  return {
    train: rows.slice(0, splitIndex),
    test: rows.slice(splitIndex),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const raw = await readFile(args.input, "utf8");
  const parsed = JSON.parse(raw) as { playerMarketRows?: TrainingRow[]; from?: string; to?: string };
  const rows = (parsed.playerMarketRows ?? []).slice().sort((left, right) => {
    const dateCompare = left.gameDateEt.localeCompare(right.gameDateEt);
    if (dateCompare !== 0) return dateCompare;
    const playerCompare = left.playerName.localeCompare(right.playerName);
    if (playerCompare !== 0) return playerCompare;
    return left.market.localeCompare(right.market);
  });

  if (rows.length === 0) {
    throw new Error("No playerMarketRows found in input file. Re-run the backtest with --emit-player-rows.");
  }

  const byKey = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const key = `${row.playerId}|${row.market}`;
    const bucket = byKey.get(key) ?? [];
    bucket.push(row);
    byKey.set(key, bucket);
  });

  const models: PlayerMarketModel[] = [];
  for (const bucket of byKey.values()) {
    if (bucket.length < args.minSamples) continue;
    const ordered = bucket.slice().sort((left, right) => left.gameDateEt.localeCompare(right.gameDateEt));
    const projectionBaselineAccuracy = scoreVariant({ kind: "projection" }, ordered).accuracy;
    const finalBaselineAccuracy = scoreVariant({ kind: "finalOverride" }, ordered).accuracy;
    const { model, score } = fitBestModel(ordered, args.maxDepth);
    const split = holdoutSplit(ordered);
    const holdout =
      split.test.length > 0 ? scoreVariant(fitBestModel(split.train, args.maxDepth).model, split.test).accuracy : null;

    models.push({
      playerId: ordered[0].playerId,
      playerName: ordered[0].playerName,
      market: ordered[0].market,
      samples: ordered.length,
      projectionBaselineAccuracy,
      finalBaselineAccuracy,
      modelAccuracy: score.accuracy,
      holdoutAccuracy: holdout,
      targetHit: score.accuracy >= 80,
      model,
    });
  }

  models.sort(
    (left, right) =>
      left.playerName.localeCompare(right.playerName) ||
      left.market.localeCompare(right.market),
  );

  const summaryMap = models.reduce((map, model) => {
    const existing =
      map.get(model.playerId) ??
      {
        playerId: model.playerId,
        playerName: model.playerName,
        marketCount: 0,
        targetHitCount: 0,
        allEightHit: false,
        markets: {} as Record<Market, { samples: number; modelAccuracy: number; holdoutAccuracy: number | null; targetHit: boolean }>,
      };
    existing.marketCount += 1;
    if (model.targetHit) existing.targetHitCount += 1;
    existing.markets[model.market] = {
      samples: model.samples,
      modelAccuracy: model.modelAccuracy,
      holdoutAccuracy: model.holdoutAccuracy,
      targetHit: model.targetHit,
    };
    map.set(model.playerId, existing);
    return map;
  }, new Map<string, { playerId: string; playerName: string; marketCount: number; targetHitCount: number; allEightHit: boolean; markets: Record<Market, { samples: number; modelAccuracy: number; holdoutAccuracy: number | null; targetHit: boolean }> }>());

  const playerSummaries = Array.from(summaryMap.values()).map((summary) => {
    const marketKeys = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"] as Market[];
    const allEightHit = marketKeys.every(
      (market) =>
        typeof summary.markets[market] === "object" &&
        summary.markets[market] != null &&
        (summary.markets[market] as { targetHit: boolean }).targetHit,
    );
    return { ...summary, allEightHit };
  });

  const output = {
    input: args.input,
    from: parsed.from ?? null,
    to: parsed.to ?? null,
    minSamples: args.minSamples,
    maxDepth: args.maxDepth,
    modelCount: models.length,
    playersRepresented: new Set(models.map((model) => model.playerId)).size,
    playerMarketModels: models,
    playerSummaries,
    playersAllEightAt80: playerSummaries.filter((summary) => summary.allEightHit),
  };

  const outputPath = path.resolve(args.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`Saved ${models.length} player-market models to ${outputPath}`);
  console.log(`Players with all eight markets at >=80%: ${output.playersAllEightAt80.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

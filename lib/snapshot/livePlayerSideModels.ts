import fs from "node:fs";
import path from "node:path";
import { normalizePlayerName } from "@/lib/lineups/rotowire";
import type { SnapshotMarket, SnapshotModelSide } from "@/lib/types/snapshot";

type Side = "OVER" | "UNDER";

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
  playerName: string;
  market: SnapshotMarket;
  model: ModelVariant;
};

type PlayerModelSummaryFile = {
  playerModels?: PlayerMarketModel[];
};

type LivePlayerModelRow = {
  projectedValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  projectionSide: Side;
  finalSide: Side;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  lineGap: number;
  absLineGap: number;
};

type PredictLivePlayerSideInput = {
  playerName: string | null;
  market: SnapshotMarket;
  projectedValue: number | null;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  finalSide: SnapshotModelSide;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
};

const LIVE_MODEL_FILES = [
  path.join(process.cwd(), "exports", "shai-gilgeous-alexander-player-model-summary.json"),
  path.join(process.cwd(), "exports", "giannis-antetokounmpo-player-model-summary.json"),
  path.join(process.cwd(), "exports", "luka-doncic-player-model-summary.json"),
  path.join(process.cwd(), "exports", "victor-wembanyama-player-model-summary.json"),
  path.join(process.cwd(), "exports", "anthony-edwards-player-model-summary.json"),
  path.join(process.cwd(), "exports", "stephen-curry-player-model-summary.json"),
  path.join(process.cwd(), "exports", "donovan-mitchell-player-model-summary.json"),
  path.join(process.cwd(), "exports", "cade-cunningham-player-model-summary.json"),
  path.join(process.cwd(), "exports", "jaylen-brown-player-model-summary.json"),
  path.join(process.cwd(), "exports", "kevin-durant-player-model-summary.json"),
  path.join(process.cwd(), "exports", "kawhi-leonard-player-model-summary.json"),
];

let cachedModelMap: Map<string, Map<SnapshotMarket, ModelVariant>> | null = null;

function normalizePlayerKey(value: string | null | undefined): string {
  return normalizePlayerName(value ?? "");
}

function loadModelMap(): Map<string, Map<SnapshotMarket, ModelVariant>> {
  if (cachedModelMap) return cachedModelMap;

  const map = new Map<string, Map<SnapshotMarket, ModelVariant>>();
  for (const filePath of LIVE_MODEL_FILES) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as PlayerModelSummaryFile;
      for (const model of payload.playerModels ?? []) {
        const playerKey = normalizePlayerKey(model.playerName);
        if (!playerKey) continue;
        const marketMap = map.get(playerKey) ?? new Map<SnapshotMarket, ModelVariant>();
        marketMap.set(model.market, model.model);
        map.set(playerKey, marketMap);
      }
    } catch {
      continue;
    }
  }

  cachedModelMap = map;
  return map;
}

function impliedProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function getFeature(row: LivePlayerModelRow, feature: FeatureName): number | null {
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

function predictTree(node: TreeNode, row: LivePlayerModelRow): Side {
  if (node.kind === "leaf") return node.side;
  const value = getFeature(row, node.feature);
  if (value == null) {
    return node.left.kind === "leaf" ? node.left.side : predictTree(node.left, row);
  }
  return value <= node.threshold ? predictTree(node.left, row) : predictTree(node.right, row);
}

function predictVariant(model: ModelVariant, row: LivePlayerModelRow): Side {
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
  market: SnapshotMarket,
  row: LivePlayerModelRow,
  predictedSide: Side,
): Side {
  const playerKey = normalizePlayerKey(playerName);

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

export function predictLivePlayerModelSide(input: PredictLivePlayerSideInput): SnapshotModelSide {
  const playerKey = normalizePlayerKey(input.playerName);
  if (!playerKey || input.projectedValue == null || input.line == null) return "NEUTRAL";

  const playerModel = loadModelMap().get(playerKey)?.get(input.market);
  if (!playerModel) return "NEUTRAL";

  const projectionSide: Side =
    input.projectedValue > input.line ? "OVER" : input.projectedValue < input.line ? "UNDER" : "UNDER";
  const favoredSide =
    input.overPrice == null || input.underPrice == null
      ? "NEUTRAL"
      : impliedProbability(input.overPrice) === impliedProbability(input.underPrice)
        ? "NEUTRAL"
        : (impliedProbability(input.overPrice) ?? 0) > (impliedProbability(input.underPrice) ?? 0)
          ? "OVER"
          : "UNDER";
  const priceLean =
    input.overPrice == null || input.underPrice == null
      ? null
      : (impliedProbability(input.overPrice) ?? 0) - (impliedProbability(input.underPrice) ?? 0);

  const finalSide: Side =
    input.finalSide === "OVER" || input.finalSide === "UNDER" ? input.finalSide : projectionSide;

  const row: LivePlayerModelRow = {
    projectedValue: input.projectedValue,
    line: input.line,
    overPrice: input.overPrice,
    underPrice: input.underPrice,
    projectionSide,
    finalSide,
    priceLean,
    favoredSide,
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    lineGap: input.projectedValue - input.line,
    absLineGap: Math.abs(input.projectedValue - input.line),
  };

  const predicted = predictVariant(playerModel, row);
  return applyCustomPlayerOverride(input.playerName ?? "", input.market, row, predicted);
}

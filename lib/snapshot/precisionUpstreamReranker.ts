import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { normalizeLivePlayerOverrideKey } from "@/lib/snapshot/livePlayerSideModels";
import type {
  SnapshotMarket,
  SnapshotModelSide,
  SnapshotPrecisionPickSignal,
  SnapshotPrecisionCardSource,
} from "@/lib/types/snapshot";
import { round } from "@/lib/utils";
import { PROMOTED_PRECISION_MIN_SPORTSBOOK_COUNT } from "@/lib/snapshot/precisionPickSystem";

type Side = "OVER" | "UNDER";
type PriorityPoolLabel =
  | "scoring_core_final_relaxed"
  | "scoring_core_strict_relaxed"
  | "combo_no_threes_final_relaxed"
  | "combo_no_threes_strict_relaxed";
type PriorityPoolMode = "approved_and_agree_final" | "approved_and_agree_strict";
type PriorityCategoryField =
  | "market"
  | "rawSource"
  | "strictRawSource"
  | "finalSource"
  | "archetype"
  | "modelKind";
type PriorityNumericField =
  | "poolCount"
  | "strictPoolCount"
  | "finalPoolCount"
  | "scoringCorePool"
  | "comboPool"
  | "rawQualified"
  | "strictAgreement"
  | "finalAgreement"
  | "projectionAgreement"
  | "favoredAgreement"
  | "playerOverrideEngaged"
  | "holdoutAccuracy"
  | "projectionBaselineAccuracy"
  | "finalBaselineAccuracy"
  | "modelAccuracy"
  | "samples"
  | "edgeVsProjection"
  | "edgeVsFinal"
  | "projectedValue"
  | "lineGap"
  | "absLineGap"
  | "expectedMinutes"
  | "minutesVolatility"
  | "starterRateLast10"
  | "priceLean"
  | "weightedCurrentLineOverRate"
  | "emaCurrentLineDelta"
  | "emaCurrentLineOverRate"
  | "l5CurrentLineOverRate"
  | "baseScoreGap"
  | "baseScoreRecency"
  | "baseScoreBalanced";
type PriorityTreeFeature =
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

type PriorityLeafNode = {
  kind: "leaf";
  side: Side;
  count?: number;
  accuracy?: number;
};

type PrioritySplitNode = {
  kind: "split";
  feature: PriorityTreeFeature;
  threshold: number;
  left: PriorityTreeNode;
  right: PriorityTreeNode;
  count?: number;
  accuracy?: number;
};

type PriorityTreeNode = PriorityLeafNode | PrioritySplitNode;

type PriorityModelVariant =
  | { kind: "constant"; side: Side }
  | { kind: "projection" }
  | { kind: "finalOverride" }
  | { kind: "marketFavored" }
  | { kind: "gapThenProjection"; threshold: number }
  | { kind: "gapThenMarket"; threshold: number }
  | { kind: "tree"; tree: PriorityTreeNode; maxDepth: number; minLeaf: number };

type PriorityPlayerMarketModelRecord = {
  playerId?: string;
  playerName: string;
  market: SnapshotMarket;
  samples: number;
  projectionBaselineAccuracy: number;
  finalBaselineAccuracy: number;
  modelAccuracy: number;
  holdoutAccuracy: number | null;
  targetHit?: boolean;
  model: PriorityModelVariant;
};

type PriorityPlayerMarketModelFile = {
  playerMarketModels?: PriorityPlayerMarketModelRecord[];
};

type PriorityPoolSpec = {
  label: PriorityPoolLabel;
  scopeMarkets: Set<SnapshotMarket>;
  poolMode: PriorityPoolMode;
  minSamples: number;
  minHoldoutAccuracy: number;
  minEdgeVsProjection: number;
  minEdgeVsFinal: number;
  topN: number | null;
};

type PriorityApprovedModel = PriorityPlayerMarketModelRecord & {
  playerKey: string;
  rankHoldoutGap: number;
};

type PriorityRuntimeModelRow = {
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

type PriorityRuntimeMeta = {
  date: string;
  playerId: string;
  playerName: string;
  market: SnapshotMarket;
  side: Side;
  poolCount: number;
  strictPoolCount: number;
  finalPoolCount: number;
  scoringCorePool: boolean;
  comboPool: boolean;
  rawSource: string;
  strictRawSource: string;
  finalSource: string;
  overrideEngaged: boolean;
  playerOverrideEngaged: boolean;
  rawQualified: boolean;
  strictAgreement: boolean;
  finalAgreement: boolean;
  projectionAgreement: boolean;
  favoredAgreement: boolean;
  archetype: string | null;
  modelKind: string | null;
  bucketSamples: number | null;
  bucketModelAccuracy: number | null;
  bucketLateAccuracy: number | null;
  leafCount: number | null;
  leafAccuracy: number | null;
  projectionWinProbability: number | null;
  projectionPriceEdge: number | null;
  priceStrength: number | null;
  projectionMarketAgreement: number | null;
  rejectionCount: number;
  holdoutAccuracy: number | null;
  projectionBaselineAccuracy: number;
  finalBaselineAccuracy: number;
  modelAccuracy: number;
  samples: number;
  edgeVsProjection: number | null;
  edgeVsFinal: number | null;
  projectedValue: number;
  lineGap: number;
  absLineGap: number;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  priceLean: number | null;
  weightedCurrentLineOverRate: number | null;
  emaCurrentLineDelta: number | null;
  emaCurrentLineOverRate: number | null;
  l5CurrentLineOverRate: number | null;
  baseScoreGap: number;
  baseScoreRecency: number;
  baseScoreBalanced: number;
};

type PriorityHistoryRow = PriorityRuntimeMeta & {
  correct: boolean;
};

type PriorityHistoryArtifact = {
  version?: string;
  generatedAt?: string;
  rows?: PriorityHistoryRow[];
};

type PriorityRawHistoryRow = Omit<PriorityHistoryRow, "poolCount" | "strictPoolCount" | "finalPoolCount" | "scoringCorePool" | "comboPool"> & {
  poolLabel: PriorityPoolLabel;
};

type PriorityRawHistoryFile = {
  rows?: PriorityRawHistoryRow[];
};

type PriorityModelSnapshot = {
  start: string;
  end: string;
  modelsFile: string;
};

type PriorityCandidateBuildInput = {
  dateEt: string;
  playerId: string;
  playerName: string;
  matchupKey: string;
  market: SnapshotMarket;
  sportsbookCount: number;
  projectionSide: Side | null;
  finalSide: SnapshotModelSide;
  strictRawSide: SnapshotModelSide;
  rawSource: string;
  strictRawSource: string;
  finalSource: string;
  overrideEngaged: boolean;
  playerOverrideEngaged: boolean;
  rawQualified: boolean;
  rejectionCount: number;
  archetype: string | null;
  modelKind: string | null;
  bucketSamples: number | null;
  bucketModelAccuracy: number | null;
  bucketLateAccuracy: number | null;
  leafCount: number | null;
  leafAccuracy: number | null;
  projectionWinProbability: number | null;
  projectionPriceEdge: number | null;
  priceStrength: number | null;
  projectionMarketAgreement: number | null;
  projectedValue: number | null;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  priceLean: number | null;
  weightedCurrentLineOverRate: number | null;
  emaCurrentLineDelta: number | null;
  emaCurrentLineOverRate: number | null;
  l5CurrentLineOverRate: number | null;
  strictSignal?: SnapshotPrecisionPickSignal | null;
};

type PriorityReplaySummary = {
  overall: { picks: number; correct: number; accuracy: number };
  last30: { picks: number; correct: number; accuracy: number };
  last14: { picks: number; correct: number; accuracy: number };
  picksPerDay: number;
};

type PriorityEncodedModel = {
  weights: number[];
  featureIndex: Map<string, number>;
  numericStats: Record<PriorityNumericField, { mean: number; stdDev: number }>;
};

type PrioritySerializedEncodedModel = {
  weights: number[];
  featureIndexEntries: Array<[string, number]>;
  numericStats: Record<PriorityNumericField, { mean: number; stdDev: number }>;
};

type PriorityRuntimeModelArtifact = {
  version?: string;
  generatedAt?: string;
  trainedThroughDate?: string;
  historyRowCount?: number;
  model?: PrioritySerializedEncodedModel | null;
};

const PRIORITY_HISTORY_RELATIVE_PATH = path.join("exports", "precision-upstream-reranker-history-v1.json");
const PRIORITY_HISTORY_FALLBACK_RELATIVE_PATH = path.join("exports", "_tmp_priority_upstream_meta_dataset.json");
const PRIORITY_RUNTIME_MODEL_RELATIVE_PATH = path.join("exports", "precision-upstream-reranker-runtime-model-v1.json");
const PRIORITY_POOL_SPECS: PriorityPoolSpec[] = [
  {
    label: "scoring_core_final_relaxed",
    scopeMarkets: new Set<SnapshotMarket>(["PTS", "PRA", "PA", "PR", "RA"]),
    poolMode: "approved_and_agree_final",
    minSamples: 16,
    minHoldoutAccuracy: 60,
    minEdgeVsProjection: 3,
    minEdgeVsFinal: 3,
    topN: 260,
  },
  {
    label: "scoring_core_strict_relaxed",
    scopeMarkets: new Set<SnapshotMarket>(["PTS", "PRA", "PA", "PR", "RA"]),
    poolMode: "approved_and_agree_strict",
    minSamples: 16,
    minHoldoutAccuracy: 60,
    minEdgeVsProjection: 3,
    minEdgeVsFinal: 3,
    topN: 260,
  },
  {
    label: "combo_no_threes_final_relaxed",
    scopeMarkets: new Set<SnapshotMarket>(["PTS", "REB", "AST", "PRA", "PA", "PR", "RA"]),
    poolMode: "approved_and_agree_final",
    minSamples: 16,
    minHoldoutAccuracy: 60,
    minEdgeVsProjection: 3,
    minEdgeVsFinal: 3,
    topN: 320,
  },
  {
    label: "combo_no_threes_strict_relaxed",
    scopeMarkets: new Set<SnapshotMarket>(["PTS", "REB", "AST", "PRA", "PA", "PR", "RA"]),
    poolMode: "approved_and_agree_strict",
    minSamples: 16,
    minHoldoutAccuracy: 60,
    minEdgeVsProjection: 3,
    minEdgeVsFinal: 3,
    topN: 320,
  },
];
const PRIORITY_MODEL_SNAPSHOTS: PriorityModelSnapshot[] = [
  {
    start: "2026-02-16",
    end: "2026-03-15",
    modelsFile: path.join(process.cwd(), "exports", "player-market-side-models-2025-10-23-to-2026-02-15-priority-train.json"),
  },
  {
    start: "2026-03-16",
    end: "2026-03-31",
    modelsFile: path.join(process.cwd(), "exports", "player-market-side-models-2025-10-23-to-2026-03-15-priority-train.json"),
  },
  {
    start: "2026-04-01",
    end: "2026-04-14",
    modelsFile: path.join(process.cwd(), "exports", "player-market-side-models-2025-10-23-to-2026-03-31-priority-train.json"),
  },
];
const PRIORITY_LIVE_MODEL_FALLBACKS = [
  path.join(process.cwd(), "exports", "player-market-side-models-2025-10-23-to-2026-04-02-priority-train.json"),
  path.join(process.cwd(), "exports", "player-market-side-models-2025-10-23-to-2026-03-31-priority-train.json"),
  path.join(process.cwd(), "exports", "player-market-side-models-2025-10-23-to-2026-03-15-priority-train.json"),
  path.join(process.cwd(), "exports", "player-market-side-models-2025-10-23-to-2026-02-15-priority-train.json"),
];
const PRIORITY_SELECTOR_TARGET_COUNT = 6;
const PRIORITY_SELECTOR_MARKET_CAPS: Partial<Record<SnapshotMarket, number>> = {
  PTS: 2,
  REB: 2,
  AST: 1,
  PRA: 2,
  PA: 1,
  PR: 2,
  RA: 2,
};
const PRIORITY_NUMERIC_FIELDS: PriorityNumericField[] = [
  "poolCount",
  "strictPoolCount",
  "finalPoolCount",
  "scoringCorePool",
  "comboPool",
  "rawQualified",
  "strictAgreement",
  "finalAgreement",
  "projectionAgreement",
  "favoredAgreement",
  "playerOverrideEngaged",
  "holdoutAccuracy",
  "projectionBaselineAccuracy",
  "finalBaselineAccuracy",
  "modelAccuracy",
  "samples",
  "edgeVsProjection",
  "edgeVsFinal",
  "projectedValue",
  "lineGap",
  "absLineGap",
  "expectedMinutes",
  "minutesVolatility",
  "starterRateLast10",
  "priceLean",
  "weightedCurrentLineOverRate",
  "emaCurrentLineDelta",
  "emaCurrentLineOverRate",
  "l5CurrentLineOverRate",
  "baseScoreGap",
  "baseScoreRecency",
  "baseScoreBalanced",
];
const PRIORITY_CATEGORY_FIELDS: PriorityCategoryField[] = [
  "market",
  "rawSource",
  "strictRawSource",
  "finalSource",
  "archetype",
  "modelKind",
];
const PRIORITY_WARMUP_DATES = 7;
const PRIORITY_TRAINING_EPOCHS = 220;
const PRIORITY_LEARNING_RATE = 0.22;
const PRIORITY_L2_REGULARIZATION = 0.0006;

let cachedPriorityHistoryRows: PriorityHistoryRow[] | null = null;
const cachedApprovedPoolMaps = new Map<string, Map<PriorityPoolLabel, Map<string, PriorityApprovedModel>>>();
let cachedPriorityReplaySummary: PriorityReplaySummary | null = null;
const cachedTrainedModels = new Map<string, PriorityEncodedModel | null>();
let cachedPriorityRuntimeModelArtifact:
  | {
      trainedThroughDate: string;
      model: PriorityEncodedModel | null;
    }
  | null
  | undefined;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function parseJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
}

function normalizePriorityKey(playerName: string): string {
  return normalizeLivePlayerOverrideKey(playerName);
}

function resolvePriorityModelFileForDate(dateEt: string): string | null {
  const snapshot = PRIORITY_MODEL_SNAPSHOTS.find((entry) => dateEt >= entry.start && dateEt <= entry.end);
  if (snapshot && existsSync(snapshot.modelsFile)) {
    return snapshot.modelsFile;
  }
  return PRIORITY_LIVE_MODEL_FALLBACKS.find((filePath) => existsSync(filePath)) ?? null;
}

function getPriorityTreeFeatureValue(row: PriorityRuntimeModelRow, feature: PriorityTreeFeature): number | null {
  const overProbability = impliedProbability(row.overPrice);
  const underProbability = impliedProbability(row.underPrice);
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
      return overProbability;
    case "underProbability":
      return underProbability;
    default:
      return null;
  }
}

function predictPriorityTree(node: PriorityTreeNode, row: PriorityRuntimeModelRow): Side {
  if (node.kind === "leaf") return node.side;
  const value = getPriorityTreeFeatureValue(row, node.feature);
  if (value == null) {
    return predictPriorityTree(node.left, row);
  }
  return value <= node.threshold ? predictPriorityTree(node.left, row) : predictPriorityTree(node.right, row);
}

function predictPriorityVariant(model: PriorityModelVariant, row: PriorityRuntimeModelRow): Side {
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
      return predictPriorityTree(model.tree, row);
    default:
      return row.projectionSide;
  }
}

function impliedProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function getRankHoldoutGap(model: PriorityPlayerMarketModelRecord): number {
  const holdout = model.holdoutAccuracy ?? Number.NEGATIVE_INFINITY;
  const edgeProjection = holdout - model.projectionBaselineAccuracy;
  const edgeFinal = holdout - model.finalBaselineAccuracy;
  return holdout + edgeProjection + edgeFinal + model.samples * 0.04;
}

function loadApprovedPoolMapsForFile(filePath: string): Map<PriorityPoolLabel, Map<string, PriorityApprovedModel>> {
  const cached = cachedApprovedPoolMaps.get(filePath);
  if (cached) return cached;

  const payload = parseJsonFile<PriorityPlayerMarketModelFile>(filePath);
  const next = new Map<PriorityPoolLabel, Map<string, PriorityApprovedModel>>();

  PRIORITY_POOL_SPECS.forEach((pool) => {
    const models: PriorityApprovedModel[] = [];
    (payload.playerMarketModels ?? []).forEach((model) => {
      if (!pool.scopeMarkets.has(model.market)) return;
      if (model.samples < pool.minSamples) return;
      if (model.holdoutAccuracy == null || model.holdoutAccuracy < pool.minHoldoutAccuracy) return;
      if (model.holdoutAccuracy < model.projectionBaselineAccuracy + pool.minEdgeVsProjection) return;
      if (model.holdoutAccuracy < model.finalBaselineAccuracy + pool.minEdgeVsFinal) return;
      const playerKey = normalizePriorityKey(model.playerName);
      if (!playerKey) return;
      models.push({
        ...model,
        playerKey,
        rankHoldoutGap: getRankHoldoutGap(model),
      });
    });

    models.sort(
      (left, right) =>
        right.rankHoldoutGap - left.rankHoldoutGap ||
        (right.holdoutAccuracy ?? Number.NEGATIVE_INFINITY) - (left.holdoutAccuracy ?? Number.NEGATIVE_INFINITY) ||
        right.samples - left.samples,
    );

    const limited = pool.topN == null ? models : models.slice(0, pool.topN);
    next.set(
      pool.label,
      new Map(limited.map((model) => [`${model.playerKey}|${model.market}`, model] as const)),
    );
  });

  cachedApprovedPoolMaps.set(filePath, next);
  return next;
}

function getPriorityRecencyFit(input: {
  weightedCurrentLineOverRate?: number | null;
  emaCurrentLineOverRate?: number | null;
  l5CurrentLineOverRate?: number | null;
  emaCurrentLineDelta?: number | null;
}, side: Side): number {
  const overRate =
    input.weightedCurrentLineOverRate ??
    input.emaCurrentLineOverRate ??
    input.l5CurrentLineOverRate ??
    0.5;
  const delta = input.emaCurrentLineDelta ?? 0;
  const overRateFit = side === "OVER" ? overRate : 1 - overRate;
  const deltaFit = side === "OVER" ? clamp01((delta + 4) / 8) : clamp01((4 - delta) / 8);
  return round(0.65 * overRateFit + 0.35 * deltaFit, 6);
}

function getPriorityMinutesFit(input: {
  expectedMinutes?: number | null;
  minutesVolatility?: number | null;
  starterRateLast10?: number | null;
}, side: Side): number {
  const expectedMinutes = input.expectedMinutes ?? 0;
  const volatility = input.minutesVolatility ?? 0;
  const starterRate = input.starterRateLast10 ?? 0.5;
  const minutesComponent = clamp01(expectedMinutes / 38);
  const volatilityComponent = clamp01(volatility / 10);
  const starterComponent = clamp01(starterRate);

  if (side === "OVER") {
    return round(0.5 * minutesComponent + 0.25 * starterComponent + 0.25 * (1 - volatilityComponent), 6);
  }

  return round(0.5 * (1 - minutesComponent) + 0.25 * (1 - starterComponent) + 0.25 * volatilityComponent, 6);
}

function getPriorityPriceLeanFit(priceLean: number | null, side: Side): number {
  const lean = priceLean ?? 0;
  return side === "OVER" ? clamp01((lean + 0.18) / 0.36) : clamp01((0.18 - lean) / 0.36);
}

function getPriorityBaseScore(meta: {
  holdoutAccuracy: number | null;
  projectionBaselineAccuracy: number;
  finalBaselineAccuracy: number;
  modelAccuracy: number;
  samples: number;
  absLineGap: number;
  priceLean: number | null;
  weightedCurrentLineOverRate?: number | null;
  emaCurrentLineOverRate?: number | null;
  l5CurrentLineOverRate?: number | null;
  emaCurrentLineDelta?: number | null;
  expectedMinutes?: number | null;
  minutesVolatility?: number | null;
  starterRateLast10?: number | null;
}, side: Side, profile: "gap" | "recency" | "balanced"): number {
  const holdout = clamp01((meta.holdoutAccuracy ?? 0) / 100);
  const modelAccuracy = clamp01(meta.modelAccuracy / 100);
  const edgeProjection = clamp01(((meta.holdoutAccuracy ?? 0) - meta.projectionBaselineAccuracy) / 20);
  const edgeFinal = clamp01(((meta.holdoutAccuracy ?? 0) - meta.finalBaselineAccuracy) / 20);
  const gap = clamp01(meta.absLineGap / 8);
  const recency = getPriorityRecencyFit(meta, side);
  const minutes = getPriorityMinutesFit(meta, side);
  const priceLean = getPriorityPriceLeanFit(meta.priceLean, side);
  const sampleSize = clamp01(meta.samples / 80);

  switch (profile) {
    case "gap":
      return round(
        0.44 * holdout +
          0.14 * edgeProjection +
          0.14 * edgeFinal +
          0.14 * gap +
          0.08 * recency +
          0.06 * sampleSize,
        6,
      );
    case "recency":
      return round(
        0.36 * holdout +
          0.13 * edgeProjection +
          0.13 * edgeFinal +
          0.15 * recency +
          0.1 * minutes +
          0.07 * priceLean +
          0.06 * gap,
        6,
      );
    case "balanced":
      return round(
        0.32 * holdout +
          0.12 * modelAccuracy +
          0.12 * edgeProjection +
          0.12 * edgeFinal +
          0.12 * recency +
          0.1 * minutes +
          0.05 * priceLean +
          0.05 * gap,
        6,
      );
    default:
      return holdout;
  }
}

function aggregatePriorityRawHistoryRows(rows: PriorityRawHistoryRow[]): PriorityHistoryRow[] {
  const byKey = new Map<
    string,
    PriorityHistoryRow & {
      poolLabels: Set<PriorityPoolLabel>;
    }
  >();

  rows.forEach((row) => {
    const key = `${row.date}|${row.playerId}|${row.market}|${row.side}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.poolLabels.add(row.poolLabel);
      return;
    }
    byKey.set(key, {
      ...row,
      poolCount: 0,
      strictPoolCount: 0,
      finalPoolCount: 0,
      scoringCorePool: false,
      comboPool: false,
      poolLabels: new Set([row.poolLabel]),
    });
  });

  return Array.from(byKey.values())
    .map((row) => {
      const poolLabels = Array.from(row.poolLabels);
      return {
        ...row,
        poolCount: poolLabels.length,
        strictPoolCount: poolLabels.filter((label) => label.includes("_strict_")).length,
        finalPoolCount: poolLabels.filter((label) => label.includes("_final_")).length,
        scoringCorePool: poolLabels.some((label) => label.startsWith("scoring_core_")),
        comboPool: poolLabels.some((label) => label.startsWith("combo_no_threes_")),
      };
    })
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.playerName.localeCompare(right.playerName) ||
        left.market.localeCompare(right.market),
    )
    .map((row) => {
      const { poolLabels, ...next } = row;
      void poolLabels;
      return next;
    });
}

function loadPriorityHistoryRows(): PriorityHistoryRow[] {
  if (cachedPriorityHistoryRows) return cachedPriorityHistoryRows;

  const preferredPath = path.join(process.cwd(), PRIORITY_HISTORY_RELATIVE_PATH);
  if (existsSync(preferredPath)) {
    const payload = parseJsonFile<PriorityHistoryArtifact>(preferredPath);
    cachedPriorityHistoryRows = (payload.rows ?? []).slice().sort((left, right) => left.date.localeCompare(right.date));
    return cachedPriorityHistoryRows;
  }

  const fallbackPath = path.join(process.cwd(), PRIORITY_HISTORY_FALLBACK_RELATIVE_PATH);
  if (!existsSync(fallbackPath)) {
    cachedPriorityHistoryRows = [];
    return cachedPriorityHistoryRows;
  }

  const fallbackPayload = parseJsonFile<PriorityRawHistoryFile>(fallbackPath);
  cachedPriorityHistoryRows = aggregatePriorityRawHistoryRows(fallbackPayload.rows ?? []);
  return cachedPriorityHistoryRows;
}

function serializePriorityEncodedModel(model: PriorityEncodedModel | null): PrioritySerializedEncodedModel | null {
  if (!model) return null;
  return {
    weights: model.weights,
    featureIndexEntries: Array.from(model.featureIndex.entries()),
    numericStats: model.numericStats,
  };
}

function deserializePriorityEncodedModel(
  model: PrioritySerializedEncodedModel | null | undefined,
): PriorityEncodedModel | null {
  if (!model) return null;
  return {
    weights: model.weights,
    featureIndex: new Map(model.featureIndexEntries),
    numericStats: model.numericStats,
  };
}

function loadPriorityRuntimeModelArtifact():
  | {
      trainedThroughDate: string;
      model: PriorityEncodedModel | null;
    }
  | null {
  if (cachedPriorityRuntimeModelArtifact !== undefined) {
    return cachedPriorityRuntimeModelArtifact;
  }

  const artifactPath = path.join(process.cwd(), PRIORITY_RUNTIME_MODEL_RELATIVE_PATH);
  if (!existsSync(artifactPath)) {
    cachedPriorityRuntimeModelArtifact = null;
    return cachedPriorityRuntimeModelArtifact;
  }

  const payload = parseJsonFile<PriorityRuntimeModelArtifact>(artifactPath);
  if (!payload.trainedThroughDate) {
    cachedPriorityRuntimeModelArtifact = null;
    return cachedPriorityRuntimeModelArtifact;
  }

  cachedPriorityRuntimeModelArtifact = {
    trainedThroughDate: payload.trainedThroughDate,
    model: deserializePriorityEncodedModel(payload.model),
  };
  return cachedPriorityRuntimeModelArtifact;
}

function getPriorityNumericValue(row: PriorityRuntimeMeta, field: PriorityNumericField): number {
  const direct = row[field];
  if (typeof direct === "boolean") return direct ? 1 : 0;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  return 0;
}

function getPriorityCategoryValue(row: PriorityRuntimeMeta, field: PriorityCategoryField): string | null {
  const value = row[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildPriorityEncodedModel(trainingRows: PriorityHistoryRow[]): PriorityEncodedModel | null {
  if (trainingRows.length === 0) return null;

  const numericStats = Object.fromEntries(
    PRIORITY_NUMERIC_FIELDS.map((field) => {
      const values = trainingRows.map((row) => getPriorityNumericValue(row, field));
      const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
      const variance =
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length, 1);
      return [field, { mean, stdDev: Math.sqrt(variance) || 1 }];
    }),
  ) as Record<PriorityNumericField, { mean: number; stdDev: number }>;

  const featureIndex = new Map<string, number>();
  const addFeature = (key: string) => {
    if (!featureIndex.has(key)) {
      featureIndex.set(key, featureIndex.size);
    }
  };

  addFeature("bias");
  PRIORITY_NUMERIC_FIELDS.forEach((field) => {
    addFeature(`num:${field}:z`);
    addFeature(`num:${field}:q`);
  });
  PRIORITY_CATEGORY_FIELDS.forEach((field) => {
    const values = new Set(
      trainingRows
        .map((row) => getPriorityCategoryValue(row, field))
        .filter((value): value is string => value != null),
    );
    Array.from(values)
      .sort((left, right) => left.localeCompare(right))
      .forEach((value) => addFeature(`cat:${field}:${value}`));
  });

  const weights = new Array(featureIndex.size).fill(0);

  const encodeRow = (row: PriorityRuntimeMeta): Array<[number, number]> => {
    const encoded: Array<[number, number]> = [[featureIndex.get("bias") ?? 0, 1]];
    PRIORITY_NUMERIC_FIELDS.forEach((field) => {
      const stats = numericStats[field];
      const raw = getPriorityNumericValue(row, field);
      const z = (raw - stats.mean) / (stats.stdDev || 1);
      const zIndex = featureIndex.get(`num:${field}:z`);
      if (zIndex != null) {
        encoded.push([zIndex, z]);
      }
      const qIndex = featureIndex.get(`num:${field}:q`);
      if (qIndex != null) {
        encoded.push([qIndex, clamp((z * z) / 3, 0, 3)]);
      }
    });
    PRIORITY_CATEGORY_FIELDS.forEach((field) => {
      const value = getPriorityCategoryValue(row, field);
      if (!value) return;
      const categoryIndex = featureIndex.get(`cat:${field}:${value}`);
      if (categoryIndex != null) {
        encoded.push([categoryIndex, 1]);
      }
    });
    return encoded;
  };

  const encodedRows = trainingRows.map((row) => ({
    x: encodeRow(row),
    y: row.correct ? 1 : 0,
  }));

  for (let epoch = 0; epoch < PRIORITY_TRAINING_EPOCHS; epoch += 1) {
    const gradients = new Array(weights.length).fill(0);
    encodedRows.forEach((row) => {
      let linear = 0;
      row.x.forEach(([index, value]) => {
        linear += weights[index] * value;
      });
      const prediction = sigmoid(linear);
      const error = prediction - row.y;
      row.x.forEach(([index, value]) => {
        gradients[index] += error * value;
      });
    });

    const learningRate = PRIORITY_LEARNING_RATE * (1 - epoch / (PRIORITY_TRAINING_EPOCHS * 1.35));
    const rowCount = Math.max(encodedRows.length, 1);
    for (let index = 0; index < weights.length; index += 1) {
      const regularization = index === 0 ? 0 : PRIORITY_L2_REGULARIZATION * weights[index];
      weights[index] -= learningRate * (gradients[index] / rowCount + regularization);
    }
  }

  return {
    weights,
    featureIndex,
    numericStats,
  };
}

export function buildPrecisionUpstreamRuntimeModelArtifact(): PriorityRuntimeModelArtifact | null {
  const historyRows = loadPriorityHistoryRows();
  if (!historyRows.length) return null;
  const trainedThroughDate = historyRows[historyRows.length - 1]?.date ?? null;
  if (!trainedThroughDate) return null;
  const model = buildPriorityEncodedModel(historyRows);
  return {
    version: "precision-upstream-reranker-runtime-model-v1",
    generatedAt: new Date().toISOString(),
    trainedThroughDate,
    historyRowCount: historyRows.length,
    model: serializePriorityEncodedModel(model),
  };
}

function scorePriorityRow(row: PriorityRuntimeMeta, model: PriorityEncodedModel | null): number {
  if (!model) {
    return row.baseScoreGap;
  }

  let linear = model.weights[model.featureIndex.get("bias") ?? 0] ?? 0;

  PRIORITY_NUMERIC_FIELDS.forEach((field) => {
    const stats = model.numericStats[field];
    const raw = getPriorityNumericValue(row, field);
    const z = (raw - stats.mean) / (stats.stdDev || 1);
    const zIndex = model.featureIndex.get(`num:${field}:z`);
    if (zIndex != null) {
      linear += (model.weights[zIndex] ?? 0) * z;
    }
    const qIndex = model.featureIndex.get(`num:${field}:q`);
    if (qIndex != null) {
      linear += (model.weights[qIndex] ?? 0) * clamp((z * z) / 3, 0, 3);
    }
  });

  PRIORITY_CATEGORY_FIELDS.forEach((field) => {
    const value = getPriorityCategoryValue(row, field);
    if (!value) return;
    const categoryIndex = model.featureIndex.get(`cat:${field}:${value}`);
    if (categoryIndex != null) {
      linear += model.weights[categoryIndex] ?? 0;
    }
  });

  return round(sigmoid(linear), 6);
}

function getTrainedPriorityModel(targetDateEt: string): PriorityEncodedModel | null {
  if (cachedTrainedModels.has(targetDateEt)) {
    return cachedTrainedModels.get(targetDateEt) ?? null;
  }

  const runtimeArtifact = loadPriorityRuntimeModelArtifact();
  if (runtimeArtifact && targetDateEt > runtimeArtifact.trainedThroughDate) {
    cachedTrainedModels.set(targetDateEt, runtimeArtifact.model);
    return runtimeArtifact.model;
  }

  const historyRows = loadPriorityHistoryRows();
  const trainingRows = historyRows.filter((row) => row.date < targetDateEt);
  const uniqueTrainingDates = new Set(trainingRows.map((row) => row.date));
  if (uniqueTrainingDates.size < PRIORITY_WARMUP_DATES) {
    cachedTrainedModels.set(targetDateEt, null);
    return null;
  }

  const model = buildPriorityEncodedModel(trainingRows);
  cachedTrainedModels.set(targetDateEt, model);
  return model;
}

function comparePriorityCandidates(left: PriorityHistoryRow, right: PriorityHistoryRow): number {
  const leftScore = left.baseScoreBalanced;
  const rightScore = right.baseScoreBalanced;
  return (
    rightScore - leftScore ||
    (right.holdoutAccuracy ?? Number.NEGATIVE_INFINITY) - (left.holdoutAccuracy ?? Number.NEGATIVE_INFINITY) ||
    right.absLineGap - left.absLineGap ||
    left.playerName.localeCompare(right.playerName)
  );
}

function selectPriorityDailyRows(rows: PriorityHistoryRow[]): PriorityHistoryRow[] {
  const selected: PriorityHistoryRow[] = [];
  const selectedPlayers = new Set<string>();
  const marketCounts = new Map<SnapshotMarket, number>();

  rows.forEach((row) => {
    if (selected.length >= PRIORITY_SELECTOR_TARGET_COUNT) return;
    if (selectedPlayers.has(row.playerId)) return;
    if ((marketCounts.get(row.market) ?? 0) >= (PRIORITY_SELECTOR_MARKET_CAPS[row.market] ?? 0)) return;
    selected.push(row);
    selectedPlayers.add(row.playerId);
    marketCounts.set(row.market, (marketCounts.get(row.market) ?? 0) + 1);
  });

  return selected;
}

export function evaluatePrecisionUpstreamHistoryReplay(): PriorityReplaySummary | null {
  if (cachedPriorityReplaySummary) return cachedPriorityReplaySummary;

  const historyRows = loadPriorityHistoryRows();
  if (!historyRows.length) return null;

  const rowsByDate = new Map<string, PriorityHistoryRow[]>();
  historyRows.forEach((row) => {
    const bucket = rowsByDate.get(row.date) ?? [];
    bucket.push(row);
    rowsByDate.set(row.date, bucket);
  });

  const dates = Array.from(rowsByDate.keys()).sort((left, right) => left.localeCompare(right));
  const selectedRows: PriorityHistoryRow[] = [];
  const daily: Array<{ date: string; picks: number; correct: number }> = [];

  dates.forEach((date) => {
    const dayRows = (rowsByDate.get(date) ?? []).slice();
    const model = getTrainedPriorityModel(date);
    const scoredRows = dayRows
      .map((row) => ({
        ...row,
        baseScoreBalanced: model ? scorePriorityRow(row, model) : row.baseScoreGap,
      }))
      .sort(comparePriorityCandidates);
    const selected = selectPriorityDailyRows(scoredRows);
    const correct = selected.filter((row) => row.correct).length;
    selectedRows.push(...selected);
    daily.push({
      date,
      picks: selected.length,
      correct,
    });
  });

  const summarizeWindow = (windowRows: typeof daily) => {
    const picks = windowRows.reduce((sum, row) => sum + row.picks, 0);
    const correct = windowRows.reduce((sum, row) => sum + row.correct, 0);
    return {
      picks,
      correct,
      accuracy: picks > 0 ? round((correct / picks) * 100, 2) : 0,
    };
  };

  cachedPriorityReplaySummary = {
    overall: summarizeWindow(daily),
    last30: summarizeWindow(daily.slice(-30)),
    last14: summarizeWindow(daily.slice(-14)),
    picksPerDay: round(selectedRows.length / Math.max(dates.length, 1), 2),
  };
  return cachedPriorityReplaySummary;
}

type PrecisionSlateCandidateLike = {
  playerId: string;
  playerName?: string | null;
  matchupKey: string;
  market: SnapshotMarket;
  signal: SnapshotPrecisionPickSignal;
  selectionScore: number;
  source: SnapshotPrecisionCardSource;
  upstreamReranker?: PriorityRuntimeMeta | null;
};

function getPrioritySignalHistoricalAccuracy(model: PriorityApprovedModel, fallback: SnapshotPrecisionPickSignal | null | undefined): number {
  if (model.holdoutAccuracy != null && Number.isFinite(model.holdoutAccuracy)) {
    return round(model.holdoutAccuracy, 2);
  }
  if (fallback?.historicalAccuracy != null && Number.isFinite(fallback.historicalAccuracy)) {
    return round(fallback.historicalAccuracy, 2);
  }
  return round(model.modelAccuracy, 2);
}

export function buildPrecisionUpstreamPriorityCandidate(
  input: PriorityCandidateBuildInput,
): PrecisionSlateCandidateLike | null {
  if (input.market === "THREES") return null;
  if (input.sportsbookCount < PROMOTED_PRECISION_MIN_SPORTSBOOK_COUNT) return null;
  if (input.projectionSide == null) return null;
  if (input.projectedValue == null || input.line == null) return null;

  const modelFile = resolvePriorityModelFileForDate(input.dateEt);
  if (!modelFile) return null;

  const approvedPoolMaps = loadApprovedPoolMapsForFile(modelFile);
  const playerKey = normalizePriorityKey(input.playerName);
  if (!playerKey) return null;

  const lineGap = round(input.projectedValue - input.line, 4);
  const absLineGap = Math.abs(lineGap);
  const runtimeModelRow: PriorityRuntimeModelRow = {
    projectedValue: input.projectedValue,
    line: input.line,
    overPrice: input.overPrice,
    underPrice: input.underPrice,
    projectionSide: input.projectionSide,
    finalSide: input.finalSide === "OVER" || input.finalSide === "UNDER" ? input.finalSide : input.projectionSide,
    priceLean: input.priceLean,
    favoredSide: input.favoredSide,
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    lineGap,
    absLineGap,
  };

  const poolLabels: PriorityPoolLabel[] = [];
  let selectedModel: PriorityApprovedModel | null = null;
  let selectedSide: Side | null = null;

  for (const pool of PRIORITY_POOL_SPECS) {
    const approvedModel = approvedPoolMaps.get(pool.label)?.get(`${playerKey}|${input.market}`) ?? null;
    if (!approvedModel) continue;
    const predictedSide = predictPriorityVariant(approvedModel.model, runtimeModelRow);
    if (predictedSide !== "OVER" && predictedSide !== "UNDER") continue;

    if (pool.poolMode === "approved_and_agree_final") {
      if (input.finalSource === "baseline") continue;
      if (predictedSide !== input.finalSide) continue;
    } else {
      if (input.strictRawSide !== "OVER" && input.strictRawSide !== "UNDER") continue;
      if (predictedSide !== input.strictRawSide) continue;
    }

    poolLabels.push(pool.label);
    selectedModel ??= approvedModel;
    selectedSide ??= predictedSide;
  }

  if (!selectedModel || !selectedSide || poolLabels.length === 0) return null;

  const holdoutAccuracy = selectedModel.holdoutAccuracy;
  const projectionAgreement = selectedSide === input.projectionSide;
  const favoredAgreement = input.favoredSide !== "NEUTRAL" && selectedSide === input.favoredSide;
  const strictAgreement = selectedSide === input.strictRawSide;
  const finalAgreement = selectedSide === input.finalSide;
  const edgeVsProjection =
    holdoutAccuracy == null ? null : round(holdoutAccuracy - selectedModel.projectionBaselineAccuracy, 4);
  const edgeVsFinal =
    holdoutAccuracy == null ? null : round(holdoutAccuracy - selectedModel.finalBaselineAccuracy, 4);
  const scoringCorePool = poolLabels.some((label) => label.startsWith("scoring_core_"));
  const comboPool = poolLabels.some((label) => label.startsWith("combo_no_threes_"));
  const strictPoolCount = poolLabels.filter((label) => label.includes("_strict_")).length;
  const finalPoolCount = poolLabels.filter((label) => label.includes("_final_")).length;
  const baseScoreGap = getPriorityBaseScore(
    {
      holdoutAccuracy,
      projectionBaselineAccuracy: selectedModel.projectionBaselineAccuracy,
      finalBaselineAccuracy: selectedModel.finalBaselineAccuracy,
      modelAccuracy: selectedModel.modelAccuracy,
      samples: selectedModel.samples,
      absLineGap,
      priceLean: input.priceLean,
      weightedCurrentLineOverRate: input.weightedCurrentLineOverRate,
      emaCurrentLineOverRate: input.emaCurrentLineOverRate,
      l5CurrentLineOverRate: input.l5CurrentLineOverRate,
      emaCurrentLineDelta: input.emaCurrentLineDelta,
      expectedMinutes: input.expectedMinutes,
      minutesVolatility: input.minutesVolatility,
      starterRateLast10: input.starterRateLast10,
    },
    selectedSide,
    "gap",
  );
  const baseScoreRecency = getPriorityBaseScore(
    {
      holdoutAccuracy,
      projectionBaselineAccuracy: selectedModel.projectionBaselineAccuracy,
      finalBaselineAccuracy: selectedModel.finalBaselineAccuracy,
      modelAccuracy: selectedModel.modelAccuracy,
      samples: selectedModel.samples,
      absLineGap,
      priceLean: input.priceLean,
      weightedCurrentLineOverRate: input.weightedCurrentLineOverRate,
      emaCurrentLineOverRate: input.emaCurrentLineOverRate,
      l5CurrentLineOverRate: input.l5CurrentLineOverRate,
      emaCurrentLineDelta: input.emaCurrentLineDelta,
      expectedMinutes: input.expectedMinutes,
      minutesVolatility: input.minutesVolatility,
      starterRateLast10: input.starterRateLast10,
    },
    selectedSide,
    "recency",
  );
  const baseScoreBalanced = getPriorityBaseScore(
    {
      holdoutAccuracy,
      projectionBaselineAccuracy: selectedModel.projectionBaselineAccuracy,
      finalBaselineAccuracy: selectedModel.finalBaselineAccuracy,
      modelAccuracy: selectedModel.modelAccuracy,
      samples: selectedModel.samples,
      absLineGap,
      priceLean: input.priceLean,
      weightedCurrentLineOverRate: input.weightedCurrentLineOverRate,
      emaCurrentLineOverRate: input.emaCurrentLineOverRate,
      l5CurrentLineOverRate: input.l5CurrentLineOverRate,
      emaCurrentLineDelta: input.emaCurrentLineDelta,
      expectedMinutes: input.expectedMinutes,
      minutesVolatility: input.minutesVolatility,
      starterRateLast10: input.starterRateLast10,
    },
    selectedSide,
    "balanced",
  );

  const rerankerMeta: PriorityRuntimeMeta = {
    date: input.dateEt,
    playerId: input.playerId,
    playerName: input.playerName,
    market: input.market,
    side: selectedSide,
    poolCount: poolLabels.length,
    strictPoolCount,
    finalPoolCount,
    scoringCorePool,
    comboPool,
    rawSource: input.rawSource,
    strictRawSource: input.strictRawSource,
    finalSource: input.finalSource,
    overrideEngaged: input.overrideEngaged,
    playerOverrideEngaged: input.playerOverrideEngaged,
    rawQualified: input.rawQualified,
    strictAgreement,
    finalAgreement,
    projectionAgreement,
    favoredAgreement,
    archetype: input.archetype,
    modelKind: input.modelKind,
    bucketSamples: input.bucketSamples,
    bucketModelAccuracy: input.bucketModelAccuracy,
    bucketLateAccuracy: input.bucketLateAccuracy,
    leafCount: input.leafCount,
    leafAccuracy: input.leafAccuracy,
    projectionWinProbability: input.projectionWinProbability,
    projectionPriceEdge: input.projectionPriceEdge,
    priceStrength: input.priceStrength,
    projectionMarketAgreement: input.projectionMarketAgreement,
    rejectionCount: input.rejectionCount,
    holdoutAccuracy,
    projectionBaselineAccuracy: selectedModel.projectionBaselineAccuracy,
    finalBaselineAccuracy: selectedModel.finalBaselineAccuracy,
    modelAccuracy: selectedModel.modelAccuracy,
    samples: selectedModel.samples,
    edgeVsProjection,
    edgeVsFinal,
    projectedValue: input.projectedValue,
    lineGap,
    absLineGap,
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    priceLean: input.priceLean,
    weightedCurrentLineOverRate: input.weightedCurrentLineOverRate,
    emaCurrentLineDelta: input.emaCurrentLineDelta,
    emaCurrentLineOverRate: input.emaCurrentLineOverRate,
    l5CurrentLineOverRate: input.l5CurrentLineOverRate,
    baseScoreGap,
    baseScoreRecency,
    baseScoreBalanced,
  };

  const selectionScore = baseScoreBalanced;
  const signal: SnapshotPrecisionPickSignal = {
    side: selectedSide,
    qualified: true,
    historicalAccuracy: getPrioritySignalHistoricalAccuracy(selectedModel, input.strictSignal),
    historicalPicks: selectedModel.samples,
    historicalCoveragePct: input.strictSignal?.historicalCoveragePct,
    bucketRecentAccuracy: input.bucketLateAccuracy,
    leafAccuracy: input.leafAccuracy,
    absLineGap: round(absLineGap, 2),
    projectionWinProbability: input.projectionWinProbability,
    projectionPriceEdge: input.projectionPriceEdge,
    selectionScore,
    selectorFamily: "precision_upstream_v4",
    selectorTier: "precision_upstream_v4",
    reasons: [
      `The upstream precision reranker approved this ${input.market} spot across ${poolLabels.length} priority pool${poolLabels.length === 1 ? "" : "s"}.`,
      `${input.sportsbookCount} live books are pricing this market.`,
      `The player-market holdout prior for this lane is ${getPrioritySignalHistoricalAccuracy(selectedModel, input.strictSignal).toFixed(2)}%.`,
    ],
  };

  return {
    playerId: input.playerId,
    playerName: input.playerName,
    matchupKey: input.matchupKey,
    market: input.market,
    signal,
    selectionScore,
    source: "PRECISION",
    upstreamReranker: rerankerMeta,
  };
}

export function rerankPrecisionUpstreamCandidates<T extends PrecisionSlateCandidateLike>(
  candidates: T[],
  targetDateEt: string,
): T[] {
  if (candidates.length === 0) return candidates;

  const model = getTrainedPriorityModel(targetDateEt);
  return candidates.map((candidate) => {
    const rerankerMeta = candidate.upstreamReranker;
    if (!rerankerMeta) return candidate;
    const rerankedScore = model ? scorePriorityRow(rerankerMeta, model) : rerankerMeta.baseScoreGap;
    return {
      ...candidate,
      selectionScore: rerankedScore,
      signal: {
        ...candidate.signal,
        selectionScore: rerankedScore,
      },
    };
  });
}

import { round } from "../utils";

export type RouterTarget = 0 | 1;
export type RouterDecision = "KEEP_UNIVERSAL" | "VETO_BASELINE";

export type RouterDatasetRow = {
  rowKey: string;
  gameDateEt: string;
  bucketKey: string;
  market: string;
  archetype: string;
  modelKind: string | null;
  qualifiedSide: "OVER" | "UNDER";
  finalSide: "OVER" | "UNDER";
  favoredSide: "OVER" | "UNDER" | "NEUTRAL" | null;
  bucketSamples: number | null;
  bucketModelAccuracy: number | null;
  bucketLateAccuracy: number | null;
  bucketRecentAccuracy: number | null;
  leafCount: number | null;
  leafAccuracy: number | null;
  projectionMarketAgreement: number | null;
  overProbability: number | null;
  underProbability: number | null;
  overPrice: number | null;
  underPrice: number | null;
  lineGap: number;
  absLineGap: number;
  priceStrength: number | null;
  priceLean: number | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  openingTeamSpread: number | null;
  absOpeningSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  spreadResolved: boolean;
  universalCorrect: boolean;
  baselineCorrect: boolean;
  routerTarget: RouterTarget | null;
};

export type RouterFeatureMode = "core" | "core_relations";

export type RouterTrainConfig = {
  maxDepth: number;
  minLeaf: number;
  featureMode: RouterFeatureMode;
};

export type RouterLeafNode = {
  kind: "leaf";
  decision: RouterDecision;
  count: number;
  keepRate: number;
  accuracy: number;
};

export type RouterSplitNode = {
  kind: "split";
  feature: string;
  threshold: number;
  count: number;
  accuracy: number;
  left: RouterTreeNode;
  right: RouterTreeNode;
};

export type RouterTreeNode = RouterLeafNode | RouterSplitNode;

export type UniversalBaselineRouterModel = {
  generatedAt: string;
  config: RouterTrainConfig;
  featureCatalog: string[];
  tree: RouterTreeNode;
  training: {
    samples: number;
    keepRate: number;
    accuracy: number;
  };
};

const MISSING_SENTINEL = -9999;
const CATEGORY_PREFIXES = ["bucketKey", "market", "archetype", "modelKind", "qualifiedSide", "finalSide", "favoredSide"] as const;
const CORE_NUMERIC_FEATURES = [
  "bucketRecentAccuracy",
  "bucketSamples",
  "leafAccuracy",
  "leafCount",
  "absLineGap",
  "priceStrength",
  "projectionMarketAgreement",
  "expectedMinutes",
  "openingTeamSpread",
] as const;
const RELATION_NUMERIC_FEATURES = [
  "bucketModelAccuracy",
  "bucketLateAccuracy",
  "lineGap",
  "priceLean",
  "overPrice",
  "underPrice",
  "overProbability",
  "underProbability",
  "minutesVolatility",
  "starterRateLast10",
  "absOpeningSpread",
  "openingTotal",
  "lineupTimingConfidence",
  "completenessScore",
  "probMargin",
  "universalProbConfidence",
  "baselineProbConfidence",
  "signedSpreadFromFavoritePerspective",
  "missingnessCount",
  "universalMatchesFavoredSide",
  "baselineMatchesFavoredSide",
  "universalOpposesFavoredSide",
  "baselineOpposesFavoredSide",
  "smallEdge",
  "verySmallEdge",
  "weakBucket",
  "weakLeaf",
  "spreadResolvedFlag",
];

function numericOrSentinel(value: number | null | undefined): number {
  return value == null || !Number.isFinite(value) ? MISSING_SENTINEL : value;
}

function toBinary(value: boolean): number {
  return value ? 1 : 0;
}

function getDerivedFeature(row: RouterDatasetRow, feature: string): number | null {
  const favoredSide = row.favoredSide;
  const universalSide = row.qualifiedSide;
  const baselineSide = row.finalSide;
  switch (feature) {
    case "probMargin":
      return row.overProbability != null && row.underProbability != null
        ? round(Math.abs(row.overProbability - row.underProbability), 4)
        : null;
    case "universalProbConfidence":
      return universalSide === "OVER" ? row.overProbability : row.underProbability;
    case "baselineProbConfidence":
      return baselineSide === "OVER" ? row.overProbability : row.underProbability;
    case "signedSpreadFromFavoritePerspective":
      return row.openingTeamSpread == null ? null : round(-row.openingTeamSpread, 4);
    case "missingnessCount": {
      const tracked = [
        row.bucketRecentAccuracy,
        row.leafAccuracy,
        row.priceStrength,
        row.projectionMarketAgreement,
        row.expectedMinutes,
        row.minutesVolatility,
        row.starterRateLast10,
        row.openingTeamSpread,
        row.openingTotal,
        row.lineupTimingConfidence,
        row.completenessScore,
      ];
      return tracked.filter((value) => value == null || !Number.isFinite(value)).length;
    }
    case "universalMatchesFavoredSide":
      return favoredSide == null || favoredSide === "NEUTRAL" ? 0 : toBinary(universalSide === favoredSide);
    case "baselineMatchesFavoredSide":
      return favoredSide == null || favoredSide === "NEUTRAL" ? 0 : toBinary(baselineSide === favoredSide);
    case "universalOpposesFavoredSide":
      return favoredSide == null || favoredSide === "NEUTRAL" ? 0 : toBinary(universalSide !== favoredSide);
    case "baselineOpposesFavoredSide":
      return favoredSide == null || favoredSide === "NEUTRAL" ? 0 : toBinary(baselineSide !== favoredSide);
    case "smallEdge":
      return toBinary(row.absLineGap <= 1.0);
    case "verySmallEdge":
      return toBinary(row.absLineGap <= 0.5);
    case "weakBucket":
      return toBinary((row.bucketLateAccuracy ?? Number.POSITIVE_INFINITY) <= 62);
    case "weakLeaf":
      return toBinary((row.leafAccuracy ?? Number.POSITIVE_INFINITY) <= 56);
    case "spreadResolvedFlag":
      return toBinary(row.spreadResolved);
    default:
      return (row as Record<string, unknown>)[feature] as number | null | undefined ?? null;
  }
}

export function buildRouterFeatureCatalog(rows: RouterDatasetRow[], featureMode: RouterFeatureMode): string[] {
  const features: string[] = [];
  const add = (feature: string) => {
    if (!features.includes(feature)) features.push(feature);
  };

  rows
    .map((row) => row.bucketKey)
    .filter(Boolean)
    .sort()
    .forEach((value) => add(`bucketKey=${value}`));
  rows
    .map((row) => row.market)
    .filter(Boolean)
    .sort()
    .forEach((value) => add(`market=${value}`));
  rows
    .map((row) => row.archetype)
    .filter(Boolean)
    .sort()
    .forEach((value) => add(`archetype=${value}`));
  rows
    .map((row) => row.modelKind ?? "NULL")
    .sort()
    .forEach((value) => add(`modelKind=${value}`));
  rows
    .map((row) => row.qualifiedSide)
    .sort()
    .forEach((value) => add(`qualifiedSide=${value}`));
  rows
    .map((row) => row.finalSide)
    .sort()
    .forEach((value) => add(`finalSide=${value}`));
  rows
    .map((row) => row.favoredSide ?? "NULL")
    .sort()
    .forEach((value) => add(`favoredSide=${value}`));

  CORE_NUMERIC_FEATURES.forEach((feature) => add(feature));
  if (featureMode === "core_relations") {
    RELATION_NUMERIC_FEATURES.forEach((feature) => add(feature));
  }
  return features;
}

export function getRouterFeatureValue(row: RouterDatasetRow, feature: string): number {
  for (const prefix of CATEGORY_PREFIXES) {
    const marker = `${prefix}=`;
    if (feature.startsWith(marker)) {
      const expected = feature.slice(marker.length);
      const rawValue =
        prefix === "bucketKey"
          ? row.bucketKey
          : prefix === "market"
            ? row.market
            : prefix === "archetype"
              ? row.archetype
              : prefix === "modelKind"
                ? row.modelKind ?? "NULL"
                : prefix === "qualifiedSide"
                  ? row.qualifiedSide
                  : prefix === "finalSide"
                    ? row.finalSide
                    : row.favoredSide ?? "NULL";
      return rawValue === expected ? 1 : 0;
    }
  }
  return numericOrSentinel(getDerivedFeature(row, feature));
}

function leafFromRows(rows: RouterDatasetRow[]): RouterLeafNode {
  const keepCount = rows.filter((row) => row.routerTarget === 1).length;
  const vetoCount = rows.length - keepCount;
  const keepRate = rows.length > 0 ? round((keepCount / rows.length) * 100, 2) : 0;
  const accuracy = rows.length > 0 ? round((Math.max(keepCount, vetoCount) / rows.length) * 100, 2) : 0;
  return {
    kind: "leaf",
    decision: keepCount >= vetoCount ? "KEEP_UNIVERSAL" : "VETO_BASELINE",
    count: rows.length,
    keepRate,
    accuracy,
  };
}

function candidateThresholds(rows: RouterDatasetRow[], feature: string): number[] {
  if (feature.includes("=") || ["smallEdge", "verySmallEdge", "weakBucket", "weakLeaf", "spreadResolvedFlag"].includes(feature)) {
    return [0.5];
  }
  const values = rows
    .map((row) => getRouterFeatureValue(row, feature))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (values.length < 2) return [];
  const thresholds: number[] = [];
  const push = (left: number, right: number) => {
    const midpoint = round((left + right) / 2, 4);
    if (!thresholds.includes(midpoint)) thresholds.push(midpoint);
  };
  const quantiles = values.length <= 40 ? null : [0.08, 0.16, 0.24, 0.32, 0.4, 0.5, 0.6, 0.68, 0.76, 0.84, 0.92];
  if (quantiles == null) {
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] !== values[index - 1]) push(values[index - 1], values[index]);
    }
    return thresholds;
  }
  quantiles.forEach((quantile) => {
    const index = Math.max(1, Math.min(values.length - 1, Math.floor(values.length * quantile)));
    if (values[index] !== values[index - 1]) push(values[index - 1], values[index]);
  });
  return thresholds;
}

export function trainUniversalBaselineRouter(
  rows: RouterDatasetRow[],
  config: RouterTrainConfig,
): UniversalBaselineRouterModel {
  const featureCatalog = buildRouterFeatureCatalog(rows, config.featureMode);

  function trainNode(nodeRows: RouterDatasetRow[], depthRemaining: number): RouterTreeNode {
    const baseLeaf = leafFromRows(nodeRows);
    if (depthRemaining <= 0 || nodeRows.length < config.minLeaf * 2) return baseLeaf;

    let bestFeature: string | null = null;
    let bestThreshold: number | null = null;
    let bestLeft: RouterDatasetRow[] | null = null;
    let bestRight: RouterDatasetRow[] | null = null;
    let bestAccuracy = baseLeaf.accuracy;

    for (const feature of featureCatalog) {
      for (const threshold of candidateThresholds(nodeRows, feature)) {
        const left = nodeRows.filter((row) => getRouterFeatureValue(row, feature) <= threshold);
        const right = nodeRows.filter((row) => getRouterFeatureValue(row, feature) > threshold);
        if (left.length < config.minLeaf || right.length < config.minLeaf) continue;

        const leftLeaf = leafFromRows(left);
        const rightLeaf = leafFromRows(right);
        const accuracy = round(
          (((leftLeaf.accuracy / 100) * left.length + (rightLeaf.accuracy / 100) * right.length) / nodeRows.length) * 100,
          2,
        );
        if (accuracy > bestAccuracy) {
          bestAccuracy = accuracy;
          bestFeature = feature;
          bestThreshold = threshold;
          bestLeft = left;
          bestRight = right;
        }
      }
    }

    if (bestFeature == null || bestThreshold == null || bestLeft == null || bestRight == null) return baseLeaf;

    return {
      kind: "split",
      feature: bestFeature,
      threshold: bestThreshold,
      count: nodeRows.length,
      accuracy: bestAccuracy,
      left: trainNode(bestLeft, depthRemaining - 1),
      right: trainNode(bestRight, depthRemaining - 1),
    };
  }

  const tree = trainNode(rows, config.maxDepth);
  const keepCount = rows.filter((row) => row.routerTarget === 1).length;
  const trainingCorrect = rows.filter((row) => {
    const prediction = predictUniversalBaselineRouter(
      {
        generatedAt: new Date().toISOString(),
        config,
        featureCatalog,
        tree,
        training: {
          samples: rows.length,
          keepRate: 0,
          accuracy: 0,
        },
      },
      row,
    );
    return prediction === "KEEP_UNIVERSAL" ? row.routerTarget === 1 : row.routerTarget === 0;
  }).length;
  return {
    generatedAt: new Date().toISOString(),
    config,
    featureCatalog,
    tree,
    training: {
      samples: rows.length,
      keepRate: rows.length > 0 ? round((keepCount / rows.length) * 100, 2) : 0,
      accuracy: rows.length > 0 ? round((trainingCorrect / rows.length) * 100, 2) : 0,
    },
  };
}

export function predictUniversalBaselineRouter(model: UniversalBaselineRouterModel, row: RouterDatasetRow): RouterDecision {
  let node = model.tree;
  while (node.kind === "split") {
    node = getRouterFeatureValue(row, node.feature) <= node.threshold ? node.left : node.right;
  }
  return node.decision;
}

export function resolveRouterLeaf(model: UniversalBaselineRouterModel, row: RouterDatasetRow): {
  path: string;
  leaf: RouterLeafNode;
} {
  const path: string[] = [];
  let node = model.tree;
  while (node.kind === "split") {
    const value = getRouterFeatureValue(row, node.feature);
    const goLeft = value <= node.threshold;
    path.push(`${node.feature}${goLeft ? "<=" : ">"}${node.threshold}`);
    node = goLeft ? node.left : node.right;
  }
  return {
    path: path.join(" -> ") || "ROOT",
    leaf: node,
  };
}

export function resolveRouterLeafPath(model: UniversalBaselineRouterModel, row: RouterDatasetRow): string {
  return resolveRouterLeaf(model, row).path;
}

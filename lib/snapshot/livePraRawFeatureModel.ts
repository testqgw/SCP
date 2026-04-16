import fs from "node:fs";
import path from "node:path";
import type { SnapshotMarket } from "@/lib/types/snapshot";

type Side = "OVER" | "UNDER";
type GapBucket = "near" | "tight" | "mid" | "wide";
type FeatureMode = "core" | "context";
type FeatureName = string;

type FeatureLeafNode = {
  kind: "leaf";
  side: Side;
  count: number;
  accuracy: number;
};

type FeatureSplitNode = {
  kind: "split";
  feature: FeatureName;
  threshold: number;
  count: number;
  accuracy: number;
  left: FeatureTreeNode;
  right: FeatureTreeNode;
};

type FeatureTreeNode = FeatureLeafNode | FeatureSplitNode;

type PromotedModelVariant =
  | { kind: "control" }
  | { kind: "projection" }
  | { kind: "universal" }
  | { kind: "player" }
  | { kind: "marketFavored" }
  | { kind: "constant"; side: Side }
  | { kind: "tree"; featureMode: FeatureMode; maxDepth: number; minLeaf: number; tree: FeatureTreeNode };

export type LivePraRawFeaturePromotionInput = {
  market: SnapshotMarket;
  projectedValue: number | null;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  projectionSide: Side;
  baselineSide: Side;
  controlSide: Side;
  universalSide: Side | null;
  playerSide: Side | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  archetype: string;
  modelKind: string;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistProjection: number | null;
  threesProjection: number | null;
  lineGap: number;
  absLineGap: number;
};

export type LivePraRawFeatureArtifact = {
  version: string;
  generatedAt: string;
  label: string;
  metricFamily: string;
  scopeMarkets: SnapshotMarket[];
  allowedGapBuckets: GapBucket[] | null;
  chosenModel: PromotedModelVariant;
  fittedMarkets: Array<{
    market: SnapshotMarket;
    modelKind: string;
    validationAccuracy: number;
    controlValidationAccuracy: number;
    validationEdge: number;
    validationSamples: number;
    trainSamples: number;
  }>;
  trainingRange: {
    from: string | null;
    to: string | null;
  };
  qualificationSettingsFile: string | null;
};

export type LivePraRawFeatureRuntimeMeta = {
  mode: "on" | "off";
  enabled: boolean;
  filePath: string;
  fileSignature: string | null;
  loaded: boolean;
  label: string | null;
  version: string | null;
};

export const LIVE_PRA_RAW_FEATURE_MODEL_VERSION = "2026-03-26-pra-raw-v1";
export const DEFAULT_LIVE_PRA_RAW_FEATURE_MODEL_RELATIVE_PATH = path.join(
  "exports",
  "live-pra-raw-feature-live.json",
);

const MISSING_SENTINEL = -9999;
const CATEGORY_FIELDS = [
  "archetype",
  "modelKind",
  "projectionSide",
  "baselineSide",
  "controlSide",
  "universalSide",
  "playerSide",
  "favoredSide",
  "gapBucket",
  "minutesBucket",
  "volatilityBucket",
] as const;

let cachedArtifact:
  | {
      filePath: string;
      artifact: LivePraRawFeatureArtifact | null;
    }
  | null = null;

function parseJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw) as T;
}

function resolveMode(): "on" | "off" {
  const raw = process.env.SNAPSHOT_LIVE_PRA_RAW_FEATURE_MODE?.trim().toLowerCase();
  if (raw === "off") return "off";
  return "on";
}

export function resolveLivePraRawFeatureModelFilePath(): string {
  const override = process.env.SNAPSHOT_LIVE_PRA_RAW_FEATURE_MODEL_FILE?.trim();
  return override ? path.resolve(override) : path.join(process.cwd(), DEFAULT_LIVE_PRA_RAW_FEATURE_MODEL_RELATIVE_PATH);
}

function loadArtifact(): LivePraRawFeatureArtifact | null {
  const filePath = resolveLivePraRawFeatureModelFilePath();
  if (cachedArtifact?.filePath === filePath) {
    return cachedArtifact.artifact;
  }

  let artifact: LivePraRawFeatureArtifact | null = null;
  if (fs.existsSync(filePath)) {
    try {
      artifact = parseJsonFile<LivePraRawFeatureArtifact>(filePath);
    } catch {
      artifact = null;
    }
  }

  cachedArtifact = {
    filePath,
    artifact,
  };
  return artifact;
}

export function getLivePraRawFeatureRuntimeMeta(): LivePraRawFeatureRuntimeMeta {
  const mode = resolveMode();
  const filePath = resolveLivePraRawFeatureModelFilePath();
  const artifact = mode === "off" ? null : loadArtifact();
  const fileSignature = (() => {
    try {
      const stat = fs.statSync(filePath);
      return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
    } catch {
      return null;
    }
  })();
  return {
    mode,
    enabled: mode === "on" && artifact != null,
    filePath,
    fileSignature,
    loaded: artifact != null,
    label: artifact?.label ?? null,
    version: artifact?.version ?? null,
  };
}

function impliedProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function gapBucket(absLineGap: number): GapBucket {
  if (absLineGap <= 0.5) return "near";
  if (absLineGap <= 1) return "tight";
  if (absLineGap <= 2) return "mid";
  return "wide";
}

function minutesBucket(expectedMinutes: number | null): "<22" | "22-28" | "28-34" | "34+" {
  if (expectedMinutes == null || !Number.isFinite(expectedMinutes)) return "<22";
  if (expectedMinutes < 22) return "<22";
  if (expectedMinutes < 28) return "22-28";
  if (expectedMinutes < 34) return "28-34";
  return "34+";
}

function volatilityBucket(minutesVolatility: number | null): "low" | "mid" | "high" | "unknown" {
  if (minutesVolatility == null || !Number.isFinite(minutesVolatility)) return "unknown";
  if (minutesVolatility < 3) return "low";
  if (minutesVolatility < 6) return "mid";
  return "high";
}

function projectionToLineRatio(input: LivePraRawFeaturePromotionInput): number | null {
  if (input.line == null || !Number.isFinite(input.line) || Math.abs(input.line) < 0.01 || input.projectedValue == null) {
    return null;
  }
  return Number(((input.projectedValue / input.line)).toFixed(4));
}

function categoricalValue(
  row: LivePraRawFeaturePromotionInput & { gapBucket: GapBucket; minutesBucket: string; volatilityBucket: string },
  field: (typeof CATEGORY_FIELDS)[number],
): string {
  switch (field) {
    case "archetype":
      return row.archetype;
    case "modelKind":
      return row.modelKind;
    case "projectionSide":
      return row.projectionSide;
    case "baselineSide":
      return row.baselineSide;
    case "controlSide":
      return row.controlSide;
    case "universalSide":
      return row.universalSide ?? "NONE";
    case "playerSide":
      return row.playerSide ?? "NONE";
    case "favoredSide":
      return row.favoredSide;
    case "gapBucket":
      return row.gapBucket;
    case "minutesBucket":
      return row.minutesBucket;
    case "volatilityBucket":
      return row.volatilityBucket;
    default:
      return "NA";
  }
}

function numericFeature(row: LivePraRawFeaturePromotionInput, feature: string): number | null {
  switch (feature) {
    case "lineGap":
      return row.lineGap;
    case "absLineGap":
      return row.absLineGap;
    case "projectedValue":
      return row.projectedValue;
    case "line":
      return row.line;
    case "priceLean":
      return row.overPrice == null || row.underPrice == null ? null : row.overPrice - row.underPrice;
    case "priceStrength": {
      const over = impliedProbability(row.overPrice);
      const under = impliedProbability(row.underPrice);
      if (over == null || under == null) return null;
      return Number(Math.abs(over - under).toFixed(4));
    }
    case "overProbability":
      return impliedProbability(row.overPrice);
    case "underProbability":
      return impliedProbability(row.underPrice);
    case "projectionToLineRatio":
      return projectionToLineRatio(row);
    case "expectedMinutes":
      return row.expectedMinutes;
    case "minutesVolatility":
      return row.minutesVolatility;
    case "starterRateLast10":
      return row.starterRateLast10;
    case "openingTeamSpread":
      return row.openingTeamSpread;
    case "openingTotal":
      return row.openingTotal;
    case "lineupTimingConfidence":
      return row.lineupTimingConfidence;
    case "completenessScore":
      return row.completenessScore;
    case "pointsProjection":
      return row.pointsProjection;
    case "reboundsProjection":
      return row.reboundsProjection;
    case "assistProjection":
      return row.assistProjection;
    case "threesProjection":
      return row.threesProjection;
    default:
      return null;
  }
}

function getFeatureValue(nodeInput: LivePraRawFeaturePromotionInput, feature: string): number {
  const row = {
    ...nodeInput,
    gapBucket: gapBucket(nodeInput.absLineGap),
    minutesBucket: minutesBucket(nodeInput.expectedMinutes),
    volatilityBucket: volatilityBucket(nodeInput.minutesVolatility),
  };
  for (const field of CATEGORY_FIELDS) {
    const marker = `${field}=`;
    if (feature.startsWith(marker)) {
      return categoricalValue(row, field) === feature.slice(marker.length) ? 1 : 0;
    }
  }
  const value = numericFeature(nodeInput, feature);
  return value == null || !Number.isFinite(value) ? MISSING_SENTINEL : value;
}

function predictTree(node: FeatureTreeNode, row: LivePraRawFeaturePromotionInput): Side {
  if (node.kind === "leaf") return node.side;
  return getFeatureValue(row, node.feature) <= node.threshold ? predictTree(node.left, row) : predictTree(node.right, row);
}

function predictModel(model: PromotedModelVariant, row: LivePraRawFeaturePromotionInput): Side {
  switch (model.kind) {
    case "control":
      return row.controlSide;
    case "projection":
      return row.projectionSide;
    case "universal":
      return row.universalSide ?? row.controlSide;
    case "player":
      return row.playerSide ?? row.controlSide;
    case "marketFavored":
      return row.favoredSide === "NEUTRAL" ? row.controlSide : row.favoredSide;
    case "constant":
      return model.side;
    case "tree":
      return predictTree(model.tree, row);
    default:
      return row.controlSide;
  }
}

function modelKindLabel(model: PromotedModelVariant): string {
  switch (model.kind) {
    case "constant":
      return `constant_${model.side}`;
    case "tree":
      return `tree_${model.featureMode}_d${model.maxDepth}_l${model.minLeaf}`;
    default:
      return model.kind;
  }
}

export function predictLivePraRawFeatureSide(input: LivePraRawFeaturePromotionInput): {
  selectedSide: Side;
  modelKind: string;
  changedFromControl: boolean;
  gapBucket: GapBucket;
} | null {
  if (resolveMode() === "off") return null;
  const artifact = loadArtifact();
  if (!artifact) return null;
  if (input.market !== "PRA" || input.projectedValue == null || input.line == null) return null;
  const bucket = gapBucket(input.absLineGap);
  if (artifact.allowedGapBuckets && !artifact.allowedGapBuckets.includes(bucket)) return null;
  const selectedSide = predictModel(artifact.chosenModel, input);
  return {
    selectedSide,
    modelKind: modelKindLabel(artifact.chosenModel),
    changedFromControl: selectedSide !== input.controlSide,
    gapBucket: bucket,
  };
}

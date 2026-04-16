import fs from "node:fs";
import path from "node:path";
import { normalizePlayerName } from "@/lib/lineups/rotowire";
import type { SnapshotMarket, SnapshotModelSide } from "@/lib/types/snapshot";

type Side = "OVER" | "UNDER";
type RuntimeSourceName = "liveRaw" | "projection" | "baseline" | "favored" | "final";
type RuntimeActionName = RuntimeSourceName | "OVER" | "UNDER";
type RuntimeNumericFeature =
  | "expectedMinutes"
  | "minutesVolatility"
  | "starterRateLast10"
  | "projectedValue"
  | "overPrice"
  | "underPrice"
  | "priceLean"
  | "priceAbsLean"
  | "lineGap"
  | "absLineGap";

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

type LivePlayerOverrideAllowlistPayload =
  | { allowedPlayers?: string[]; players?: string[]; playerStats?: Array<{ playerKey?: string | null; playerName?: string | null }> }
  | string[];

type LivePlayerModelRow = {
  projectedValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  projectionSide: Side;
  rawSide: Side;
  finalSide: Side;
  baselineSide: Side;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  lineGap: number;
  absLineGap: number;
};

type PlayerLocalRecoveryManifestRule =
  | {
      kind: "source";
      source: RuntimeSourceName;
    }
  | {
      kind: "action";
      action: RuntimeActionName;
    }
  | {
      kind: "threshold";
      feature: RuntimeNumericFeature;
      threshold: number;
      lowAction: RuntimeActionName;
      highAction: RuntimeActionName;
    };

type PlayerLocalRecoveryManifestEntry = {
  playerKey?: string | null;
  playerName?: string | null;
  label?: string | null;
  markets?: Partial<Record<SnapshotMarket, PlayerLocalRecoveryManifestRule>>;
};

type PlayerLocalRecoveryManifestPayload = {
  version?: string | null;
  generatedAt?: string | null;
  entries?: PlayerLocalRecoveryManifestEntry[];
};

type PredictLivePlayerSideInput = {
  playerName: string | null;
  market: SnapshotMarket;
  projectedValue: number | null;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  rawSide?: SnapshotModelSide;
  finalSide: SnapshotModelSide;
  baselineSide?: SnapshotModelSide;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
};

const DEFAULT_LIVE_MODEL_FILES = [
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
const DEFAULT_PRIORITY_LIVE_MODEL_FILES = [
  path.join(process.cwd(), "exports", "live-player-model-priority-replace-headroom-tight-v1-2026-04-14.json"),
];
const DEFAULT_PLAYER_OVERRIDE_ALLOWLIST_FILE = path.join(process.cwd(), "exports", "live-player-override-allowlist.json");
const DEFAULT_PLAYER_LOCAL_RECOVERY_MANIFEST_FILE = path.join(
  process.cwd(),
  "exports",
  "player-local-target-lift-manifest.json",
);
const EXTRA_PLAYER_MODEL_FILES_ENV = "SNAPSHOT_LIVE_PLAYER_MODEL_FILES";
const EXTRA_PRIORITY_PLAYER_MODEL_FILES_ENV = "SNAPSHOT_LIVE_PRIORITY_PLAYER_MODEL_FILES";
const EXTRA_PRIORITY_PLAYER_MODEL_FILES_MODE_ENV = "SNAPSHOT_LIVE_PRIORITY_PLAYER_MODEL_FILES_MODE";

let cachedModelMap: Map<string, Map<SnapshotMarket, ModelVariant>> | null = null;
let cachedPriorityModelMap: Map<string, Map<SnapshotMarket, ModelVariant>> | null = null;
let cachedAllowlistConfig:
  | {
      filePath: string;
      allowedPlayers: Set<string>;
    }
  | null = null;
let cachedPlayerLocalRecoveryManifest:
  | {
      filePath: string;
      entriesByPlayerKey: Map<string, Map<SnapshotMarket, PlayerLocalRecoveryManifestRule>>;
    }
  | null = null;

function parseJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw) as T;
}

export type LivePlayerOverrideMode = "on" | "off" | "allowlist";
export type LivePlayerOverrideRuntimeMeta = {
  mode: LivePlayerOverrideMode;
  playerModelFiles: string[];
  playerModelFileSignatures: Record<string, string | null>;
  priorityPlayerModelFiles: string[];
  priorityPlayerModelFileSignatures: Record<string, string | null>;
  priorityPlayerModelFilesMode: "default" | "append" | "replace";
  joelMode: "on" | "off";
  javonMode: "on" | "off";
  jaMode: "on" | "off";
  naeMode: "on" | "off";
  coleMode: "on" | "off";
  dejounteMode: "on" | "off";
  devinMode: "on" | "off";
  aaronMode: "on" | "off";
  sabonisMode: "on" | "off";
  taureanMode: "on" | "off";
  tristanMode: "on" | "off";
  marcusMode: "on" | "off";
  kyleMode: "on" | "off";
  playerLocalRecoveryClusterMode: "on" | "off";
  playerLocalRecoveryManifestMode: "on" | "off";
  playerLocalRecoveryManifestFile: string;
  playerLocalRecoveryManifestSignature: string | null;
};

export function normalizeLivePlayerOverrideKey(value: string | null | undefined): string {
  return normalizePlayerName(value ?? "");
}

function normalizePlayerKey(value: string | null | undefined): string {
  return normalizeLivePlayerOverrideKey(value);
}

function resolveLivePlayerOverrideMode(): LivePlayerOverrideMode {
  const raw = process.env.SNAPSHOT_LIVE_PLAYER_OVERRIDE_MODE?.trim().toLowerCase();
  if (raw === "off") return "off";
  if (raw === "allowlist") return "allowlist";
  return "on";
}

function isJoelPlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_JOEL_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isJavonPlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_JAVON_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isJaPlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_JA_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isNaePlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_NAE_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isColePlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_COLE_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isDejountePlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_DEJOUNTE_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isDevinPlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_DEVIN_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isAaronPlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_AARON_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isSabonisPlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_SABONIS_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isTaureanPlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_TAUREAN_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isTristanPlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_TRISTAN_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isMarcusPlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_MARCUS_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isKylePlayerOverrideEnabled(): boolean {
  return process.env.SNAPSHOT_KYLE_PLAYER_OVERRIDE_MODE?.trim().toLowerCase() === "on";
}

function isPlayerLocalRecoveryClusterEnabled(): boolean {
  return process.env.SNAPSHOT_PLAYER_LOCAL_RECOVERY_CLUSTER_MODE?.trim().toLowerCase() === "on";
}

function isPlayerLocalRecoveryManifestEnabled(): boolean {
  return process.env.SNAPSHOT_PLAYER_LOCAL_RECOVERY_MANIFEST_MODE?.trim().toLowerCase() === "on";
}

function resolveAllowlistFilePath(): string {
  const override = process.env.SNAPSHOT_LIVE_PLAYER_OVERRIDE_ALLOWLIST_FILE?.trim();
  return override ? path.resolve(override) : DEFAULT_PLAYER_OVERRIDE_ALLOWLIST_FILE;
}

function resolvePlayerLocalRecoveryManifestFilePath(): string {
  const override = process.env.SNAPSHOT_PLAYER_LOCAL_RECOVERY_MANIFEST_FILE?.trim();
  return override ? path.resolve(override) : DEFAULT_PLAYER_LOCAL_RECOVERY_MANIFEST_FILE;
}

function buildFileSignature(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
  } catch {
    return null;
  }
}

function resolveConfiguredPriorityLiveModelFilesMode(): "default" | "append" | "replace" {
  const configured = process.env[EXTRA_PRIORITY_PLAYER_MODEL_FILES_ENV]?.trim();
  if (!configured) return "default";
  return process.env[EXTRA_PRIORITY_PLAYER_MODEL_FILES_MODE_ENV]?.trim().toLowerCase() === "replace"
    ? "replace"
    : "append";
}

export function getLivePlayerOverrideRuntimeMeta(): LivePlayerOverrideRuntimeMeta {
  const manifestFile = resolvePlayerLocalRecoveryManifestFilePath();
  const playerModelFiles = resolveConfiguredLiveModelFiles();
  const priorityPlayerModelFiles = resolveConfiguredPriorityLiveModelFiles();
  return {
    mode: resolveLivePlayerOverrideMode(),
    playerModelFiles,
    playerModelFileSignatures: Object.fromEntries(
      playerModelFiles.map((filePath) => [filePath, buildFileSignature(filePath)]),
    ),
    priorityPlayerModelFiles,
    priorityPlayerModelFileSignatures: Object.fromEntries(
      priorityPlayerModelFiles.map((filePath) => [filePath, buildFileSignature(filePath)]),
    ),
    priorityPlayerModelFilesMode: resolveConfiguredPriorityLiveModelFilesMode(),
    joelMode: isJoelPlayerOverrideEnabled() ? "on" : "off",
    javonMode: isJavonPlayerOverrideEnabled() ? "on" : "off",
    jaMode: isJaPlayerOverrideEnabled() ? "on" : "off",
    naeMode: isNaePlayerOverrideEnabled() ? "on" : "off",
    coleMode: isColePlayerOverrideEnabled() ? "on" : "off",
    dejounteMode: isDejountePlayerOverrideEnabled() ? "on" : "off",
    devinMode: isDevinPlayerOverrideEnabled() ? "on" : "off",
    aaronMode: isAaronPlayerOverrideEnabled() ? "on" : "off",
    sabonisMode: isSabonisPlayerOverrideEnabled() ? "on" : "off",
    taureanMode: isTaureanPlayerOverrideEnabled() ? "on" : "off",
    tristanMode: isTristanPlayerOverrideEnabled() ? "on" : "off",
    marcusMode: isMarcusPlayerOverrideEnabled() ? "on" : "off",
    kyleMode: isKylePlayerOverrideEnabled() ? "on" : "off",
    playerLocalRecoveryClusterMode: isPlayerLocalRecoveryClusterEnabled() ? "on" : "off",
    playerLocalRecoveryManifestMode: isPlayerLocalRecoveryManifestEnabled() ? "on" : "off",
    playerLocalRecoveryManifestFile: manifestFile,
    playerLocalRecoveryManifestSignature: buildFileSignature(manifestFile),
  };
}

function resolveConfiguredLiveModelFiles(): string[] {
  const configured = process.env[EXTRA_PLAYER_MODEL_FILES_ENV]?.trim();
  if (!configured) return DEFAULT_LIVE_MODEL_FILES;

  const extras = configured
    .split(/[,\r\n;]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));

  return [...new Set([...DEFAULT_LIVE_MODEL_FILES, ...extras])];
}

function resolveConfiguredPriorityLiveModelFiles(): string[] {
  const configured = process.env[EXTRA_PRIORITY_PLAYER_MODEL_FILES_ENV]?.trim();
  if (!configured) return DEFAULT_PRIORITY_LIVE_MODEL_FILES;
  const configuredMode = process.env[EXTRA_PRIORITY_PLAYER_MODEL_FILES_MODE_ENV]?.trim().toLowerCase();

  const extras = configured
    .split(/[,\r\n;]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));

  if (configuredMode === "replace") {
    return [...new Set(extras)];
  }

  return [...new Set([...DEFAULT_PRIORITY_LIVE_MODEL_FILES, ...extras])];
}

function loadAllowlistSet(): Set<string> {
  const filePath = resolveAllowlistFilePath();
  if (cachedAllowlistConfig?.filePath === filePath) {
    return cachedAllowlistConfig.allowedPlayers;
  }

  const allowedPlayers = new Set<string>();
  if (fs.existsSync(filePath)) {
    try {
      const payload = parseJsonFile<LivePlayerOverrideAllowlistPayload>(filePath);
      const add = (value: string | null | undefined) => {
        const normalized = normalizePlayerKey(value);
        if (normalized) allowedPlayers.add(normalized);
      };
      if (Array.isArray(payload)) {
        payload.forEach((value) => add(value));
      } else {
        (payload.allowedPlayers ?? payload.players ?? []).forEach((value) => add(value));
        (payload.playerStats ?? []).forEach((entry) => add(entry.playerKey ?? entry.playerName ?? null));
      }
    } catch {
      // Ignore malformed allowlists and fall back to an empty set.
    }
  }

  cachedAllowlistConfig = {
    filePath,
    allowedPlayers,
  };
  return allowedPlayers;
}

function loadModelMap(): Map<string, Map<SnapshotMarket, ModelVariant>> {
  if (cachedModelMap) return cachedModelMap;

  const map = new Map<string, Map<SnapshotMarket, ModelVariant>>();
  for (const filePath of resolveConfiguredLiveModelFiles()) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = parseJsonFile<PlayerModelSummaryFile>(filePath);
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

function loadPriorityModelMap(): Map<string, Map<SnapshotMarket, ModelVariant>> {
  if (cachedPriorityModelMap) return cachedPriorityModelMap;

  const map = new Map<string, Map<SnapshotMarket, ModelVariant>>();
  for (const filePath of resolveConfiguredPriorityLiveModelFiles()) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = parseJsonFile<PlayerModelSummaryFile>(filePath);
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

  cachedPriorityModelMap = map;
  return map;
}

function loadPlayerLocalRecoveryManifest(): Map<string, Map<SnapshotMarket, PlayerLocalRecoveryManifestRule>> {
  const filePath = resolvePlayerLocalRecoveryManifestFilePath();
  if (cachedPlayerLocalRecoveryManifest?.filePath === filePath) {
    return cachedPlayerLocalRecoveryManifest.entriesByPlayerKey;
  }

  const entriesByPlayerKey = new Map<string, Map<SnapshotMarket, PlayerLocalRecoveryManifestRule>>();
  if (fs.existsSync(filePath)) {
    try {
      const payload = parseJsonFile<PlayerLocalRecoveryManifestPayload>(filePath);
      for (const entry of payload.entries ?? []) {
        const playerKey = normalizePlayerKey(entry.playerKey ?? entry.playerName ?? null);
        if (!playerKey || !entry.markets) continue;
        const marketRules = new Map<SnapshotMarket, PlayerLocalRecoveryManifestRule>();
        for (const market of Object.keys(entry.markets) as SnapshotMarket[]) {
          const rule = entry.markets[market];
          if (!rule) continue;
          marketRules.set(market, rule);
        }
        if (marketRules.size > 0) {
          entriesByPlayerKey.set(playerKey, marketRules);
        }
      }
    } catch {
      // Ignore malformed manifests and fall back to an empty map.
    }
  }

  cachedPlayerLocalRecoveryManifest = {
    filePath,
    entriesByPlayerKey,
  };
  return entriesByPlayerKey;
}

function impliedProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function runtimeManifestSourceSide(row: LivePlayerModelRow, source: RuntimeSourceName): Side {
  switch (source) {
    case "projection":
      return row.projectionSide;
    case "baseline":
      return row.baselineSide;
    case "favored":
      return row.favoredSide === "NEUTRAL" ? row.projectionSide : row.favoredSide;
    case "final":
      return row.finalSide;
    case "liveRaw":
    default:
      return row.rawSide;
  }
}

function runtimeManifestActionSide(row: LivePlayerModelRow, action: RuntimeActionName): Side {
  switch (action) {
    case "OVER":
    case "UNDER":
      return action;
    case "projection":
    case "baseline":
    case "favored":
    case "final":
    case "liveRaw":
      return runtimeManifestSourceSide(row, action);
    default:
      return row.rawSide;
  }
}

function runtimeManifestFeatureValue(row: LivePlayerModelRow, feature: RuntimeNumericFeature): number | null {
  switch (feature) {
    case "expectedMinutes":
      return row.expectedMinutes;
    case "minutesVolatility":
      return row.minutesVolatility;
    case "starterRateLast10":
      return row.starterRateLast10;
    case "projectedValue":
      return row.projectedValue;
    case "overPrice":
      return row.overPrice;
    case "underPrice":
      return row.underPrice;
    case "priceLean":
      return row.priceLean;
    case "priceAbsLean":
      return row.priceLean == null ? null : Math.abs(row.priceLean);
    case "lineGap":
      return row.lineGap;
    case "absLineGap":
      return row.absLineGap;
    default:
      return null;
  }
}

function applyPlayerLocalRecoveryManifest(
  playerKey: string,
  market: SnapshotMarket,
  row: LivePlayerModelRow,
): Side | null {
  if (!isPlayerLocalRecoveryManifestEnabled()) return null;
  const rule = loadPlayerLocalRecoveryManifest().get(playerKey)?.get(market);
  if (!rule) return null;
  if (rule.kind === "source") {
    return runtimeManifestSourceSide(row, rule.source);
  }
  if (rule.kind === "action") {
    return runtimeManifestActionSide(row, rule.action);
  }
  const value = runtimeManifestFeatureValue(row, rule.feature);
  if (value == null || !Number.isFinite(value)) {
    return row.rawSide;
  }
  return value <= rule.threshold
    ? runtimeManifestActionSide(row, rule.lowAction)
    : runtimeManifestActionSide(row, rule.highAction);
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
): Side | null {
  const playerKey = normalizePlayerKey(playerName);

  if (isJoelPlayerOverrideEnabled() && playerKey === "joel embiid") {
    switch (market) {
      case "PTS":
        return row.priceLean != null && row.priceLean < 0.03 ? row.projectionSide : row.rawSide;
      case "AST":
        return row.expectedMinutes != null && row.expectedMinutes > 28 ? row.baselineSide : row.rawSide;
      case "PRA":
        return row.absLineGap > 0.5 ? row.projectionSide : row.rawSide;
      case "PA":
        return row.baselineSide;
      case "THREES":
        return row.baselineSide;
      case "RA":
        return row.projectionSide;
      case "REB":
        return row.expectedMinutes != null && row.expectedMinutes <= 28 ? row.baselineSide : row.rawSide;
      case "PR":
        return row.rawSide;
      default:
        return predictedSide;
    }
  }

  if (isJavonPlayerOverrideEnabled() && playerKey === "javon small") {
    switch (market) {
      case "AST":
        return row.expectedMinutes != null && row.expectedMinutes <= 23.59 ? "OVER" : "UNDER";
      case "PA":
        return row.expectedMinutes != null && row.expectedMinutes <= 24.59 ? "UNDER" : row.favoredSide === "NEUTRAL" ? row.projectionSide : row.favoredSide;
      case "PR":
        return row.expectedMinutes != null && row.expectedMinutes <= 23.59
          ? row.rawSide
          : row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide;
      case "PRA":
        return row.projectedValue <= 13.61
          ? row.projectionSide
          : row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide;
      case "PTS":
        return row.minutesVolatility != null && row.minutesVolatility <= 3.42
          ? "UNDER"
          : row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide;
      case "RA":
        return "UNDER";
      case "REB":
        return row.projectedValue <= 4.01
          ? row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide
          : "UNDER";
      case "THREES":
        return row.expectedMinutes != null && row.expectedMinutes <= 24.37
          ? row.rawSide
          : row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide;
      default:
        return predictedSide;
    }
  }

  if (isJaPlayerOverrideEnabled() && playerKey === "ja morant") {
    switch (market) {
      case "PTS":
        if (row.minutesVolatility == null) return row.rawSide;
        return row.minutesVolatility <= 4.12 ? "UNDER" : row.rawSide;
      case "REB":
        return row.projectedValue <= 4.54 ? row.projectionSide : "UNDER";
      case "AST":
        return row.absLineGap <= 0.27 ? row.rawSide : "OVER";
      case "THREES":
        return row.rawSide;
      case "PRA":
        return row.projectionSide;
      case "PA":
        return row.rawSide;
      case "PR":
        return row.projectionSide;
      case "RA":
        return "OVER";
      default:
        return predictedSide;
    }
  }

  if (isNaePlayerOverrideEnabled() && playerKey === "nae qwan tomlin") {
    switch (market) {
      case "PTS":
        return row.lineGap <= -1.03 ? row.projectionSide : row.rawSide;
      case "REB":
        return row.projectedValue <= 3.44 ? "OVER" : row.projectionSide;
      case "AST":
        if (row.expectedMinutes == null) return row.rawSide;
        return row.expectedMinutes <= 19.13 ? row.rawSide : "UNDER";
      case "THREES":
        if (row.minutesVolatility == null) return row.rawSide;
        return row.minutesVolatility <= 4.46
          ? "UNDER"
          : row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide;
      case "PRA":
        return row.projectedValue <= 12.59
          ? row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide
          : "UNDER";
      case "PA":
        if (row.expectedMinutes == null) return row.rawSide;
        return row.expectedMinutes <= 22.26
          ? row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide
          : "UNDER";
      case "PR":
        if (row.expectedMinutes == null) return row.rawSide;
        return row.expectedMinutes <= 22.26 ? row.rawSide : "UNDER";
      case "RA":
        return row.projectedValue <= 5.14
          ? row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide
          : "UNDER";
      default:
        return predictedSide;
    }
  }

  if (isColePlayerOverrideEnabled() && playerKey === "cole anthony") {
    switch (market) {
      case "PTS":
        return row.absLineGap <= 1.03
          ? "UNDER"
          : row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide;
      case "REB":
        if (row.minutesVolatility == null) return row.rawSide;
        return row.minutesVolatility <= 5.98 ? "OVER" : row.projectionSide;
      case "AST":
        return row.projectedValue <= 4.33 ? row.projectionSide : "OVER";
      case "THREES":
        return row.rawSide;
      case "PRA":
      case "PA":
      case "PR":
      case "RA":
        return row.projectionSide;
      default:
        return predictedSide;
    }
  }

  if (isDejountePlayerOverrideEnabled() && playerKey === "dejounte murray") {
    switch (market) {
      case "PTS":
        if (row.starterRateLast10 == null) return row.rawSide;
        return row.starterRateLast10 <= 0.8 ? row.rawSide : row.baselineSide;
      case "REB":
        if (row.expectedMinutes == null) return row.rawSide;
        return row.expectedMinutes <= 26.19 ? "UNDER" : "OVER";
      case "AST":
        if (row.expectedMinutes == null) return row.rawSide;
        return row.expectedMinutes <= 26.19 ? "OVER" : row.baselineSide;
      case "THREES":
        return row.absLineGap <= 0.11 ? "OVER" : "UNDER";
      case "PRA":
        if (row.starterRateLast10 == null) return row.rawSide;
        return row.starterRateLast10 <= 0.8 ? row.rawSide : "UNDER";
      case "PA":
        if (row.starterRateLast10 == null) return row.rawSide;
        return row.starterRateLast10 <= 0.8 ? row.rawSide : "UNDER";
      case "PR":
        if (row.starterRateLast10 == null) return row.rawSide;
        return row.starterRateLast10 <= 0.7 ? row.rawSide : "UNDER";
      case "RA":
        return row.projectedValue <= 11.8 ? row.projectionSide : row.baselineSide;
      default:
        return predictedSide;
    }
  }

  if (isDevinPlayerOverrideEnabled() && playerKey === "devin carter") {
    switch (market) {
      case "AST":
        return row.favoredSide === "NEUTRAL" ? row.projectionSide : row.favoredSide;
      case "PA":
        return row.rawSide;
      case "PR":
        return row.lineGap <= -4.005 ? "OVER" : "UNDER";
      case "PRA":
        return row.projectionSide;
      case "PTS":
        return row.rawSide;
      case "RA":
        return row.expectedMinutes != null && row.expectedMinutes <= 20.295 ? "OVER" : "UNDER";
      case "REB":
        return row.priceLean == null ? row.baselineSide : Math.abs(row.priceLean) <= 0.1069 ? "UNDER" : "OVER";
      case "THREES":
        if (row.lineGap <= -1.055) return "OVER";
        return row.minutesVolatility != null && row.minutesVolatility <= 9.925 ? "UNDER" : "OVER";
      default:
        return predictedSide;
    }
  }

  if (isAaronPlayerOverrideEnabled() && playerKey === "aaron gordon") {
    switch (market) {
      case "PTS":
        return row.overPrice != null && row.overPrice <= -118 ? row.projectionSide : "OVER";
      case "REB":
        return row.finalSide;
      case "AST":
        return row.rawSide;
      case "THREES":
        return row.projectedValue <= 1.48 ? row.baselineSide : "UNDER";
      case "PRA":
        return row.projectedValue <= 22.6 ? "OVER" : "UNDER";
      case "PA":
        return row.favoredSide === "NEUTRAL" ? row.projectionSide : row.favoredSide;
      case "PR":
        return row.finalSide;
      case "RA":
        return row.expectedMinutes != null && row.expectedMinutes <= 27.37 ? row.projectionSide : "UNDER";
      default:
        return predictedSide;
    }
  }

  if (isSabonisPlayerOverrideEnabled() && playerKey === "domantas sabonis") {
    switch (market) {
      case "PTS":
        return row.expectedMinutes != null && row.expectedMinutes <= 30.12 ? row.projectionSide : "UNDER";
      case "REB":
        return row.expectedMinutes != null && row.expectedMinutes <= 30.43
          ? row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide
          : row.rawSide;
      case "AST":
        return row.minutesVolatility != null && row.minutesVolatility <= 7.69 ? row.finalSide : "UNDER";
      case "THREES":
        return row.rawSide;
      case "PRA":
        return "UNDER";
      case "PA":
        return row.rawSide;
      case "PR":
        return "UNDER";
      case "RA":
        return row.projectionSide;
      default:
        return predictedSide;
    }
  }

  if (isTaureanPlayerOverrideEnabled() && playerKey === "taurean prince") {
    switch (market) {
      case "PTS":
        return row.rawSide;
      case "REB":
        return row.projectionSide;
      case "AST":
        return "UNDER";
      case "THREES":
        return "OVER";
      case "PRA":
        return row.rawSide;
      case "PA":
        return "OVER";
      case "PR":
        return row.baselineSide;
      case "RA":
        return "UNDER";
      default:
        return predictedSide;
    }
  }

  if (isTristanPlayerOverrideEnabled() && playerKey === "tristan vukcevic") {
    switch (market) {
      case "PTS":
        return row.priceLean != null && row.priceLean <= -0.006087446164148025 ? "OVER" : "UNDER";
      case "REB":
        return row.projectedValue <= 3.81 ? "OVER" : "UNDER";
      case "AST":
        return row.absLineGap <= 0.31 ? "UNDER" : row.favoredSide === "NEUTRAL" ? row.projectionSide : row.favoredSide;
      case "THREES":
        return row.minutesVolatility != null && row.minutesVolatility <= 4.17 ? "OVER" : row.projectionSide;
      case "PRA":
        return row.projectedValue <= 16.11 ? "OVER" : "UNDER";
      case "PA":
        return row.lineGap <= -0.4 ? "OVER" : row.favoredSide === "NEUTRAL" ? row.projectionSide : row.favoredSide;
      case "PR":
        return row.projectedValue <= 14.48 ? "OVER" : "UNDER";
      case "RA":
        return row.projectedValue <= 5.02 ? row.rawSide : "UNDER";
      default:
        return predictedSide;
    }
  }

  if (isMarcusPlayerOverrideEnabled() && playerKey === "marcus sasser") {
    switch (market) {
      case "PTS":
        if (row.minutesVolatility == null) return row.rawSide;
        return row.minutesVolatility <= 6.6
          ? "UNDER"
          : row.favoredSide === "NEUTRAL"
            ? row.projectionSide
            : row.favoredSide;
      case "REB":
        return row.projectedValue <= 1.73 ? row.baselineSide : "OVER";
      case "AST":
        if (row.expectedMinutes == null) return row.rawSide;
        return row.expectedMinutes <= 9.95 ? row.rawSide : "UNDER";
      case "THREES":
        if (row.priceLean == null) return row.rawSide;
        return row.priceLean <= 0.5708 ? "OVER" : "UNDER";
      case "PRA":
        if (row.expectedMinutes == null) return row.rawSide;
        return row.expectedMinutes <= 13.91 ? "OVER" : row.projectionSide;
      case "PA":
        if (row.expectedMinutes == null) return row.rawSide;
        return row.expectedMinutes <= 13.91 ? "OVER" : row.projectionSide;
      case "PR":
        if (row.expectedMinutes == null) return row.rawSide;
        return row.expectedMinutes <= 13.91 ? row.rawSide : row.projectionSide;
      case "RA":
        if (row.expectedMinutes == null) return row.rawSide;
        return row.expectedMinutes <= 9.95 ? row.rawSide : "UNDER";
      default:
        return predictedSide;
    }
  }

  if (isKylePlayerOverrideEnabled() && playerKey === "kyle anderson") {
    switch (market) {
      case "PTS":
        if (row.expectedMinutes == null) return row.rawSide;
        return row.expectedMinutes <= 20.81 ? "OVER" : row.projectionSide;
      case "REB":
        return row.priceLean != null && Math.abs(row.priceLean) <= 0.058 ? "UNDER" : row.projectionSide;
      case "AST":
        return "OVER";
      case "THREES":
        return row.rawSide;
      case "PRA":
        return row.rawSide;
      case "PA":
        return row.projectionSide;
      case "PR":
        return row.baselineSide;
      case "RA":
        return "UNDER";
      default:
        return predictedSide;
    }
  }

  const manifestOverride = applyPlayerLocalRecoveryManifest(playerKey, market, row);
  if (manifestOverride) {
    return manifestOverride;
  }

  if (isPlayerLocalRecoveryClusterEnabled()) {
    if (playerKey === "lauri markkanen" || playerKey === "sidy cissoko") {
      return row.projectionSide;
    }
  }

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

  return null;
}

export function predictLivePlayerModelSide(input: PredictLivePlayerSideInput): SnapshotModelSide {
  const overrideMode = resolveLivePlayerOverrideMode();
  if (overrideMode === "off") return "NEUTRAL";

  const playerKey = normalizePlayerKey(input.playerName);
  if (!playerKey || input.projectedValue == null || input.line == null) return "NEUTRAL";
  if (overrideMode === "allowlist" && !loadAllowlistSet().has(playerKey)) return "NEUTRAL";

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

  const rawSide: Side =
    input.rawSide === "OVER" || input.rawSide === "UNDER" ? input.rawSide : projectionSide;
  const finalSide: Side =
    input.finalSide === "OVER" || input.finalSide === "UNDER" ? input.finalSide : projectionSide;
  const baselineSide: Side =
    input.baselineSide === "OVER" || input.baselineSide === "UNDER" ? input.baselineSide : projectionSide;

  const row: LivePlayerModelRow = {
    projectedValue: input.projectedValue,
    line: input.line,
    overPrice: input.overPrice,
    underPrice: input.underPrice,
    projectionSide,
    rawSide,
    finalSide,
    baselineSide,
    priceLean,
    favoredSide,
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    lineGap: input.projectedValue - input.line,
    absLineGap: Math.abs(input.projectedValue - input.line),
  };

  // Priority replacement models intentionally run before the manifest layer so
  // curated headroom challengers can displace older player-local rules.
  const priorityPlayerModel = loadPriorityModelMap().get(playerKey)?.get(input.market);
  if (priorityPlayerModel) {
    return predictVariant(priorityPlayerModel, row);
  }

  const customProjectionOverride = applyCustomPlayerOverride(input.playerName ?? "", input.market, row, projectionSide);
  if (customProjectionOverride) return customProjectionOverride;

  const playerModel = loadModelMap().get(playerKey)?.get(input.market);
  if (!playerModel) return "NEUTRAL";

  const predicted = predictVariant(playerModel, row);
  return applyCustomPlayerOverride(input.playerName ?? "", input.market, row, predicted) ?? predicted;
}

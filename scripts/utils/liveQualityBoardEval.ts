import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
  evaluateLiveUniversalModelSide,
  inspectLiveUniversalModelSide,
  type LiveUniversalModelDecision,
  type LiveUniversalQualificationSettings,
  type RawLiveUniversalModelDecision,
} from "../../lib/snapshot/liveUniversalSideModels";
import { predictLivePraRawFeatureSide, getLivePraRawFeatureRuntimeMeta } from "../../lib/snapshot/livePraRawFeatureModel";
import {
  getLivePlayerOverrideRuntimeMeta,
  predictLivePlayerModelSide,
  normalizeLivePlayerOverrideKey,
} from "../../lib/snapshot/livePlayerSideModels";
import { attachCurrentLineRecencyMetrics } from "../../lib/snapshot/currentLineRecency";
import {
  applyRecentWeaknessRouter,
  getRecentWeaknessRouterRuntimeMeta,
} from "../../lib/snapshot/recentWeaknessRouter";
import {
  DEFAULT_UNIVERSAL_LIVE_QUALIFICATION_SETTINGS_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  resolvePreferredUniversalLiveRowsRelativePath,
  resolveProjectPath,
} from "../../lib/snapshot/universalArtifactPaths";
import type { SnapshotMarket, SnapshotModelSide } from "../../lib/types/snapshot";
import { round } from "../../lib/utils";
import { loadPlayerMetaWithCache } from "../utils/playerMetaCache";
import { meanProjection, rowProjectionOrSummary } from "../utils/trainingRowProjectionContext";

type Side = "OVER" | "UNDER";
type Market = SnapshotMarket;

export type LiveQualityTrainingRow = {
  playerId: string;
  playerName: string;
  teamId?: string | null;
  teamCode?: string | null;
  externalGameId?: string | null;
  market: Market;
  gameDateEt: string;
  projectedValue: number;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection?: number | null;
  threesProjection?: number | null;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  projectionSide: Side;
  finalSide: Side;
  actualSide: Side;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  seasonMinutesAvg?: number | null;
  minutesLiftPct?: number | null;
  activeCorePts?: number | null;
  activeCoreAst?: number | null;
  missingCorePts?: number | null;
  missingCoreAst?: number | null;
  missingCoreShare?: number | null;
  stepUpRoleFlag?: number | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability?: number | null;
  l5MarketDeltaAvg?: number | null;
  l5OverRate?: number | null;
  sameOpponentSample?: number | null;
  sameOpponentAvg?: number | null;
  sameOpponentDeltaVsSeason?: number | null;
  sameOpponentAdjustment?: number | null;
  l5CurrentLineDeltaAvg?: number | null;
  l5CurrentLineOverRate?: number | null;
  l5MinutesAvg?: number | null;
  emaCurrentLineDelta?: number | null;
  emaCurrentLineOverRate?: number | null;
  emaMinutesAvg?: number | null;
  l15ValueMean?: number | null;
  l15ValueMedian?: number | null;
  l15ValueStdDev?: number | null;
  l15ValueSkew?: number | null;
  actualMinutes: number;
  lineGap: number;
  absLineGap: number;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  spreadResolved: boolean;
  lineupStatus?: "CONFIRMED" | "EXPECTED" | "UNKNOWN" | null;
  lineupStarter?: boolean | null;
  availabilityStatus?: "OUT" | "DOUBTFUL" | "QUESTIONABLE" | "PROBABLE" | "ACTIVE" | "UNKNOWN" | null;
  availabilityPercentPlay?: number | null;
  availabilitySeverity?: number | null;
  opponentShotVolumeFgaPerMinute?: number | null;
  opponentShotVolumeFg3aPerMinute?: number | null;
  opponentShotVolumeFtaPerMinute?: number | null;
  opponentShotVolumeThreeShare?: number | null;
  opponentShotVolumeFreeThrowPressure?: number | null;
  opponentShotVolumeSample?: number | null;
  restDays?: number | null;
  gamesIn4Days?: number | null;
  closeRate10?: number | null;
  blowoutRate10?: number | null;
  defenderStocksPer36?: number | null;
  opponentAllowancePts?: number | null;
  opponentAllowanceReb?: number | null;
  opponentAllowanceAst?: number | null;
  opponentAllowancePra?: number | null;
  opponentAllowancePr?: number | null;
  opponentAllowanceRa?: number | null;
  opponentAllowanceDeltaPts?: number | null;
  opponentAllowanceDeltaReb?: number | null;
  opponentAllowanceDeltaAst?: number | null;
  opponentAllowanceDeltaPra?: number | null;
  opponentAllowanceDeltaPr?: number | null;
  opponentAllowanceDeltaRa?: number | null;
  opponentPositionAllowancePts?: number | null;
  opponentPositionAllowanceReb?: number | null;
  opponentPositionAllowanceAst?: number | null;
  opponentPositionSample?: number | null;
};

export type LiveQualityRowsFile = {
  from?: string;
  to?: string;
  playerMarketRows: LiveQualityTrainingRow[];
};

type PlayerMeta = {
  id: string;
  position: string | null;
};

export type LiveQualityPlayerSummary = {
  playerId: string;
  position: string | null;
  avgExpectedMinutes: number | null;
  avgStarterRate: number | null;
  ptsProjectionAvg: number | null;
  rebProjectionAvg: number | null;
  astProjectionAvg: number | null;
  threesProjectionAvg: number | null;
};

export type LiveQualityEvaluatedRow = {
  rowKey: string;
  playerId: string;
  playerName: string;
  teamId?: string | null;
  teamCode?: string | null;
  externalGameId?: string | null;
  normalizedPlayerKey: string;
  market: Market;
  gameDateEt: string;
  projectedValue: number;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  actualSide: Side;
  baselineSide: Side;
  rawSide: SnapshotModelSide;
  strictRawSide: SnapshotModelSide;
  finalSide: Side;
  rawSource: "player_override" | "universal_raw" | "baseline";
  strictRawSource: "player_override" | "universal_raw" | "none";
  finalSource: "player_override" | "universal_qualified" | "baseline";
  rawCorrect: boolean;
  strictRawCorrect: boolean;
  finalCorrect: boolean;
  overrideEngaged: boolean;
  playerOverrideEngaged: boolean;
  rawDecision: RawLiveUniversalModelDecision;
  liveDecision: LiveUniversalModelDecision;
  playerOverrideSide: SnapshotModelSide;
  legacyUniversalRawCorrect: boolean;
  legacyUniversalFinalCorrect: boolean;
  projectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  lineGap: number;
  absLineGap: number;
  jointFeasibilityVetoed?: boolean;
  jointFeasibilityReason?: string | null;
  jointFeasibilityConflicts?: string[];
};

export type LiveQualityEvalBucket = {
  samples: number;
  rawAccuracy: number;
  strictRawAccuracy: number;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number;
  blendedAccuracy: number;
  legacyUniversalRawAccuracy: number;
  legacyUniversalBlendedAccuracy: number;
  legacyUniversalCoveragePct: number;
};

export type LiveQualityEvalSummary = {
  overall: LiveQualityEvalBucket;
  byMarket: Record<Market, LiveQualityEvalBucket>;
};

export type LiveQualityRuntimeSnapshot = {
  label: string | null;
  rowsFilePath: string;
  rowsFileSignature: string | null;
  playerOverrideMode: ReturnType<typeof getLivePlayerOverrideRuntimeMeta>["mode"];
  playerOverrideAllowlistFile: string | null;
  playerModelFiles: string[];
  playerModelFileSignatures: Record<string, string | null>;
  priorityPlayerModelFiles: string[];
  priorityPlayerModelFileSignatures: Record<string, string | null>;
  priorityPlayerModelFilesMode: ReturnType<typeof getLivePlayerOverrideRuntimeMeta>["priorityPlayerModelFilesMode"];
  playerOverrideRuntime: ReturnType<typeof getLivePlayerOverrideRuntimeMeta>;
  routerMode: string;
  routerModelFile: string | null;
  routerPackFile: string | null;
  qualificationSettingsFile: string | null;
  qualificationSettingsFileSignature: string | null;
  praRawFeatureMode: ReturnType<typeof getLivePraRawFeatureRuntimeMeta>["mode"];
  praRawFeatureModelFile: string;
  praRawFeatureModelFileSignature: string | null;
  praRawFeatureModelLabel: string | null;
  praRawFeatureModelVersion: string | null;
  recentWeaknessRouter: ReturnType<typeof getRecentWeaknessRouterRuntimeMeta>;
};

export const LIVE_QUALITY_MARKETS: Market[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];

const prisma = new PrismaClient();

export function resolveDefaultLiveQualityRowsPath(): string {
  const preferred = resolveProjectPath(resolvePreferredUniversalLiveRowsRelativePath());
  return path.resolve(preferred ?? DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

export async function disconnectLiveQualityBoardEvalPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export function buildLiveQualityRowKey(row: Pick<LiveQualityTrainingRow, "playerId" | "gameDateEt" | "market">): string {
  return [row.playerId, row.gameDateEt, row.market].join("|");
}

export function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

export function resolveRowsFilePath(input?: string | null): string {
  if (input?.trim()) return path.resolve(input);
  const preferred = resolveProjectPath(resolvePreferredUniversalLiveRowsRelativePath());
  return path.resolve(preferred);
}

export function buildFileSignature(filePath?: string | null): string | null {
  if (!filePath) return null;
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
  } catch {
    return null;
  }
}

export function buildLiveQualityRuntimeSnapshot(options?: {
  input?: string | null;
  label?: string | null;
  qualificationSettingsFile?: string | null;
}): LiveQualityRuntimeSnapshot {
  const rowsFilePath = resolveRowsFilePath(options?.input);
  const playerOverrideRuntime = getLivePlayerOverrideRuntimeMeta();
  const promotedPraRuntime = getLivePraRawFeatureRuntimeMeta();
  const recentWeaknessRouter = getRecentWeaknessRouterRuntimeMeta();

  return {
    label: options?.label?.trim() || null,
    rowsFilePath,
    rowsFileSignature: buildFileSignature(rowsFilePath),
    playerOverrideMode: playerOverrideRuntime.mode,
    playerOverrideAllowlistFile: process.env.SNAPSHOT_LIVE_PLAYER_OVERRIDE_ALLOWLIST_FILE?.trim() || null,
    playerModelFiles: playerOverrideRuntime.playerModelFiles,
    playerModelFileSignatures: playerOverrideRuntime.playerModelFileSignatures,
    priorityPlayerModelFiles: playerOverrideRuntime.priorityPlayerModelFiles,
    priorityPlayerModelFileSignatures: playerOverrideRuntime.priorityPlayerModelFileSignatures,
    priorityPlayerModelFilesMode: playerOverrideRuntime.priorityPlayerModelFilesMode,
    playerOverrideRuntime,
    routerMode: process.env.SNAPSHOT_UNIVERSAL_ROUTER_MODE?.trim() || "off",
    routerModelFile: process.env.SNAPSHOT_UNIVERSAL_ROUTER_MODEL_FILE?.trim() || null,
    routerPackFile: process.env.SNAPSHOT_UNIVERSAL_ROUTER_PACK_FILE?.trim() || null,
    qualificationSettingsFile: options?.qualificationSettingsFile ?? null,
    qualificationSettingsFileSignature: buildFileSignature(options?.qualificationSettingsFile),
    praRawFeatureMode: promotedPraRuntime.mode,
    praRawFeatureModelFile: promotedPraRuntime.filePath,
    praRawFeatureModelFileSignature: promotedPraRuntime.fileSignature,
    praRawFeatureModelLabel: promotedPraRuntime.label,
    praRawFeatureModelVersion: promotedPraRuntime.version,
    recentWeaknessRouter,
  };
}

export function cloneLiveUniversalQualificationSettings(
  input: LiveUniversalQualificationSettings = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
): LiveUniversalQualificationSettings {
  return JSON.parse(JSON.stringify(input)) as LiveUniversalQualificationSettings;
}

export function mergeLiveUniversalQualificationSettings(
  base: LiveUniversalQualificationSettings,
  override: Partial<LiveUniversalQualificationSettings>,
): LiveUniversalQualificationSettings {
  const merged = cloneLiveUniversalQualificationSettings(base);

  const scalarKeys = [
    "minBucketLateAccuracy",
    "minBucketSamples",
    "minLeafAccuracy",
    "minLeafCount",
    "minProjectionWinProbability",
    "minProjectionPriceEdge",
  ] as const;

  scalarKeys.forEach((key) => {
    const value = override[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      merged[key] = value;
    }
  });

  if (!override.marketOverrides) {
    return merged;
  }

  merged.marketOverrides = { ...(merged.marketOverrides ?? {}) };
  for (const [market, marketOverride] of Object.entries(override.marketOverrides)) {
    if (!marketOverride) continue;
    const baseMarket = (merged.marketOverrides[market as Market] ?? {}) as Record<string, unknown>;
    const nextMarket = { ...baseMarket } as Record<string, unknown>;

    scalarKeys.forEach((key) => {
      const value = marketOverride[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        nextMarket[key] = value;
      }
    });

    if (marketOverride.archetypeOverrides) {
      const nextArchetypeOverrides = {
        ...((baseMarket.archetypeOverrides as Record<string, Record<string, number>> | undefined) ?? {}),
      };
      for (const [archetype, archetypeOverride] of Object.entries(marketOverride.archetypeOverrides)) {
        if (!archetypeOverride) continue;
        const baseArchetype = nextArchetypeOverrides[archetype] ?? {};
        const nextArchetype = { ...baseArchetype } as Record<string, number>;
        scalarKeys.forEach((key) => {
          const value = archetypeOverride[key];
          if (typeof value === "number" && Number.isFinite(value)) {
            nextArchetype[key] = value;
          }
        });
        nextArchetypeOverrides[archetype] = nextArchetype;
      }
      nextMarket.archetypeOverrides = nextArchetypeOverrides;
    }

    (merged.marketOverrides as Record<string, unknown>)[market] = nextMarket;
  }

  return merged;
}

export async function loadLiveQualityQualificationSettings(input?: string | null): Promise<{
  settings: LiveUniversalQualificationSettings;
  sourceFile: string | null;
}> {
  const defaultLiveAlias = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_QUALIFICATION_SETTINGS_RELATIVE_PATH);
  const candidate =
    input?.trim() ||
    process.env.SNAPSHOT_LIVE_QUALITY_QUALIFICATION_SETTINGS_FILE?.trim() ||
    (defaultLiveAlias && path.resolve(defaultLiveAlias)) ||
    null;
  if (!candidate) {
    return {
      settings: cloneLiveUniversalQualificationSettings(),
      sourceFile: null,
    };
  }

  const resolved = path.resolve(candidate);
  if (!path.isAbsolute(resolved) || !resolved.trim()) {
    return {
      settings: cloneLiveUniversalQualificationSettings(),
      sourceFile: null,
    };
  }
  const exists = await access(resolved)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    return {
      settings: cloneLiveUniversalQualificationSettings(),
      sourceFile: null,
    };
  }
  const raw = await readFile(resolved, "utf8");
  const parsed = JSON.parse(raw) as Partial<LiveUniversalQualificationSettings>;
  return {
    settings: mergeLiveUniversalQualificationSettings(cloneLiveUniversalQualificationSettings(), parsed),
    sourceFile: resolved,
  };
}

export async function loadRowsPayload(input?: string | null): Promise<LiveQualityRowsFile> {
  const filePath = resolveRowsFilePath(input);
  return JSON.parse(await readFile(filePath, "utf8")) as LiveQualityRowsFile;
}

export function filterAndAttachRows(rows: LiveQualityTrainingRow[], minActualMinutes: number): LiveQualityTrainingRow[] {
  return attachCurrentLineRecencyMetrics(rows.filter((row) => row.actualMinutes >= minActualMinutes));
}

async function loadPlayerMetaMap(rows: LiveQualityTrainingRow[]): Promise<Map<string, PlayerMeta>> {
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

export async function summarizePlayers(rows: LiveQualityTrainingRow[]): Promise<Map<string, LiveQualityPlayerSummary>> {
  const playerMetaMap = await loadPlayerMetaMap(rows);
  const byPlayer = new Map<string, LiveQualityTrainingRow[]>();
  rows.forEach((row) => {
    const bucket = byPlayer.get(row.playerId) ?? [];
    bucket.push(row);
    byPlayer.set(row.playerId, bucket);
  });

  const summaries = new Map<string, LiveQualityPlayerSummary>();
  byPlayer.forEach((playerRows, playerId) => {
    summaries.set(playerId, {
      playerId,
      position: playerMetaMap.get(playerId)?.position ?? null,
      avgExpectedMinutes: mean(playerRows.map((row) => row.expectedMinutes)),
      avgStarterRate: mean(playerRows.map((row) => row.starterRateLast10)),
      ptsProjectionAvg: meanProjection(playerRows, "pointsProjection", (value) => round(value, 4)),
      rebProjectionAvg: meanProjection(playerRows, "reboundsProjection", (value) => round(value, 4)),
      astProjectionAvg: meanProjection(playerRows, "assistProjection", (value) => round(value, 4)),
      threesProjectionAvg: meanProjection(playerRows, "threesProjection", (value) => round(value, 4)),
    });
  });

  return summaries;
}

function applyRecentWeaknessRouterToEvaluatedRow(row: LiveQualityEvaluatedRow): LiveQualityEvaluatedRow {
  const routed = applyRecentWeaknessRouter({
    gameDateEt: row.gameDateEt,
    playerName: row.playerName,
    normalizedPlayerKey: row.normalizedPlayerKey,
    market: row.market,
    finalSource: row.finalSource,
    favoredSide: row.rawDecision.favoredSide,
    finalSide: row.finalSide,
    baselineSide: row.baselineSide,
    rawSide: row.rawSide,
    rawDecisionSide: row.rawDecision.rawSide,
    overProbability: row.rawDecision.overProbability,
    underProbability: row.rawDecision.underProbability,
    projectedValue: row.projectedValue,
    line: row.line,
    projectedMinutes: row.projectedMinutes,
    minutesVolatility: row.minutesVolatility,
    starterRateLast10: row.starterRateLast10,
    archetype: row.rawDecision.archetype,
    modelKind: row.rawDecision.modelKind,
    minutesBucket: row.rawDecision.minutesBucket,
    projectionMarketAgreement: row.rawDecision.projectionMarketAgreement,
    leafAccuracy: row.rawDecision.leafAccuracy,
    bucketLateAccuracy: row.rawDecision.bucketLateAccuracy,
    bucketModelAccuracy: row.rawDecision.bucketModelAccuracy,
    leafCount: row.rawDecision.leafCount,
    priceStrength: row.rawDecision.priceStrength,
    projectionWinProbability: row.rawDecision.projectionWinProbability,
    projectionPriceEdge: row.rawDecision.projectionPriceEdge,
  });
  if (!routed) return row;

  return {
    ...row,
    finalSide: routed.side,
    finalSource: routed.source,
    finalCorrect: routed.side === row.actualSide,
    overrideEngaged: routed.source !== "baseline",
    playerOverrideEngaged: routed.source === "player_override",
  };
}

export function evaluateRows(
  rows: LiveQualityTrainingRow[],
  summaries: Map<string, LiveQualityPlayerSummary>,
  settings: LiveUniversalQualificationSettings = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
): LiveQualityEvaluatedRow[] {
  return rows.map((row) => {
    const summary = summaries.get(row.playerId);
    const rawDecision = inspectLiveUniversalModelSide({
      gameDateEt: row.gameDateEt,
      market: row.market,
      projectedValue: row.projectedValue,
      line: row.line,
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      finalSide: row.finalSide,
      l5CurrentLineDeltaAvg: row.l5CurrentLineDeltaAvg ?? null,
      l5CurrentLineOverRate: row.l5CurrentLineOverRate ?? null,
      l5MinutesAvg: row.l5MinutesAvg ?? null,
      emaCurrentLineDelta: row.emaCurrentLineDelta ?? null,
      emaCurrentLineOverRate: row.emaCurrentLineOverRate ?? null,
      emaMinutesAvg: row.emaMinutesAvg ?? null,
      l15ValueMean: row.l15ValueMean ?? null,
      l15ValueMedian: row.l15ValueMedian ?? null,
      l15ValueStdDev: row.l15ValueStdDev ?? null,
      l15ValueSkew: row.l15ValueSkew ?? null,
      seasonMinutesAvg: row.seasonMinutesAvg ?? null,
      minutesLiftPct: row.minutesLiftPct ?? null,
      activeCorePts: row.activeCorePts ?? null,
      activeCoreAst: row.activeCoreAst ?? null,
      missingCorePts: row.missingCorePts ?? null,
      missingCoreAst: row.missingCoreAst ?? null,
      missingCoreShare: row.missingCoreShare ?? null,
      stepUpRoleFlag: row.stepUpRoleFlag ?? null,
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
      pointsProjection: rowProjectionOrSummary(row, "pointsProjection", summary?.ptsProjectionAvg ?? null),
      reboundsProjection: rowProjectionOrSummary(row, "reboundsProjection", summary?.rebProjectionAvg ?? null),
      assistProjection: rowProjectionOrSummary(row, "assistProjection", summary?.astProjectionAvg ?? null),
      threesProjection: rowProjectionOrSummary(row, "threesProjection", summary?.threesProjectionAvg ?? null),
    });

    const liveDecision = evaluateLiveUniversalModelSide(
      {
        gameDateEt: row.gameDateEt,
        market: row.market,
        projectedValue: row.projectedValue,
        line: row.line,
        overPrice: row.overPrice,
        underPrice: row.underPrice,
        finalSide: row.finalSide,
        l5CurrentLineDeltaAvg: row.l5CurrentLineDeltaAvg ?? null,
        l5CurrentLineOverRate: row.l5CurrentLineOverRate ?? null,
        l5MinutesAvg: row.l5MinutesAvg ?? null,
        emaCurrentLineDelta: row.emaCurrentLineDelta ?? null,
        emaCurrentLineOverRate: row.emaCurrentLineOverRate ?? null,
        emaMinutesAvg: row.emaMinutesAvg ?? null,
        l15ValueMean: row.l15ValueMean ?? null,
        l15ValueMedian: row.l15ValueMedian ?? null,
        l15ValueStdDev: row.l15ValueStdDev ?? null,
        l15ValueSkew: row.l15ValueSkew ?? null,
        seasonMinutesAvg: row.seasonMinutesAvg ?? null,
        minutesLiftPct: row.minutesLiftPct ?? null,
        activeCorePts: row.activeCorePts ?? null,
        activeCoreAst: row.activeCoreAst ?? null,
        missingCorePts: row.missingCorePts ?? null,
        missingCoreAst: row.missingCoreAst ?? null,
        missingCoreShare: row.missingCoreShare ?? null,
        stepUpRoleFlag: row.stepUpRoleFlag ?? null,
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
        pointsProjection: rowProjectionOrSummary(row, "pointsProjection", summary?.ptsProjectionAvg ?? null),
        reboundsProjection: rowProjectionOrSummary(row, "reboundsProjection", summary?.rebProjectionAvg ?? null),
        assistProjection: rowProjectionOrSummary(row, "assistProjection", summary?.astProjectionAvg ?? null),
        threesProjection: rowProjectionOrSummary(row, "threesProjection", summary?.threesProjectionAvg ?? null),
      },
      settings,
    );

    const playerOverrideSide = predictLivePlayerModelSide({
      playerName: row.playerName,
      market: row.market,
      projectedValue: row.projectedValue,
      line: row.line,
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      rawSide: rawDecision.rawSide,
      finalSide:
        liveDecision.side === "OVER" || liveDecision.side === "UNDER" ? liveDecision.side : row.finalSide,
      baselineSide: row.finalSide,
      expectedMinutes: row.expectedMinutes,
      minutesVolatility: row.minutesVolatility,
      starterRateLast10: row.starterRateLast10,
    });

    const strictRawSide: SnapshotModelSide =
      playerOverrideSide !== "NEUTRAL" ? playerOverrideSide : rawDecision.rawSide;
    const rawSide: SnapshotModelSide =
      strictRawSide === "OVER" || strictRawSide === "UNDER" ? strictRawSide : row.finalSide;
    const finalSide: Side =
      playerOverrideSide === "OVER" || playerOverrideSide === "UNDER"
        ? playerOverrideSide
        : liveDecision.side === "OVER" || liveDecision.side === "UNDER"
          ? liveDecision.side
          : row.finalSide;

    const finalSource: LiveQualityEvaluatedRow["finalSource"] =
      playerOverrideSide !== "NEUTRAL"
        ? "player_override"
        : liveDecision.side === "OVER" || liveDecision.side === "UNDER"
          ? "universal_qualified"
          : "baseline";

    return applyRecentWeaknessRouterToEvaluatedRow({
      rowKey: buildLiveQualityRowKey(row),
      playerId: row.playerId,
      playerName: row.playerName,
      teamId: row.teamId ?? null,
      teamCode: row.teamCode ?? null,
      externalGameId: row.externalGameId ?? null,
      normalizedPlayerKey: normalizeLivePlayerOverrideKey(row.playerName),
      market: row.market,
      gameDateEt: row.gameDateEt,
      projectedValue: row.projectedValue,
      actualValue: row.actualValue,
      line: row.line,
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      actualSide: row.actualSide,
      baselineSide: row.finalSide,
      rawSide,
      strictRawSide,
      finalSide,
      rawSource:
        playerOverrideSide !== "NEUTRAL" ? "player_override" : rawDecision.rawSide === "NEUTRAL" ? "baseline" : "universal_raw",
      strictRawSource:
        playerOverrideSide !== "NEUTRAL" ? "player_override" : rawDecision.rawSide === "NEUTRAL" ? "none" : "universal_raw",
      finalSource,
      rawCorrect: rawSide === row.actualSide,
      strictRawCorrect: strictRawSide === row.actualSide,
      finalCorrect: finalSide === row.actualSide,
      overrideEngaged: finalSource !== "baseline",
      playerOverrideEngaged: playerOverrideSide !== "NEUTRAL",
      rawDecision,
      liveDecision,
      playerOverrideSide,
      legacyUniversalRawCorrect: rawDecision.rawSide === row.actualSide,
      legacyUniversalFinalCorrect:
        (liveDecision.side === "OVER" || liveDecision.side === "UNDER" ? liveDecision.side : row.finalSide) === row.actualSide,
      projectedMinutes: row.expectedMinutes,
      minutesVolatility: row.minutesVolatility,
      starterRateLast10: row.starterRateLast10,
      lineGap: row.lineGap,
      absLineGap: row.absLineGap,
    });
  });
}

export function applyPromotedLivePraRawFeatureRows(
  baseRows: LiveQualityTrainingRow[],
  evaluatedRows: LiveQualityEvaluatedRow[],
): LiveQualityEvaluatedRow[] {
  const runtimeMeta = getLivePraRawFeatureRuntimeMeta();
  if (!runtimeMeta.enabled) {
    return evaluatedRows;
  }

  const baseRowsByKey = new Map(baseRows.map((row) => [buildLiveQualityRowKey(row), row]));
  return evaluatedRows.map((row) => {
    if (row.market !== "PRA" || row.playerOverrideEngaged) {
      return row;
    }

    const baseRow = baseRowsByKey.get(row.rowKey);
    if (!baseRow) return row;
    const baselineSide = baseRow.finalSide;
    const controlSide = row.rawSide === "OVER" || row.rawSide === "UNDER" ? row.rawSide : baselineSide;
    const universalSide =
      row.rawDecision.rawSide === "OVER" || row.rawDecision.rawSide === "UNDER" ? row.rawDecision.rawSide : null;
    const playerSide =
      row.playerOverrideSide === "OVER" || row.playerOverrideSide === "UNDER" ? row.playerOverrideSide : null;

    const selected = predictLivePraRawFeatureSide({
      market: "PRA",
      projectedValue: baseRow.projectedValue,
      line: baseRow.line,
      overPrice: baseRow.overPrice,
      underPrice: baseRow.underPrice,
      projectionSide: baseRow.projectionSide,
      baselineSide,
      controlSide,
      universalSide,
      playerSide,
      favoredSide: baseRow.favoredSide,
      archetype: row.rawDecision.archetype?.trim() || "UNKNOWN",
      modelKind: row.rawDecision.modelKind?.trim() || "UNKNOWN",
      expectedMinutes: baseRow.expectedMinutes,
      minutesVolatility: baseRow.minutesVolatility,
      starterRateLast10: baseRow.starterRateLast10,
      openingTeamSpread: baseRow.openingTeamSpread,
      openingTotal: baseRow.openingTotal,
      lineupTimingConfidence: baseRow.lineupTimingConfidence,
      completenessScore: baseRow.completenessScore,
      pointsProjection: baseRow.pointsProjection ?? null,
      reboundsProjection: baseRow.reboundsProjection ?? null,
      assistProjection: baseRow.assistProjection ?? null,
      threesProjection: baseRow.threesProjection ?? null,
      lineGap: baseRow.lineGap,
      absLineGap: baseRow.absLineGap,
    });

    if (!selected || !selected.changedFromControl) {
      return row;
    }

    const finalSource: LiveQualityEvaluatedRow["finalSource"] =
      selected.selectedSide === baselineSide ? "baseline" : "universal_qualified";

    return applyRecentWeaknessRouterToEvaluatedRow({
      ...row,
      rawSide: selected.selectedSide,
      strictRawSide: selected.selectedSide,
      finalSide: selected.selectedSide,
      rawSource: "universal_raw",
      strictRawSource: "universal_raw",
      finalSource,
      rawCorrect: selected.selectedSide === row.actualSide,
      strictRawCorrect: selected.selectedSide === row.actualSide,
      finalCorrect: selected.selectedSide === row.actualSide,
      overrideEngaged: finalSource !== "baseline",
    });
  });
}

function summarizeBucket(rows: LiveQualityEvaluatedRow[]): LiveQualityEvalBucket {
  const samples = rows.length;
  const qualifiedRows = rows.filter((row) => row.overrideEngaged);
  const rawCorrect = rows.filter((row) => row.rawCorrect).length;
  const strictRawCorrect = rows.filter((row) => row.strictRawCorrect).length;
  const finalCorrect = rows.filter((row) => row.finalCorrect).length;
  const qualifiedCorrect = qualifiedRows.filter((row) => row.finalCorrect).length;
  const legacyUniversalRawCorrect = rows.filter((row) => row.legacyUniversalRawCorrect).length;
  const legacyUniversalFinalCorrect = rows.filter((row) => row.legacyUniversalFinalCorrect).length;
  const legacyUniversalQualified = rows.filter((row) => row.liveDecision.side === "OVER" || row.liveDecision.side === "UNDER").length;

  return {
    samples,
    rawAccuracy: samples > 0 ? round((rawCorrect / samples) * 100, 2) : 0,
    strictRawAccuracy: samples > 0 ? round((strictRawCorrect / samples) * 100, 2) : 0,
    qualifiedAccuracy: qualifiedRows.length > 0 ? round((qualifiedCorrect / qualifiedRows.length) * 100, 2) : null,
    qualifiedPicks: qualifiedRows.length,
    coveragePct: samples > 0 ? round((qualifiedRows.length / samples) * 100, 2) : 0,
    blendedAccuracy: samples > 0 ? round((finalCorrect / samples) * 100, 2) : 0,
    legacyUniversalRawAccuracy: samples > 0 ? round((legacyUniversalRawCorrect / samples) * 100, 2) : 0,
    legacyUniversalBlendedAccuracy: samples > 0 ? round((legacyUniversalFinalCorrect / samples) * 100, 2) : 0,
    legacyUniversalCoveragePct: samples > 0 ? round((legacyUniversalQualified / samples) * 100, 2) : 0,
  };
}

export function summarizeEvaluatedRows(rows: LiveQualityEvaluatedRow[]): LiveQualityEvalSummary {
  return {
    overall: summarizeBucket(rows),
    byMarket: Object.fromEntries(
      LIVE_QUALITY_MARKETS.map((market) => [market, summarizeBucket(rows.filter((row) => row.market === market))]),
    ) as Record<Market, LiveQualityEvalBucket>,
  };
}

import modelArtifact from '@/exports/projection-115-live-quality-walkforward-playerday-results.json';

type RubbingHands115Lane = {
  accuracyPct: number | null;
  playerDays: number;
  correct: number;
  wrong: number;
  uniquePlayers: number;
  activeDates: number;
  avgPlayersPerSlate: number;
  last30AccuracyPct: number | null;
  last14AccuracyPct: number | null;
  rule: string;
};

type RubbingHands115PoolPlayer = {
  playerId: string;
  playerName: string;
  eligibleDays?: number;
  warmEligibleDays?: number;
  avgProjectedMinutes?: number;
  avgProjectionWinScore?: number;
  avgBucketLateAccuracy?: number;
  poolScore?: number;
};

type RubbingHands115Artifact = {
  generatedAt: string;
  source: string;
  playerPoolSize: number;
  qualityPlayerPool: RubbingHands115PoolPlayer[];
  best115: RubbingHands115Lane;
  best80Top115: RubbingHands115Lane & {
    threshold: number;
    coverageVsWalkForwardPlayerDaysPct: number;
  };
  best80Top115AllRecent?: (RubbingHands115Lane & {
    threshold: number;
    coverageVsWalkForwardPlayerDaysPct: number;
  }) | null;
  best90ResearchLane?: (RubbingHands115Lane & {
    threshold: number;
    coverageVsWalkForwardPlayerDaysPct: number;
    rankMax?: number;
    markets?: string[];
  }) | null;
  noExclusionSourceRouter?: (RubbingHands115Lane & {
    warmAccuracyPct?: number | null;
    coverageVsWalkForwardPlayerDaysPct?: number | null;
  }) | null;
};

const artifact = modelArtifact as RubbingHands115Artifact;

function normalizePlayerName(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type RubbingHands115ModelPlayer = RubbingHands115PoolPlayer & {
  qualityRank: number;
};

export const RUBBING_HANDS_115_MODEL_VERSION = 'projection-115-live-quality-walkforward-playerday-2026-04-26';
export const RUBBING_HANDS_115_MODEL_LABEL = '115-player quality model';
export const RUBBING_HANDS_115_MODEL_GENERATED_AT = artifact.generatedAt;
export const RUBBING_HANDS_115_MODEL_SOURCE = artifact.source;
export const RUBBING_HANDS_115_POOL_SIZE = artifact.playerPoolSize;
export const RUBBING_HANDS_115_PRIMARY_LANE = artifact.noExclusionSourceRouter ?? artifact.best115;
export const RUBBING_HANDS_115_WALK_FORWARD_LANE = artifact.best80Top115;
export const RUBBING_HANDS_115_ALL_WINDOW_LANE = artifact.best80Top115AllRecent ?? null;
export const RUBBING_HANDS_115_RESEARCH_LANE = artifact.best90ResearchLane ?? null;
export const RUBBING_HANDS_115_ALL_WINDOW_CONFIDENCE_PCT =
  ((RUBBING_HANDS_115_ALL_WINDOW_LANE ?? RUBBING_HANDS_115_WALK_FORWARD_LANE).threshold ?? 0.725) * 100;
export const RUBBING_HANDS_115_RESEARCH_CONFIDENCE_PCT =
  (RUBBING_HANDS_115_RESEARCH_LANE?.threshold ?? RUBBING_HANDS_115_ALL_WINDOW_CONFIDENCE_PCT / 100) * 100;
export const RUBBING_HANDS_115_RESEARCH_RANK_MAX = RUBBING_HANDS_115_RESEARCH_LANE?.rankMax ?? 35;
export const RUBBING_HANDS_115_RESEARCH_MARKETS = RUBBING_HANDS_115_RESEARCH_LANE?.markets ?? ['AST', 'PA', 'THREES'];

export const RUBBING_HANDS_115_QUALITY_POOL: RubbingHands115ModelPlayer[] = artifact.qualityPlayerPool.map(
  (player, index) => ({
    ...player,
    qualityRank: index + 1,
  }),
);

const playerById = new Map(RUBBING_HANDS_115_QUALITY_POOL.map((player) => [player.playerId, player] as const));
const playerByName = new Map(
  RUBBING_HANDS_115_QUALITY_POOL.map((player) => [normalizePlayerName(player.playerName), player] as const),
);

export function getRubbingHands115Player(input: {
  playerId: string | null | undefined;
  playerName?: string | null | undefined;
}) {
  const byId = input.playerId ? playerById.get(input.playerId) : null;
  if (byId) return byId;
  return playerByName.get(normalizePlayerName(input.playerName)) ?? null;
}

export function isRubbingHands115Player(input: {
  playerId: string | null | undefined;
  playerName?: string | null | undefined;
}) {
  return getRubbingHands115Player(input) != null;
}

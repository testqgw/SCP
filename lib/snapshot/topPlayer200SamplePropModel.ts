import modelArtifact from '@/exports/top-player-200-sample-prop-model-results.json';

type TopPlayer200Lane = {
  accuracyPct: number | null;
  playerDays: number;
  correct: number;
  wrong: number;
  runtimeFinalAccuracyPct?: number | null;
  runtimeFinalCorrect?: number;
  runtimeFinalWrong?: number;
  sideAgreementPct?: number | null;
  uniquePlayers: number;
  activeDates: number;
  avgPlayersPerSlate: number;
  last30AccuracyPct: number | null;
  last14AccuracyPct: number | null;
  threshold: number | null;
  rule: string;
};

type TopPlayer200PoolPlayer = {
  playerId: string;
  playerName: string;
  samples: number;
  activeDates: number;
  avgProjectedMinutes: number;
  marketsWithSamples: number;
  marketCounts: Partial<Record<string, number>>;
};

type TopPlayer200Artifact = {
  generatedAt: string;
  markets: string[];
  minSamples: number;
  topPlayerCount: number;
  qualifiedPlayerCount: number;
  primaryPlayerPool: TopPlayer200PoolPlayer[];
  primaryLane: TopPlayer200Lane;
  accuracyFirstLane: TopPlayer200Lane;
};

const artifact = modelArtifact as TopPlayer200Artifact;

function normalizePlayerName(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type TopPlayer200SampleModelPlayer = TopPlayer200PoolPlayer & {
  sampleRank: number;
};

export const TOP_PLAYER_200_SAMPLE_MODEL_LABEL = '200-sample top-player prop model';
export const TOP_PLAYER_200_SAMPLE_MODEL_GENERATED_AT = artifact.generatedAt;
export const TOP_PLAYER_200_SAMPLE_MARKETS = artifact.markets;
export const TOP_PLAYER_200_SAMPLE_MIN_SAMPLES = artifact.minSamples;
export const TOP_PLAYER_200_SAMPLE_POOL_SIZE = artifact.topPlayerCount;
export const TOP_PLAYER_200_SAMPLE_QUALIFIED_COUNT = artifact.qualifiedPlayerCount;
export const TOP_PLAYER_200_SAMPLE_PRIMARY_LANE = artifact.primaryLane;
export const TOP_PLAYER_200_SAMPLE_ACCURACY_FIRST_LANE = artifact.accuracyFirstLane;
export const TOP_PLAYER_200_SAMPLE_RUNTIME_ACCURACY_PCT =
  artifact.primaryLane.runtimeFinalAccuracyPct ?? artifact.primaryLane.accuracyPct;
export const TOP_PLAYER_200_SAMPLE_CONFIDENCE_PCT = (artifact.primaryLane.threshold ?? 0.84) * 100;

export const TOP_PLAYER_200_SAMPLE_POOL: TopPlayer200SampleModelPlayer[] = artifact.primaryPlayerPool.map(
  (player, index) => ({
    ...player,
    sampleRank: index + 1,
  }),
);

const playerById = new Map(TOP_PLAYER_200_SAMPLE_POOL.map((player) => [player.playerId, player] as const));
const playerByName = new Map(
  TOP_PLAYER_200_SAMPLE_POOL.map((player) => [normalizePlayerName(player.playerName), player] as const),
);

export function getTopPlayer200SamplePropPlayer(input: {
  playerId: string | null | undefined;
  playerName?: string | null | undefined;
}) {
  const byId = input.playerId ? playerById.get(input.playerId) : null;
  if (byId) return byId;
  return playerByName.get(normalizePlayerName(input.playerName)) ?? null;
}

export function isTopPlayer200SamplePropPlayer(input: {
  playerId: string | null | undefined;
  playerName?: string | null | undefined;
}) {
  return getTopPlayer200SamplePropPlayer(input) != null;
}

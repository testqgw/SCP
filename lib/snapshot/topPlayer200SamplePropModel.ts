import modelArtifact from '@/exports/top-player-200-sample-prop-model-results.json';
import currentSlateScoresArtifact from '@/exports/top-player-200-sample-current-slate-scores.json';

type TopPlayer200Lane = {
  label?: string;
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
  topOverall80Lanes?: TopPlayer200Lane[];
  widestOverall80Lane?: TopPlayer200Lane;
};

const artifact = modelArtifact as TopPlayer200Artifact;

type TopPlayer200CurrentSlateScore = {
  dateEt: string;
  playerId: string;
  playerName: string;
  market: string;
  wfProbOver: number;
  wfConfidence: number;
  wfSide: 'OVER' | 'UNDER';
  runtimeFinalSide?: 'OVER' | 'UNDER' | 'NEUTRAL';
  line: number | null;
  projectedValue: number | null;
  absLineGap: number | null;
  sportsbookCount: number | null;
};

type TopPlayer200CurrentSlateScoresArtifact = {
  generatedAt: string;
  dateEt: string;
  source: string;
  rows: TopPlayer200CurrentSlateScore[];
};

const currentScoresArtifact = currentSlateScoresArtifact as TopPlayer200CurrentSlateScoresArtifact;

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
export const TOP_PLAYER_200_SAMPLE_VOLUME_LANE =
  artifact.topOverall80Lanes?.find(
    (lane) => lane.label === `top${artifact.topPlayerCount}_sample_count` && lane.threshold === 0.8,
  ) ??
  artifact.widestOverall80Lane ??
  artifact.primaryLane;
export const TOP_PLAYER_200_SAMPLE_RUNTIME_ACCURACY_PCT =
  artifact.primaryLane.runtimeFinalAccuracyPct ?? artifact.primaryLane.accuracyPct;
export const TOP_PLAYER_200_SAMPLE_CONFIDENCE_PCT = (artifact.primaryLane.threshold ?? 0.84) * 100;
export const TOP_PLAYER_200_SAMPLE_VOLUME_RUNTIME_ACCURACY_PCT =
  TOP_PLAYER_200_SAMPLE_VOLUME_LANE.runtimeFinalAccuracyPct ?? TOP_PLAYER_200_SAMPLE_VOLUME_LANE.accuracyPct;
export const TOP_PLAYER_200_SAMPLE_VOLUME_CONFIDENCE_PCT =
  (TOP_PLAYER_200_SAMPLE_VOLUME_LANE.threshold ?? 0.8) * 100;
export const TOP_PLAYER_200_SAMPLE_CURRENT_SLATE_GENERATED_AT = currentScoresArtifact.generatedAt;
export const TOP_PLAYER_200_SAMPLE_CURRENT_SLATE_DATE_ET = currentScoresArtifact.dateEt;

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
const currentScoreByPlayerMarket = new Map(
  currentScoresArtifact.rows.map((row) => [`${row.playerId}:${row.market}`, row] as const),
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

export function getTopPlayer200SampleCurrentSlateScore(input: {
  dateEt: string | null | undefined;
  playerId: string | null | undefined;
  market: string | null | undefined;
}) {
  if (!input.dateEt || input.dateEt !== currentScoresArtifact.dateEt || !input.playerId || !input.market) return null;
  return currentScoreByPlayerMarket.get(`${input.playerId}:${input.market}`) ?? null;
}

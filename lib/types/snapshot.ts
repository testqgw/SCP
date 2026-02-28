export type SnapshotMarket = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";

export type SnapshotStatLog = {
  gameDateEt: string;
  opponent: string | null;
  isHome: boolean | null;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  steals: number;
  blocks: number;
};

export type SnapshotMetricRecord = Record<SnapshotMarket, number | null>;

export type SnapshotTeammateCore = {
  playerId: string;
  playerName: string;
  position: string | null;
  avgMinutesLast10: number | null;
  avgPRA10: number | null;
  avgAST10: number | null;
};

export type SnapshotPrimaryDefender = {
  playerId: string;
  playerName: string;
  position: string | null;
  avgMinutesLast10: number | null;
  stocksPer36Last10: number | null;
  matchupReason: string;
};

export type SnapshotPlayerContext = {
  archetype: string;
  projectedStarter: string;
  rotationRank: number | null;
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesTrend: number | null;
  minutesVolatility: number | null;
  primaryDefender: SnapshotPrimaryDefender | null;
  teammateCore: SnapshotTeammateCore[];
};

export type SnapshotRow = {
  playerId: string;
  playerName: string;
  position: string | null;
  teamCode: string;
  opponentCode: string;
  matchupKey: string;
  isHome: boolean;
  gameTimeEt: string;
  last5: Record<SnapshotMarket, number[]>;
  last10: Record<SnapshotMarket, number[]>;
  last3Average: SnapshotMetricRecord;
  last10Average: SnapshotMetricRecord;
  seasonAverage: Record<SnapshotMarket, number | null>;
  homeAwayAverage: SnapshotMetricRecord;
  trendVsSeason: SnapshotMetricRecord;
  opponentAllowance: SnapshotMetricRecord;
  opponentAllowanceDelta: SnapshotMetricRecord;
  recentLogs: SnapshotStatLog[];
  playerContext: SnapshotPlayerContext;
};

export type SnapshotMatchupOption = {
  key: string;
  awayTeam: string;
  homeTeam: string;
  gameTimeEt: string;
  label: string;
};

export type SnapshotTeamRecord = {
  wins: number;
  losses: number;
};

export type SnapshotTeamMatchupStats = {
  matchupKey: string;
  awayTeam: string;
  homeTeam: string;
  gameTimeEt: string;
  awaySeasonFor: SnapshotMetricRecord;
  awaySeasonAllowed: SnapshotMetricRecord;
  awayLast10For: SnapshotMetricRecord;
  awayLast10Allowed: SnapshotMetricRecord;
  awaySeasonRecord: SnapshotTeamRecord;
  awayLast10Record: SnapshotTeamRecord;
  homeSeasonFor: SnapshotMetricRecord;
  homeSeasonAllowed: SnapshotMetricRecord;
  homeLast10For: SnapshotMetricRecord;
  homeLast10Allowed: SnapshotMetricRecord;
  homeSeasonRecord: SnapshotTeamRecord;
  homeLast10Record: SnapshotTeamRecord;
};

export type SnapshotBoardData = {
  dateEt: string;
  lastUpdatedAt: string | null;
  matchups: SnapshotMatchupOption[];
  teamMatchups: SnapshotTeamMatchupStats[];
  rows: SnapshotRow[];
};

export type SnapshotMarket = "PTS" | "REB" | "AST" | "THREES";

export type SnapshotStatLog = {
  gameDateEt: string;
  opponent: string | null;
  isHome: boolean | null;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
};

export type SnapshotMetricRecord = Record<SnapshotMarket, number | null>;

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
};

export type SnapshotMatchupOption = {
  key: string;
  awayTeam: string;
  homeTeam: string;
  gameTimeEt: string;
  label: string;
};

export type SnapshotBoardData = {
  dateEt: string;
  lastUpdatedAt: string | null;
  matchups: SnapshotMatchupOption[];
  rows: SnapshotRow[];
};

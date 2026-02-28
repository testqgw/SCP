export type SnapshotMarket = "PTS" | "REB" | "AST" | "THREES";

export type SnapshotStatLog = {
  gameDateEt: string;
  opponent: string | null;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
};

export type SnapshotRow = {
  playerId: string;
  playerName: string;
  position: string | null;
  teamCode: string;
  opponentCode: string;
  gameTimeEt: string;
  last5: Record<SnapshotMarket, number[]>;
  seasonAverage: Record<SnapshotMarket, number | null>;
  recentLogs: SnapshotStatLog[];
};

export type SnapshotTeamOption = {
  code: string;
  label: string;
};

export type SnapshotBoardData = {
  dateEt: string;
  lastUpdatedAt: string | null;
  teams: SnapshotTeamOption[];
  rows: SnapshotRow[];
};

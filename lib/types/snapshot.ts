export type Market =
  | "PTS"
  | "REB"
  | "AST"
  | "THREES"
  | "PRA"
  | "PA"
  | "PR"
  | "RA"
  | "STL"
  | "BLK"
  | "TOV"
  | "DOUBLE_DOUBLE"
  | "TRIPLE_DOUBLE";

export type Confidence = "A" | "B" | "C";
export type SportsbookCode = string;
export type RecommendedSide = "OVER" | "UNDER";
export type QualityStatus = "OK" | "BLOCKED";

export type SnapshotRow = {
  playerId: string;
  edgeId: string;
  playerName: string;
  team: string;
  opponent: string;
  teamCodeCanonical: string;
  opponentCodeCanonical: string;
  gameTimeEt: string;
  sportsbook: SportsbookCode;
  sportsbookName: string;
  market: Market;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  recommendedSide: RecommendedSide;
  edgeScore: number;
  confidence: Confidence;
  last5OverRate: number;
  bounceBackFlag: boolean;
  opponentAllowanceDelta: number;
  archetypeKey: string;
  lineMove24h: number;
  dataSource: string | null;
  updatedAt: string;
};

export type SnapshotTodayResponse = {
  lastUpdatedAt: string | null;
  stale: boolean;
  total: number;
  qualityStatus: QualityStatus;
  qualityIssues: string[];
  publishableRunId: string | null;
  rows: SnapshotRow[];
};

export type SnapshotDetailResponse = {
  playerId: string;
  playerName: string;
  position: string | null;
  team: string | null;
  markets: Array<{
    edgeId: string;
    market: Market;
    sportsbook: SportsbookCode;
    sportsbookName: string;
    line: number;
    recommendedSide: RecommendedSide;
    edgeScore: number;
    confidence: Confidence | "LOW";
    componentScores: Record<string, number>;
    last5OverRate: number;
    bounceBackFlag: boolean;
    opponentAllowanceDelta: number;
    archetypeKey: string;
    lineMove24h: number;
    updatedAt: string;
  }>;
  trends: {
    last10: Array<{
      gameDateEt: string;
      opponent: string | null;
      isHome: boolean | null;
      points: number | null;
      rebounds: number | null;
      assists: number | null;
      threes: number | null;
      steals: number | null;
      blocks: number | null;
      turnovers: number | null;
      minutes: number | null;
    }>;
    homeAwaySplit: {
      homeAveragePoints: number | null;
      awayAveragePoints: number | null;
      homeGames: number;
      awayGames: number;
    };
  };
};

export type SnapshotFiltersResponse = {
  dateEt: string;
  teams: Array<{
    code: string;
    providerCode: string;
    label: string;
  }>;
  books: Array<{
    key: string;
    name: string;
  }>;
  markets: Market[];
  qualityStatus: QualityStatus;
  qualityIssues: string[];
  lastUpdatedAt: string | null;
};

export type TodayFilter = {
  dateEt: string;
  market?: Market[];
  book?: SportsbookCode[];
  team?: string;
  confidence?: Confidence[];
  player?: string;
  includeLowConfidence?: boolean;
  limit: number;
  offset: number;
};

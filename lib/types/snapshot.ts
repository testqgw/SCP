export type SnapshotMarket = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";

export type SnapshotStatLog = {
  gameDateEt: string;
  teamCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
  starter: boolean | null;
  played: boolean | null;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  steals: number;
  blocks: number;
};

export type SnapshotMetricRecord = Record<SnapshotMarket, number | null>;

export type SnapshotModelSide = "OVER" | "UNDER" | "NEUTRAL";

export type SnapshotModelLine = {
  fairLine: number | null;
  modelSide: SnapshotModelSide;
  projectionGap: number | null;
  actionOverLine: number | null;
  actionUnderLine: number | null;
  actionBuffer: number | null;
  volatility: number | null;
};

export type SnapshotModelLineRecord = Record<SnapshotMarket, SnapshotModelLine>;

export type SnapshotPtsConfidenceTier = "HIGH" | "MEDIUM" | "LOW";

export type SnapshotPtsQualifiedRule = {
  minConfidence: number;
  maxMinutesRisk: number;
  minProjectionGap: number;
  blockOverWhenFavoriteBy: number;
};

export type SnapshotPtsSignal = {
  marketLine: number | null;
  sportsbookCount: number;
  side: SnapshotModelSide;
  confidence: number | null;
  confidenceTier: SnapshotPtsConfidenceTier | null;
  projectionGap: number | null;
  minutesRisk: number | null;
  lineupTimingConfidence: number | null;
  qualified: boolean;
  passReasons: string[];
  rule: SnapshotPtsQualifiedRule;
};

export type SnapshotRebSignal = SnapshotPtsSignal;
export type SnapshotAstSignal = SnapshotPtsSignal;
export type SnapshotThreesSignal = SnapshotPtsSignal;
export type SnapshotPraSignal = SnapshotPtsSignal;
export type SnapshotPaSignal = SnapshotPtsSignal;
export type SnapshotPrSignal = SnapshotPtsSignal;
export type SnapshotRaSignal = SnapshotPtsSignal;

export type SnapshotCompletenessTier = "HIGH" | "MEDIUM" | "LOW";

export type SnapshotDataCompleteness = {
  score: number;
  tier: SnapshotCompletenessTier;
  issues: string[];
  components: {
    sampleCoverage: number;
    statusCoverage: number;
    contextCoverage: number;
    stabilityCoverage: number;
  };
};

export type SnapshotIntelStatus = "LIVE" | "DERIVED" | "PENDING";

export type SnapshotIntelItem = {
  label: string;
  value: string;
  hint?: string;
};

export type SnapshotIntelModule = {
  id: string;
  title: string;
  description: string;
  status: SnapshotIntelStatus;
  items: SnapshotIntelItem[];
};

export type SnapshotGameIntel = {
  generatedAt: string;
  modules: SnapshotIntelModule[];
};

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
  startedLastGame: boolean | null;
  startsLast10: number;
  starterRateLast10: number | null;
  rotationRank: number | null;
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesCurrentTeamAvg: number | null;
  minutesCurrentTeamGames: number;
  minutesTrend: number | null;
  minutesVolatility: number | null;
  projectedMinutes: number | null;
  projectedMinutesFloor: number | null;
  projectedMinutesCeiling: number | null;
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
  projectedTonight: SnapshotMetricRecord;
  modelLines: SnapshotModelLineRecord;
  ptsSignal: SnapshotPtsSignal | null;
  rebSignal: SnapshotRebSignal | null;
  astSignal: SnapshotAstSignal | null;
  threesSignal: SnapshotThreesSignal | null;
  praSignal: SnapshotPraSignal | null;
  paSignal: SnapshotPaSignal | null;
  prSignal: SnapshotPrSignal | null;
  raSignal: SnapshotRaSignal | null;
  recentLogs: SnapshotStatLog[];
  analysisLogs: SnapshotStatLog[];
  dataCompleteness: SnapshotDataCompleteness;
  playerContext: SnapshotPlayerContext;
  gameIntel: SnapshotGameIntel;
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

export type SnapshotPlayerLookupData = {
  requestedDateEt: string;
  resolvedDateEt: string;
  note: string | null;
  row: SnapshotRow;
};

export type SnapshotPlayerBacktestSampleSummary = {
  games: number;
  correct: number;
  wrong: number;
  accuracyPct: number | null;
  averageLine: number | null;
  averageProjection: number | null;
  from: string | null;
  to: string | null;
};

export type SnapshotPlayerBacktestGameRow = {
  gameDateEt: string;
  matchupKey: string;
  bookPtsLine: number | null;
  lineSource: string | null;
  projectedPts: number | null;
  predictedSide: SnapshotModelSide | null;
  actualPts: number | null;
  actualSide: SnapshotModelSide | "PUSH" | null;
  correct: boolean | null;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  ptsSideConfidence: number | null;
  ptsOverScore: number | null;
  ptsUnderScore: number | null;
  ptsMinutesRisk: number | null;
  lineupTimingConfidence: number | null;
  ptsQualifiedBet: boolean | null;
};

export type SnapshotPlayerBacktestReport = {
  playerName: string;
  reportPath: string;
  sheetPath: string | null;
  holdoutRatio: number;
  fullSample: SnapshotPlayerBacktestSampleSummary;
  trainingSample: SnapshotPlayerBacktestSampleSummary;
  holdoutSample: SnapshotPlayerBacktestSampleSummary;
  games: SnapshotPlayerBacktestGameRow[];
};

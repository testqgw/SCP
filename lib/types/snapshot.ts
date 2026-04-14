import type { LineupStatus, RotowireAvailabilityStatus } from "@/lib/lineups/rotowire";

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
  baselineSide: SnapshotModelSide;
  confidence: number | null;
  confidenceTier: SnapshotPtsConfidenceTier | null;
  projectionGap: number | null;
  minutesRisk: number | null;
  lineupTimingConfidence: number | null;
  qualified: boolean;
  passReasons: string[];
  rule: SnapshotPtsQualifiedRule;
};

export type SnapshotAstSignal = SnapshotPtsSignal;
export type SnapshotRebSignal = SnapshotPtsSignal;
export type SnapshotThreesSignal = SnapshotPtsSignal;
export type SnapshotPraSignal = SnapshotPtsSignal;
export type SnapshotPaSignal = SnapshotPtsSignal;
export type SnapshotPrSignal = SnapshotPtsSignal;
export type SnapshotRaSignal = SnapshotPtsSignal;

export type SnapshotPrecisionPickSignal = {
  side: SnapshotModelSide;
  qualified?: boolean;
  historicalAccuracy: number;
  historicalPicks: number;
  historicalCoveragePct?: number;
  bucketRecentAccuracy: number | null;
  leafAccuracy: number | null;
  absLineGap: number | null;
  projectionWinProbability: number | null;
  projectionPriceEdge?: number | null;
  selectionScore?: number | null;
  selectorFamily?: string | null;
  selectorTier?: string | null;
  reasons?: string[];
};

export type SnapshotPrecisionCardSource = "PRECISION";

export type SnapshotPrecisionCardEntry = {
  playerId: string;
  market: SnapshotMarket;
  source: SnapshotPrecisionCardSource;
  rank: number;
  selectionScore: number | null;
  lockedLine?: number | null;
  precisionSignal?: SnapshotPrecisionPickSignal | null;
};

export type SnapshotPrecisionCardSummary = {
  targetCardCount: number;
  truePickCount: number;
  fillCount: number;
  selectedCount: number;
};

export type SnapshotPrecisionSystemSummary = {
  label: string;
  historicalAccuracy: number;
  historicalPicks: number;
  historicalCoveragePct: number;
  historicalPicksPerDay?: number;
  supportedMarkets: SnapshotMarket[];
  accuracyLabel?: string;
  picksPerDayLabel?: string;
  note?: string;
  targetCardCount?: number;
  allowFill?: boolean;
};

export type SnapshotPrecisionAuditStatus = "ACTIVE" | "LOCKED" | "SETTLED";

export type SnapshotPrecisionAuditOutcome = "WIN" | "LOSS" | "PUSH";

export type SnapshotPrecisionAuditEntry = {
  playerId: string;
  market: SnapshotMarket;
  line: number | null;
  actualValue: number | null;
  status: SnapshotPrecisionAuditStatus;
  outcome: SnapshotPrecisionAuditOutcome | null;
};

export type SnapshotPrecisionDashboard = {
  label: string;
  note: string;
  auditNote: string;
  promotedCount: number;
  qualifiedCount: number;
  activeCount: number;
  lockedCount: number;
  pendingCount: number;
  settledCount: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number | null;
  units: number | null;
  roiPct: number | null;
  averageConfidence: number | null;
  averageBooksLive: number | null;
  entries: SnapshotPrecisionAuditEntry[];
};

export type SnapshotUniversalSystemSummary = {
  label: string;
  replayRawAccuracy: number;
  replayQualifiedAccuracy: number | null;
  replayBlendedAccuracy: number;
  replayCoveragePct: number;
  walkForwardRawAccuracy: number;
  walkForwardQualifiedAccuracy: number | null;
  walkForwardBlendedAccuracy: number;
  walkForwardCoveragePct: number;
  note?: string;
};

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
  lineupStatus: LineupStatus | null;
  lineupStarter: boolean | null;
  availabilityStatus: RotowireAvailabilityStatus | null;
  availabilityPercentPlay: number | null;
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
  detailLevel?: "BOARD" | "FULL";
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
  rebSignal: SnapshotPtsSignal | null;
  astSignal: SnapshotPtsSignal | null;
  threesSignal: SnapshotPtsSignal | null;
  praSignal: SnapshotPtsSignal | null;
  paSignal: SnapshotPtsSignal | null;
  prSignal: SnapshotPtsSignal | null;
  raSignal: SnapshotPtsSignal | null;
  precisionSignals?: Partial<Record<SnapshotMarket, SnapshotPrecisionPickSignal>>;
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
  precisionCard?: SnapshotPrecisionCardEntry[];
  precisionCardSummary?: SnapshotPrecisionCardSummary | null;
  precisionSystem?: SnapshotPrecisionSystemSummary | null;
  precisionDashboard?: SnapshotPrecisionDashboard | null;
  universalSystem?: SnapshotUniversalSystemSummary | null;
  boardFeed?: SnapshotBoardFeed | null;
};

export type SnapshotBoardFeedEventType =
  | "SURFACED"
  | "MOVED"
  | "STRENGTHENED"
  | "WEAKENED"
  | "DROPPED"
  | "LOCKED";

export type SnapshotBoardFeedStatus = "PREGAME" | "LOCKED" | "FINAL";

export type SnapshotBoardFeedItem = {
  id: string;
  createdAt: string;
  eventType: SnapshotBoardFeedEventType;
  status: SnapshotBoardFeedStatus;
  title: string;
  detail: string;
  playerId: string;
  playerName: string;
  matchupKey: string;
  gameTimeEt: string;
  market: SnapshotMarket;
  recommendation: string;
  side: SnapshotModelSide;
  line: number | null;
  fairLine: number | null;
  projection: number | null;
  gap: number | null;
  confidence: number | null;
  booksLive: number | null;
  rank: number | null;
};

export type SnapshotBoardFeed = {
  label: string;
  note: string;
  events: SnapshotBoardFeedItem[];
};

export type SnapshotDashboardSignal = Pick<
  SnapshotPtsSignal,
  "marketLine" | "sportsbookCount" | "side" | "confidence" | "passReasons"
>;

export type SnapshotDashboardPrecisionSignal = Pick<
  SnapshotPrecisionPickSignal,
  | "side"
  | "qualified"
  | "historicalAccuracy"
  | "projectionWinProbability"
  | "projectionPriceEdge"
  | "selectionScore"
  | "selectorFamily"
  | "selectorTier"
  | "reasons"
>;

export type SnapshotDashboardModelLine = Pick<SnapshotModelLine, "fairLine" | "modelSide">;

export type SnapshotDashboardModelLineRecord = Record<SnapshotMarket, SnapshotDashboardModelLine>;

export type SnapshotDashboardDataCompleteness = Pick<SnapshotDataCompleteness, "score" | "tier">;

export type SnapshotDashboardPrimaryDefender = Pick<SnapshotPrimaryDefender, "playerName" | "matchupReason">;

export type SnapshotDashboardTeammateCore = Pick<
  SnapshotTeammateCore,
  "playerId" | "playerName" | "avgMinutesLast10"
>;

export type SnapshotDashboardPlayerContext = Pick<
  SnapshotPlayerContext,
  | "projectedStarter"
  | "lineupStatus"
  | "rotationRank"
  | "minutesTrend"
  | "minutesVolatility"
  | "projectedMinutes"
  | "projectedMinutesFloor"
  | "projectedMinutesCeiling"
> & {
  primaryDefender: SnapshotDashboardPrimaryDefender | null;
  teammateCore: SnapshotDashboardTeammateCore[];
};

export type SnapshotDashboardGameIntel = Pick<SnapshotGameIntel, "generatedAt">;

export type SnapshotDashboardRow = Pick<
  SnapshotRow,
  | "playerId"
  | "playerName"
  | "position"
  | "teamCode"
  | "opponentCode"
  | "matchupKey"
  | "gameTimeEt"
  | "last5"
  | "last10Average"
  | "seasonAverage"
  | "trendVsSeason"
  | "opponentAllowanceDelta"
  | "projectedTonight"
> & {
  modelLines: SnapshotDashboardModelLineRecord;
  ptsSignal: SnapshotDashboardSignal | null;
  rebSignal: SnapshotDashboardSignal | null;
  astSignal: SnapshotDashboardSignal | null;
  threesSignal: SnapshotDashboardSignal | null;
  praSignal: SnapshotDashboardSignal | null;
  paSignal: SnapshotDashboardSignal | null;
  prSignal: SnapshotDashboardSignal | null;
  raSignal: SnapshotDashboardSignal | null;
  precisionSignals?: Partial<Record<SnapshotMarket, SnapshotDashboardPrecisionSignal>>;
  dataCompleteness: SnapshotDashboardDataCompleteness;
  playerContext: SnapshotDashboardPlayerContext;
  gameIntel: SnapshotDashboardGameIntel;
};

export type SnapshotBoardViewData = Omit<SnapshotBoardData, "rows"> & {
  rows: SnapshotDashboardRow[];
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

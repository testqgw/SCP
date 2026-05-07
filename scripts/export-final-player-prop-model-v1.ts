import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

type Side = "OVER" | "UNDER";
type Tier = "S" | "A" | "B" | "C" | "D";
type Mode = "PREVIEW" | "LOCK_REQUESTED_NO_LEDGER";
type ModelAction = "SELECTED" | "CANDIDATE" | "COVERAGE";

type Args = {
  scoresInput: string;
  modelInput: string;
  precisionInput: string;
  v9Input: string;
  outDir: string;
  maxPicks: number;
  minScore: number;
  lockRequested: boolean;
};

type TopPlayerPoolPlayer = {
  playerId: string;
  playerName: string;
};

type LaneMetric = {
  label?: string;
  accuracyPct?: number | null;
  runtimeFinalAccuracyPct?: number | null;
  playerDays?: number;
  correct?: number;
  wrong?: number;
  last30AccuracyPct?: number | null;
  last14AccuracyPct?: number | null;
  threshold?: number | null;
  rule?: string;
};

type TopPlayerModelArtifact = {
  generatedAt: string;
  minSamples: number;
  topPlayerCount: number;
  qualifiedPlayerCount: number;
  qualifiedPlayerPool?: TopPlayerPoolPlayer[];
  primaryPlayerPool: TopPlayerPoolPlayer[];
  primaryLane: LaneMetric;
  accuracyFirstLane?: LaneMetric;
  premiumPtsOverLane?: LaneMetric;
  expandedPremium90Lane?: LaneMetric & {
    pockets?: string[];
    topPlayerPocketPoolSize?: number;
    tailPlayerPocketPoolSize?: number;
  };
  coverageFrontierLane?: LaneMetric;
  recentFormLane?: LaneMetric;
};

type CurrentSlateScore = {
  dateEt: string;
  playerId: string;
  playerName: string;
  teamCode?: string | null;
  opponentCode?: string | null;
  matchupKey?: string | null;
  gameTimeEt?: string | null;
  market: string;
  wfProbOver: number | null;
  wfConfidence: number | null;
  wfSide: Side | "NEUTRAL" | string;
  metaProbCorrect?: number | null;
  runtimeFinalSide?: Side | "NEUTRAL" | string | null;
  runtimeFinalSource?: string | null;
  projectionSide?: Side | "NEUTRAL" | string | null;
  line: number | null;
  projectedValue: number | null;
  lineGap?: number | null;
  absLineGap: number | null;
  projectedMinutes?: number | null;
  priorMarketSourceSideAcc?: number | null;
  priorMarketFinalSideAcc?: number | null;
  sportsbookCount: number | null;
};

type CurrentSlateScoresArtifact = {
  generatedAt: string;
  generatedAtUtc?: string;
  dateEt: string;
  firstGameTimeEt?: string | null;
  scheduledGameTimesEt?: string[];
  source: string;
  metaExpandedLane?: {
    label: string;
    accuracyPct: number;
    playerDays: number;
    last30AccuracyPct: number;
    last14AccuracyPct: number;
    activeDates: number;
    avgPlayersPerSlate: number;
    metaThreshold: number;
    minWfConfidence: number;
    rule: string;
  };
  rows: CurrentSlateScore[];
};

type PrecisionLockedResults = {
  summary?: {
    overall?: {
      picks?: number;
      correct?: number;
      accuracy?: number;
    };
    last30?: {
      accuracy?: number;
    };
    last14?: {
      accuracy?: number;
    };
    picksPerDay?: number;
  };
};

type V9Eval = {
  generatedAt?: string;
  jointFeasibility?: {
    enabled?: boolean;
    vetoedRows?: number;
    conflictPairs?: number;
    settings?: Record<string, unknown>;
  };
  overall?: {
    samples?: number;
    blendedAccuracy?: number;
    qualifiedAccuracy?: number;
    qualifiedPicks?: number;
  };
};

type ComponentId =
  | "top200_premium_90"
  | "top200_premium_pts_over"
  | "top200_accuracy_first"
  | "top200_meta_reliability"
  | "top200_coverage_frontier"
  | "top200_recent_form_fade"
  | "top200_primary"
  | "precision_parlay_v1"
  | "live_quality_router_v9";

type ComponentEvidence = {
  id: ComponentId;
  role: "candidate_source" | "portfolio_advisor" | "quality_router";
  label: string;
  accuracyPct: number | null;
  playerDays: number | null;
  last30AccuracyPct: number | null;
  last14AccuracyPct: number | null;
  rule: string;
};

type CandidateComponent = {
  id: ComponentId;
  label: string;
  accuracyPct: number | null;
  playerDays: number | null;
};

type PocketSpec = {
  label: string;
  pool: "top200" | "tail200plus";
  market: string;
  source?: string;
  finalSide: Side;
  wfAgreement?: boolean;
  wfSide?: Side;
  projectionSide?: Side;
  absGap?: [number, number];
  absGapMax?: number;
  minutes?: [number, number];
  line?: [number, number];
  wfConfidence?: [number, number];
  priorSourceSideAcc?: [number, number];
  priorFinalSideAcc?: [number, number];
};

type Candidate = {
  candidate_id: string;
  slate_date: string;
  player_id: string;
  player: string;
  team: string | null;
  opponent: string | null;
  matchup_key: string | null;
  game_time_et: string | null;
  market: string;
  side: Side;
  line: number | null;
  projected_value: number | null;
  line_gap: number | null;
  abs_line_gap: number | null;
  wf_confidence: number | null;
  wf_prob_over: number | null;
  meta_prob_correct: number | null;
  projected_minutes: number | null;
  sportsbook_count: number | null;
  runtime_final_source: string | null;
  projection_side: string | null;
  tier: Tier;
  model_action: ModelAction;
  source_components: CandidateComponent[];
  premium_pockets: string[];
  estimated_accuracy_prior_pct: number | null;
  base_score: number;
  correlation_penalty: number;
  final_score: number;
  selected_rank: number | null;
  risk_flags: string[];
  reasons: string[];
  rejection_reason: string | null;
};

type FinalModelCard = {
  generatedAt: string;
  modelId: "final-player-prop-model-v1";
  modelName: "Final Correlation-Aware Player Prop Model V1";
  modelVersion: typeof MODEL_VERSION;
  mode: Mode;
  slateDate: string;
  currentDateEt: string;
  claimBoundary: string;
  sourceArtifacts: Record<string, string | null>;
  componentEvidence: ComponentEvidence[];
  portfolioConfig: {
    maxPicks: number;
    minScore: number;
    maxPerPlayer: number;
    maxPerTeam: number;
    maxPerGame: number;
    maxPerMarket: number;
    maxSameTeamCountingOvers: number;
    maxComboMarkets: number;
    forceFill: false;
  };
  summary: {
    totalBoardRows: number;
    scoredBoardRows: number;
    boardCoveragePct: number;
    candidateCount: number;
    selectedCount: number;
    selectedByTier: Record<string, number>;
    boardRowsByTier: Record<string, number>;
    boardRowsByAction: Record<string, number>;
    averageEstimatedAccuracyPriorPct: number | null;
    averageFinalScore: number | null;
    correlationMultiplier: number;
    warningCount: number;
  };
  warnings: string[];
  boardRows: Candidate[];
  selectedPicks: Candidate[];
  watchlist: Candidate[];
  rejectedTop: Candidate[];
};

const MODEL_ID = "final-player-prop-model-v1";
const MODEL_VERSION = "2026-05-07-projection-confidence-v2" as const;
const COUNTING_OVER_MARKETS = new Set(["PTS", "AST", "PRA", "PA", "PR", "RA"]);
const COMBO_MARKETS = new Set(["PRA", "PA", "PR", "RA"]);
const SELECTED_MARKET_VETO = new Set(["PR", "PA"]);

const PORTFOLIO_LIMITS = {
  maxPerPlayer: 1,
  maxPerTeam: 2,
  maxPerGame: 2,
  maxPerMarket: 2,
  maxSameTeamCountingOvers: 1,
  maxComboMarkets: 1,
};

const POCKET_SPECS: PocketSpec[] = [
  { label: "top200 REB UNDER agreement, abs gap (1.5, 2.0]", pool: "top200", market: "REB", source: "player_override", finalSide: "UNDER", wfAgreement: true, absGap: [1.5, 2.0] },
  { label: "tail200plus AST OVER agreement, HGB confidence (0.82, 0.85]", pool: "tail200plus", market: "AST", source: "player_override", finalSide: "OVER", wfAgreement: true, wfConfidence: [0.82, 0.85] },
  { label: "top200 REB OVER agreement, abs gap (1.5, 2.0], source-side prior (0.80, 0.85]", pool: "top200", market: "REB", source: "player_override", finalSide: "OVER", wfAgreement: true, absGap: [1.5, 2.0], priorSourceSideAcc: [0.8, 0.85] },
  { label: "tail200plus AST OVER agreement, line (0.5, 1.5]", pool: "tail200plus", market: "AST", source: "player_override", finalSide: "OVER", wfAgreement: true, line: [0.5, 1.5] },
  { label: "top200 PR OVER triple-agree, line (12.5, 15.5], HGB confidence (0.75, 0.78]", pool: "top200", market: "PR", source: "player_override", finalSide: "OVER", wfSide: "OVER", projectionSide: "OVER", line: [12.5, 15.5], wfConfidence: [0.75, 0.78] },
  { label: "top200 REB UNDER HGB/projection split, abs gap (1.5, 2.0]", pool: "top200", market: "REB", finalSide: "UNDER", wfSide: "UNDER", projectionSide: "OVER", absGap: [1.5, 2.0] },
  { label: "top200 PA UNDER agreement, minutes (28, 30], line (15.5, 18.5]", pool: "top200", market: "PA", source: "player_override", finalSide: "UNDER", wfAgreement: true, minutes: [28, 30], line: [15.5, 18.5] },
  { label: "top200 AST OVER agreement, abs gap (0.25, 0.5], minutes (16, 20]", pool: "top200", market: "AST", source: "player_override", finalSide: "OVER", wfAgreement: true, absGap: [0.25, 0.5], minutes: [16, 20] },
  { label: "tail200plus PR OVER triple-agree, minutes (20, 24]", pool: "tail200plus", market: "PR", source: "player_override", finalSide: "OVER", wfSide: "OVER", projectionSide: "OVER", minutes: [20, 24] },
  { label: "tail200plus PTS OVER triple-agree, minutes (20, 24]", pool: "tail200plus", market: "PTS", source: "player_override", finalSide: "OVER", wfSide: "OVER", projectionSide: "OVER", minutes: [20, 24] },
  { label: "tail200plus REB OVER triple-agree, line (0.5, 1.5]", pool: "tail200plus", market: "REB", source: "player_override", finalSide: "OVER", wfSide: "OVER", projectionSide: "OVER", line: [0.5, 1.5] },
  { label: "tail200plus AST UNDER triple-agree, HGB confidence (0.80, 0.82]", pool: "tail200plus", market: "AST", source: "player_override", finalSide: "UNDER", wfSide: "UNDER", projectionSide: "UNDER", wfConfidence: [0.8, 0.82] },
  { label: "tail200plus PTS OVER triple-agree, HGB confidence (0.85, 0.88]", pool: "tail200plus", market: "PTS", source: "player_override", finalSide: "OVER", wfSide: "OVER", projectionSide: "OVER", wfConfidence: [0.85, 0.88] },
  { label: "tail200plus THREES UNDER triple-agree, HGB confidence (0.78, 0.80]", pool: "tail200plus", market: "THREES", source: "player_override", finalSide: "UNDER", wfSide: "UNDER", projectionSide: "UNDER", wfConfidence: [0.78, 0.8] },
  { label: "top200 REB UNDER agreement, minutes (32, 34], line (2.5, 3.5], HGB confidence (0.78, 0.80]", pool: "top200", market: "REB", source: "player_override", finalSide: "UNDER", wfAgreement: true, minutes: [32, 34], line: [2.5, 3.5], wfConfidence: [0.78, 0.8] },
  { label: "tail200plus RA OVER agreement, HGB confidence (0.82, 0.85], final-side prior (0.65, 0.70]", pool: "tail200plus", market: "RA", source: "player_override", finalSide: "OVER", wfAgreement: true, wfConfidence: [0.82, 0.85], priorFinalSideAcc: [0.65, 0.7] },
  { label: "top200 REB UNDER agreement, abs gap (0.25, 0.5], minutes (32, 34], line (2.5, 3.5]", pool: "top200", market: "REB", source: "player_override", finalSide: "UNDER", wfAgreement: true, absGap: [0.25, 0.5], minutes: [32, 34], line: [2.5, 3.5] },
  { label: "top200 AST OVER triple-agree, minutes (16, 20], source-side prior (0.80, 0.85]", pool: "top200", market: "AST", source: "player_override", finalSide: "OVER", wfSide: "OVER", projectionSide: "OVER", minutes: [16, 20], priorSourceSideAcc: [0.8, 0.85] },
  { label: "top200 PTS OVER agreement, minutes (28, 30], line (12.5, 15.5], HGB confidence (0.78, 0.80]", pool: "top200", market: "PTS", source: "player_override", finalSide: "OVER", wfAgreement: true, minutes: [28, 30], line: [12.5, 15.5], wfConfidence: [0.78, 0.8] },
  { label: "top200 PTS OVER agreement, abs gap (1.5, 2.0], minutes (20, 24], HGB confidence (0.82, 0.85]", pool: "top200", market: "PTS", source: "player_override", finalSide: "OVER", wfAgreement: true, absGap: [1.5, 2.0], minutes: [20, 24], wfConfidence: [0.82, 0.85] },
  { label: "top200 PTS OVER agreement, abs gap (1.25, 1.5], HGB confidence (0.82, 0.85]", pool: "top200", market: "PTS", source: "player_override", finalSide: "OVER", wfAgreement: true, absGap: [1.25, 1.5], wfConfidence: [0.82, 0.85] },
  { label: "top200 PTS UNDER HGB/projection split, HGB confidence (0.85, 0.88]", pool: "top200", market: "PTS", source: "player_override", finalSide: "UNDER", wfSide: "UNDER", projectionSide: "OVER", wfConfidence: [0.85, 0.88] },
  { label: "top200 PA OVER HGB/projection split, abs gap <= 0.25, minutes (24, 28]", pool: "top200", market: "PA", source: "player_override", finalSide: "OVER", wfSide: "OVER", projectionSide: "UNDER", absGapMax: 0.25, minutes: [24, 28] },
  { label: "tail200plus AST UNDER HGB/projection split, HGB confidence (0.82, 0.85], final-side prior (0.65, 0.70]", pool: "tail200plus", market: "AST", source: "player_override", finalSide: "UNDER", wfSide: "UNDER", projectionSide: "OVER", wfConfidence: [0.82, 0.85], priorFinalSideAcc: [0.65, 0.7] },
  { label: "top200 AST UNDER triple-agree, abs gap (0.5, 0.75], minutes (24, 28], HGB confidence (0.80, 0.82]", pool: "top200", market: "AST", source: "player_override", finalSide: "UNDER", wfSide: "UNDER", projectionSide: "UNDER", absGap: [0.5, 0.75], minutes: [24, 28], wfConfidence: [0.8, 0.82] },
  { label: "top200 PTS OVER HGB/projection split, abs gap (0.25, 0.5], minutes (24, 28]", pool: "top200", market: "PTS", source: "player_override", finalSide: "OVER", wfSide: "OVER", projectionSide: "UNDER", absGap: [0.25, 0.5], minutes: [24, 28] },
  { label: "top200 PTS UNDER agreement, abs gap (0.75, 1.0], minutes (24, 28], HGB confidence (0.80, 0.82]", pool: "top200", market: "PTS", source: "player_override", finalSide: "UNDER", wfAgreement: true, absGap: [0.75, 1.0], minutes: [24, 28], wfConfidence: [0.8, 0.82] },
];

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let scoresInput = path.join("exports", "top-player-200-sample-current-slate-scores.json");
  let modelInput = path.join("exports", "top-player-200-sample-prop-model-results.json");
  let precisionInput = path.join("exports", "precision-locked-pregame-results.json");
  let v9Input = path.join("exports", "live-quality-full-season-router-v9-default-eval.json");
  let outDir = path.join("exports", MODEL_ID);
  let maxPicks = 6;
  let minScore = 0.84;
  let lockRequested = false;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if ((token === "--scores" || token === "-s") && next) {
      scoresInput = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--scores=")) {
      scoresInput = token.slice("--scores=".length);
      continue;
    }
    if ((token === "--model" || token === "-m") && next) {
      modelInput = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--model=")) {
      modelInput = token.slice("--model=".length);
      continue;
    }
    if (token === "--precision" && next) {
      precisionInput = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--precision=")) {
      precisionInput = token.slice("--precision=".length);
      continue;
    }
    if (token === "--v9" && next) {
      v9Input = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--v9=")) {
      v9Input = token.slice("--v9=".length);
      continue;
    }
    if (token === "--out-dir" && next) {
      outDir = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out-dir=")) {
      outDir = token.slice("--out-dir=".length);
      continue;
    }
    if ((token === "--max-picks" || token === "--picks") && next) {
      maxPicks = readInt(next, maxPicks);
      index += 1;
      continue;
    }
    if (token.startsWith("--max-picks=") || token.startsWith("--picks=")) {
      maxPicks = readInt(token.split("=")[1], maxPicks);
      continue;
    }
    if (token === "--min-score" && next) {
      minScore = readNumber(next, minScore);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-score=")) {
      minScore = readNumber(token.slice("--min-score=".length), minScore);
      continue;
    }
    if (token === "--lock") {
      lockRequested = true;
      continue;
    }
  }

  return {
    scoresInput: path.resolve(scoresInput),
    modelInput: path.resolve(modelInput),
    precisionInput: path.resolve(precisionInput),
    v9Input: path.resolve(v9Input),
    outDir: path.resolve(outDir),
    maxPicks: Math.max(1, Math.min(20, maxPicks)),
    minScore: Math.max(0, Math.min(1, minScore)),
    lockRequested,
  };
}

function readInt(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function readNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sha256File(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readOptionalJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  return readJson<T>(filePath);
}

function side(value: unknown): Side | null {
  return value === "OVER" || value === "UNDER" ? value : null;
}

function finite(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : value;
}

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function betweenOpenClosed(value: number | null | undefined, bounds: [number, number]): boolean {
  return value != null && Number.isFinite(value) && value > bounds[0] && value <= bounds[1];
}

function componentAccuracy(lane: LaneMetric | null | undefined): number | null {
  return finite(lane?.runtimeFinalAccuracyPct ?? lane?.accuracyPct ?? null);
}

function laneComponent(
  id: ComponentId,
  label: string,
  lane: LaneMetric | null | undefined,
  role: ComponentEvidence["role"],
  fallbackRule: string,
): ComponentEvidence {
  return {
    id,
    role,
    label: lane?.label ?? label,
    accuracyPct: componentAccuracy(lane),
    playerDays: finite(lane?.playerDays ?? null),
    last30AccuracyPct: finite(lane?.last30AccuracyPct ?? null),
    last14AccuracyPct: finite(lane?.last14AccuracyPct ?? null),
    rule: lane?.rule ?? fallbackRule,
  };
}

function buildEvidence(
  model: TopPlayerModelArtifact,
  scores: CurrentSlateScoresArtifact,
  precision: PrecisionLockedResults | null,
  v9: V9Eval | null,
): ComponentEvidence[] {
  const metaLane = scores.metaExpandedLane;
  const evidence: ComponentEvidence[] = [
    laneComponent(
      "top200_premium_90",
      "Top Player 200 Expanded 90 Premium",
      model.expandedPremium90Lane,
      "candidate_source",
      "Union of holdout-stable high-precision pockets.",
    ),
    laneComponent(
      "top200_premium_pts_over",
      "Top Player Premium PTS Over",
      model.premiumPtsOverLane,
      "candidate_source",
      "PTS over agreement sweet spot.",
    ),
    laneComponent(
      "top200_accuracy_first",
      "Top Player Accuracy-First",
      model.accuracyFirstLane,
      "candidate_source",
      "Top-player high HGB confidence accuracy-first lane.",
    ),
    {
      id: "top200_meta_reliability",
      role: "candidate_source",
      label: metaLane?.label ?? "top200_meta_reliability_expanded",
      accuracyPct: metaLane?.accuracyPct ?? null,
      playerDays: metaLane?.playerDays ?? null,
      last30AccuracyPct: metaLane?.last30AccuracyPct ?? null,
      last14AccuracyPct: metaLane?.last14AccuracyPct ?? null,
      rule: metaLane?.rule ?? "Top-player meta reliability probability gate.",
    },
    laneComponent(
      "top200_coverage_frontier",
      "Top Player Coverage Frontier",
      model.coverageFrontierLane,
      "candidate_source",
      "Projection-disagreement coverage expansion lane.",
    ),
    laneComponent(
      "top200_recent_form_fade",
      "Top Player Recent-Form Fade",
      model.recentFormLane,
      "candidate_source",
      "Recent-form projection fade lane.",
    ),
    laneComponent(
      "top200_primary",
      "Top Player Primary",
      model.primaryLane,
      "candidate_source",
      "Top-player one-market-per-player HGB confidence gate.",
    ),
  ];

  evidence.push({
    id: "precision_parlay_v1",
    role: "portfolio_advisor",
    label: "Precision Parlay / snapshot-parlay-precision-v1",
    accuracyPct: finite(precision?.summary?.overall?.accuracy ?? null),
    playerDays: finite(precision?.summary?.overall?.picks ?? null),
    last30AccuracyPct: finite(precision?.summary?.last30?.accuracy ?? null),
    last14AccuracyPct: finite(precision?.summary?.last14?.accuracy ?? null),
    rule:
      "Use the parlay model's one-player, market-cap, same-game, same-team, and counting-over controls as the portfolio construction layer.",
  });
  evidence.push({
    id: "live_quality_router_v9",
    role: "quality_router",
    label: "Live Quality Full Season Router V9",
    accuracyPct: finite(v9?.overall?.blendedAccuracy ?? null),
    playerDays: finite(v9?.overall?.samples ?? null),
    last30AccuracyPct: null,
    last14AccuracyPct: null,
    rule:
      "Use V9 runtime final side and joint-feasibility ideas as a backend quality router, not as an unbounded pick source.",
  });

  return evidence;
}

function evidenceById(evidence: ComponentEvidence[]): Map<ComponentId, ComponentEvidence> {
  return new Map(evidence.map((item) => [item.id, item]));
}

function component(id: ComponentId, evidence: Map<ComponentId, ComponentEvidence>): CandidateComponent {
  const item = evidence.get(id);
  return {
    id,
    label: item?.label ?? id,
    accuracyPct: item?.accuracyPct ?? null,
    playerDays: item?.playerDays ?? null,
  };
}

function matchesPocket(
  row: CurrentSlateScore,
  spec: PocketSpec,
  topIds: Set<string>,
  tailIds: Set<string>,
): boolean {
  const finalSide = side(row.runtimeFinalSide);
  const wfSide = side(row.wfSide);
  const projectionSide = side(row.projectionSide);
  const isPoolMatch = spec.pool === "top200" ? topIds.has(row.playerId) : tailIds.has(row.playerId);
  if (!isPoolMatch) return false;
  if (row.market !== spec.market) return false;
  if (finalSide !== spec.finalSide) return false;
  if (spec.source && row.runtimeFinalSource !== spec.source) return false;
  if (spec.wfSide && wfSide !== spec.wfSide) return false;
  if (spec.projectionSide && projectionSide !== spec.projectionSide) return false;
  if (spec.wfAgreement && (!wfSide || wfSide !== finalSide)) return false;
  if (spec.absGap && !betweenOpenClosed(row.absLineGap, spec.absGap)) return false;
  if (spec.absGapMax != null && (row.absLineGap == null || row.absLineGap > spec.absGapMax)) return false;
  if (spec.minutes && !betweenOpenClosed(row.projectedMinutes, spec.minutes)) return false;
  if (spec.line && !betweenOpenClosed(row.line, spec.line)) return false;
  if (spec.wfConfidence && !betweenOpenClosed(row.wfConfidence, spec.wfConfidence)) return false;
  if (spec.priorSourceSideAcc && !betweenOpenClosed(row.priorMarketSourceSideAcc, spec.priorSourceSideAcc)) return false;
  if (spec.priorFinalSideAcc && !betweenOpenClosed(row.priorMarketFinalSideAcc, spec.priorFinalSideAcc)) return false;
  return true;
}

function projectionSideFromRow(row: CurrentSlateScore): Side | null {
  const projectionSide = side(row.projectionSide);
  if (projectionSide) return projectionSide;
  if (row.lineGap == null || !Number.isFinite(row.lineGap)) return null;
  if (row.lineGap > 0) return "OVER";
  if (row.lineGap < 0) return "UNDER";
  return null;
}

function matchesPremiumPtsOver(row: CurrentSlateScore, qualifiedIds: Set<string>): boolean {
  const finalSide = side(row.runtimeFinalSide);
  const wfSide = side(row.wfSide);
  const projectionSide = projectionSideFromRow(row);
  return (
    qualifiedIds.has(row.playerId) &&
    row.market === "PTS" &&
    row.runtimeFinalSource === "player_override" &&
    finalSide === "OVER" &&
    wfSide === "OVER" &&
    projectionSide === "OVER" &&
    (row.absLineGap ?? -1) >= 0.5 &&
    (row.absLineGap ?? 999) < 1.25 &&
    (row.projectedMinutes ?? -1) >= 20 &&
    (row.projectedMinutes ?? 999) < 24 &&
    (row.wfConfidence ?? -1) >= 0.78 &&
    (row.wfConfidence ?? 999) < 0.85
  );
}

function matchesCoverageFrontier(row: CurrentSlateScore, qualifiedIds: Set<string>): boolean {
  const finalSide = side(row.runtimeFinalSide);
  const projectionSide = projectionSideFromRow(row);
  return (
    qualifiedIds.has(row.playerId) &&
    ["PTS", "REB", "AST"].includes(row.market) &&
    row.runtimeFinalSource === "player_override" &&
    finalSide != null &&
    projectionSide != null &&
    finalSide !== projectionSide &&
    (row.absLineGap ?? -1) >= 1 &&
    (row.projectedMinutes ?? -1) >= 24
  );
}

function matchesRecentForm(row: CurrentSlateScore, topIds: Set<string>): boolean {
  const finalSide = side(row.runtimeFinalSide);
  const projectionSide = projectionSideFromRow(row);
  return (
    topIds.has(row.playerId) &&
    ["PTS", "REB", "AST"].includes(row.market) &&
    row.runtimeFinalSource === "player_override" &&
    finalSide === "UNDER" &&
    projectionSide === "OVER" &&
    (row.absLineGap ?? -1) >= 1 &&
    (row.projectedMinutes ?? -1) >= 28
  );
}

function riskFlags(row: CurrentSlateScore, components: CandidateComponent[]): string[] {
  const flags: string[] = [];
  if ((row.projectedMinutes ?? 99) < 22) flags.push("low_projected_minutes");
  if ((row.sportsbookCount ?? 0) <= 3) flags.push("minimum_book_depth");
  if (row.runtimeFinalSource === "baseline" && !components.some((item) => item.id === "top200_premium_90")) {
    flags.push("baseline_source");
  }
  const finalSide = side(row.runtimeFinalSide);
  const projectionSide = projectionSideFromRow(row);
  if (finalSide && projectionSide && finalSide !== projectionSide) flags.push("projection_side_split");
  if ((row.absLineGap ?? 0) < 0.5 && !components.some((item) => item.id === "top200_premium_90")) {
    flags.push("thin_projection_gap");
  }
  return flags;
}

function scoreCandidate(
  row: CurrentSlateScore,
  components: CandidateComponent[],
  estimatedAccuracyPriorPct: number | null,
): number {
  const accuracyScore = (estimatedAccuracyPriorPct ?? 75) / 100;
  const wfScore = row.wfConfidence ?? 0.5;
  const metaScore = row.metaProbCorrect ?? accuracyScore;
  const gapScore = clamp((row.absLineGap ?? 0) / 3, 0, 1);
  const bookScore = clamp((row.sportsbookCount ?? 0) / 10, 0, 1);
  const minuteScore =
    row.projectedMinutes == null ? 0.5 : clamp((row.projectedMinutes - 16) / 18, 0, 1);
  const consensusScore = clamp((components.length - 1) / 4, 0, 1);
  const sourceAdjustment =
    row.runtimeFinalSource === "player_override" ? 0.035 : row.runtimeFinalSource === "baseline" ? -0.018 : 0;

  return round(
    accuracyScore * 0.48 +
      wfScore * 0.18 +
      metaScore * 0.14 +
      gapScore * 0.08 +
      bookScore * 0.05 +
      minuteScore * 0.03 +
      consensusScore * 0.04 +
      sourceAdjustment,
    6,
  );
}

function tierFor(components: CandidateComponent[], row: CurrentSlateScore): Tier {
  if (components.some((item) => item.id === "top200_premium_90")) return "S";
  if (
    components.some((item) => item.id === "top200_premium_pts_over" || item.id === "top200_accuracy_first") ||
    (components.some((item) => item.id === "top200_meta_reliability") &&
      components.some((item) => item.id === "top200_coverage_frontier" || item.id === "top200_recent_form_fade"))
  ) {
    return "A";
  }
  if (
    components.some((item) => item.id === "top200_meta_reliability" || item.id === "top200_coverage_frontier" || item.id === "top200_recent_form_fade" || item.id === "top200_primary")
  ) {
    return "B";
  }
  if (row.runtimeFinalSource === "player_override" || (row.wfConfidence ?? 0) >= 0.7 || (row.metaProbCorrect ?? 0) >= 0.74) {
    return "C";
  }
  return "D";
}

function hasActionSource(components: CandidateComponent[]): boolean {
  return components.some((item) => item.id !== "live_quality_router_v9");
}

function actionFor(tier: Tier, components: CandidateComponent[], baseScore: number): ModelAction {
  if (hasActionSource(components) || tier === "S" || tier === "A" || tier === "B") return "CANDIDATE";
  if (tier === "C" && baseScore >= 0.78) return "CANDIDATE";
  return "COVERAGE";
}

function actionCandidates(rows: Candidate[]): Candidate[] {
  return rows.filter((row) => row.model_action === "CANDIDATE");
}

function estimateAccuracyPrior(components: CandidateComponent[]): number | null {
  const values = components
    .map((item) => item.accuracyPct)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (values.length === 0) return null;
  const best = Math.max(...values);
  const consensusBonus = Math.min(2, Math.max(0, values.length - 1) * 0.55);
  return round(Math.min(96, best + consensusBonus), 2);
}

function buildCandidates(
  scores: CurrentSlateScoresArtifact,
  model: TopPlayerModelArtifact,
  evidence: ComponentEvidence[],
): Candidate[] {
  const evidenceMap = evidenceById(evidence);
  const qualifiedIds = new Set((model.qualifiedPlayerPool ?? model.primaryPlayerPool).map((player) => player.playerId));
  const topIds = new Set(model.primaryPlayerPool.map((player) => player.playerId));
  const tailIds = new Set([...qualifiedIds].filter((id) => !topIds.has(id)));
  const primaryThreshold = model.primaryLane.threshold ?? 0.84;
  const accuracyFirstThreshold = model.accuracyFirstLane?.threshold ?? 0.89;
  const metaThreshold = scores.metaExpandedLane?.metaThreshold ?? 0.825;
  const metaMinWf = scores.metaExpandedLane?.minWfConfidence ?? 0.75;

  const byKey = new Map<string, Candidate>();
  for (const row of scores.rows) {
    const finalSide = side(row.runtimeFinalSide);
    if (!finalSide) continue;

    const components: CandidateComponent[] = [component("live_quality_router_v9", evidenceMap)];
    const premiumPockets = POCKET_SPECS.filter((spec) => matchesPocket(row, spec, topIds, tailIds)).map(
      (spec) => spec.label,
    );
    if (premiumPockets.length > 0) components.push(component("top200_premium_90", evidenceMap));
    if (matchesPremiumPtsOver(row, qualifiedIds)) components.push(component("top200_premium_pts_over", evidenceMap));
    if (topIds.has(row.playerId) && (row.wfConfidence ?? 0) >= accuracyFirstThreshold) {
      components.push(component("top200_accuracy_first", evidenceMap));
    }
    if (
      topIds.has(row.playerId) &&
      (row.metaProbCorrect ?? 0) >= metaThreshold &&
      (row.wfConfidence ?? 0) >= metaMinWf
    ) {
      components.push(component("top200_meta_reliability", evidenceMap));
    }
    if (matchesCoverageFrontier(row, qualifiedIds)) {
      components.push(component("top200_coverage_frontier", evidenceMap));
    }
    if (matchesRecentForm(row, topIds)) {
      components.push(component("top200_recent_form_fade", evidenceMap));
    }
    if (topIds.has(row.playerId) && (row.wfConfidence ?? 0) >= primaryThreshold) {
      components.push(component("top200_primary", evidenceMap));
    }
    const uniqueComponents = [...new Map(components.map((item) => [item.id, item])).values()];
    const estimated = estimateAccuracyPrior(uniqueComponents);
    const baseScore = scoreCandidate(row, uniqueComponents, estimated);
    const tier = tierFor(uniqueComponents, row);
    const candidateId = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          model: MODEL_ID,
          slateDate: row.dateEt,
          playerId: row.playerId,
          market: row.market,
          side: finalSide,
          line: row.line,
          components: uniqueComponents.map((item) => item.id).sort(),
        }),
      )
      .digest("hex")
      .slice(0, 20);
    const key = `${row.dateEt}|${row.playerId}|${row.market}|${finalSide}|${row.line ?? "NA"}`;
    const candidate: Candidate = {
      candidate_id: candidateId,
      slate_date: row.dateEt,
      player_id: row.playerId,
      player: row.playerName,
      team: row.teamCode ?? null,
      opponent: row.opponentCode ?? null,
      matchup_key: row.matchupKey ?? null,
      game_time_et: row.gameTimeEt ?? null,
      market: row.market,
      side: finalSide,
      line: finite(row.line),
      projected_value: finite(row.projectedValue),
      line_gap: finite(row.lineGap),
      abs_line_gap: finite(row.absLineGap),
      wf_confidence: finite(row.wfConfidence),
      wf_prob_over: finite(row.wfProbOver),
      meta_prob_correct: finite(row.metaProbCorrect ?? null),
      projected_minutes: finite(row.projectedMinutes ?? null),
      sportsbook_count: finite(row.sportsbookCount),
      runtime_final_source: row.runtimeFinalSource ?? null,
      projection_side: row.projectionSide ?? null,
      tier,
      model_action: actionFor(tier, uniqueComponents, baseScore),
      source_components: uniqueComponents,
      premium_pockets: premiumPockets.sort(),
      estimated_accuracy_prior_pct: estimated,
      base_score: baseScore,
      correlation_penalty: 0,
      final_score: baseScore,
      selected_rank: null,
      risk_flags: riskFlags(row, uniqueComponents),
      reasons: uniqueComponents.map((item) => item.label),
      rejection_reason: null,
    };
    const existing = byKey.get(key);
    if (!existing || compareCandidate(candidate, existing) < 0) {
      byKey.set(key, candidate);
    }
  }

  return [...byKey.values()].sort(compareCandidate);
}

function compareCandidate(left: Candidate, right: Candidate): number {
  const tierRank = (tier: Tier) => (tier === "S" ? 0 : tier === "A" ? 1 : 2);
  return (
    tierRank(left.tier) - tierRank(right.tier) ||
    right.base_score - left.base_score ||
    (right.estimated_accuracy_prior_pct ?? -1) - (left.estimated_accuracy_prior_pct ?? -1) ||
    (right.wf_confidence ?? -1) - (left.wf_confidence ?? -1) ||
    (right.abs_line_gap ?? -1) - (left.abs_line_gap ?? -1) ||
    left.player.localeCompare(right.player) ||
    left.market.localeCompare(right.market)
  );
}

function hasSamePlayer(left: Candidate, right: Candidate): boolean {
  return left.player_id === right.player_id;
}

function hasSameTeam(left: Candidate, right: Candidate): boolean {
  return !!left.team && !!right.team && left.team === right.team;
}

function hasSameGame(left: Candidate, right: Candidate): boolean {
  return !!left.matchup_key && !!right.matchup_key && left.matchup_key === right.matchup_key;
}

function isCountingOver(candidate: Candidate): boolean {
  return candidate.side === "OVER" && COUNTING_OVER_MARKETS.has(candidate.market);
}

function correlationPenalty(candidate: Candidate, selected: Candidate[]): number {
  let penalty = 0;
  for (const leg of selected) {
    if (hasSameGame(candidate, leg)) penalty += 0.025;
    if (hasSameTeam(candidate, leg)) penalty += 0.045;
    if (hasSameTeam(candidate, leg) && isCountingOver(candidate) && isCountingOver(leg)) penalty += 0.13;
    if (candidate.market === leg.market) penalty += 0.006;
    if (hasSameGame(candidate, leg) && COMBO_MARKETS.has(candidate.market) && COMBO_MARKETS.has(leg.market)) {
      penalty += 0.018;
    }
  }
  return round(penalty, 6);
}

function capRejectionReason(candidate: Candidate, selected: Candidate[]): string | null {
  if (SELECTED_MARKET_VETO.has(candidate.market)) {
    return "portfolio_guard_market_veto";
  }
  if (selected.filter((pick) => hasSamePlayer(pick, candidate)).length >= PORTFOLIO_LIMITS.maxPerPlayer) {
    return "same_player_cap";
  }
  if (candidate.team && selected.filter((pick) => pick.team === candidate.team).length >= PORTFOLIO_LIMITS.maxPerTeam) {
    return "same_team_cap";
  }
  if (
    candidate.matchup_key &&
    selected.filter((pick) => pick.matchup_key === candidate.matchup_key).length >= PORTFOLIO_LIMITS.maxPerGame
  ) {
    return "same_game_cap";
  }
  if (selected.filter((pick) => pick.market === candidate.market).length >= PORTFOLIO_LIMITS.maxPerMarket) {
    return "market_cap";
  }
  if (
    COMBO_MARKETS.has(candidate.market) &&
    selected.filter((pick) => COMBO_MARKETS.has(pick.market)).length >= PORTFOLIO_LIMITS.maxComboMarkets
  ) {
    return "combo_market_cap";
  }
  if (
    candidate.team &&
    isCountingOver(candidate) &&
    selected.filter((pick) => pick.team === candidate.team && isCountingOver(pick)).length >=
      PORTFOLIO_LIMITS.maxSameTeamCountingOvers
  ) {
    return "same_team_counting_over_cap";
  }
  return null;
}

function selectPortfolio(candidates: Candidate[], maxPicks: number, minScore: number): Candidate[] {
  const selected: Candidate[] = [];
  const remaining = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));

  while (selected.length < maxPicks && remaining.size > 0) {
    let best: Candidate | null = null;

    for (const candidate of remaining.values()) {
      const rejection = capRejectionReason(candidate, selected);
      const penalty = correlationPenalty(candidate, selected);
      const finalScore = round(candidate.base_score - penalty, 6);
      if (rejection || finalScore < minScore) continue;

      const scored = {
        ...candidate,
        correlation_penalty: penalty,
        final_score: finalScore,
      };
      if (!best || compareFinalCandidate(scored, best) < 0) best = scored;
    }

    if (!best) break;
    selected.push({
      ...best,
      model_action: "SELECTED",
      selected_rank: selected.length + 1,
    });
    remaining.delete(best.candidate_id);
  }

  return selected;
}

function compareFinalCandidate(left: Candidate, right: Candidate): number {
  const tierRank = (tier: Tier) => (tier === "S" ? 0 : tier === "A" ? 1 : 2);
  return (
    right.final_score - left.final_score ||
    tierRank(left.tier) - tierRank(right.tier) ||
    (right.estimated_accuracy_prior_pct ?? -1) - (left.estimated_accuracy_prior_pct ?? -1) ||
    left.player.localeCompare(right.player) ||
    left.market.localeCompare(right.market)
  );
}

function annotateUnselected(candidates: Candidate[], selected: Candidate[], minScore: number): Candidate[] {
  const selectedIds = new Set(selected.map((candidate) => candidate.candidate_id));
  return candidates
    .filter((candidate) => !selectedIds.has(candidate.candidate_id))
    .map((candidate) => {
      const penalty = correlationPenalty(candidate, selected);
      const finalScore = round(candidate.base_score - penalty, 6);
      const capReason = capRejectionReason(candidate, selected);
      const scoreReason = finalScore < minScore ? "below_min_score" : null;
      const rankReason = candidate.model_action === "CANDIDATE" && !capReason && !scoreReason ? "portfolio_rank_cutoff" : null;
      return {
        ...candidate,
        correlation_penalty: penalty,
        final_score: finalScore,
        rejection_reason: capReason ?? scoreReason ?? rankReason,
      };
    })
    .sort(compareCandidate);
}

function correlationMultiplier(legs: Candidate[]): number {
  let multiplier = 1;
  for (let leftIndex = 0; leftIndex < legs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < legs.length; rightIndex += 1) {
      const left = legs[leftIndex];
      const right = legs[rightIndex];
      if (hasSameGame(left, right)) multiplier *= 0.975;
      if (hasSameTeam(left, right)) multiplier *= 0.94;
      if (hasSameTeam(left, right) && isCountingOver(left) && isCountingOver(right)) multiplier *= 0.86;
      if (left.market === right.market) multiplier *= 0.99;
    }
  }
  return round(clamp(multiplier, 0.2, 1), 4);
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (valid.length === 0) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

function countByTier(picks: Candidate[]): Record<string, number> {
  return picks.reduce<Record<string, number>>((acc, pick) => {
    acc[pick.tier] = (acc[pick.tier] ?? 0) + 1;
    return acc;
  }, {});
}

function countByAction(picks: Candidate[]): Record<string, number> {
  return picks.reduce<Record<string, number>>((acc, pick) => {
    acc[pick.model_action] = (acc[pick.model_action] ?? 0) + 1;
    return acc;
  }, {});
}

function currentDateEt(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function buildWarnings(
  mode: Mode,
  selected: Candidate[],
  candidates: Candidate[],
  scores: CurrentSlateScoresArtifact,
  todayEt: string,
): string[] {
  const warnings: string[] = [];
  if (scores.dateEt < todayEt) {
    warnings.push(`Input score artifact is stale: slate ${scores.dateEt}, current ET date ${todayEt}. Preview only.`);
  }
  if (!scores.firstGameTimeEt) {
    warnings.push("Input score artifact has no firstGameTimeEt, so this card cannot be treated as pregame proof.");
  }
  if (mode === "LOCK_REQUESTED_NO_LEDGER") {
    warnings.push(
      "Lock was requested, but this new final model does not have its own append-only ledger yet. No rows were appended.",
    );
  }
  if (selected.length === 0 && candidates.length > 0) {
    warnings.push("Candidates existed, but none survived the current portfolio score and correlation caps.");
  }
  if (selected.length < Math.min(6, candidates.length)) {
    warnings.push("The model intentionally underfilled rather than force weak or correlated picks.");
  }
  const riskCount = selected.filter((pick) => pick.risk_flags.length > 0).length;
  if (riskCount > 0) warnings.push(`${riskCount} selected pick(s) carry role, source, gap, or book-depth risk flags.`);
  warnings.push("Estimated accuracy priors are component priors, not calibrated forward probabilities.");
  return warnings;
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(picks: Candidate[]): string {
  const columns: Array<keyof Candidate> = [
    "selected_rank",
    "candidate_id",
    "slate_date",
    "player",
    "team",
    "opponent",
    "matchup_key",
    "game_time_et",
    "market",
    "side",
    "line",
    "projected_value",
    "line_gap",
    "wf_confidence",
    "meta_prob_correct",
    "estimated_accuracy_prior_pct",
    "tier",
    "model_action",
    "base_score",
    "correlation_penalty",
    "final_score",
    "risk_flags",
    "premium_pockets",
  ];
  return `${[
    columns.join(","),
    ...picks.map((pick) => columns.map((column) => csvCell(pick[column])).join(",")),
  ].join("\n")}\n`;
}

function n(value: number | null | undefined, decimals = 3): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(2)}%`;
}

function toMarkdown(card: FinalModelCard): string {
  const lines: string[] = [];
  lines.push("# Final Player Prop Model V1");
  lines.push("");
  lines.push(`Generated: ${card.generatedAt}`);
  lines.push(`Mode: ${card.mode}`);
  lines.push(`Slate date ET: ${card.slateDate}`);
  lines.push(`Current date ET: ${card.currentDateEt}`);
  lines.push("");
  lines.push("## Model Build");
  lines.push("");
  lines.push(
    "This is a correlation-aware meta-selector with the 2026-05-07 projection/confidence calibration and the 2026-05-06 portfolio guard. It uses the Top Player 200 premium pockets as the precision core, controlled Top Player expansion lanes for extra volume, V9 as the quality-router context, and stricter portfolio guards that veto selected PR/PA legs, cap combo markets to one, and raise the selected score floor.",
  );
  lines.push("");
  lines.push("## Claim Boundary");
  lines.push("");
  lines.push(card.claimBoundary);
  lines.push("");
  lines.push("## Component Evidence");
  lines.push("");
  lines.push("| Component | Role | Accuracy | Samples | Last 30 | Last 14 |");
  lines.push("|---|---|---:|---:|---:|---:|");
  for (const item of card.componentEvidence) {
    lines.push(
      `| ${item.label} | ${item.role} | ${pct(item.accuracyPct)} | ${item.playerDays ?? "-"} | ${pct(item.last30AccuracyPct)} | ${pct(item.last14AccuracyPct)} |`,
    );
  }
  lines.push("");
  lines.push("## Portfolio Summary");
  lines.push("");
  lines.push(`- Full board rows: ${card.summary.scoredBoardRows}/${card.summary.totalBoardRows}`);
  lines.push(`- Board coverage: ${pct(card.summary.boardCoveragePct)}`);
  lines.push(`- Candidates: ${card.summary.candidateCount}`);
  lines.push(`- Selected: ${card.summary.selectedCount}`);
  lines.push(`- Average estimated accuracy prior: ${pct(card.summary.averageEstimatedAccuracyPriorPct)}`);
  lines.push(`- Average final score: ${n(card.summary.averageFinalScore)}`);
  lines.push(`- Correlation multiplier: ${n(card.summary.correlationMultiplier, 4)}`);
  lines.push(`- Selected tiers: ${JSON.stringify(card.summary.selectedByTier)}`);
  lines.push(`- Full-board tiers: ${JSON.stringify(card.summary.boardRowsByTier)}`);
  lines.push(`- Actions: ${JSON.stringify(card.summary.boardRowsByAction)}`);
  lines.push("");
  lines.push("## Selected Picks");
  lines.push("");
  if (card.selectedPicks.length === 0) {
    lines.push("No picks survived the final model for this slate.");
  } else {
    lines.push("| # | Tier | Player | Matchup | Market | Side | Line | Prior | Score | Risk | Components |");
    lines.push("|---:|---|---|---|---|---|---:|---:|---:|---|---|");
    for (const pick of card.selectedPicks) {
      lines.push(
        `| ${pick.selected_rank ?? "-"} | ${pick.tier} | ${pick.player} | ${pick.matchup_key ?? "-"} | ${pick.market} | ${pick.side} | ${n(pick.line, 2)} | ${pct(pick.estimated_accuracy_prior_pct)} | ${n(pick.final_score)} | ${pick.risk_flags.join("; ") || "-"} | ${pick.source_components.map((item) => item.id).join("; ")} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Watchlist");
  lines.push("");
  if (card.watchlist.length === 0) {
    lines.push("No additional candidates cleared the source model filters.");
  } else {
    lines.push("| Tier | Player | Market | Side | Line | Score | Rejection |");
    lines.push("|---|---|---|---|---:|---:|---|");
    for (const pick of card.watchlist.slice(0, 12)) {
      lines.push(
        `| ${pick.tier} | ${pick.player} | ${pick.market} | ${pick.side} | ${n(pick.line, 2)} | ${n(pick.final_score)} | ${pick.rejection_reason ?? "-"} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Full Coverage Board");
  lines.push("");
  lines.push("Every scored row is included in the JSON and board CSV. The rows below are the top coverage rows after selected picks and candidates.");
  lines.push("");
  const coverageRows = card.boardRows.filter((pick) => pick.model_action === "COVERAGE").slice(0, 12);
  if (coverageRows.length === 0) {
    lines.push("No coverage-only rows were present.");
  } else {
    lines.push("| Tier | Player | Market | Side | Line | Score | Risk |");
    lines.push("|---|---|---|---|---:|---:|---|");
    for (const pick of coverageRows) {
      lines.push(
        `| ${pick.tier} | ${pick.player} | ${pick.market} | ${pick.side} | ${n(pick.line, 2)} | ${n(pick.final_score)} | ${pick.risk_flags.join("; ") || "-"} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Correlation Rules");
  lines.push("");
  lines.push("- One pick per player.");
  lines.push("- Cap same team, same game, same market, and combo-market exposure.");
  lines.push("- Reject same-team double counting overs beyond the configured cap.");
  lines.push("- Never force-fill to six picks if the clean portfolio underfills.");
  lines.push("");
  lines.push("## Warnings");
  lines.push("");
  for (const warning of card.warnings) lines.push(`- ${warning}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const scores = readJson<CurrentSlateScoresArtifact>(args.scoresInput);
  const model = readJson<TopPlayerModelArtifact>(args.modelInput);
  const precision = readOptionalJson<PrecisionLockedResults>(args.precisionInput);
  const v9 = readOptionalJson<V9Eval>(args.v9Input);
  const componentEvidence = buildEvidence(model, scores, precision, v9);
  const scoredRows = buildCandidates(scores, model, componentEvidence);
  const candidates = actionCandidates(scoredRows);
  const selected = selectPortfolio(candidates, args.maxPicks, args.minScore);
  const unselected = annotateUnselected(scoredRows, selected, args.minScore);
  const boardRows = [...selected, ...unselected].sort(compareCandidate);
  const mode: Mode = args.lockRequested ? "LOCK_REQUESTED_NO_LEDGER" : "PREVIEW";
  const todayEt = currentDateEt();
  const warnings = buildWarnings(mode, selected, candidates, scores, todayEt);
  const generatedAt = new Date().toISOString();
  const claimBoundary =
    "This is a projection-calibrated, portfolio-guarded final-model candidate engine, not a forward-proven betting model. It keeps full-board coverage but applies a stricter selected-pick guard; locked-forward rows, market lines, settlements, and audit PASS are still required before live-edge claims.";

  const card: FinalModelCard = {
    generatedAt,
    modelId: MODEL_ID,
    modelName: "Final Correlation-Aware Player Prop Model V1",
    modelVersion: MODEL_VERSION,
    mode,
    slateDate: scores.dateEt,
    currentDateEt: todayEt,
    claimBoundary,
    sourceArtifacts: {
      scoresInput: args.scoresInput,
      scoresInputSha256: sha256File(args.scoresInput),
      modelInput: args.modelInput,
      modelInputSha256: sha256File(args.modelInput),
      precisionInput: existsSync(args.precisionInput) ? args.precisionInput : null,
      precisionInputSha256: sha256File(args.precisionInput),
      v9Input: existsSync(args.v9Input) ? args.v9Input : null,
      v9InputSha256: sha256File(args.v9Input),
    },
    componentEvidence,
    portfolioConfig: {
      maxPicks: args.maxPicks,
      minScore: args.minScore,
      ...PORTFOLIO_LIMITS,
      forceFill: false,
    },
    summary: {
      totalBoardRows: scores.rows.length,
      scoredBoardRows: scoredRows.length,
      boardCoveragePct: scores.rows.length > 0 ? round((scoredRows.length / scores.rows.length) * 100, 2) : 0,
      candidateCount: candidates.length,
      selectedCount: selected.length,
      selectedByTier: countByTier(selected),
      boardRowsByTier: countByTier(boardRows),
      boardRowsByAction: countByAction(boardRows),
      averageEstimatedAccuracyPriorPct: average(selected.map((pick) => pick.estimated_accuracy_prior_pct)),
      averageFinalScore: average(selected.map((pick) => pick.final_score)),
      correlationMultiplier: correlationMultiplier(selected),
      warningCount: warnings.length,
    },
    warnings,
    boardRows,
    selectedPicks: selected,
    watchlist: unselected.filter((pick) => pick.model_action === "CANDIDATE").slice(0, 25),
    rejectedTop: unselected.filter((pick) => pick.rejection_reason != null).slice(0, 25),
  };

  const basePath = path.join(args.outDir, `${MODEL_ID}-${scores.dateEt}`);
  await mkdir(args.outDir, { recursive: true });
  await Promise.all([
    writeFile(`${basePath}.json`, `${JSON.stringify(card, null, 2)}\n`, "utf8"),
    writeFile(`${basePath}.md`, toMarkdown(card), "utf8"),
    writeFile(`${basePath}.csv`, toCsv(selected), "utf8"),
    writeFile(`${basePath}.board.csv`, toCsv(boardRows), "utf8"),
  ]);

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: card.mode,
        modelId: card.modelId,
        modelVersion: card.modelVersion,
        slateDate: card.slateDate,
        totalBoardRows: card.summary.totalBoardRows,
        scoredBoardRows: card.summary.scoredBoardRows,
        boardCoveragePct: card.summary.boardCoveragePct,
        candidates: card.summary.candidateCount,
        selected: card.summary.selectedCount,
        selectedByTier: card.summary.selectedByTier,
        boardRowsByTier: card.summary.boardRowsByTier,
        boardRowsByAction: card.summary.boardRowsByAction,
        averageEstimatedAccuracyPriorPct: card.summary.averageEstimatedAccuracyPriorPct,
        averageFinalScore: card.summary.averageFinalScore,
        correlationMultiplier: card.summary.correlationMultiplier,
        warnings,
        outputs: {
          json: `${basePath}.json`,
          md: `${basePath}.md`,
          csv: `${basePath}.csv`,
          boardCsv: `${basePath}.board.csv`,
        },
        claimBoundary,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

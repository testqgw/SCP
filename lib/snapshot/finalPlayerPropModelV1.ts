import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  SnapshotFinalModelAction,
  SnapshotFinalModelBoardRow,
  SnapshotFinalModelComponent,
  SnapshotFinalModelData,
  SnapshotFinalModelSummary,
  SnapshotFinalModelTier,
  SnapshotMarket,
  SnapshotModelSide,
} from "@/lib/types/snapshot";

const MODEL_ID = "final-player-prop-model-v1" as const;
const MODEL_NAME = "Final Player Prop Model V1";
const CLAIM_BOUNDARY =
  "Final V1 is historically measured and proof-instrumented. Live forward proof requires locked rows, market lines, settlements, and audit PASS.";

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function market(value: unknown): SnapshotMarket | null {
  return value === "PTS" ||
    value === "REB" ||
    value === "AST" ||
    value === "THREES" ||
    value === "PRA" ||
    value === "PA" ||
    value === "PR" ||
    value === "RA"
    ? value
    : null;
}

function side(value: unknown): SnapshotModelSide | null {
  return value === "OVER" || value === "UNDER" || value === "NEUTRAL" ? value : null;
}

function tier(value: unknown): SnapshotFinalModelTier {
  return value === "S" || value === "A" || value === "B" || value === "C" || value === "D" ? value : "D";
}

function action(value: unknown): SnapshotFinalModelAction {
  return value === "SELECTED" || value === "CANDIDATE" || value === "COVERAGE" ? value : "COVERAGE";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function components(value: unknown): SnapshotFinalModelComponent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = str(record.id);
      const label = str(record.label);
      if (!id || !label) return null;
      return {
        id,
        label,
        accuracyPct: num(record.accuracyPct),
        playerDays: num(record.playerDays),
      };
    })
    .filter((item): item is SnapshotFinalModelComponent => item != null);
}

function countRecord<T extends string>(value: unknown): Partial<Record<T, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, count]) => [key, num(count)])
      .filter((entry): entry is [string, number] => entry[1] != null),
  ) as Partial<Record<T, number>>;
}

function emptySummary(): SnapshotFinalModelSummary {
  return {
    totalBoardRows: 0,
    scoredBoardRows: 0,
    boardCoveragePct: 0,
    candidateCount: 0,
    selectedCount: 0,
    selectedByTier: {},
    boardRowsByTier: {},
    boardRowsByAction: {},
    averageEstimatedAccuracyPriorPct: null,
    averageFinalScore: null,
    averageContextScore: null,
    averageContextAdjustment: null,
    correlationMultiplier: null,
    warningCount: 1,
  };
}

function missingArtifact(dateEt: string): SnapshotFinalModelData {
  return {
    artifactStatus: "MISSING",
    generatedAt: null,
    modelId: MODEL_ID,
    modelName: MODEL_NAME,
    modelVersion: null,
    mode: "MISSING_ARTIFACT",
    slateDate: dateEt,
    currentDateEt: null,
    claimBoundary: CLAIM_BOUNDARY,
    summary: emptySummary(),
    warnings: [
      `No Final V1 card artifact was found for ${dateEt}. Run the Final V1 exporter after the current slate score export.`,
    ],
    boardRows: [],
    selectedRows: [],
    candidateRows: [],
  };
}

function normalizeRow(input: unknown): SnapshotFinalModelBoardRow | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const rowMarket = market(row.market);
  const rowSide = side(row.side);
  const playerName = str(row.player) ?? str(row.playerName);
  if (!rowMarket || !rowSide || !playerName) return null;
  return {
    candidateId: str(row.candidate_id) ?? str(row.candidateId) ?? `${playerName}:${rowMarket}`,
    slateDate: str(row.slate_date) ?? str(row.slateDate) ?? "",
    playerId: str(row.player_id) ?? str(row.playerId),
    playerName,
    team: str(row.team),
    opponent: str(row.opponent),
    matchupKey: str(row.matchup_key) ?? str(row.matchupKey),
    gameTimeEt: str(row.game_time_et) ?? str(row.gameTimeEt),
    market: rowMarket,
    side: rowSide,
    line: num(row.line),
    projectedValue: num(row.projected_value) ?? num(row.projectedValue),
    lineGap: num(row.line_gap) ?? num(row.lineGap),
    absLineGap: num(row.abs_line_gap) ?? num(row.absLineGap),
    wfConfidence: num(row.wf_confidence) ?? num(row.wfConfidence),
    metaProbCorrect: num(row.meta_prob_correct) ?? num(row.metaProbCorrect),
    projectedMinutes: num(row.projected_minutes) ?? num(row.projectedMinutes),
    minutesVolatility: num(row.minutes_volatility) ?? num(row.minutesVolatility),
    starterRateLast10: num(row.starter_rate_last10) ?? num(row.starterRateLast10),
    lineupStatus: str(row.lineup_status) ?? str(row.lineupStatus),
    availabilityStatus: str(row.availability_status) ?? str(row.availabilityStatus),
    rotationRank: num(row.rotation_rank) ?? num(row.rotationRank),
    minutesTrend: num(row.minutes_trend) ?? num(row.minutesTrend),
    dataCompletenessScore: num(row.data_completeness_score) ?? num(row.dataCompletenessScore),
    stakeLevel: str(row.stake_level) ?? str(row.stakeLevel),
    teamRecentWinPct: num(row.team_recent_win_pct) ?? num(row.teamRecentWinPct),
    opponentRecentWinPct: num(row.opponent_recent_win_pct) ?? num(row.opponentRecentWinPct),
    marketSynergyBoost: num(row.market_synergy_boost) ?? num(row.marketSynergyBoost),
    marketSynergyDrag: num(row.market_synergy_drag) ?? num(row.marketSynergyDrag),
    sportsbookCount: num(row.sportsbook_count) ?? num(row.sportsbookCount),
    tier: tier(row.tier),
    modelAction: action(row.model_action ?? row.modelAction),
    selectedRank: num(row.selected_rank) ?? num(row.selectedRank),
    estimatedAccuracyPriorPct: num(row.estimated_accuracy_prior_pct) ?? num(row.estimatedAccuracyPriorPct),
    baseScore: num(row.base_score) ?? num(row.baseScore),
    contextScore: num(row.context_score) ?? num(row.contextScore),
    contextAdjustment: num(row.context_adjustment) ?? num(row.contextAdjustment),
    correlationPenalty: num(row.correlation_penalty) ?? num(row.correlationPenalty),
    finalScore: num(row.final_score) ?? num(row.finalScore),
    sourceComponents: components(row.source_components ?? row.sourceComponents),
    riskFlags: stringArray(row.risk_flags ?? row.riskFlags),
    contextFlags: stringArray(row.context_flags ?? row.contextFlags),
    reasons: stringArray(row.reasons),
    rejectionReason: str(row.rejection_reason) ?? str(row.rejectionReason),
  };
}

function normalizeSummary(value: unknown, selectedRows: SnapshotFinalModelBoardRow[]): SnapshotFinalModelSummary {
  const summary = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    totalBoardRows: num(summary.totalBoardRows) ?? selectedRows.length,
    scoredBoardRows: num(summary.scoredBoardRows) ?? selectedRows.length,
    boardCoveragePct: num(summary.boardCoveragePct) ?? 0,
    candidateCount: num(summary.candidateCount) ?? selectedRows.length,
    selectedCount: num(summary.selectedCount) ?? selectedRows.length,
    selectedByTier: countRecord<SnapshotFinalModelTier>(summary.selectedByTier),
    boardRowsByTier: countRecord<SnapshotFinalModelTier>(summary.boardRowsByTier),
    boardRowsByAction: countRecord<SnapshotFinalModelAction>(summary.boardRowsByAction),
    averageEstimatedAccuracyPriorPct: num(summary.averageEstimatedAccuracyPriorPct),
    averageFinalScore: num(summary.averageFinalScore),
    averageContextScore: num(summary.averageContextScore),
    averageContextAdjustment: num(summary.averageContextAdjustment),
    correlationMultiplier: num(summary.correlationMultiplier),
    warningCount: num(summary.warningCount) ?? 0,
  };
}

export async function loadFinalPlayerPropModelV1(dateEt: string): Promise<SnapshotFinalModelData> {
  const artifactPath = path.join(
    process.cwd(),
    "exports",
    "final-player-prop-model-v1",
    `final-player-prop-model-v1-${dateEt}.json`,
  );

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await readFile(artifactPath, "utf8")) as Record<string, unknown>;
  } catch {
    return missingArtifact(dateEt);
  }

  const boardRows = Array.isArray(payload.boardRows)
    ? payload.boardRows.map(normalizeRow).filter((row): row is SnapshotFinalModelBoardRow => row != null)
    : [];
  const selectedRows = boardRows
    .filter((row): row is SnapshotFinalModelBoardRow => row != null && row.modelAction === "SELECTED")
    .sort((a, b) => (a.selectedRank ?? 999) - (b.selectedRank ?? 999));
  const candidateRows = boardRows
    .filter((row): row is SnapshotFinalModelBoardRow => row != null && row.modelAction === "CANDIDATE")
    .sort((a, b) => (b.finalScore ?? -1) - (a.finalScore ?? -1));
  const warnings = stringArray(payload.warnings);

  return {
    artifactStatus: "LOADED",
    generatedAt: str(payload.generatedAt),
    modelId: MODEL_ID,
    modelName: str(payload.modelName) ?? MODEL_NAME,
    modelVersion: str(payload.modelVersion),
    mode: str(payload.mode) ?? "PREVIEW",
    slateDate: str(payload.slateDate) ?? dateEt,
    currentDateEt: str(payload.currentDateEt),
    claimBoundary: str(payload.claimBoundary) ?? CLAIM_BOUNDARY,
    summary: normalizeSummary(payload.summary, selectedRows),
    warnings,
    boardRows,
    selectedRows,
    candidateRows,
  };
}

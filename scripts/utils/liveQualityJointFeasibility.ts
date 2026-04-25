import type { LiveQualityEvaluatedRow, LiveQualityTrainingRow } from "./liveQualityBoardEval";
import { round } from "../../lib/utils";

type Side = "OVER" | "UNDER";

type Candidate = {
  row: LiveQualityEvaluatedRow;
  groupKey: string;
};

type PairStats = {
  samples: number;
  aHits: number;
  bHits: number;
  jointHits: number;
  aRate: number;
  bRate: number;
  jointRate: number;
  expectedJointRate: number;
  expectedRatio: number | null;
};

type Conflict = {
  aKey: string;
  bKey: string;
  vetoKey: string;
  keptKey: string;
  severity: number;
  reason: string;
};

export type JointFeasibilitySettings = {
  enabled: boolean;
  mode: "confidence" | "fallback";
  sideMode: "both_over" | "any";
  minSamples: number;
  maxPairsPerTeam: number;
};

export type JointFeasibilitySummary = {
  enabled: boolean;
  vetoedRows: number;
  conflictPairs: number;
  settings: JointFeasibilitySettings;
};

const DEFAULT_SETTINGS: JointFeasibilitySettings = {
  enabled: true,
  mode: "confidence",
  sideMode: "both_over",
  minSamples: 20,
  maxPairsPerTeam: 120,
};

function rowGroupKey(row: Pick<LiveQualityTrainingRow, "gameDateEt" | "teamId" | "teamCode" | "externalGameId">) {
  const teamKey = row.teamId?.trim() || row.teamCode?.trim() || null;
  if (!teamKey) return null;
  return [row.gameDateEt, row.externalGameId?.trim() || "unknown-game", teamKey].join("|");
}

function playerMarketKey(row: Pick<LiveQualityTrainingRow, "playerId" | "market">) {
  return `${row.playerId}|${row.market}`;
}

function rowKey(row: Pick<LiveQualityEvaluatedRow, "rowKey">) {
  return row.rowKey;
}

function isSelectedSide(side: string | null | undefined): side is Side {
  return side === "OVER" || side === "UNDER";
}

function sideHit(row: Pick<LiveQualityTrainingRow, "actualSide">, side: Side) {
  return row.actualSide === side;
}

function activeCandidate(row: LiveQualityEvaluatedRow): Candidate | null {
  if (!row.overrideEngaged || !isSelectedSide(row.finalSide)) return null;
  const groupKey = rowGroupKey(row);
  if (!groupKey) return null;
  return { row, groupKey };
}

function candidateStrength(row: LiveQualityEvaluatedRow) {
  const sideGap = row.finalSide === "OVER" ? row.lineGap : -row.lineGap;
  const supportedGap = Math.max(0, sideGap);
  const sourceBonus =
    row.finalSource === "player_override" ? 2.25 : row.finalSource === "universal_qualified" ? 1.35 : 0;
  const probabilityBonus =
    row.rawDecision.projectionWinProbability == null
      ? 0
      : Math.max(-0.75, Math.min(1.75, (row.rawDecision.projectionWinProbability - 0.5) * 5));
  const leafBonus =
    row.rawDecision.leafAccuracy == null ? 0 : Math.max(-0.4, Math.min(0.8, (row.rawDecision.leafAccuracy - 55) / 30));
  const gapBonus = Math.min(2.2, supportedGap / 2.5);
  const minutesPenalty = row.minutesVolatility == null ? 0 : Math.max(0, Math.min(0.75, (row.minutesVolatility - 7) / 8));
  return round(sourceBonus + probabilityBonus + leafBonus + gapBonus - minutesPenalty, 4);
}

function pairStats(input: {
  a: LiveQualityEvaluatedRow;
  b: LiveQualityEvaluatedRow;
  historyByPlayerMarket: Map<string, LiveQualityTrainingRow[]>;
}): PairStats | null {
  const aHistory = input.historyByPlayerMarket.get(playerMarketKey(input.a)) ?? [];
  const bHistory = input.historyByPlayerMarket.get(playerMarketKey(input.b)) ?? [];
  if (aHistory.length === 0 || bHistory.length === 0) return null;

  const bByGroup = new Map<string, LiveQualityTrainingRow>();
  for (const bRow of bHistory) {
    const groupKey = rowGroupKey(bRow);
    if (groupKey) bByGroup.set(groupKey, bRow);
  }

  let samples = 0;
  let aHits = 0;
  let bHits = 0;
  let jointHits = 0;

  for (const aRow of aHistory) {
    const groupKey = rowGroupKey(aRow);
    if (!groupKey) continue;
    const bRow = bByGroup.get(groupKey);
    if (!bRow) continue;
    samples += 1;
    const aHit = sideHit(aRow, input.a.finalSide);
    const bHit = sideHit(bRow, input.b.finalSide);
    if (aHit) aHits += 1;
    if (bHit) bHits += 1;
    if (aHit && bHit) jointHits += 1;
  }

  if (samples === 0) return null;
  const aRate = aHits / samples;
  const bRate = bHits / samples;
  const jointRate = jointHits / samples;
  const expectedJointRate = aRate * bRate;
  const expectedRatio = expectedJointRate > 0 ? jointRate / expectedJointRate : null;

  return {
    samples,
    aHits,
    bHits,
    jointHits,
    aRate,
    bRate,
    jointRate,
    expectedJointRate,
    expectedRatio,
  };
}

function conflictFor(input: {
  a: LiveQualityEvaluatedRow;
  b: LiveQualityEvaluatedRow;
  stats: PairStats;
  settings: JointFeasibilitySettings;
}): Conflict | null {
  const stats = input.stats;
  if (stats.samples < input.settings.minSamples) return null;

  const bothOver = input.a.finalSide === "OVER" && input.b.finalSide === "OVER";
  if (input.settings.sideMode === "both_over" && !bothOver) return null;

  const expectedGap = stats.expectedJointRate - stats.jointRate;
  const ratio = stats.expectedRatio ?? 1;
  const lowJointCount = stats.jointHits <= 1 && stats.samples >= Math.max(6, input.settings.minSamples);
  const meaningfulExpectation = stats.expectedJointRate >= 0.14;
  const ratioConflict = ratio <= 0.55 && expectedGap >= 0.1 && stats.expectedJointRate >= 0.16;
  const sparseOverConflict =
    bothOver && lowJointCount && meaningfulExpectation && Math.min(stats.aRate, stats.bRate) >= 0.25;
  const hardOverConflict =
    bothOver && stats.samples >= 8 && stats.jointRate <= 0.12 && stats.expectedJointRate >= 0.18;

  if (!ratioConflict && !sparseOverConflict && !hardOverConflict) return null;

  const aStrength = candidateStrength(input.a);
  const bStrength = candidateStrength(input.b);
  const veto = aStrength <= bStrength ? input.a : input.b;
  const kept = veto.rowKey === input.a.rowKey ? input.b : input.a;
  const severity = round(
    expectedGap * 100 +
      Math.max(0, 1 - ratio) * 18 +
      (bothOver ? 7 : 2) +
      (lowJointCount ? 5 : 0) +
      Math.max(0, input.settings.minSamples - stats.jointHits),
    4,
  );
  const reason = [
    `Same-team joint feasibility veto: ${input.a.playerName} ${input.a.market} ${input.a.finalSide}`,
    `+ ${input.b.playerName} ${input.b.market} ${input.b.finalSide}`,
    `co-hit ${stats.jointHits}/${stats.samples}`,
    `(${round(stats.jointRate * 100, 1)}% vs independent ${round(stats.expectedJointRate * 100, 1)}%)`,
  ].join(" ");

  return {
    aKey: rowKey(input.a),
    bKey: rowKey(input.b),
    vetoKey: rowKey(veto),
    keptKey: rowKey(kept),
    severity,
    reason,
  };
}

function addHistoryRows(rows: LiveQualityTrainingRow[], historyByPlayerMarket: Map<string, LiveQualityTrainingRow[]>): void {
  for (const row of rows) {
    if (!rowGroupKey(row)) continue;
    if (!isSelectedSide(row.actualSide)) continue;
    const key = playerMarketKey(row);
    const bucket = historyByPlayerMarket.get(key) ?? [];
    bucket.push(row);
    historyByPlayerMarket.set(key, bucket);
  }
}

function applyConflict(
  row: LiveQualityEvaluatedRow,
  conflict: Conflict,
  settings: JointFeasibilitySettings,
): LiveQualityEvaluatedRow {
  const conflicts = row.jointFeasibilityConflicts ?? [];
  if (row.rowKey !== conflict.vetoKey) {
    return {
      ...row,
      jointFeasibilityConflicts: [...conflicts, conflict.reason],
    };
  }

  const common = {
    ...row,
    overrideEngaged: false,
    jointFeasibilityVetoed: true,
    jointFeasibilityReason: conflict.reason,
    jointFeasibilityConflicts: [...conflicts, conflict.reason],
  };

  if (settings.mode === "confidence") {
    return common;
  }

  return {
    ...common,
    finalSide: row.baselineSide,
    finalSource: "baseline",
    finalCorrect: row.baselineSide === row.actualSide,
    playerOverrideEngaged: false,
  };
}

export function applyJointFeasibilityGate(input: {
  baseRows: LiveQualityTrainingRow[];
  evaluatedRows: LiveQualityEvaluatedRow[];
  settings?: Partial<JointFeasibilitySettings>;
}): LiveQualityEvaluatedRow[] {
  const settings: JointFeasibilitySettings = { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) };
  if (!settings.enabled) return input.evaluatedRows;

  const baseRowsByDate = new Map<string, LiveQualityTrainingRow[]>();
  for (const row of input.baseRows) {
    const bucket = baseRowsByDate.get(row.gameDateEt) ?? [];
    bucket.push(row);
    baseRowsByDate.set(row.gameDateEt, bucket);
  }

  const evaluatedByDate = new Map<string, LiveQualityEvaluatedRow[]>();
  input.evaluatedRows.forEach((row) => {
    const bucket = evaluatedByDate.get(row.gameDateEt) ?? [];
    bucket.push(row);
    evaluatedByDate.set(row.gameDateEt, bucket);
  });

  const historyByPlayerMarket = new Map<string, LiveQualityTrainingRow[]>();
  const dates = [...new Set([...baseRowsByDate.keys(), ...evaluatedByDate.keys()])].sort();
  const outputByKey = new Map<string, LiveQualityEvaluatedRow>();

  for (const date of dates) {
    const dateRows = evaluatedByDate.get(date) ?? [];
    const mutableRows = new Map(dateRows.map((row) => [row.rowKey, row]));
    const candidatesByTeamGame = new Map<string, Candidate[]>();

    for (const row of dateRows) {
      const candidate = activeCandidate(row);
      if (!candidate) continue;
      const bucket = candidatesByTeamGame.get(candidate.groupKey) ?? [];
      bucket.push(candidate);
      candidatesByTeamGame.set(candidate.groupKey, bucket);
    }

    const conflicts: Conflict[] = [];
    for (const candidates of candidatesByTeamGame.values()) {
      const sorted = candidates
        .filter((candidate, index, arr) => arr.findIndex((other) => other.row.rowKey === candidate.row.rowKey) === index)
        .sort((left, right) => candidateStrength(right.row) - candidateStrength(left.row))
        .slice(0, settings.maxPairsPerTeam);

      for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
          const left = sorted[leftIndex].row;
          const right = sorted[rightIndex].row;
          if (left.playerId === right.playerId) continue;
          const stats = pairStats({ a: left, b: right, historyByPlayerMarket });
          if (!stats) continue;
          const conflict = conflictFor({ a: left, b: right, stats, settings });
          if (conflict) conflicts.push(conflict);
        }
      }
    }

    const vetoedKeys = new Set<string>();
    for (const conflict of conflicts.sort((left, right) => right.severity - left.severity)) {
      if (vetoedKeys.has(conflict.aKey) || vetoedKeys.has(conflict.bKey)) continue;
      const vetoRow = mutableRows.get(conflict.vetoKey);
      const keptRow = mutableRows.get(conflict.keptKey);
      if (!vetoRow || !keptRow || !vetoRow.overrideEngaged || !keptRow.overrideEngaged) continue;
      mutableRows.set(conflict.vetoKey, applyConflict(vetoRow, conflict, settings));
      mutableRows.set(conflict.keptKey, applyConflict(keptRow, conflict, settings));
      vetoedKeys.add(conflict.vetoKey);
    }

    for (const row of dateRows) {
      outputByKey.set(row.rowKey, mutableRows.get(row.rowKey) ?? row);
    }

    addHistoryRows(baseRowsByDate.get(date) ?? [], historyByPlayerMarket);
  }

  return input.evaluatedRows.map((row) => outputByKey.get(row.rowKey) ?? row);
}

export function summarizeJointFeasibility(rows: LiveQualityEvaluatedRow[], settings: JointFeasibilitySettings): JointFeasibilitySummary {
  const vetoedRows = rows.filter((row) => row.jointFeasibilityVetoed).length;
  const conflictPairs = rows.reduce((sum, row) => sum + (row.jointFeasibilityConflicts?.length ?? 0), 0);
  return {
    enabled: settings.enabled,
    vetoedRows,
    conflictPairs,
    settings,
  };
}

export function resolveJointFeasibilitySettings(input?: Partial<JointFeasibilitySettings>): JointFeasibilitySettings {
  const rawEnvEnabled = process.env.SNAPSHOT_JOINT_FEASIBILITY_GATE?.trim().toLowerCase();
  const envEnabled = rawEnvEnabled === "1" || rawEnvEnabled === "true" || rawEnvEnabled === "on";
  const envDisabled = rawEnvEnabled === "0" || rawEnvEnabled === "false" || rawEnvEnabled === "off";
  const envMode = process.env.SNAPSHOT_JOINT_FEASIBILITY_MODE?.trim().toLowerCase();
  const envSideMode = process.env.SNAPSHOT_JOINT_FEASIBILITY_SIDE_MODE?.trim().toLowerCase();
  const envMinSamples = Number(process.env.SNAPSHOT_JOINT_FEASIBILITY_MIN_SAMPLES ?? "");
  const envMaxPairs = Number(process.env.SNAPSHOT_JOINT_FEASIBILITY_MAX_PAIRS_PER_TEAM ?? "");
  return {
    enabled: input?.enabled ?? (envDisabled ? false : envEnabled || DEFAULT_SETTINGS.enabled),
    mode:
      input?.mode ??
      (envMode === "fallback" || envMode === "confidence" ? envMode : DEFAULT_SETTINGS.mode),
    sideMode:
      input?.sideMode ??
      (envSideMode === "any" || envSideMode === "both_over" ? envSideMode : DEFAULT_SETTINGS.sideMode),
    minSamples:
      input?.minSamples ??
      (Number.isFinite(envMinSamples) && envMinSamples >= 2 ? Math.round(envMinSamples) : DEFAULT_SETTINGS.minSamples),
    maxPairsPerTeam:
      input?.maxPairsPerTeam ??
      (Number.isFinite(envMaxPairs) && envMaxPairs >= 10 ? Math.round(envMaxPairs) : DEFAULT_SETTINGS.maxPairsPerTeam),
  };
}

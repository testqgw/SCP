import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

type Side = "OVER" | "UNDER";

type Args = {
  scoresInput: string;
  modelInput: string;
  ledgerPath: string;
  outPrefix: string | null;
  dryRun: boolean;
  allowPast: boolean;
  allowAfterTipoff: boolean;
};

type TopPlayerPoolPlayer = {
  playerId: string;
  playerName: string;
};

type TopPlayerModelArtifact = {
  generatedAt: string;
  source?: string;
  minSamples: number;
  topPlayerCount: number;
  qualifiedPlayerCount: number;
  qualifiedPlayerPool?: TopPlayerPoolPlayer[];
  primaryPlayerPool: TopPlayerPoolPlayer[];
  expandedPremium90Lane?: {
    label: string;
    rule: string;
    accuracyPct: number | null;
    playerDays: number;
    correct: number;
    wrong: number;
    last30AccuracyPct: number | null;
    last14AccuracyPct: number | null;
    coverageVsEligiblePlayerDaysPct?: number | null;
    pockets?: string[];
  };
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
  rows: CurrentSlateScore[];
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

type LockedPick = {
  pick_id: string;
  lock_id: string;
  lock_mode: "LOCKED_FORWARD" | "BACKFILL_NOT_FORWARD_PROOF" | "AFTER_TIPOFF_NOT_FORWARD_PROOF";
  lock_timing_status: "BEFORE_FIRST_GAME" | "AFTER_FIRST_GAME" | "NO_GAME_TIME_IN_ARTIFACT" | "PAST_DATE";
  generated_at: string;
  artifact_generated_at: string | null;
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
  odds: number | null;
  sportsbook_source: string;
  model_lane: string;
  model_rule: string;
  confidence_bucket: string;
  wf_confidence: number | null;
  wf_prob_over: number | null;
  meta_prob_correct: number | null;
  projected_value: number | null;
  line_gap: number | null;
  abs_line_gap: number | null;
  projected_minutes: number | null;
  sportsbook_count: number | null;
  runtime_final_source: string | null;
  projection_side: string | null;
  premium_pockets: string[];
  input_snapshot_id: string;
  input_artifact_path: string;
  input_score_artifact_sha256: string;
  model_artifact_path: string;
  model_artifact_sha256: string;
  rule_version: string;
  rule_source_sha256: string;
  pocket_count: number;
  pocket_ids: string[];
  exporter_script_sha256: string;
  git_commit_sha: string | null;
  git_branch: string | null;
  git_dirty: boolean;
  git_dirty_relevant_paths: string[];
  result: number | null;
  win_loss_push_void: "WIN" | "LOSS" | "PUSH" | "VOID" | "PENDING";
  closing_line: number | null;
  closing_odds: number | null;
  clv: number | null;
  exclusion_reason: string | null;
};

type LedgerRecord = LockedPick & {
  previous_record_hash: string | null;
  record_hash: string;
};

type GitState = {
  commit: string | null;
  branch: string | null;
  dirty: boolean;
  dirtyPaths: string[];
  dirtyRelevantPaths: string[];
};

type EvidenceMetadata = {
  inputScoreArtifactSha256: string;
  modelArtifactSha256: string;
  exporterScriptSha256: string;
  ruleSourceSha256: string;
  ruleVersion: string;
  pocketCount: number;
  pocketIds: string[];
  git: GitState;
};

const LANE_LABEL = "holdout_stable_premium_90_six_per_day";
const MODEL_NAME = "Top Player 200 Expanded 90 Premium";

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
  let ledgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium-ledger.jsonl");
  let outPrefix: string | null = null;
  let dryRun = false;
  let allowPast = false;
  let allowAfterTipoff = false;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if (token === "--scores" && next) {
      scoresInput = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--scores=")) {
      scoresInput = token.slice("--scores=".length);
      continue;
    }
    if (token === "--model" && next) {
      modelInput = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--model=")) {
      modelInput = token.slice("--model=".length);
      continue;
    }
    if (token === "--ledger" && next) {
      ledgerPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--ledger=")) {
      ledgerPath = token.slice("--ledger=".length);
      continue;
    }
    if ((token === "--out-prefix" || token === "-o") && next) {
      outPrefix = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out-prefix=")) {
      outPrefix = token.slice("--out-prefix=".length);
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--allow-past" || token === "--allow-past-backfill") {
      allowPast = true;
      continue;
    }
    if (token === "--allow-after-tipoff") {
      allowAfterTipoff = true;
      continue;
    }
  }

  return { scoresInput, modelInput, ledgerPath, outPrefix, dryRun, allowPast, allowAfterTipoff };
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readJsonFile<T>(inputPath: string): { value: T; absolutePath: string; hash: string } {
  const absolutePath = path.resolve(inputPath);
  const text = readFileSync(absolutePath, "utf8");
  return { value: JSON.parse(text) as T, absolutePath, hash: sha256(text) };
}

function todayEt(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function runGit(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function normalizeGitPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^"|"$/g, "");
}

function gitDirtyPaths(): string[] {
  const status = runGit(["status", "--porcelain"]);
  if (!status) return [];
  return status
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .flatMap((item) => item.split(" -> ").slice(-1))
    .map(normalizeGitPath)
    .sort();
}

function currentGitState(): GitState {
  const dirtyPaths = gitDirtyPaths();
  const relevant = new Set([
    "package.json",
    "docs/locked-forward-top-player-expanded-90-premium.md",
    "scripts/export-locked-forward-top-player-expanded-90-premium.ts",
    "scripts/export-top-player-200-current-slate-scores.py",
    "scripts/export-top-player-200-sample-prop-model.py",
    "lib/snapshot/topPlayer200SamplePropModel.ts",
  ]);
  return {
    commit: runGit(["rev-parse", "HEAD"]),
    branch: runGit(["branch", "--show-current"]),
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
    dirtyRelevantPaths: dirtyPaths.filter((item) => relevant.has(item)),
  };
}

function scriptSha256(): string {
  const scriptPath = path.resolve(process.argv[1] ?? __filename);
  return sha256(readFileSync(scriptPath, "utf8"));
}

function ruleSourceSha256(): string {
  return sha256(canonicalJson({ lane: LANE_LABEL, pockets: POCKET_SPECS }));
}

function parseDateTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function lockTimingStatus(input: {
  slateDate: string;
  currentDateEt: string;
  generatedAt: string;
  firstGameTimeEt: string | null | undefined;
}): LockedPick["lock_timing_status"] {
  if (input.slateDate < input.currentDateEt) return "PAST_DATE";
  const firstGameMs = parseDateTime(input.firstGameTimeEt);
  if (firstGameMs == null) return "NO_GAME_TIME_IN_ARTIFACT";
  return Date.parse(input.generatedAt) < firstGameMs ? "BEFORE_FIRST_GAME" : "AFTER_FIRST_GAME";
}

function num(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

function round(value: number | null | undefined, decimals = 6): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function betweenOpenClosed(value: number | null | undefined, bounds: [number, number]): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  return value > bounds[0] && value <= bounds[1];
}

function side(value: unknown): Side | null {
  return value === "OVER" || value === "UNDER" ? value : null;
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

function confidenceBucket(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (value >= 0.88) return "wf>=0.88";
  if (value >= 0.85) return "0.85<=wf<0.88";
  if (value >= 0.82) return "0.82<=wf<0.85";
  if (value >= 0.8) return "0.80<=wf<0.82";
  if (value >= 0.78) return "0.78<=wf<0.80";
  if (value >= 0.75) return "0.75<=wf<0.78";
  return "wf<0.75";
}

function selectPremiumRows(
  scores: CurrentSlateScoresArtifact,
  model: TopPlayerModelArtifact,
): Array<CurrentSlateScore & { premiumPockets: string[] }> {
  const qualifiedIds = new Set((model.qualifiedPlayerPool ?? model.primaryPlayerPool).map((player) => player.playerId));
  const topIds = new Set(model.primaryPlayerPool.map((player) => player.playerId));
  const tailIds = new Set([...qualifiedIds].filter((id) => !topIds.has(id)));
  const byRow = new Map<string, CurrentSlateScore & { premiumPockets: string[] }>();

  for (const row of scores.rows) {
    const rowSide = side(row.runtimeFinalSide);
    if (!rowSide) continue;
    const pockets = POCKET_SPECS.filter((spec) => matchesPocket(row, spec, topIds, tailIds)).map((spec) => spec.label);
    if (pockets.length === 0) continue;
    const key = `${row.dateEt}|${row.playerId}|${row.market}|${rowSide}|${row.line ?? "NA"}`;
    const existing = byRow.get(key);
    if (existing) {
      existing.premiumPockets = [...new Set([...existing.premiumPockets, ...pockets])].sort();
    } else {
      byRow.set(key, { ...row, premiumPockets: pockets.sort() });
    }
  }

  const bestByPlayer = new Map<string, CurrentSlateScore & { premiumPockets: string[] }>();
  for (const row of byRow.values()) {
    const key = `${row.dateEt}|${row.playerId}`;
    const existing = bestByPlayer.get(key);
    if (!existing) {
      bestByPlayer.set(key, row);
      continue;
    }
    const currentConfidence = row.wfConfidence ?? -1;
    const existingConfidence = existing.wfConfidence ?? -1;
    const currentGap = row.absLineGap ?? -1;
    const existingGap = existing.absLineGap ?? -1;
    if (
      currentConfidence > existingConfidence ||
      (currentConfidence === existingConfidence && currentGap > existingGap) ||
      (currentConfidence === existingConfidence && currentGap === existingGap && row.market > existing.market)
    ) {
      bestByPlayer.set(key, row);
    }
  }

  return [...bestByPlayer.values()].sort((a, b) => {
    const confDiff = (b.wfConfidence ?? -1) - (a.wfConfidence ?? -1);
    if (confDiff !== 0) return confDiff;
    return (b.absLineGap ?? -1) - (a.absLineGap ?? -1);
  });
}

function buildLockedPicks(input: {
  scores: CurrentSlateScoresArtifact;
  model: TopPlayerModelArtifact;
  selected: Array<CurrentSlateScore & { premiumPockets: string[] }>;
  generatedAt: string;
  lockMode: LockedPick["lock_mode"];
  timingStatus: LockedPick["lock_timing_status"];
  scoresPath: string;
  modelPath: string;
  metadata: EvidenceMetadata;
  inputSnapshotId: string;
}): LockedPick[] {
  const lane = input.model.expandedPremium90Lane;
  const modelRule =
    lane?.rule ??
    "holdout-stable 90 premium lane: union of 27 high-precision top200/tail200plus pockets; deduped to one highest-confidence market per player per slate.";
  const lockId = sha256(
    canonicalJson({
      lane: LANE_LABEL,
      generatedAt: input.generatedAt,
      slateDate: input.scores.dateEt,
      inputSnapshotId: input.inputSnapshotId,
      modelGeneratedAt: input.model.generatedAt,
    }),
  ).slice(0, 16);

  return input.selected.map((row) => {
    const finalSide = side(row.runtimeFinalSide);
    if (!finalSide) {
      throw new Error(`Selected row had no final side: ${row.playerName} ${row.market}`);
    }
    const pickId = sha256(
      canonicalJson({
        lane: LANE_LABEL,
        slateDate: row.dateEt,
        playerId: row.playerId,
        market: row.market,
        side: finalSide,
        line: row.line,
        pockets: row.premiumPockets,
      }),
    ).slice(0, 20);
    return {
      pick_id: pickId,
      lock_id: lockId,
      lock_mode: input.lockMode,
      lock_timing_status: input.timingStatus,
      generated_at: input.generatedAt,
      artifact_generated_at: input.scores.generatedAtUtc ?? input.scores.generatedAt ?? null,
      slate_date: row.dateEt,
      player_id: row.playerId,
      player: row.playerName,
      team: row.teamCode ?? null,
      opponent: row.opponentCode ?? null,
      matchup_key: row.matchupKey ?? null,
      game_time_et: row.gameTimeEt ?? null,
      market: row.market,
      side: finalSide,
      line: num(row.line),
      odds: null,
      sportsbook_source: input.scores.source,
      model_lane: LANE_LABEL,
      model_rule: modelRule,
      confidence_bucket: confidenceBucket(row.wfConfidence),
      wf_confidence: round(row.wfConfidence),
      wf_prob_over: round(row.wfProbOver),
      meta_prob_correct: round(row.metaProbCorrect),
      projected_value: round(row.projectedValue, 2),
      line_gap: round(row.lineGap, 2),
      abs_line_gap: round(row.absLineGap, 2),
      projected_minutes: round(row.projectedMinutes, 2),
      sportsbook_count: row.sportsbookCount,
      runtime_final_source: row.runtimeFinalSource ?? null,
      projection_side: row.projectionSide ?? null,
      premium_pockets: row.premiumPockets,
      input_snapshot_id: input.inputSnapshotId,
      input_artifact_path: input.scoresPath,
      input_score_artifact_sha256: input.metadata.inputScoreArtifactSha256,
      model_artifact_path: input.modelPath,
      model_artifact_sha256: input.metadata.modelArtifactSha256,
      rule_version: input.metadata.ruleVersion,
      rule_source_sha256: input.metadata.ruleSourceSha256,
      pocket_count: input.metadata.pocketCount,
      pocket_ids: input.metadata.pocketIds,
      exporter_script_sha256: input.metadata.exporterScriptSha256,
      git_commit_sha: input.metadata.git.commit,
      git_branch: input.metadata.git.branch,
      git_dirty: input.metadata.git.dirty,
      git_dirty_relevant_paths: input.metadata.git.dirtyRelevantPaths,
      result: null,
      win_loss_push_void: "PENDING",
      closing_line: null,
      closing_odds: null,
      clv: null,
      exclusion_reason: null,
    };
  });
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(picks: LockedPick[]): string {
  const columns: Array<keyof LockedPick> = [
    "pick_id",
    "generated_at",
    "artifact_generated_at",
    "slate_date",
    "player",
    "team",
    "opponent",
    "matchup_key",
    "game_time_et",
    "market",
    "side",
    "line",
    "odds",
    "sportsbook_source",
    "model_lane",
    "rule_version",
    "confidence_bucket",
    "input_snapshot_id",
    "input_score_artifact_sha256",
    "result",
    "win_loss_push_void",
    "closing_line",
    "closing_odds",
    "clv",
    "premium_pockets",
  ];
  return `${[columns.join(","), ...picks.map((pick) => columns.map((column) => csvCell(pick[column])).join(","))].join("\n")}\n`;
}

function pct(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(decimals)}%`;
}

function toMarkdown(input: {
  picks: LockedPick[];
  model: TopPlayerModelArtifact;
  scores: CurrentSlateScoresArtifact;
  generatedAt: string;
  lockMode: LockedPick["lock_mode"];
  dryRun: boolean;
  appended: number;
  skippedDuplicates: number;
  ledgerPath: string;
  metadata: EvidenceMetadata;
  timingStatus: LockedPick["lock_timing_status"];
}): string {
  const lane = input.model.expandedPremium90Lane;
  const lines: string[] = [];
  lines.push("# Locked Forward Top Player Expanded 90 Premium");
  lines.push("");
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push(`Slate date ET: ${input.scores.dateEt}`);
  lines.push(`Mode: ${input.dryRun ? "DRY_RUN" : input.lockMode}`);
  lines.push(`Timing status: ${input.timingStatus}`);
  lines.push(`Ledger: ${input.ledgerPath}`);
  lines.push("");
  lines.push("## Claim Boundary");
  lines.push("");
  lines.push("- This file locks picks from the current score artifact; it is not settlement proof by itself.");
  lines.push("- Odds, closing lines, CLV, and results are intentionally blank until joined from sportsbook/settlement artifacts.");
  if (input.lockMode === "BACKFILL_NOT_FORWARD_PROOF") {
    lines.push("- This slate is in the past relative to the run date, so these rows are marked backfill and must not be counted as forward proof.");
  }
  if (input.lockMode === "AFTER_TIPOFF_NOT_FORWARD_PROOF") {
    lines.push("- This run happened after the first known game time, so these rows are marked after-tipoff and must not be counted as forward proof.");
  }
  if (input.timingStatus === "NO_GAME_TIME_IN_ARTIFACT") {
    lines.push("- The score artifact did not expose first-game timing, so this lock cannot prove it happened before tipoff.");
  }
  if (input.dryRun) {
    lines.push("- Dry run only: no ledger rows were appended.");
  }
  lines.push("");
  lines.push("## Champion Baseline");
  lines.push("");
  lines.push(`- Model: ${MODEL_NAME}`);
  lines.push(`- Lane: \`${LANE_LABEL}\``);
  lines.push(`- Reported backtest accuracy: ${pct(lane?.accuracyPct)}`);
  lines.push(`- Reported record: ${lane?.correct ?? "-"} / ${lane?.wrong ?? "-"}`);
  lines.push(`- Reported player-days: ${lane?.playerDays ?? "-"}`);
  lines.push(`- Reported last 30 / last 14: ${pct(lane?.last30AccuracyPct)} / ${pct(lane?.last14AccuracyPct)}`);
  lines.push("");
  lines.push("## Lock Summary");
  lines.push("");
  lines.push(`- Picks selected: ${input.picks.length}`);
  lines.push(`- Newly appended ledger rows: ${input.appended}`);
  lines.push(`- Duplicate ledger rows skipped: ${input.skippedDuplicates}`);
  lines.push(`- Input score artifact generated: ${input.scores.generatedAt}`);
  lines.push(`- First game time ET: ${input.scores.firstGameTimeEt ?? "-"}`);
  lines.push(`- Score source: ${input.scores.source}`);
  lines.push(`- Input score artifact SHA-256: \`${input.metadata.inputScoreArtifactSha256}\``);
  lines.push(`- Model artifact SHA-256: \`${input.metadata.modelArtifactSha256}\``);
  lines.push(`- Exporter script SHA-256: \`${input.metadata.exporterScriptSha256}\``);
  lines.push(`- Rule version: \`${input.metadata.ruleVersion}\``);
  lines.push(`- Rule source SHA-256: \`${input.metadata.ruleSourceSha256}\``);
  lines.push(`- Pocket count: ${input.metadata.pocketCount}`);
  lines.push(`- Git commit: \`${input.metadata.git.commit ?? "-"}\``);
  lines.push(`- Git branch: \`${input.metadata.git.branch ?? "-"}\``);
  lines.push(`- Git dirty: ${input.metadata.git.dirty ? "true" : "false"}`);
  lines.push(`- Relevant dirty paths: ${input.metadata.git.dirtyRelevantPaths.length ? input.metadata.git.dirtyRelevantPaths.join(", ") : "-"}`);
  lines.push("");
  lines.push("## Picks");
  lines.push("");
  if (input.picks.length === 0) {
    lines.push("No rows matched the frozen premium-90 lane.");
  } else {
    lines.push("| # | Player | Matchup | Game Time | Market | Side | Line | WF Conf | Meta | Books | Pockets |");
    lines.push("|---:|---|---|---|---|---|---:|---:|---:|---:|---|");
    input.picks.forEach((pick, index) => {
      lines.push(
        `| ${index + 1} | ${pick.player} | ${pick.matchup_key ?? "-"} | ${pick.game_time_et ?? "-"} | ${pick.market} | ${pick.side} | ${pick.line ?? "-"} | ${pick.wf_confidence ?? "-"} | ${pick.meta_prob_correct ?? "-"} | ${pick.sportsbook_count ?? "-"} | ${pick.premium_pockets.join("; ")} |`,
      );
    });
  }
  lines.push("");
  lines.push("## Required Settlement Columns");
  lines.push("");
  lines.push("The ledger already reserves `result`, `win_loss_push_void`, `closing_line`, `closing_odds`, and `clv`. A row should stay `PENDING` until those are joined from timestamped settlement and line-close data.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function readLedger(ledgerPath: string): Promise<LedgerRecord[]> {
  if (!existsSync(ledgerPath)) return [];
  const text = await readFile(ledgerPath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerRecord);
}

function withRecordHash(record: LockedPick, previousRecordHash: string | null): LedgerRecord {
  const payload = { ...record, previous_record_hash: previousRecordHash };
  return { ...payload, record_hash: sha256(canonicalJson(payload)) };
}

async function appendLedger(input: {
  ledgerPath: string;
  picks: LockedPick[];
}): Promise<{ records: LedgerRecord[]; appended: number; skippedDuplicates: number }> {
  const existing = await readLedger(input.ledgerPath);
  const byPickId = new Map(existing.map((record) => [record.pick_id, record]));
  let previousHash = existing.at(-1)?.record_hash ?? null;
  const newRecords: LedgerRecord[] = [];
  let skippedDuplicates = 0;

  for (const pick of input.picks) {
    if (byPickId.has(pick.pick_id)) {
      skippedDuplicates += 1;
      continue;
    }
    const record = withRecordHash(pick, previousHash);
    previousHash = record.record_hash;
    newRecords.push(record);
  }

  if (newRecords.length > 0) {
    await mkdir(path.dirname(input.ledgerPath), { recursive: true });
    const prefix = existing.length > 0 ? "\n" : "";
    await writeFile(input.ledgerPath, `${prefix}${newRecords.map((record) => JSON.stringify(record)).join("\n")}\n`, {
      encoding: "utf8",
      flag: existing.length > 0 ? "a" : "w",
    });
  }

  return { records: newRecords, appended: newRecords.length, skippedDuplicates };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const scoresFile = readJsonFile<CurrentSlateScoresArtifact>(args.scoresInput);
  const modelFile = readJsonFile<TopPlayerModelArtifact>(args.modelInput);
  const slateDate = scoresFile.value.dateEt;
  const currentDateEt = todayEt();
  const isPastSlate = slateDate < currentDateEt;
  const generatedAt = new Date().toISOString();
  const timingStatus = lockTimingStatus({
    slateDate,
    currentDateEt,
    generatedAt,
    firstGameTimeEt: scoresFile.value.firstGameTimeEt,
  });
  const metadata: EvidenceMetadata = {
    inputScoreArtifactSha256: scoresFile.hash,
    modelArtifactSha256: modelFile.hash,
    exporterScriptSha256: scriptSha256(),
    ruleSourceSha256: ruleSourceSha256(),
    ruleVersion: sha256(canonicalJson({ lane: LANE_LABEL, pockets: POCKET_SPECS })).slice(0, 16),
    pocketCount: POCKET_SPECS.length,
    pocketIds: POCKET_SPECS.map((pocket) => pocket.label).sort(),
    git: currentGitState(),
  };

  if (isPastSlate && !args.allowPast && !args.dryRun) {
    throw new Error(
      `Refusing to append ${slateDate} as locked-forward proof because today in ET is ${currentDateEt}. Re-run with --dry-run for inspection or --allow-past to mark rows BACKFILL_NOT_FORWARD_PROOF.`,
    );
  }
  if (timingStatus === "AFTER_FIRST_GAME" && !args.allowAfterTipoff && !args.dryRun) {
    throw new Error(
      `Refusing to append ${slateDate} as locked-forward proof because first game time ${scoresFile.value.firstGameTimeEt} is before this lock. Re-run with --dry-run for inspection or --allow-after-tipoff to mark rows AFTER_TIPOFF_NOT_FORWARD_PROOF.`,
    );
  }

  const selected = selectPremiumRows(scoresFile.value, modelFile.value);
  const lockMode: LockedPick["lock_mode"] =
    timingStatus === "PAST_DATE"
      ? "BACKFILL_NOT_FORWARD_PROOF"
      : timingStatus === "AFTER_FIRST_GAME"
        ? "AFTER_TIPOFF_NOT_FORWARD_PROOF"
        : "LOCKED_FORWARD";
  const inputSnapshotId = sha256(
    canonicalJson({
      scoresHash: scoresFile.hash,
      modelHash: modelFile.hash,
      scoreDate: scoresFile.value.dateEt,
      lane: LANE_LABEL,
    }),
  );
  const picks = buildLockedPicks({
    scores: scoresFile.value,
    model: modelFile.value,
    selected,
    generatedAt,
    lockMode,
    timingStatus,
    scoresPath: scoresFile.absolutePath,
    modelPath: modelFile.absolutePath,
    metadata,
    inputSnapshotId,
  });
  const ledgerPath = path.resolve(args.ledgerPath);
  const outPrefix = path.resolve(args.outPrefix ?? path.join("exports", "locked-forward", `top-player-expanded-90-premium-${slateDate}`));
  let appended = 0;
  let skippedDuplicates = 0;

  if (!args.dryRun) {
    const result = await appendLedger({ ledgerPath, picks });
    appended = result.appended;
    skippedDuplicates = result.skippedDuplicates;
  }

  const jsonOutput = {
    generatedAt,
    dryRun: args.dryRun,
    lockMode,
    timingStatus,
    model: MODEL_NAME,
    lane: LANE_LABEL,
    slateDate,
    currentDateEt,
    inputSnapshotId,
    evidence: {
      ...metadata,
      git: {
        ...metadata.git,
        dirtyPathCount: metadata.git.dirtyPaths.length,
      },
    },
    ledgerPath,
    appended,
    skippedDuplicates,
    picks,
  };

  if (!args.dryRun) {
    await mkdir(path.dirname(outPrefix), { recursive: true });
    await Promise.all([
      writeFile(`${outPrefix}.json`, `${JSON.stringify(jsonOutput, null, 2)}\n`, "utf8"),
      writeFile(
        `${outPrefix}.md`,
        toMarkdown({
          picks,
          model: modelFile.value,
          scores: scoresFile.value,
          generatedAt,
          lockMode,
          dryRun: args.dryRun,
          appended,
          skippedDuplicates,
          ledgerPath,
          metadata,
          timingStatus,
        }),
        "utf8",
      ),
      writeFile(`${outPrefix}.csv`, toCsv(picks), "utf8"),
    ]);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        dryRun: args.dryRun,
        lockMode,
        timingStatus,
        slateDate,
        currentDateEt,
        firstGameTimeEt: scoresFile.value.firstGameTimeEt ?? null,
        picks: picks.length,
        pickRows: picks,
        appended,
        skippedDuplicates,
        evidence: {
          inputScoreArtifactSha256: metadata.inputScoreArtifactSha256,
          modelArtifactSha256: metadata.modelArtifactSha256,
          exporterScriptSha256: metadata.exporterScriptSha256,
          ruleVersion: metadata.ruleVersion,
          ruleSourceSha256: metadata.ruleSourceSha256,
          gitDirty: metadata.git.dirty,
          gitDirtyRelevantPaths: metadata.git.dirtyRelevantPaths,
        },
        ledgerPath,
        outputs: args.dryRun
          ? null
          : {
              json: `${outPrefix}.json`,
              md: `${outPrefix}.md`,
              csv: `${outPrefix}.csv`,
            },
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

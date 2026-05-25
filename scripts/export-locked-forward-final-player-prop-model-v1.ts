import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

type LockMode =
  | "LOCKED_FORWARD"
  | "BACKFILL_NOT_FORWARD_PROOF"
  | "AFTER_TIPOFF_NOT_FORWARD_PROOF"
  | "MISSING_GAME_TIME_NOT_FORWARD_PROOF";

type TimingStatus = "BEFORE_FIRST_GAME" | "AFTER_FIRST_GAME" | "NO_GAME_TIME_IN_ARTIFACT" | "PAST_DATE";

type Args = {
  scoresInput: string;
  modelInput: string;
  precisionInput: string;
  v9Input: string;
  ledgerPath: string;
  outPrefix: string | null;
  dryRun: boolean;
  allowPast: boolean;
  allowAfterTipoff: boolean;
  allowMissingGameTime: boolean;
  maxPicks: number;
  minScore: number;
};

type CurrentSlateScoresArtifact = {
  generatedAt?: string;
  generatedAtUtc?: string;
  dateEt: string;
  firstGameTimeEt?: string | null;
};

type FinalCardPick = {
  selected_rank: number | null;
  candidate_id: string;
  slate_date: string;
  player_id: string;
  player: string;
  team: string | null;
  opponent: string | null;
  matchup_key: string | null;
  game_time_et: string | null;
  market: string;
  side: "OVER" | "UNDER";
  line: number | null;
  projected_value: number | null;
  line_gap: number | null;
  abs_line_gap: number | null;
  wf_confidence: number | null;
  wf_prob_over: number | null;
  meta_prob_correct: number | null;
  projected_minutes: number | null;
  sportsbook_count: number | null;
  tier: string;
  model_action: string;
  source_components: Array<{ id: string; label: string; accuracyPct: number | null; playerDays: number | null }>;
  premium_pockets: string[];
  estimated_accuracy_prior_pct: number | null;
  base_score: number;
  correlation_penalty: number;
  final_score: number;
  risk_flags: string[];
};

type FinalCard = {
  generatedAt: string;
  modelId: string;
  modelName: string;
  modelVersion: string;
  mode: string;
  slateDate: string;
  currentDateEt: string;
  sourceArtifacts: Record<string, string | null>;
  portfolioConfig: Record<string, unknown>;
  summary: {
    totalBoardRows: number;
    scoredBoardRows: number;
    boardCoveragePct: number;
    selectedCount: number;
  };
  selectedPicks: FinalCardPick[];
  boardRows: FinalCardPick[];
};

type LockedFinalPick = {
  pick_id: string;
  lock_id: string;
  lock_mode: LockMode;
  lock_timing_status: TimingStatus;
  generated_at: string;
  artifact_generated_at: string | null;
  slate_date: string;
  current_date_et: string;
  player_id: string;
  player: string;
  team: string | null;
  opponent: string | null;
  matchup_key: string | null;
  game_time_et: string | null;
  market: string;
  side: "OVER" | "UNDER";
  line: number | null;
  odds: number | null;
  sportsbook_source: string | null;
  model_id: "final-player-prop-model-v1";
  model_version: string;
  selected_rank: number | null;
  tier: string;
  model_action: string;
  estimated_accuracy_prior_pct: number | null;
  base_score: number;
  correlation_penalty: number;
  final_score: number;
  source_component_ids: string[];
  premium_pockets: string[];
  risk_flags: string[];
  projected_value: number | null;
  line_gap: number | null;
  abs_line_gap: number | null;
  wf_confidence: number | null;
  wf_prob_over: number | null;
  meta_prob_correct: number | null;
  projected_minutes: number | null;
  sportsbook_count: number | null;
  input_snapshot_id: string;
  score_artifact_path: string;
  score_artifact_sha256: string;
  top_player_model_artifact_path: string;
  top_player_model_artifact_sha256: string;
  precision_artifact_path: string | null;
  precision_artifact_sha256: string | null;
  v9_artifact_path: string | null;
  v9_artifact_sha256: string | null;
  final_card_artifact_path: string;
  final_card_artifact_sha256: string;
  final_board_row_count: number;
  final_board_coverage_pct: number;
  selector_script_sha256: string;
  lock_exporter_script_sha256: string;
  walk_forward_report_sha256: string | null;
  portfolio_config_hash: string;
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

type LedgerRecord = LockedFinalPick & {
  previous_record_hash: string | null;
  record_hash: string;
};

const MODEL_ID = "final-player-prop-model-v1";
const SELECTOR_SCRIPT = "scripts/export-final-player-prop-model-v1.ts";
const LOCK_EXPORTER_SCRIPT = "scripts/export-locked-forward-final-player-prop-model-v1.ts";
const WALK_FORWARD_REPORT = "exports/final-player-prop-model-v1-walk-forward.json";

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let scoresInput = path.join("exports", "top-player-200-sample-current-slate-scores.json");
  let modelInput = path.join("exports", "top-player-200-sample-prop-model-results.json");
  let precisionInput = path.join("exports", "precision-locked-pregame-results.json");
  let v9Input = path.join("exports", "live-quality-full-season-router-v9-default-eval.json");
  let ledgerPath = path.join("exports", "locked-forward", "final-player-prop-model-v1-ledger.jsonl");
  let outPrefix: string | null = null;
  let dryRun = false;
  let allowPast = false;
  let allowAfterTipoff = false;
  let allowMissingGameTime = false;
  let maxPicks = 6;
  let minScore = 0.75;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    const value = token.includes("=") ? token.split("=").slice(1).join("=") : next;

    if ((token === "--scores" || token === "-s") && next) {
      scoresInput = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--scores=")) {
      scoresInput = value;
      continue;
    }
    if ((token === "--model" || token === "-m") && next) {
      modelInput = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--model=")) {
      modelInput = value;
      continue;
    }
    if (token === "--precision" && next) {
      precisionInput = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--precision=")) {
      precisionInput = value;
      continue;
    }
    if (token === "--v9" && next) {
      v9Input = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--v9=")) {
      v9Input = value;
      continue;
    }
    if (token === "--ledger" && next) {
      ledgerPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--ledger=")) {
      ledgerPath = value;
      continue;
    }
    if ((token === "--out-prefix" || token === "-o") && next) {
      outPrefix = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out-prefix=")) {
      outPrefix = value;
      continue;
    }
    if (token === "--dry-run") dryRun = true;
    if (token === "--allow-past") allowPast = true;
    if (token === "--allow-after-tipoff") allowAfterTipoff = true;
    if (token === "--allow-missing-game-time") allowMissingGameTime = true;
    if ((token === "--max-picks" || token === "--picks") && next) {
      maxPicks = readInt(next, maxPicks);
      index += 1;
      continue;
    }
    if (token.startsWith("--max-picks=") || token.startsWith("--picks=")) {
      maxPicks = readInt(value, maxPicks);
      continue;
    }
    if (token === "--min-score" && next) {
      minScore = readNumber(next, minScore);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-score=")) {
      minScore = readNumber(value, minScore);
    }
  }

  return {
    scoresInput: path.resolve(scoresInput),
    modelInput: path.resolve(modelInput),
    precisionInput: path.resolve(precisionInput),
    v9Input: path.resolve(v9Input),
    ledgerPath: path.resolve(ledgerPath),
    outPrefix,
    dryRun,
    allowPast,
    allowAfterTipoff,
    allowMissingGameTime,
    maxPicks,
    minScore,
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

function sha256(text: string | Buffer): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function fileSha256(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return sha256(readFileSync(filePath));
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

function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Command did not emit JSON: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

function runSelector(args: Args): { summary: Record<string, unknown>; cardPath: string } {
  const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
  const selectorArgs = [
    SELECTOR_SCRIPT,
    "--scores",
    args.scoresInput,
    "--model",
    args.modelInput,
    "--precision",
    args.precisionInput,
    "--v9",
    args.v9Input,
    "--max-picks",
    String(args.maxPicks),
    "--min-score",
    String(args.minScore),
  ];
  const stdout = execFileSync(process.execPath, [tsxCli, ...selectorArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const summary = extractJson(stdout);
  const outputs = summary.outputs as Record<string, string> | undefined;
  if (!outputs?.json) throw new Error("Final selector did not return an outputs.json path.");
  return { summary, cardPath: path.resolve(outputs.json) };
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
}): TimingStatus {
  if (input.slateDate < input.currentDateEt) return "PAST_DATE";
  const firstGameMs = parseDateTime(input.firstGameTimeEt);
  if (firstGameMs == null) return "NO_GAME_TIME_IN_ARTIFACT";
  return Date.parse(input.generatedAt) < firstGameMs ? "BEFORE_FIRST_GAME" : "AFTER_FIRST_GAME";
}

function lockModeFromTiming(timingStatus: TimingStatus): LockMode {
  if (timingStatus === "PAST_DATE") return "BACKFILL_NOT_FORWARD_PROOF";
  if (timingStatus === "AFTER_FIRST_GAME") return "AFTER_TIPOFF_NOT_FORWARD_PROOF";
  if (timingStatus === "NO_GAME_TIME_IN_ARTIFACT") return "MISSING_GAME_TIME_NOT_FORWARD_PROOF";
  return "LOCKED_FORWARD";
}

function git(command: string[]): string | null {
  try {
    return execFileSync("git", command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

function gitDirtyRelevantPaths(): string[] {
  const raw = git(["status", "--short"]) ?? "";
  const relevant = [
    SELECTOR_SCRIPT,
    LOCK_EXPORTER_SCRIPT,
    "scripts/backtest-final-player-prop-model-v1.py",
    "docs/final-player-prop-model-v1.md",
    "package.json",
  ];
  return raw
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter((filePath) => relevant.some((prefix) => filePath === prefix || filePath.startsWith(prefix)));
}

function expectedRecordHash(record: Omit<LedgerRecord, "record_hash">): string {
  return sha256(canonicalJson(record));
}

async function readLedger(ledgerPath: string): Promise<LedgerRecord[]> {
  if (!existsSync(ledgerPath)) return [];
  const text = await readFile(ledgerPath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerRecord);
}

async function appendLedger(input: {
  ledgerPath: string;
  picks: LockedFinalPick[];
}): Promise<{ appended: number; skippedDuplicates: number }> {
  const existing = await readLedger(input.ledgerPath);
  const existingPickIds = new Set(existing.map((row) => row.pick_id));
  let previousHash = existing.at(-1)?.record_hash ?? null;
  let skippedDuplicates = 0;
  const records: LedgerRecord[] = [];

  for (const pick of input.picks) {
    if (existingPickIds.has(pick.pick_id)) {
      skippedDuplicates += 1;
      continue;
    }
    const payload = { ...pick, previous_record_hash: previousHash };
    const record = { ...payload, record_hash: expectedRecordHash(payload) };
    records.push(record);
    previousHash = record.record_hash;
  }

  if (records.length > 0) {
    await mkdir(path.dirname(input.ledgerPath), { recursive: true });
    const prefix = existsSync(input.ledgerPath) ? "\n" : "";
    const existingText = existsSync(input.ledgerPath) ? readFileSync(input.ledgerPath, "utf8").trimEnd() : "";
    const nextText = `${existingText}${prefix}${records.map((row) => JSON.stringify(row)).join("\n")}\n`;
    await writeFile(input.ledgerPath, nextText, "utf8");
  }
  return { appended: records.length, skippedDuplicates };
}

function buildLockedPicks(input: {
  card: FinalCard;
  cardPath: string;
  cardHash: string;
  scores: CurrentSlateScoresArtifact;
  args: Args;
  generatedAt: string;
  currentDateEt: string;
  timingStatus: TimingStatus;
  lockMode: LockMode;
  inputSnapshotId: string;
}): LockedFinalPick[] {
  const scoreHash = fileSha256(input.args.scoresInput) ?? "";
  const modelHash = fileSha256(input.args.modelInput) ?? "";
  const precisionHash = fileSha256(input.args.precisionInput);
  const v9Hash = fileSha256(input.args.v9Input);
  const selectorHash = fileSha256(path.resolve(SELECTOR_SCRIPT)) ?? "";
  const lockExporterHash = fileSha256(path.resolve(LOCK_EXPORTER_SCRIPT)) ?? "";
  const walkForwardHash = fileSha256(path.resolve(WALK_FORWARD_REPORT));
  const portfolioConfigHash = sha256(canonicalJson(input.card.portfolioConfig));
  const commit = git(["rev-parse", "HEAD"]);
  const branch = git(["branch", "--show-current"]);
  const dirtyRelevant = gitDirtyRelevantPaths();
  const dirty = (git(["status", "--porcelain"]) ?? "").length > 0;
  const lockId = sha256(
    canonicalJson({
      modelId: MODEL_ID,
      modelVersion: input.card.modelVersion,
      generatedAt: input.generatedAt,
      slateDate: input.card.slateDate,
      cardHash: input.cardHash,
      inputSnapshotId: input.inputSnapshotId,
    }),
  ).slice(0, 16);

  return input.card.selectedPicks.map((pick) => {
    const pickId = sha256(
      canonicalJson({
        modelId: MODEL_ID,
        modelVersion: input.card.modelVersion,
        slateDate: pick.slate_date,
        playerId: pick.player_id,
        market: pick.market,
        side: pick.side,
        line: pick.line,
        selectedRank: pick.selected_rank,
      }),
    ).slice(0, 20);
    return {
      pick_id: pickId,
      lock_id: lockId,
      lock_mode: input.lockMode,
      lock_timing_status: input.timingStatus,
      generated_at: input.generatedAt,
      artifact_generated_at: input.card.generatedAt ?? null,
      slate_date: pick.slate_date,
      current_date_et: input.currentDateEt,
      player_id: pick.player_id,
      player: pick.player,
      team: pick.team,
      opponent: pick.opponent,
      matchup_key: pick.matchup_key,
      game_time_et: pick.game_time_et ?? input.scores.firstGameTimeEt ?? null,
      market: pick.market,
      side: pick.side,
      line: pick.line,
      odds: null,
      sportsbook_source: input.card.sourceArtifacts.scoresInput ?? null,
      model_id: MODEL_ID,
      model_version: input.card.modelVersion,
      selected_rank: pick.selected_rank,
      tier: pick.tier,
      model_action: pick.model_action,
      estimated_accuracy_prior_pct: pick.estimated_accuracy_prior_pct,
      base_score: pick.base_score,
      correlation_penalty: pick.correlation_penalty,
      final_score: pick.final_score,
      source_component_ids: pick.source_components.map((item) => item.id).sort(),
      premium_pockets: pick.premium_pockets,
      risk_flags: pick.risk_flags,
      projected_value: pick.projected_value,
      line_gap: pick.line_gap,
      abs_line_gap: pick.abs_line_gap,
      wf_confidence: pick.wf_confidence,
      wf_prob_over: pick.wf_prob_over,
      meta_prob_correct: pick.meta_prob_correct,
      projected_minutes: pick.projected_minutes,
      sportsbook_count: pick.sportsbook_count,
      input_snapshot_id: input.inputSnapshotId,
      score_artifact_path: input.args.scoresInput,
      score_artifact_sha256: scoreHash,
      top_player_model_artifact_path: input.args.modelInput,
      top_player_model_artifact_sha256: modelHash,
      precision_artifact_path: existsSync(input.args.precisionInput) ? input.args.precisionInput : null,
      precision_artifact_sha256: precisionHash,
      v9_artifact_path: existsSync(input.args.v9Input) ? input.args.v9Input : null,
      v9_artifact_sha256: v9Hash,
      final_card_artifact_path: input.cardPath,
      final_card_artifact_sha256: input.cardHash,
      final_board_row_count: input.card.summary.scoredBoardRows,
      final_board_coverage_pct: input.card.summary.boardCoveragePct,
      selector_script_sha256: selectorHash,
      lock_exporter_script_sha256: lockExporterHash,
      walk_forward_report_sha256: walkForwardHash,
      portfolio_config_hash: portfolioConfigHash,
      git_commit_sha: commit,
      git_branch: branch,
      git_dirty: dirty,
      git_dirty_relevant_paths: dirtyRelevant,
      result: null,
      win_loss_push_void: "PENDING",
      closing_line: null,
      closing_odds: null,
      clv: null,
      exclusion_reason: null,
    };
  });
}

function toCsv(picks: LockedFinalPick[]): string {
  const columns: Array<keyof LockedFinalPick> = [
    "pick_id",
    "lock_id",
    "lock_mode",
    "slate_date",
    "selected_rank",
    "player",
    "team",
    "opponent",
    "matchup_key",
    "game_time_et",
    "market",
    "side",
    "line",
    "tier",
    "estimated_accuracy_prior_pct",
    "final_score",
    "source_component_ids",
    "risk_flags",
  ];
  const cell = (value: unknown) => {
    const text = Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${[columns.join(","), ...picks.map((pick) => columns.map((column) => cell(pick[column])).join(","))].join("\n")}\n`;
}

function toMarkdown(input: {
  card: FinalCard;
  picks: LockedFinalPick[];
  lockMode: LockMode;
  timingStatus: TimingStatus;
  appended: number;
  skippedDuplicates: number;
  dryRun: boolean;
  ledgerPath: string;
}): string {
  const lines: string[] = [];
  lines.push("# Locked Forward Final Player Prop Model V1");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Mode: ${input.dryRun ? "DRY RUN" : "APPEND"}`);
  lines.push(`Slate date ET: ${input.card.slateDate}`);
  lines.push(`Lock mode: ${input.lockMode}`);
  lines.push(`Timing status: ${input.timingStatus}`);
  lines.push(`Selected picks: ${input.picks.length}`);
  lines.push(`Ledger rows appended: ${input.appended}`);
  lines.push(`Skipped duplicates: ${input.skippedDuplicates}`);
  lines.push(`Ledger: ${input.ledgerPath}`);
  lines.push("");
  lines.push("## Full Board Proof");
  lines.push("");
  lines.push(`- Full-board rows: ${input.card.summary.scoredBoardRows}/${input.card.summary.totalBoardRows}`);
  lines.push(`- Full-board coverage: ${input.card.summary.boardCoveragePct}%`);
  lines.push("- The full board is preserved in the final card artifact and referenced by SHA-256 from each locked pick row.");
  lines.push("");
  lines.push("## Selected Picks");
  lines.push("");
  if (input.picks.length === 0) {
    lines.push("No selected picks survived the final model.");
  } else {
    lines.push("| # | Player | Matchup | Market | Side | Line | Tier | Score | Components |");
    lines.push("|---:|---|---|---|---|---:|---|---:|---|");
    for (const pick of input.picks) {
      lines.push(
        `| ${pick.selected_rank ?? "-"} | ${pick.player} | ${pick.matchup_key ?? "-"} | ${pick.market} | ${pick.side} | ${pick.line ?? "-"} | ${pick.tier} | ${pick.final_score.toFixed(3)} | ${pick.source_component_ids.join("; ")} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Claim Boundary");
  lines.push("");
  lines.push("These rows are forward proof only when lock_mode is LOCKED_FORWARD and the verifier passes. Accuracy, CLV, and ROI still require market-line capture and postgame settlement.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const selector = runSelector(args);
  const card = JSON.parse(await readFile(selector.cardPath, "utf8")) as FinalCard;
  const scores = JSON.parse(await readFile(args.scoresInput, "utf8")) as CurrentSlateScoresArtifact;
  const generatedAt = new Date().toISOString();
  const currentDateEt = todayEt();
  const timingStatus = lockTimingStatus({
    slateDate: card.slateDate,
    currentDateEt,
    generatedAt,
    firstGameTimeEt: scores.firstGameTimeEt,
  });
  const lockMode = lockModeFromTiming(timingStatus);

  if (timingStatus === "PAST_DATE" && !args.allowPast && !args.dryRun) {
    throw new Error(
      `Refusing to append ${card.slateDate} as locked-forward proof because today in ET is ${currentDateEt}. Use --dry-run for inspection or --allow-past to append BACKFILL_NOT_FORWARD_PROOF rows.`,
    );
  }
  if (timingStatus === "AFTER_FIRST_GAME" && !args.allowAfterTipoff && !args.dryRun) {
    throw new Error(
      `Refusing to append ${card.slateDate} because first game time ${scores.firstGameTimeEt} is before this lock. Use --dry-run or --allow-after-tipoff.`,
    );
  }
  if (timingStatus === "NO_GAME_TIME_IN_ARTIFACT" && !args.allowMissingGameTime && !args.dryRun) {
    throw new Error(
      `Refusing to append ${card.slateDate} because the score artifact has no firstGameTimeEt. Use --dry-run or --allow-missing-game-time to append non-forward-proof rows.`,
    );
  }

  const cardHash = fileSha256(selector.cardPath) ?? "";
  const inputSnapshotId = sha256(
    canonicalJson({
      modelId: MODEL_ID,
      modelVersion: card.modelVersion,
      scoreHash: fileSha256(args.scoresInput),
      topPlayerModelHash: fileSha256(args.modelInput),
      precisionHash: fileSha256(args.precisionInput),
      v9Hash: fileSha256(args.v9Input),
      cardHash,
      portfolioConfig: card.portfolioConfig,
    }),
  );
  const picks = buildLockedPicks({
    card,
    cardPath: selector.cardPath,
    cardHash,
    scores,
    args,
    generatedAt,
    currentDateEt,
    timingStatus,
    lockMode,
    inputSnapshotId,
  });
  let appended = 0;
  let skippedDuplicates = 0;

  if (!args.dryRun) {
    const result = await appendLedger({ ledgerPath: args.ledgerPath, picks });
    appended = result.appended;
    skippedDuplicates = result.skippedDuplicates;
  }

  const outPrefix = path.resolve(
    args.outPrefix ?? path.join("exports", "locked-forward", MODEL_ID, `${MODEL_ID}-${card.slateDate}`),
  );
  const output = {
    generatedAt,
    dryRun: args.dryRun,
    lockMode,
    timingStatus,
    modelId: MODEL_ID,
    modelVersion: card.modelVersion,
    slateDate: card.slateDate,
    currentDateEt,
    firstGameTimeEt: scores.firstGameTimeEt ?? null,
    inputSnapshotId,
    ledgerPath: args.ledgerPath,
    finalCardArtifactPath: selector.cardPath,
    finalCardArtifactSha256: cardHash,
    fullBoardRows: card.summary.scoredBoardRows,
    fullBoardCoveragePct: card.summary.boardCoveragePct,
    selectedPicks: picks.length,
    appended,
    skippedDuplicates,
    pickRows: picks,
  };

  if (!args.dryRun) {
    await mkdir(path.dirname(outPrefix), { recursive: true });
    await Promise.all([
      writeFile(`${outPrefix}.json`, `${JSON.stringify(output, null, 2)}\n`, "utf8"),
      writeFile(
        `${outPrefix}.md`,
        toMarkdown({
          card,
          picks,
          lockMode,
          timingStatus,
          appended,
          skippedDuplicates,
          dryRun: args.dryRun,
          ledgerPath: args.ledgerPath,
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
        modelId: MODEL_ID,
        slateDate: card.slateDate,
        currentDateEt,
        firstGameTimeEt: scores.firstGameTimeEt ?? null,
        fullBoardRows: card.summary.scoredBoardRows,
        fullBoardCoveragePct: card.summary.boardCoveragePct,
        selectedPicks: picks.length,
        pickRows: picks,
        appended,
        skippedDuplicates,
        ledgerPath: args.ledgerPath,
        finalCardArtifactPath: selector.cardPath,
        finalCardArtifactSha256: cardHash,
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

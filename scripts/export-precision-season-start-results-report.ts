import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  buildPrecisionPick,
  computePrecisionSelectorScore,
  DEFAULT_DAILY_6_RULES,
  getPrecisionRule,
  LOOSE_RULES,
  selectPrecisionCardWithTopOff,
  type PrecisionPickInput,
  type PrecisionSlateCandidate,
} from "../lib/snapshot/precisionPickSystem";
import { attachCurrentLineRecencyMetrics } from "../lib/snapshot/currentLineRecency";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import type { SnapshotMarket, SnapshotModelSide, SnapshotPrecisionPickSignal } from "../lib/types/snapshot";
import { round } from "../lib/utils";

type Side = "OVER" | "UNDER";
type Market = SnapshotMarket;

type TrainingRow = {
  playerId: string;
  playerName: string;
  market: Market;
  gameDateEt: string;
  projectedValue: number;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  finalSide: Side;
  actualSide: Side;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability?: number | null;
  actualMinutes: number;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection?: number | null;
  threesProjection?: number | null;
  seasonMinutesAvg?: number | null;
  minutesLiftPct?: number | null;
  activeCorePts?: number | null;
  activeCoreAst?: number | null;
  missingCorePts?: number | null;
  missingCoreAst?: number | null;
  missingCoreShare?: number | null;
  stepUpRoleFlag?: number | null;
  sameOpponentDeltaVsSeason?: number | null;
  sameOpponentSample?: number | null;
};

type BacktestRowsFile = {
  from: string;
  to: string;
  playerMarketRows: TrainingRow[];
};

type EnrichedRow = TrainingRow & ReturnType<typeof attachCurrentLineRecencyMetrics<TrainingRow>>[number];

type CandidateRecord = PrecisionSlateCandidate & {
  row: EnrichedRow;
  correct: boolean;
  actualValue: number;
  actualSide: Side;
};

type FirstGameLockMeta = {
  firstGameTimeUtc: string | null;
  syntheticLockedAt: string | null;
  lockLeadMinutes: number;
};

type PickResult = {
  date: string;
  lockTimeUtc: string | null;
  firstGameTimeUtc: string | null;
  rank: number;
  playerName: string;
  playerId: string;
  market: Market;
  side: SnapshotModelSide;
  lockedLine: number;
  projectedValue: number;
  actualValue: number;
  actualSide: Side;
  outcome: "WIN" | "LOSS" | "PUSH";
  correct: boolean;
  selectionScore: number;
  historicalAccuracy: number | null;
  projectionWinProbability: number | null;
  projectionPriceEdge: number | null;
  selectorTier: string | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
};

type DailyResult = {
  date: string;
  lockTimeUtc: string | null;
  firstGameTimeUtc: string | null;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  accuracyPct: number | null;
  cumulativePicks: number;
  cumulativeWins: number;
  cumulativeLosses: number;
  cumulativeAccuracyPct: number | null;
};

type NbaCdnScheduleGame = {
  gameCode?: unknown;
  gameDateTimeUTC?: unknown;
};

type NbaCdnSchedulePayload = {
  leagueSchedule?: {
    gameDates?: Array<{ games?: unknown }>;
  };
};

const prisma = new PrismaClient();
const MIN_ACTUAL_MINUTES = 15;
const DEFAULT_OUT_PREFIX = path.join(process.cwd(), "exports", "precision-season-start-results");
const DEFAULT_LOCK_LEAD_MINUTES = 15;
const NBA_CDN_SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";
const LEGACY_ADAPTIVE_TOP_OFF_RULES: Partial<
  Record<Market, { minSelectionScore?: number; minProjectionWinProbability: number }>
> = {
  AST: {
    minSelectionScore: 0.64,
    minProjectionWinProbability: 0.64,
  },
  PRA: {
    minSelectionScore: 0.64,
    minProjectionWinProbability: 0.64,
  },
  PA: {
    minSelectionScore: 0.64,
    minProjectionWinProbability: 0.64,
  },
  PR: {
    minSelectionScore: 0.64,
    minProjectionWinProbability: 0.64,
  },
  RA: {
    minProjectionWinProbability: 0.64,
  },
};
const LEGACY_SHORTFALL_RESCUE_RULES: Partial<
  Record<Market, { minSelectionScore?: number; minProjectionWinProbability: number }>
> = {
  REB: {
    minProjectionWinProbability: 0.64,
  },
  THREES: {
    minProjectionWinProbability: 0.64,
  },
};

function resolveInputPath(): string {
  try {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  } catch {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
  }
}

function parseArgs(): { input: string; outPrefix: string; lockLeadMinutes: number } {
  const raw = process.argv.slice(2);
  let input = resolveInputPath();
  let outPrefix = DEFAULT_OUT_PREFIX;
  let lockLeadMinutes = DEFAULT_LOCK_LEAD_MINUTES;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if ((token === "--input" || token === "-i") && next) {
      input = path.isAbsolute(next) ? next : path.join(process.cwd(), next);
      index += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      const value = token.slice("--input=".length);
      input = path.isAbsolute(value) ? value : path.join(process.cwd(), value);
      continue;
    }
    if ((token === "--out-prefix" || token === "-o") && next) {
      outPrefix = path.isAbsolute(next) ? next : path.join(process.cwd(), next);
      index += 1;
      continue;
    }
    if (token.startsWith("--out-prefix=")) {
      const value = token.slice("--out-prefix=".length);
      outPrefix = path.isAbsolute(value) ? value : path.join(process.cwd(), value);
      continue;
    }
    if (token === "--lock-lead-minutes" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) lockLeadMinutes = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--lock-lead-minutes=")) {
      const parsed = Number(token.slice("--lock-lead-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) lockLeadMinutes = Math.floor(parsed);
    }
  }

  return { input, outPrefix, lockLeadMinutes };
}

async function loadPlayerPositions(playerIds: string[]): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const chunkSize = 400;
  for (let index = 0; index < playerIds.length; index += chunkSize) {
    const chunk = playerIds.slice(index, index + chunkSize);
    const players = await prisma.player.findMany({
      where: { id: { in: chunk } },
      select: { id: true, position: true },
    });
    players.forEach((player) => results.set(player.id, player.position ?? null));
  }
  return results;
}

function buildPrecisionInput(row: EnrichedRow, playerPosition: string | null): PrecisionPickInput {
  return {
    playerId: row.playerId,
    playerName: row.playerName,
    matchupKey: `${row.gameDateEt}:${row.playerId}`,
    market: row.market,
    projectedValue: row.projectedValue,
    line: row.line,
    overPrice: row.overPrice,
    underPrice: row.underPrice,
    finalSide: row.finalSide,
    l5CurrentLineDeltaAvg: row.l5CurrentLineDeltaAvg ?? null,
    l5CurrentLineOverRate: row.l5CurrentLineOverRate ?? null,
    l5MinutesAvg: row.l5MinutesAvg ?? null,
    l10CurrentLineOverRate: row.l10CurrentLineOverRate ?? null,
    l15CurrentLineOverRate: row.l15CurrentLineOverRate ?? null,
    weightedCurrentLineOverRate: row.weightedCurrentLineOverRate ?? null,
    emaCurrentLineDelta: row.emaCurrentLineDelta ?? null,
    emaCurrentLineOverRate: row.emaCurrentLineOverRate ?? null,
    emaMinutesAvg: row.emaMinutesAvg ?? null,
    l15ValueMean: row.l15ValueMean ?? null,
    l15ValueMedian: row.l15ValueMedian ?? null,
    l15ValueStdDev: row.l15ValueStdDev ?? null,
    l15ValueSkew: row.l15ValueSkew ?? null,
    sameOpponentDeltaVsAnchor: row.sameOpponentDeltaVsSeason ?? null,
    sameOpponentSample: row.sameOpponentSample ?? null,
    sameOpponentMinutesSimilarity: null,
    seasonMinutesAvg: row.seasonMinutesAvg ?? null,
    minutesLiftPct: row.minutesLiftPct ?? null,
    minutesLast10Avg: row.l5MinutesAvg ?? row.expectedMinutes ?? null,
    activeCorePts: row.activeCorePts ?? null,
    activeCoreAst: row.activeCoreAst ?? null,
    missingCorePts: row.missingCorePts ?? null,
    missingCoreAst: row.missingCoreAst ?? null,
    missingCoreShare: row.missingCoreShare ?? null,
    stepUpRoleFlag: row.stepUpRoleFlag ?? null,
    expectedMinutes: row.expectedMinutes,
    minutesVolatility: row.minutesVolatility,
    benchBigRoleStability: row.benchBigRoleStability ?? null,
    starterRateLast10: row.starterRateLast10,
    archetypeExpectedMinutes: row.seasonMinutesAvg ?? null,
    archetypeStarterRateLast10: row.starterRateLast10,
    openingTeamSpread: row.openingTeamSpread,
    openingTotal: row.openingTotal,
    lineupTimingConfidence: row.lineupTimingConfidence,
    completenessScore: row.completenessScore,
    playerPosition,
    pointsProjection: row.pointsProjection ?? null,
    reboundsProjection: row.reboundsProjection ?? null,
    assistProjection: row.assistProjection ?? null,
    threesProjection: row.threesProjection ?? null,
  };
}

function getLegacyAdaptiveExclusionReason(
  input: PrecisionPickInput,
  signal: SnapshotPrecisionPickSignal,
): string | null {
  if (signal.side === "NEUTRAL") return null;
  if (input.market === "AST" && signal.side === "OVER" && (input.minutesVolatility ?? Number.POSITIVE_INFINITY) <= 4.16) {
    return "Adaptive AST OVER rejected in the low-volatility near-miss pocket that replayed poorly.";
  }
  if (input.market === "PR" && signal.side === "UNDER" && Math.abs(input.openingTeamSpread ?? 0) >= 7.5) {
    return "Adaptive PR UNDER rejected in heavy-spread spots that replayed poorly as thin-slate rescues.";
  }
  if (input.market === "RA" && signal.side === "OVER" && (signal.leafAccuracy ?? Number.NEGATIVE_INFINITY) >= 74.07) {
    return "Adaptive RA OVER rejected in the overconfident high-leaf rescue pocket.";
  }
  return null;
}

function buildLegacySeasonStartPrecisionPick(input: PrecisionPickInput): SnapshotPrecisionPickSignal | null {
  const signal = buildPrecisionPick(input, DEFAULT_DAILY_6_RULES);
  if (!signal) return null;
  if (!signal.qualified || signal.side === "NEUTRAL") return signal;

  return {
    ...signal,
    selectionScore: computePrecisionSelectorScore({
      market: input.market,
      signal,
      selectorFamily: "precision",
      selectorInput: input,
    }),
    selectorFamily: "precision",
    selectorTier: "season_start_legacy",
    reasons: [...(signal.reasons ?? []), "Season-start replay: legacy precision rules before the v6 manifest gate."],
  };
}

function buildLegacyAdaptivePrecisionFloorPick(input: PrecisionPickInput): SnapshotPrecisionPickSignal | null {
  const strictSignal = buildLegacySeasonStartPrecisionPick(input);
  const strictQualified = strictSignal?.qualified ?? strictSignal?.side !== "NEUTRAL";
  if (strictSignal && strictQualified) return null;

  const adaptiveConfig = LEGACY_ADAPTIVE_TOP_OFF_RULES[input.market];
  if (!adaptiveConfig) return null;

  const looseSignal = buildPrecisionPick(input, LOOSE_RULES);
  const looseQualified = looseSignal?.qualified ?? looseSignal?.side !== "NEUTRAL";
  if (!looseSignal || !looseQualified || looseSignal.side === "NEUTRAL") return null;
  if ((looseSignal.projectionWinProbability ?? 0) < adaptiveConfig.minProjectionWinProbability) return null;

  const selectionScore = computePrecisionSelectorScore({
    market: input.market,
    signal: looseSignal,
    selectorFamily: "precision",
    selectorInput: input,
  });
  if (selectionScore < (adaptiveConfig.minSelectionScore ?? Number.NEGATIVE_INFINITY)) return null;
  if (getLegacyAdaptiveExclusionReason(input, looseSignal)) return null;

  const baselineRule = getPrecisionRule(DEFAULT_DAILY_6_RULES, input.market);
  return {
    ...looseSignal,
    qualified: true,
    historicalAccuracy: baselineRule?.historicalAccuracy ?? looseSignal.historicalAccuracy,
    historicalPicks: baselineRule?.historicalPicks ?? looseSignal.historicalPicks,
    historicalCoveragePct: baselineRule?.historicalCoveragePct ?? looseSignal.historicalCoveragePct,
    selectionScore,
    selectorFamily: "precision",
    selectorTier: "season_start_adaptive",
    reasons: [...(looseSignal.reasons ?? []), "Season-start replay: adaptive precision top-off."],
  };
}

function buildLegacyShortfallPrecisionRescuePick(input: PrecisionPickInput): SnapshotPrecisionPickSignal | null {
  if (input.market === "PTS") return null;

  const strictSignal = buildLegacySeasonStartPrecisionPick(input);
  const strictQualified = strictSignal?.qualified ?? strictSignal?.side !== "NEUTRAL";
  if (strictSignal && strictQualified) return null;

  const adaptiveSignal = buildLegacyAdaptivePrecisionFloorPick(input);
  const adaptiveQualified = adaptiveSignal?.qualified ?? adaptiveSignal?.side !== "NEUTRAL";
  if (adaptiveSignal && adaptiveQualified) return null;

  const rescueConfig = LEGACY_ADAPTIVE_TOP_OFF_RULES[input.market] ?? LEGACY_SHORTFALL_RESCUE_RULES[input.market];
  if (!rescueConfig) return null;

  const looseSignal = buildPrecisionPick(input, LOOSE_RULES);
  const looseQualified = looseSignal?.qualified ?? looseSignal?.side !== "NEUTRAL";
  if (!looseSignal || !looseQualified || looseSignal.side === "NEUTRAL") return null;
  if ((looseSignal.projectionWinProbability ?? 0) < rescueConfig.minProjectionWinProbability) return null;
  if (getLegacyAdaptiveExclusionReason(input, looseSignal)) return null;

  const selectionScore = computePrecisionSelectorScore({
    market: input.market,
    signal: looseSignal,
    selectorFamily: "precision",
    selectorInput: input,
  });
  const baselineRule = getPrecisionRule(DEFAULT_DAILY_6_RULES, input.market);
  return {
    ...looseSignal,
    qualified: true,
    historicalAccuracy: baselineRule?.historicalAccuracy ?? looseSignal.historicalAccuracy,
    historicalPicks: baselineRule?.historicalPicks ?? looseSignal.historicalPicks,
    historicalCoveragePct: baselineRule?.historicalCoveragePct ?? looseSignal.historicalCoveragePct,
    selectionScore,
    selectorFamily: "precision",
    selectorTier: "season_start_shortfall",
    reasons: [...(looseSignal.reasons ?? []), "Season-start replay: shortfall precision rescue."],
  };
}

function buildLegacySixPickFallback(input: PrecisionPickInput): SnapshotPrecisionPickSignal | null {
  const signal = buildPrecisionPick(input, LOOSE_RULES);
  const qualified = signal?.qualified ?? signal?.side !== "NEUTRAL";
  if (!signal || !qualified || signal.side === "NEUTRAL") return null;
  if ((signal.projectionWinProbability ?? 0) < 0.5) return null;

  const baselineRule = getPrecisionRule(DEFAULT_DAILY_6_RULES, input.market);
  return {
    ...signal,
    qualified: true,
    historicalAccuracy: baselineRule?.historicalAccuracy ?? signal.historicalAccuracy,
    historicalPicks: baselineRule?.historicalPicks ?? signal.historicalPicks,
    historicalCoveragePct: baselineRule?.historicalCoveragePct ?? signal.historicalCoveragePct,
    selectionScore: computePrecisionSelectorScore({
      market: input.market,
      signal,
      selectorFamily: "precision",
      selectorInput: input,
    }),
    selectorFamily: "precision",
    selectorTier: "season_start_daily_six_fallback",
    reasons: [...(signal.reasons ?? []), "Season-start replay: final top-off to maintain six picks per day."],
  };
}

function nbaCodeDateToEtDate(value: string): string | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})\//);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function loadOnlineFirstGameLockMeta(dates: string[], lockLeadMinutes: number): Promise<Map<string, FirstGameLockMeta>> {
  const wantedDates = new Set(dates);
  const response = await fetch(NBA_CDN_SCHEDULE_URL, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; precision-season-start-report/1.0)" },
  });
  if (!response.ok) throw new Error(`NBA CDN schedule fetch failed with HTTP ${response.status}.`);
  const payload = (await response.json()) as NbaCdnSchedulePayload;
  const firstByDate = new Map<string, Date | null>();
  dates.forEach((date) => firstByDate.set(date, null));

  (payload.leagueSchedule?.gameDates ?? []).forEach((dateBucket) => {
    const games = Array.isArray(dateBucket.games) ? dateBucket.games : [];
    games.forEach((rawGame) => {
      const game = rawGame as NbaCdnScheduleGame;
      const gameCode = typeof game.gameCode === "string" ? game.gameCode : "";
      const dateEt = nbaCodeDateToEtDate(gameCode);
      if (!dateEt || !wantedDates.has(dateEt)) return;
      const rawTime = typeof game.gameDateTimeUTC === "string" ? game.gameDateTimeUTC : "";
      const parsed = new Date(rawTime);
      if (!Number.isFinite(parsed.getTime())) return;
      const current = firstByDate.get(dateEt) ?? null;
      if (!current || parsed.getTime() < current.getTime()) {
        firstByDate.set(dateEt, parsed);
      }
    });
  });

  return new Map(
    dates.map((date) => {
      const firstGame = firstByDate.get(date) ?? null;
      return [
        date,
        {
          firstGameTimeUtc: firstGame?.toISOString() ?? null,
          syntheticLockedAt: firstGame ? new Date(firstGame.getTime() - lockLeadMinutes * 60_000).toISOString() : null,
          lockLeadMinutes,
        },
      ] as const;
    }),
  );
}

function outcomeForPick(side: SnapshotModelSide, line: number, actualValue: number): PickResult["outcome"] {
  if (actualValue === line) return "PUSH";
  if (side === "OVER") return actualValue > line ? "WIN" : "LOSS";
  if (side === "UNDER") return actualValue < line ? "WIN" : "LOSS";
  return "LOSS";
}

function summarizeDaily(dates: string[], picks: PickResult[]): DailyResult[] {
  const byDate = new Map<string, PickResult[]>();
  picks.forEach((pick) => {
    const bucket = byDate.get(pick.date) ?? [];
    bucket.push(pick);
    byDate.set(pick.date, bucket);
  });

  let cumulativePicks = 0;
  let cumulativeWins = 0;
  let cumulativeLosses = 0;
  return dates
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map((date) => {
      const dayPicks = byDate.get(date) ?? [];
      const wins = dayPicks.filter((pick) => pick.outcome === "WIN").length;
      const losses = dayPicks.filter((pick) => pick.outcome === "LOSS").length;
      const pushes = dayPicks.filter((pick) => pick.outcome === "PUSH").length;
      cumulativePicks += dayPicks.length;
      cumulativeWins += wins;
      cumulativeLosses += losses;
      return {
        date,
        lockTimeUtc: dayPicks[0]?.lockTimeUtc ?? null,
        firstGameTimeUtc: dayPicks[0]?.firstGameTimeUtc ?? null,
        picks: dayPicks.length,
        wins,
        losses,
        pushes,
        accuracyPct: wins + losses > 0 ? round((wins / (wins + losses)) * 100, 2) : null,
        cumulativePicks,
        cumulativeWins,
        cumulativeLosses,
        cumulativeAccuracyPct:
          cumulativeWins + cumulativeLosses > 0 ? round((cumulativeWins / (cumulativeWins + cumulativeLosses)) * 100, 2) : null,
      };
    });
}

function summarizeWindow(days: DailyResult[]) {
  const picks = days.reduce((sum, day) => sum + day.picks, 0);
  const wins = days.reduce((sum, day) => sum + day.wins, 0);
  const losses = days.reduce((sum, day) => sum + day.losses, 0);
  const pushes = days.reduce((sum, day) => sum + day.pushes, 0);
  return {
    picks,
    correct: wins,
    losses,
    pushes,
    accuracy: wins + losses > 0 ? round((wins / (wins + losses)) * 100, 2) : null,
  };
}

function summarizeBySelectorTier(picks: PickResult[]): Record<string, { picks: number; wins: number; accuracyPct: number | null }> {
  const buckets = new Map<string, { picks: number; wins: number }>();
  picks.forEach((pick) => {
    const key = pick.selectorTier ?? "unknown";
    const current = buckets.get(key) ?? { picks: 0, wins: 0 };
    current.picks += 1;
    if (pick.outcome === "WIN") current.wins += 1;
    buckets.set(key, current);
  });
  return Object.fromEntries(
    Array.from(buckets.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tier, values]) => [
        tier,
        {
          picks: values.picks,
          wins: values.wins,
          accuracyPct: values.picks > 0 ? round((values.wins / values.picks) * 100, 2) : null,
        },
      ]),
  );
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv<T extends Record<string, unknown>>(rows: T[], headers: Array<keyof T>): string {
  return [
    headers.map((header) => csvCell(header)).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n") + "\n";
}

function formatPct(value: number | null | undefined): string {
  return value == null ? "-" : `${value.toFixed(2)}%`;
}

function buildMarkdown(input: {
  summary: Record<string, unknown>;
  daily: DailyResult[];
  picks: PickResult[];
}): string {
  const summary = input.summary as {
    range: { from: string; to: string; days: number };
    overall: { picks: number; correct: number; accuracy: number | null };
    last30: { picks: number; correct: number; accuracy: number | null };
    last14: { picks: number; correct: number; accuracy: number | null };
    note: string;
  };
  const lines: string[] = [];
  lines.push("# Precision Season-Start Results");
  lines.push("");
  lines.push(`Range: ${summary.range.from} through ${summary.range.to}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Window | Picks | Correct | Accuracy |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| Overall | ${summary.overall.picks} | ${summary.overall.correct} | ${formatPct(summary.overall.accuracy)} |`);
  lines.push(`| Last 30 | ${summary.last30.picks} | ${summary.last30.correct} | ${formatPct(summary.last30.accuracy)} |`);
  lines.push(`| Last 14 | ${summary.last14.picks} | ${summary.last14.correct} | ${formatPct(summary.last14.accuracy)} |`);
  lines.push("");
  lines.push(`> ${summary.note}`);
  lines.push("");
  lines.push("## Daily Results");
  lines.push("");
  lines.push("| Date | Lock Time UTC | First Game UTC | Picks | W | L | Push | Accuracy | Cumulative Accuracy |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|");
  input.daily.forEach((day) => {
    lines.push(
      `| ${day.date} | ${day.lockTimeUtc ?? "-"} | ${day.firstGameTimeUtc ?? "-"} | ${day.picks} | ${day.wins} | ${day.losses} | ${day.pushes} | ${formatPct(day.accuracyPct)} | ${formatPct(day.cumulativeAccuracyPct)} |`,
    );
  });
  lines.push("");
  lines.push("## Pick Details");
  lines.push("");
  lines.push("| Date | Rank | Player | Market | Side | Line | Actual | Outcome | Tier |");
  lines.push("|---|---:|---|---|---|---:|---:|---|---|");
  input.picks.forEach((pick) => {
    lines.push(
      `| ${pick.date} | ${pick.rank} | ${pick.playerName} | ${pick.market} | ${pick.side} | ${pick.lockedLine} | ${pick.actualValue} | ${pick.outcome} | ${pick.selectorTier ?? "-"} |`,
    );
  });
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const enrichedRows = attachCurrentLineRecencyMetrics(
    payload.playerMarketRows.filter((row) => row.actualMinutes >= MIN_ACTUAL_MINUTES),
  ) as EnrichedRow[];
  const playerPositions = await loadPlayerPositions([...new Set(enrichedRows.map((row) => row.playerId))]);

  const byDate = new Map<string, EnrichedRow[]>();
  enrichedRows.forEach((row) => {
    const bucket = byDate.get(row.gameDateEt) ?? [];
    bucket.push(row);
    byDate.set(row.gameDateEt, bucket);
  });

  const dates = [...byDate.keys()].sort((left, right) => left.localeCompare(right));
  const lockMetaByDate = await loadOnlineFirstGameLockMeta(dates, args.lockLeadMinutes);
  const selected: PickResult[] = [];

  dates.forEach((date) => {
    const rows = byDate.get(date) ?? [];
    const candidates: CandidateRecord[] = [];
    const adaptiveCandidates: CandidateRecord[] = [];
    const shortfallCandidates: CandidateRecord[] = [];
    const fallbackCandidates: CandidateRecord[] = [];

    rows.forEach((row) => {
      const input = buildPrecisionInput(row, playerPositions.get(row.playerId) ?? null);
      const pushCandidate = (target: CandidateRecord[], signal: SnapshotPrecisionPickSignal) => {
        target.push({
          playerId: row.playerId,
          playerName: row.playerName,
          matchupKey: `${row.gameDateEt}:${row.playerId}`,
          market: row.market,
          signal,
          selectionScore: signal.selectionScore ?? 0,
          source: "PRECISION",
          row,
          correct: row.actualSide === signal.side,
          actualValue: row.actualValue,
          actualSide: row.actualSide,
        });
      };

      const strictSignal = buildLegacySeasonStartPrecisionPick(input);
      const strictQualified = strictSignal?.qualified ?? strictSignal?.side !== "NEUTRAL";
      if (strictSignal && strictQualified) {
        pushCandidate(candidates, strictSignal);
        return;
      }

      const adaptiveSignal = buildLegacyAdaptivePrecisionFloorPick(input);
      const adaptiveQualified = adaptiveSignal?.qualified ?? adaptiveSignal?.side !== "NEUTRAL";
      if (adaptiveSignal && adaptiveQualified) {
        pushCandidate(adaptiveCandidates, adaptiveSignal);
        return;
      }

      const shortfallSignal = buildLegacyShortfallPrecisionRescuePick(input);
      const shortfallQualified = shortfallSignal?.qualified ?? shortfallSignal?.side !== "NEUTRAL";
      if (shortfallSignal && shortfallQualified) {
        pushCandidate(shortfallCandidates, shortfallSignal);
        return;
      }

      const fallbackSignal = buildLegacySixPickFallback(input);
      const fallbackQualified = fallbackSignal?.qualified ?? fallbackSignal?.side !== "NEUTRAL";
      if (fallbackSignal && fallbackQualified) {
        pushCandidate(fallbackCandidates, fallbackSignal);
      }
    });

    const daySelections = selectPrecisionCardWithTopOff(
      candidates,
      adaptiveCandidates,
      {
        candidates: adaptiveCandidates,
        ignorePlayerLimit: true,
        ignoreMarketCaps: true,
      },
      shortfallCandidates,
      {
        candidates: fallbackCandidates,
        ignoreMarketCaps: true,
      },
      {
        candidates: fallbackCandidates,
        ignorePlayerLimit: true,
        ignoreMarketCaps: true,
      },
    );
    const allCandidates = [...candidates, ...adaptiveCandidates, ...shortfallCandidates, ...fallbackCandidates];
    const lockMeta = lockMetaByDate.get(date) ?? {
      firstGameTimeUtc: null,
      syntheticLockedAt: null,
      lockLeadMinutes: args.lockLeadMinutes,
    };

    daySelections.forEach((pick, index) => {
      const found = allCandidates.find((candidate) => candidate.playerId === pick.playerId && candidate.market === pick.market);
      if (!found) return;
      const outcome = outcomeForPick(found.signal.side, found.row.line, found.row.actualValue);
      selected.push({
        date,
        lockTimeUtc: lockMeta.syntheticLockedAt,
        firstGameTimeUtc: lockMeta.firstGameTimeUtc,
        rank: index + 1,
        playerName: found.playerName ?? found.row.playerName,
        playerId: found.playerId,
        market: found.market,
        side: found.signal.side,
        lockedLine: found.row.line,
        projectedValue: found.row.projectedValue,
        actualValue: found.row.actualValue,
        actualSide: found.actualSide,
        outcome,
        correct: outcome === "WIN",
        selectionScore: found.selectionScore,
        historicalAccuracy: found.signal.historicalAccuracy ?? null,
        projectionWinProbability: found.signal.projectionWinProbability ?? null,
        projectionPriceEdge: found.signal.projectionPriceEdge ?? null,
        selectorTier: found.signal.selectorTier ?? null,
        expectedMinutes: found.row.expectedMinutes,
        minutesVolatility: found.row.minutesVolatility,
        starterRateLast10: found.row.starterRateLast10,
      });
    });
  });

  const daily = summarizeDaily(dates, selected);
  const summary = {
    generatedAt: new Date().toISOString(),
    label: "Precision season-start replay",
    input: path.relative(process.cwd(), path.resolve(args.input)),
    range: {
      from: daily[0]?.date ?? null,
      to: daily[daily.length - 1]?.date ?? null,
      days: daily.length,
    },
    note:
      "This is the opening-night season-start replay from the available full-season rows. It is not the same as the promoted v6 upstream 90% window, which only has history beginning 2026-02-19.",
    lockPolicy: {
      source: "nba_cdn_schedule",
      sourceUrl: NBA_CDN_SCHEDULE_URL,
      lockLeadMinutes: args.lockLeadMinutes,
      firstGameLockCoveragePct: round(
        (daily.filter((day) => day.firstGameTimeUtc).length / Math.max(daily.length, 1)) * 100,
        2,
      ),
    },
    overall: summarizeWindow(daily),
    last30: summarizeWindow(daily.slice(-30)),
    last14: summarizeWindow(daily.slice(-14)),
    bySelectorTier: summarizeBySelectorTier(selected),
    picksPerDay: daily.length > 0 ? round(selected.length / daily.length, 2) : 0,
    daysBelowSix: daily.filter((day) => day.picks < 6).length,
  };

  const output = { summary, daily, picks: selected };
  await mkdir(path.dirname(args.outPrefix), { recursive: true });
  await writeFile(`${args.outPrefix}.json`, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(
    `${args.outPrefix}-daily.csv`,
    toCsv(daily, [
      "date",
      "lockTimeUtc",
      "firstGameTimeUtc",
      "picks",
      "wins",
      "losses",
      "pushes",
      "accuracyPct",
      "cumulativePicks",
      "cumulativeWins",
      "cumulativeLosses",
      "cumulativeAccuracyPct",
    ]),
    "utf8",
  );
  await writeFile(
    `${args.outPrefix}-picks.csv`,
    toCsv(selected, [
      "date",
      "lockTimeUtc",
      "firstGameTimeUtc",
      "rank",
      "playerName",
      "playerId",
      "market",
      "side",
      "lockedLine",
      "projectedValue",
      "actualValue",
      "actualSide",
      "outcome",
      "correct",
      "selectionScore",
      "historicalAccuracy",
      "projectionWinProbability",
      "projectionPriceEdge",
      "selectorTier",
      "expectedMinutes",
      "minutesVolatility",
      "starterRateLast10",
    ]),
    "utf8",
  );
  await writeFile(`${args.outPrefix}.md`, buildMarkdown({ summary, daily, picks: selected }), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

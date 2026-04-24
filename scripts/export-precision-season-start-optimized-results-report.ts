import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import type { SnapshotMarket, SnapshotModelSide } from "../lib/types/snapshot";
import { round } from "../lib/utils";

type Side = "OVER" | "UNDER";

type TrainingRow = {
  playerId: string;
  playerName: string;
  market: SnapshotMarket;
  gameDateEt: string;
  projectedValue: number;
  actualValue: number;
  line: number;
  projectionSide?: SnapshotModelSide | null;
  finalSide?: SnapshotModelSide | null;
  actualSide: Side;
  priceLean?: number | null;
  expectedMinutes?: number | null;
  minutesVolatility?: number | null;
  starterRateLast10?: number | null;
  actualMinutes: number;
};

type BacktestRowsFile = {
  from: string;
  to: string;
  playerMarketRows: TrainingRow[];
};

type PickResult = {
  date: string;
  lockTimeUtc: string | null;
  firstGameTimeUtc: string | null;
  rank: number;
  playerName: string;
  playerId: string;
  market: SnapshotMarket;
  side: Side;
  lockedLine: number;
  projectedValue: number;
  actualValue: number;
  actualSide: Side;
  outcome: "WIN" | "LOSS" | "PUSH";
  correct: boolean;
  selectionScore: number;
  selectorTier: "projection_abs" | "april_threes_price_min15";
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

type FirstGameLockMeta = {
  firstGameTimeUtc: string | null;
  syntheticLockedAt: string | null;
  lockLeadMinutes: number;
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

type Args = {
  input: string;
  outPrefix: string;
  lockLeadMinutes: number;
};

type Candidate = {
  row: TrainingRow;
  side: Side;
  score: number;
  selectorTier: PickResult["selectorTier"];
};

const MIN_ACTUAL_MINUTES = 15;
const DEFAULT_LOCK_LEAD_MINUTES = 15;
const APRIL_THREES_SWITCH_DATE = "2026-04-01";
const NBA_CDN_SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";
const DEFAULT_OUT_PREFIX = path.join(process.cwd(), "exports", "precision-season-start-optimized-results");

function resolveInputPath(): string {
  try {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  } catch {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
  }
}

function parseArgs(): Args {
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
  }

  return { input, outPrefix, lockLeadMinutes };
}

function nbaCodeDateToEtDate(value: string): string | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})\//);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function loadOnlineFirstGameLockMeta(dates: string[], lockLeadMinutes: number): Promise<Map<string, FirstGameLockMeta>> {
  const wantedDates = new Set(dates);
  const response = await fetch(NBA_CDN_SCHEDULE_URL, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; precision-season-start-optimized-report/1.0)" },
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
      if (!current || parsed.getTime() < current.getTime()) firstByDate.set(dateEt, parsed);
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

function isSide(value: unknown): value is Side {
  return value === "OVER" || value === "UNDER";
}

function buildCandidate(row: TrainingRow, date: string): Candidate | null {
  const projectionGap = row.projectedValue - row.line;
  if (date >= APRIL_THREES_SWITCH_DATE) {
    if (row.market !== "THREES") return null;
    if ((row.expectedMinutes ?? 0) < 15) return null;
    if (!isSide(row.finalSide)) return null;
    return {
      row,
      side: row.finalSide,
      score: Math.abs(projectionGap) + 5 * Math.abs(row.priceLean ?? 0) + (row.finalSide === "UNDER" ? 0.5 : 0),
      selectorTier: "april_threes_price_min15",
    };
  }

  if (!isSide(row.projectionSide)) return null;
  return {
    row,
    side: row.projectionSide,
    score: Math.abs(projectionGap),
    selectorTier: "projection_abs",
  };
}

function selectDailyCandidates(date: string, rows: TrainingRow[]): Candidate[] {
  const candidates = rows
    .map((row) => buildCandidate(row, date))
    .filter((candidate): candidate is Candidate => candidate != null)
    .sort((left, right) => right.score - left.score || left.row.playerName.localeCompare(right.row.playerName));
  const selected: Candidate[] = [];
  const selectedPlayers = new Set<string>();
  const selectedPairs = new Set<string>();
  const marketCounts = new Map<SnapshotMarket, number>();
  const marketCap = date >= APRIL_THREES_SWITCH_DATE ? 6 : 2;

  for (const candidate of candidates) {
    if (selected.length >= 6) break;
    const pairKey = `${candidate.row.playerId}|${candidate.row.market}`;
    if (selectedPlayers.has(candidate.row.playerId) || selectedPairs.has(pairKey)) continue;
    const currentMarketCount = marketCounts.get(candidate.row.market) ?? 0;
    if (currentMarketCount >= marketCap) continue;
    selected.push(candidate);
    selectedPlayers.add(candidate.row.playerId);
    selectedPairs.add(pairKey);
    marketCounts.set(candidate.row.market, currentMarketCount + 1);
  }

  for (const candidate of candidates) {
    if (selected.length >= 6) break;
    const pairKey = `${candidate.row.playerId}|${candidate.row.market}`;
    if (selectedPlayers.has(candidate.row.playerId) || selectedPairs.has(pairKey)) continue;
    selected.push(candidate);
    selectedPlayers.add(candidate.row.playerId);
    selectedPairs.add(pairKey);
  }

  if (selected.length < 6) {
    throw new Error(`Only selected ${selected.length} picks for ${date}; six are required.`);
  }
  return selected;
}

function outcomeForPick(side: Side, line: number, actualValue: number): PickResult["outcome"] {
  if (actualValue === line) return "PUSH";
  if (side === "OVER") return actualValue > line ? "WIN" : "LOSS";
  return actualValue < line ? "WIN" : "LOSS";
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
  return dates.map((date) => {
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

function summarizeByTier(picks: PickResult[]) {
  const buckets = new Map<string, PickResult[]>();
  picks.forEach((pick) => {
    const bucket = buckets.get(pick.selectorTier) ?? [];
    bucket.push(pick);
    buckets.set(pick.selectorTier, bucket);
  });
  return Object.fromEntries(
    Array.from(buckets.entries()).map(([tier, tierPicks]) => {
      const wins = tierPicks.filter((pick) => pick.outcome === "WIN").length;
      return [
        tier,
        {
          picks: tierPicks.length,
          correct: wins,
          accuracyPct: round((wins / tierPicks.length) * 100, 2),
        },
      ] as const;
    }),
  );
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv<T extends Record<string, unknown>>(rows: T[], headers: Array<keyof T>): string {
  return [headers.map((header) => csvCell(header)).join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n";
}

function formatPct(value: number | null | undefined): string {
  return value == null ? "-" : `${value.toFixed(2)}%`;
}

function buildMarkdown(input: { summary: Record<string, unknown>; daily: DailyResult[]; picks: PickResult[] }): string {
  const summary = input.summary as {
    range: { from: string; to: string; days: number };
    overall: { picks: number; correct: number; accuracy: number | null };
    last30: { picks: number; correct: number; accuracy: number | null };
    last14: { picks: number; correct: number; accuracy: number | null };
    note: string;
  };
  const lines: string[] = [];
  lines.push("# Precision Season-Start Optimized Results");
  lines.push("");
  lines.push(`Range: ${summary.range.from} through ${summary.range.to}`);
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
  lines.push("| Date | Picks | W | L | Accuracy | Cumulative Accuracy |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  input.daily.forEach((day) => {
    lines.push(`| ${day.date} | ${day.picks} | ${day.wins} | ${day.losses} | ${formatPct(day.accuracyPct)} | ${formatPct(day.cumulativeAccuracyPct)} |`);
  });
  lines.push("");
  lines.push("## Pick Details");
  lines.push("");
  lines.push("| Date | Rank | Player | Market | Side | Line | Actual | Outcome | Tier |");
  lines.push("|---|---:|---|---|---|---:|---:|---|---|");
  input.picks.forEach((pick) => {
    lines.push(`| ${pick.date} | ${pick.rank} | ${pick.playerName} | ${pick.market} | ${pick.side} | ${pick.lockedLine} | ${pick.actualValue} | ${pick.outcome} | ${pick.selectorTier} |`);
  });
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const rows = payload.playerMarketRows.filter(
    (row) => row.actualMinutes >= MIN_ACTUAL_MINUTES && isSide(row.actualSide),
  );
  const byDate = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const bucket = byDate.get(row.gameDateEt) ?? [];
    bucket.push(row);
    byDate.set(row.gameDateEt, bucket);
  });

  const dates = Array.from(byDate.keys()).sort((left, right) => left.localeCompare(right));
  const lockMetaByDate = await loadOnlineFirstGameLockMeta(dates, args.lockLeadMinutes);
  const picks: PickResult[] = [];

  dates.forEach((date) => {
    const lockMeta = lockMetaByDate.get(date) ?? {
      firstGameTimeUtc: null,
      syntheticLockedAt: null,
      lockLeadMinutes: args.lockLeadMinutes,
    };
    const selections = selectDailyCandidates(date, byDate.get(date) ?? []);
    selections.forEach((selection, index) => {
      const outcome = outcomeForPick(selection.side, selection.row.line, selection.row.actualValue);
      picks.push({
        date,
        lockTimeUtc: lockMeta.syntheticLockedAt,
        firstGameTimeUtc: lockMeta.firstGameTimeUtc,
        rank: index + 1,
        playerName: selection.row.playerName,
        playerId: selection.row.playerId,
        market: selection.row.market,
        side: selection.side,
        lockedLine: selection.row.line,
        projectedValue: selection.row.projectedValue,
        actualValue: selection.row.actualValue,
        actualSide: selection.row.actualSide,
        outcome,
        correct: outcome === "WIN",
        selectionScore: round(selection.score, 6),
        selectorTier: selection.selectorTier,
        expectedMinutes: selection.row.expectedMinutes ?? null,
        minutesVolatility: selection.row.minutesVolatility ?? null,
        starterRateLast10: selection.row.starterRateLast10 ?? null,
      });
    });
  });

  const daily = summarizeDaily(dates, picks);
  const summary = {
    generatedAt: new Date().toISOString(),
    label: "Precision season-start optimized replay",
    input: path.relative(process.cwd(), path.resolve(args.input)),
    range: {
      from: daily[0]?.date ?? null,
      to: daily[daily.length - 1]?.date ?? null,
      days: daily.length,
    },
    note:
      "Optimized in-sample over the opening-night-through-current row artifact. Overall clears 70%, but last-30 and last-14 remain below 70 and should be treated as the live risk signal.",
    strategy: {
      before: `${APRIL_THREES_SWITCH_DATE}: top projection-side candidates by absolute projection gap, max 2 per market.`,
      fromSwitchDate: "THREES only, final side, expected minutes >= 15, ranked by projection gap plus price-lean strength with a small UNDER boost.",
      targetPicksPerDay: 6,
    },
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
    bySelectorTier: summarizeByTier(picks),
    picksPerDay: daily.length > 0 ? round(picks.length / daily.length, 2) : 0,
    daysBelowSix: daily.filter((day) => day.picks < 6).length,
  };

  const output = { summary, daily, picks };
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
    toCsv(picks, [
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
      "selectorTier",
      "expectedMinutes",
      "minutesVolatility",
      "starterRateLast10",
    ]),
    "utf8",
  );
  await writeFile(`${args.outPrefix}.md`, buildMarkdown(output), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

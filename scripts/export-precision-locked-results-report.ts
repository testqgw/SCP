import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma";
import type { SnapshotMarket, SnapshotModelSide } from "../lib/types/snapshot";
import { round } from "../lib/utils";

type LockedReplay = {
  version?: string;
  generatedAt?: string;
  firstGameLockPolicy?: {
    source?: string;
    sourceUrl?: string | null;
    lockLeadMinutes?: number;
    caveat?: string;
  };
  summary?: {
    overall?: { picks: number; correct: number; accuracy: number };
    last30?: { picks: number; correct: number; accuracy: number };
    last14?: { picks: number; correct: number; accuracy: number };
    picksPerDay?: number;
    daysBelowSix?: number;
    firstGameLockCoveragePct?: number;
  };
  daily?: Array<{
    date: string;
    picks: number;
    correct: number;
    accuracy: number | null;
    firstGameTimeUtc: string | null;
    syntheticLockedAt: string | null;
    lockLeadMinutes: number;
  }>;
  picks?: Array<{
    date: string;
    rank: number;
    playerId: string;
    playerName: string;
    market: SnapshotMarket;
    side: SnapshotModelSide;
    correct: boolean;
    selectionScore: number;
    lockedLine: number;
    holdoutAccuracy: number | null;
    modelAccuracy: number;
    projectedValue: number;
    lineGap: number;
    absLineGap: number;
    expectedMinutes: number | null;
    minutesVolatility: number | null;
    starterRateLast10: number | null;
    firstGameTimeUtc: string | null;
    syntheticLockedAt: string | null;
    lockLeadMinutes: number;
  }>;
};

type ActualLog = {
  playerId: string;
  gameDateEt: string;
  played: boolean | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threes: number | null;
};

type PickResult = {
  date: string;
  lockTimeUtc: string | null;
  firstGameTimeUtc: string | null;
  rank: number;
  playerName: string;
  playerId: string;
  market: SnapshotMarket;
  side: SnapshotModelSide;
  lockedLine: number;
  projectedValue: number;
  actualValue: number | null;
  outcome: "WIN" | "LOSS" | "PUSH" | "PENDING";
  correct: boolean | null;
  selectionScore: number;
  holdoutAccuracy: number | null;
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
  pending: number;
  accuracyPct: number | null;
  cumulativePicks: number;
  cumulativeWins: number;
  cumulativeLosses: number;
  cumulativeAccuracyPct: number | null;
};

const DEFAULT_INPUT_PATH = path.join(process.cwd(), "exports", "precision-upstream-locked-pregame-history-replay.json");
const DEFAULT_OUT_PREFIX = path.join(process.cwd(), "exports", "precision-locked-pregame-results");

function parseArgs(): { input: string; outPrefix: string } {
  const args = process.argv.slice(2);
  let input = DEFAULT_INPUT_PATH;
  let outPrefix = DEFAULT_OUT_PREFIX;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];
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
    }
  }

  return { input, outPrefix };
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

function actualValueForMarket(log: ActualLog | null, market: SnapshotMarket): number | null {
  if (!log || log.played === false) return null;
  const points = log.points ?? null;
  const rebounds = log.rebounds ?? null;
  const assists = log.assists ?? null;
  switch (market) {
    case "PTS":
      return points;
    case "REB":
      return rebounds;
    case "AST":
      return assists;
    case "THREES":
      return log.threes ?? null;
    case "PRA":
      return points == null || rebounds == null || assists == null ? null : points + rebounds + assists;
    case "PA":
      return points == null || assists == null ? null : points + assists;
    case "PR":
      return points == null || rebounds == null ? null : points + rebounds;
    case "RA":
      return rebounds == null || assists == null ? null : rebounds + assists;
    default:
      return null;
  }
}

function outcomeForPick(side: SnapshotModelSide, line: number | null, actualValue: number | null): PickResult["outcome"] {
  if ((side !== "OVER" && side !== "UNDER") || line == null || actualValue == null) return "PENDING";
  if (actualValue === line) return "PUSH";
  if (side === "OVER") return actualValue > line ? "WIN" : "LOSS";
  return actualValue < line ? "WIN" : "LOSS";
}

function formatPct(value: number | null | undefined): string {
  return value == null ? "-" : `${value.toFixed(2)}%`;
}

function buildMarkdown(input: {
  replay: LockedReplay;
  daily: DailyResult[];
  picks: PickResult[];
}): string {
  const summary = input.replay.summary;
  const firstDate = input.daily[0]?.date ?? "-";
  const lastDate = input.daily[input.daily.length - 1]?.date ?? "-";
  const lines: string[] = [];
  lines.push("# Precision Locked Pregame Results");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Range: ${firstDate} through ${lastDate}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Window | Picks | Correct | Accuracy |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| Overall | ${summary?.overall?.picks ?? 0} | ${summary?.overall?.correct ?? 0} | ${formatPct(summary?.overall?.accuracy)} |`);
  lines.push(`| Last 30 locked slates | ${summary?.last30?.picks ?? 0} | ${summary?.last30?.correct ?? 0} | ${formatPct(summary?.last30?.accuracy)} |`);
  lines.push(`| Last 14 locked slates | ${summary?.last14?.picks ?? 0} | ${summary?.last14?.correct ?? 0} | ${formatPct(summary?.last14?.accuracy)} |`);
  lines.push("");
  lines.push(`Picks per day: ${summary?.picksPerDay ?? 0}`);
  lines.push(`Days below six picks: ${summary?.daysBelowSix ?? 0}`);
  lines.push(`First-game lock coverage: ${formatPct(summary?.firstGameLockCoveragePct)}`);
  lines.push("");
  lines.push("## Lock Policy");
  lines.push("");
  lines.push(`Source: ${input.replay.firstGameLockPolicy?.source ?? "-"}`);
  lines.push(`Source URL: ${input.replay.firstGameLockPolicy?.sourceUrl ?? "-"}`);
  lines.push(`Lock lead: ${input.replay.firstGameLockPolicy?.lockLeadMinutes ?? "-"} minutes before first game`);
  lines.push("");
  lines.push("> Note: this report covers the locked Precision v6 history currently available in the replay artifact. Historical rows before this window are not part of the locked v6 dataset.");
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
  lines.push("| Date | Rank | Player | Market | Side | Line | Actual | Outcome | Score |");
  lines.push("|---|---:|---|---|---|---:|---:|---|---:|");
  input.picks.forEach((pick) => {
    lines.push(
      `| ${pick.date} | ${pick.rank} | ${pick.playerName} | ${pick.market} | ${pick.side} | ${pick.lockedLine} | ${pick.actualValue ?? "-"} | ${pick.outcome} | ${pick.selectionScore} |`,
    );
  });
  lines.push("");
  return lines.join("\n");
}

function summarizeDaily(picks: PickResult[]): DailyResult[] {
  const byDate = new Map<string, PickResult[]>();
  picks.forEach((pick) => {
    const bucket = byDate.get(pick.date) ?? [];
    bucket.push(pick);
    byDate.set(pick.date, bucket);
  });
  let cumulativeWins = 0;
  let cumulativeLosses = 0;
  let cumulativePicks = 0;
  return Array.from(byDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dayPicks]) => {
      const wins = dayPicks.filter((pick) => pick.outcome === "WIN").length;
      const losses = dayPicks.filter((pick) => pick.outcome === "LOSS").length;
      const pushes = dayPicks.filter((pick) => pick.outcome === "PUSH").length;
      const pending = dayPicks.filter((pick) => pick.outcome === "PENDING").length;
      cumulativeWins += wins;
      cumulativeLosses += losses;
      cumulativePicks += dayPicks.length;
      return {
        date,
        lockTimeUtc: dayPicks[0]?.lockTimeUtc ?? null,
        firstGameTimeUtc: dayPicks[0]?.firstGameTimeUtc ?? null,
        picks: dayPicks.length,
        wins,
        losses,
        pushes,
        pending,
        accuracyPct: wins + losses > 0 ? round((wins / (wins + losses)) * 100, 2) : null,
        cumulativePicks,
        cumulativeWins,
        cumulativeLosses,
        cumulativeAccuracyPct:
          cumulativeWins + cumulativeLosses > 0 ? round((cumulativeWins / (cumulativeWins + cumulativeLosses)) * 100, 2) : null,
      };
    });
}

async function main(): Promise<void> {
  const args = parseArgs();
  const replay = JSON.parse(await readFile(args.input, "utf8")) as LockedReplay;
  const replayPicks = replay.picks ?? [];
  const dates = Array.from(new Set(replayPicks.map((pick) => pick.date)));
  const playerIds = Array.from(new Set(replayPicks.map((pick) => pick.playerId)));

  const logs =
    dates.length > 0 && playerIds.length > 0
      ? await prisma.playerGameLog.findMany({
          where: {
            gameDateEt: { in: dates },
            playerId: { in: playerIds },
          },
          select: {
            playerId: true,
            gameDateEt: true,
            played: true,
            points: true,
            rebounds: true,
            assists: true,
            threes: true,
          },
        })
      : [];
  const logByKey = new Map(logs.map((log) => [`${log.playerId}|${log.gameDateEt}`, log] as const));

  const picks = replayPicks
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || left.rank - right.rank)
    .map((pick) => {
      const log = logByKey.get(`${pick.playerId}|${pick.date}`) ?? null;
      const actualValue = actualValueForMarket(log, pick.market);
      const outcome = outcomeForPick(pick.side, pick.lockedLine, actualValue);
      return {
        date: pick.date,
        lockTimeUtc: pick.syntheticLockedAt,
        firstGameTimeUtc: pick.firstGameTimeUtc,
        rank: pick.rank,
        playerName: pick.playerName,
        playerId: pick.playerId,
        market: pick.market,
        side: pick.side,
        lockedLine: pick.lockedLine,
        projectedValue: pick.projectedValue,
        actualValue,
        outcome,
        correct: outcome === "PUSH" || outcome === "PENDING" ? null : outcome === "WIN",
        selectionScore: pick.selectionScore,
        holdoutAccuracy: pick.holdoutAccuracy,
        expectedMinutes: pick.expectedMinutes,
        minutesVolatility: pick.minutesVolatility,
        starterRateLast10: pick.starterRateLast10,
      } satisfies PickResult;
    });

  const daily = summarizeDaily(picks);
  const summary = {
    generatedAt: new Date().toISOString(),
    input: path.relative(process.cwd(), args.input),
    range: {
      from: daily[0]?.date ?? null,
      to: daily[daily.length - 1]?.date ?? null,
      days: daily.length,
    },
    overall: replay.summary?.overall ?? null,
    last30: replay.summary?.last30 ?? null,
    last14: replay.summary?.last14 ?? null,
    picksPerDay: replay.summary?.picksPerDay ?? null,
    daysBelowSix: replay.summary?.daysBelowSix ?? null,
    firstGameLockCoveragePct: replay.summary?.firstGameLockCoveragePct ?? null,
    lockPolicy: replay.firstGameLockPolicy ?? null,
  };

  const output = {
    summary,
    daily,
    picks,
  };

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
      "pending",
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
      "outcome",
      "correct",
      "selectionScore",
      "holdoutAccuracy",
      "expectedMinutes",
      "minutesVolatility",
      "starterRateLast10",
    ]),
    "utf8",
  );
  await writeFile(`${args.outPrefix}.md`, buildMarkdown({ replay, daily, picks }), "utf8");

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

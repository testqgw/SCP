import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma";
import {
  PRECISION_PREGAME_LOCK_SETTING_KEY_PREFIX,
  readPrecisionPregameLock,
  type SnapshotPrecisionPregameLock,
} from "../lib/snapshot/precisionPregameLock";
import type { SnapshotMarket, SnapshotModelSide, SnapshotPrecisionCardEntry } from "../lib/types/snapshot";
import { round } from "../lib/utils";

type PrecisionLockOutcome = "WIN" | "LOSS" | "PUSH" | "PENDING";

type ActualLog = {
  playerId: string;
  played: boolean | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threes: number | null;
};

type EvaluatedPregamePick = {
  dateEt: string;
  lockedAt: string;
  firstGameTimeUtc: string;
  rank: number;
  playerId: string;
  market: SnapshotMarket;
  side: SnapshotModelSide;
  line: number | null;
  actualValue: number | null;
  outcome: PrecisionLockOutcome;
};

type DailyPregameResult = {
  dateEt: string;
  lockedAt: string;
  firstGameTimeUtc: string;
  picks: number;
  graded: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  accuracyPct: number | null;
};

const DEFAULT_OUTPUT_PATH = path.join(process.cwd(), "exports", "precision-pregame-lock-backtest.json");

function parseArgs(): { out: string } {
  const args = process.argv.slice(2);
  let out = DEFAULT_OUTPUT_PATH;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];
    if ((token === "--out" || token === "-o") && next) {
      out = path.isAbsolute(next) ? next : path.join(process.cwd(), next);
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      const value = token.slice("--out=".length);
      out = path.isAbsolute(value) ? value : path.join(process.cwd(), value);
    }
  }
  return { out };
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

function resolveOutcome(side: SnapshotModelSide, line: number | null, actualValue: number | null): PrecisionLockOutcome {
  if ((side !== "OVER" && side !== "UNDER") || line == null || actualValue == null) return "PENDING";
  if (actualValue === line) return "PUSH";
  if (side === "OVER") return actualValue > line ? "WIN" : "LOSS";
  return actualValue < line ? "WIN" : "LOSS";
}

function summarizeDaily(lock: SnapshotPrecisionPregameLock, picks: EvaluatedPregamePick[]): DailyPregameResult {
  const wins = picks.filter((pick) => pick.outcome === "WIN").length;
  const losses = picks.filter((pick) => pick.outcome === "LOSS").length;
  const pushes = picks.filter((pick) => pick.outcome === "PUSH").length;
  const pending = picks.filter((pick) => pick.outcome === "PENDING").length;
  const graded = wins + losses + pushes;
  return {
    dateEt: lock.dateEt,
    lockedAt: lock.lockedAt,
    firstGameTimeUtc: lock.firstGameTimeUtc,
    picks: picks.length,
    graded,
    wins,
    losses,
    pushes,
    pending,
    accuracyPct: wins + losses > 0 ? round((wins / (wins + losses)) * 100, 2) : null,
  };
}

function summarizeWindow(days: DailyPregameResult[]) {
  const picks = days.reduce((sum, day) => sum + day.picks, 0);
  const graded = days.reduce((sum, day) => sum + day.graded, 0);
  const wins = days.reduce((sum, day) => sum + day.wins, 0);
  const losses = days.reduce((sum, day) => sum + day.losses, 0);
  const pushes = days.reduce((sum, day) => sum + day.pushes, 0);
  const pending = days.reduce((sum, day) => sum + day.pending, 0);
  return {
    days: days.length,
    picks,
    graded,
    wins,
    losses,
    pushes,
    pending,
    accuracyPct: wins + losses > 0 ? round((wins / (wins + losses)) * 100, 2) : null,
    picksPerLockedDay: days.length > 0 ? round(picks / days.length, 2) : 0,
  };
}

function pickSide(entry: SnapshotPrecisionCardEntry): SnapshotModelSide {
  return entry.precisionSignal?.side ?? "NEUTRAL";
}

async function evaluateLock(lock: SnapshotPrecisionPregameLock): Promise<{
  daily: DailyPregameResult;
  picks: EvaluatedPregamePick[];
}> {
  const playerIds = Array.from(new Set(lock.precisionCard.map((entry) => entry.playerId)));
  const logs =
    playerIds.length > 0
      ? await prisma.playerGameLog.findMany({
          where: {
            gameDateEt: lock.dateEt,
            playerId: { in: playerIds },
          },
          select: {
            playerId: true,
            played: true,
            points: true,
            rebounds: true,
            assists: true,
            threes: true,
          },
        })
      : [];
  const logByPlayerId = new Map(logs.map((log) => [log.playerId, log] as const));
  const picks = lock.precisionCard.map((entry) => {
    const log = logByPlayerId.get(entry.playerId) ?? null;
    const actualValue = actualValueForMarket(log, entry.market);
    const side = pickSide(entry);
    const line = entry.lockedLine ?? null;
    return {
      dateEt: lock.dateEt,
      lockedAt: lock.lockedAt,
      firstGameTimeUtc: lock.firstGameTimeUtc,
      rank: entry.rank,
      playerId: entry.playerId,
      market: entry.market,
      side,
      line,
      actualValue,
      outcome: resolveOutcome(side, line, actualValue),
    } satisfies EvaluatedPregamePick;
  });
  return {
    daily: summarizeDaily(lock, picks),
    picks,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const settings = await prisma.systemSetting.findMany({
    where: { key: { startsWith: PRECISION_PREGAME_LOCK_SETTING_KEY_PREFIX } },
    select: { key: true, value: true, updatedAt: true },
    orderBy: { key: "asc" },
  });
  const locks = settings
    .flatMap((setting) => {
      const lock = readPrecisionPregameLock(setting.value);
      return lock ? [lock] : [];
    })
    .sort((left, right) => left.dateEt.localeCompare(right.dateEt));

  const evaluated = [];
  for (const lock of locks) {
    evaluated.push(await evaluateLock(lock));
  }

  const daily = evaluated.map((item) => item.daily);
  const picks = evaluated.flatMap((item) => item.picks);
  const output = {
    version: "precision-pregame-lock-backtest-v1",
    generatedAt: new Date().toISOString(),
    sourceSettingPrefix: PRECISION_PREGAME_LOCK_SETTING_KEY_PREFIX,
    note:
      locks.length === 0
        ? "No locked pre-first-game Precision cards exist yet. This tracker starts once the precision-lock cron captures a slate before first tip."
        : "Accuracy is graded only from immutable Precision cards stored before the first game of the slate.",
    summary: {
      lockCount: locks.length,
      overall: summarizeWindow(daily),
      last30: summarizeWindow(daily.slice(-30)),
      last14: summarizeWindow(daily.slice(-14)),
      daysBelowSixPicks: daily.filter((day) => day.picks < 6).length,
    },
    daily,
    picks,
  };

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

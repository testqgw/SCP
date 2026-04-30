import { PrismaClient } from "@prisma/client";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalTeamCode, normalizePlayerName } from "../lib/lineups/rotowire";
import type { SnapshotMarket, SnapshotModelSide } from "../lib/types/snapshot";
import {
  listSnapshotDates,
  PROP_LINE_SNAPSHOT_DIR,
  readSnapshotRowsForDate,
  roundNumber,
  summarizeSnapshotRows,
  type IntradayPropLineMovementEntry,
} from "./utils/intradayPropLineSnapshots";

type Args = {
  dateEt: string | null;
  outDir: string;
  outFile: string;
};

type ActualLog = {
  playerId: string;
  externalPlayerId: string | null;
  playerName: string;
  dateEt: string;
  matchupKey: string | null;
  actuals: Record<SnapshotMarket, number | null>;
};

type TrainingRow = IntradayPropLineMovementEntry & {
  playerId: string | null;
  externalPlayerId: string | null;
  actualValue: number | null;
  actualSideAtFirstLine: SnapshotModelSide | "PUSH" | null;
  actualSideAtLastLine: SnapshotModelSide | "PUSH" | null;
  lineMovePressureHit: boolean | null;
};

const prisma = new PrismaClient();

function parseArgs(): Args {
  const tokens = process.argv.slice(2);
  let dateEt: string | null = null;
  let outDir = PROP_LINE_SNAPSHOT_DIR;
  let outFile = path.join(PROP_LINE_SNAPSHOT_DIR, "intraday-prop-training-dataset.json");

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if ((token === "--date" || token === "-d") && next) {
      dateEt = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--date=")) {
      dateEt = token.slice("--date=".length);
      continue;
    }
    if ((token === "--out-dir" || token === "-o") && next) {
      outDir = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out-dir=")) {
      outDir = token.slice("--out-dir=".length);
      continue;
    }
    if ((token === "--out" || token === "--out-file") && next) {
      outFile = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      outFile = token.slice("--out=".length);
      continue;
    }
  }

  if (dateEt && !/^\d{4}-\d{2}-\d{2}$/.test(dateEt)) {
    throw new Error(`Invalid --date value: ${dateEt}. Expected YYYY-MM-DD.`);
  }

  return { dateEt, outDir, outFile };
}

function metricActual(market: SnapshotMarket, points: number | null, rebounds: number | null, assists: number | null, threes: number | null): number | null {
  if (market === "PTS") return points;
  if (market === "REB") return rebounds;
  if (market === "AST") return assists;
  if (market === "THREES") return threes;
  if (market === "PRA") return points == null || rebounds == null || assists == null ? null : points + rebounds + assists;
  if (market === "PA") return points == null || assists == null ? null : points + assists;
  if (market === "PR") return points == null || rebounds == null ? null : points + rebounds;
  return rebounds == null || assists == null ? null : rebounds + assists;
}

function actualSide(actualValue: number | null, line: number | null): SnapshotModelSide | "PUSH" | null {
  if (actualValue == null || line == null) return null;
  if (actualValue > line) return "OVER";
  if (actualValue < line) return "UNDER";
  return "PUSH";
}

function matchupKeyForLog(row: { isHome: boolean | null; team: { abbreviation: string } | null; opponentTeam: { abbreviation: string } | null }): string | null {
  const teamCode = row.team?.abbreviation ? canonicalTeamCode(row.team.abbreviation) : null;
  const opponentCode = row.opponentTeam?.abbreviation ? canonicalTeamCode(row.opponentTeam.abbreviation) : null;
  if (!teamCode || !opponentCode || row.isHome == null) return null;
  return row.isHome ? `${opponentCode}@${teamCode}` : `${teamCode}@${opponentCode}`;
}

async function loadActualLogs(dates: string[]): Promise<Map<string, ActualLog>> {
  if (dates.length === 0) return new Map();

  const logs = await prisma.playerGameLog.findMany({
    where: {
      gameDateEt: { in: dates },
      minutes: { gt: 0 },
    },
    select: {
      gameDateEt: true,
      isHome: true,
      points: true,
      rebounds: true,
      assists: true,
      threes: true,
      playerId: true,
      player: {
        select: {
          externalId: true,
          fullName: true,
        },
      },
      team: {
        select: {
          abbreviation: true,
        },
      },
      opponentTeam: {
        select: {
          abbreviation: true,
        },
      },
    },
  });

  const byExact = new Map<string, ActualLog>();
  const byDateName = new Map<string, ActualLog[]>();

  for (const log of logs) {
    const matchupKey = matchupKeyForLog(log);
    const playerName = normalizePlayerName(log.player.fullName);
    const points = log.points == null ? null : Number(log.points);
    const rebounds = log.rebounds == null ? null : Number(log.rebounds);
    const assists = log.assists == null ? null : Number(log.assists);
    const threes = log.threes == null ? null : Number(log.threes);
    const actual: ActualLog = {
      playerId: log.playerId,
      externalPlayerId: log.player.externalId,
      playerName,
      dateEt: log.gameDateEt,
      matchupKey,
      actuals: {
        PTS: metricActual("PTS", points, rebounds, assists, threes),
        REB: metricActual("REB", points, rebounds, assists, threes),
        AST: metricActual("AST", points, rebounds, assists, threes),
        THREES: metricActual("THREES", points, rebounds, assists, threes),
        PRA: metricActual("PRA", points, rebounds, assists, threes),
        PA: metricActual("PA", points, rebounds, assists, threes),
        PR: metricActual("PR", points, rebounds, assists, threes),
        RA: metricActual("RA", points, rebounds, assists, threes),
      },
    };

    if (matchupKey) {
      byExact.set(`${log.gameDateEt}|${playerName}|${matchupKey}`, actual);
    }
    const looseKey = `${log.gameDateEt}|${playerName}`;
    const looseBucket = byDateName.get(looseKey) ?? [];
    looseBucket.push(actual);
    byDateName.set(looseKey, looseBucket);
  }

  for (const [key, bucket] of byDateName.entries()) {
    if (bucket.length === 1) {
      byExact.set(key, bucket[0]);
    }
  }

  return byExact;
}

function findActual(actuals: Map<string, ActualLog>, entry: IntradayPropLineMovementEntry): ActualLog | null {
  return (
    actuals.get(`${entry.dateEt}|${entry.playerName}|${entry.matchupKey}`) ??
    actuals.get(`${entry.dateEt}|${entry.playerName}`) ??
    null
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dates = args.dateEt ? [args.dateEt] : await listSnapshotDates(args.outDir);
  const entries: IntradayPropLineMovementEntry[] = [];

  for (const dateEt of dates) {
    const rows = await readSnapshotRowsForDate(args.outDir, dateEt);
    entries.push(...summarizeSnapshotRows(rows, dateEt).entries);
  }

  const actuals = await loadActualLogs(Array.from(new Set(entries.map((entry) => entry.dateEt))));
  const trainingRows: TrainingRow[] = entries.map((entry) => {
    const actual = findActual(actuals, entry);
    const actualValue = actual?.actuals[entry.market] ?? null;
    const firstSide = actualSide(actualValue, entry.firstLine);
    const lastSide = actualSide(actualValue, entry.lastLine);
    const lineMovePressureHit =
      entry.lineMovePressureSide === "NEUTRAL" || lastSide == null || lastSide === "PUSH"
        ? null
        : lastSide === entry.lineMovePressureSide;

    return {
      ...entry,
      firstLine: roundNumber(entry.firstLine),
      lastLine: roundNumber(entry.lastLine),
      minLine: roundNumber(entry.minLine),
      maxLine: roundNumber(entry.maxLine),
      playerId: actual?.playerId ?? null,
      externalPlayerId: actual?.externalPlayerId ?? null,
      actualValue,
      actualSideAtFirstLine: firstSide,
      actualSideAtLastLine: lastSide,
      lineMovePressureHit,
    };
  });

  const settledRows = trainingRows.filter((row) => row.actualValue != null);
  const pressureRows = settledRows.filter((row) => row.lineMovePressureHit != null);
  const pressureHits = pressureRows.filter((row) => row.lineMovePressureHit).length;

  await writeFile(
    args.outFile,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceDir: args.outDir,
        dates,
        rowCount: trainingRows.length,
        settledRowCount: settledRows.length,
        movedPressureRowCount: pressureRows.length,
        movedPressureHitRate: pressureRows.length ? roundNumber((pressureHits / pressureRows.length) * 100, 2) : null,
        rows: trainingRows,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        outFile: args.outFile,
        rowCount: trainingRows.length,
        settledRowCount: settledRows.length,
        movedPressureRowCount: pressureRows.length,
        movedPressureHitRate: pressureRows.length ? roundNumber((pressureHits / pressureRows.length) * 100, 2) : null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { getTodayEtDateString, inferSeasonFromEtDate } from "../lib/snapshot/time";

type Args = {
  season: string;
  from: string;
  to: string;
  out: string;
};

type AggregateRow = {
  playerName: string;
  team: string;
  games: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  pointsPerGame: number;
  reboundsPerGame: number;
  assistsPerGame: number;
  threesPerGame: number;
};

function parseArgs(): Args {
  const todayEt = getTodayEtDateString();
  const defaultSeason = inferSeasonFromEtDate(todayEt);
  const raw = process.argv.slice(2);

  let season = defaultSeason;
  let from = `${defaultSeason}-10-01`;
  let to = todayEt;
  let out = path.join("exports", `nba-season-${defaultSeason}-player-game-logs.csv`);

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    const next = raw[i + 1];

    if ((token === "--season" || token === "-s") && next) {
      season = next;
      from = `${season}-10-01`;
      out = path.join("exports", `nba-season-${season}-player-game-logs.csv`);
      i += 1;
      continue;
    }
    if (token.startsWith("--season=")) {
      season = token.slice("--season=".length);
      from = `${season}-10-01`;
      out = path.join("exports", `nba-season-${season}-player-game-logs.csv`);
      continue;
    }

    if (token === "--from" && next) {
      from = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--from=")) {
      from = token.slice("--from=".length);
      continue;
    }

    if (token === "--to" && next) {
      to = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--to=")) {
      to = token.slice("--to=".length);
      continue;
    }

    if ((token === "--out" || token === "-o") && next) {
      out = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
  }

  return { season, from, to, out };
}

function isEtDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function csvCell(value: string | number | null): string {
  if (value == null) {
    return "";
  }
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

function toCsvLine(values: Array<string | number | null>): string {
  return values.map((value) => csvCell(value)).join(",");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!isEtDate(args.from) || !isEtDate(args.to)) {
    throw new Error("Dates must be YYYY-MM-DD (ET). Example: --from 2025-10-01 --to 2026-02-28");
  }

  const logs = await prisma.playerGameLog.findMany({
    where: {
      gameDateEt: {
        gte: args.from,
        lte: args.to,
      },
      minutes: { gt: 0 },
    },
    include: {
      player: { select: { fullName: true } },
      team: { select: { abbreviation: true } },
      opponentTeam: { select: { abbreviation: true } },
    },
    orderBy: [{ gameDateEt: "asc" }, { player: { fullName: "asc" } }],
  });

  const header = [
    "gameDateEt",
    "playerName",
    "team",
    "opponent",
    "minutes",
    "points",
    "rebounds",
    "assists",
    "threes",
  ];

  const lines = [toCsvLine(header)];
  logs.forEach((log) => {
    lines.push(
      toCsvLine([
        log.gameDateEt,
        log.player.fullName,
        log.team?.abbreviation ?? "",
        log.opponentTeam?.abbreviation ?? "",
        log.minutes,
        log.points,
        log.rebounds,
        log.assists,
        log.threes,
      ]),
    );
  });

  const outputPath = path.isAbsolute(args.out) ? args.out : path.join(process.cwd(), args.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");

  const byPlayer = new Map<string, AggregateRow>();
  logs.forEach((log) => {
    const key = log.playerId;
    const current =
      byPlayer.get(key) ??
      {
        playerName: log.player.fullName,
        team: log.team?.abbreviation ?? "",
        games: 0,
        points: 0,
        rebounds: 0,
        assists: 0,
        threes: 0,
        pointsPerGame: 0,
        reboundsPerGame: 0,
        assistsPerGame: 0,
        threesPerGame: 0,
      };

    current.games += 1;
    current.points += log.points ?? 0;
    current.rebounds += log.rebounds ?? 0;
    current.assists += log.assists ?? 0;
    current.threes += log.threes ?? 0;
    byPlayer.set(key, current);
  });

  const aggregateRows = Array.from(byPlayer.values())
    .map((row) => ({
      ...row,
      pointsPerGame: row.games > 0 ? round2(row.points / row.games) : 0,
      reboundsPerGame: row.games > 0 ? round2(row.rebounds / row.games) : 0,
      assistsPerGame: row.games > 0 ? round2(row.assists / row.games) : 0,
      threesPerGame: row.games > 0 ? round2(row.threes / row.games) : 0,
    }))
    .sort((a, b) => b.points - a.points);

  const aggregatePath = outputPath.replace(/\.csv$/i, ".totals.csv");
  const aggregateHeader = [
    "playerName",
    "team",
    "games",
    "points",
    "rebounds",
    "assists",
    "threes",
    "pointsPerGame",
    "reboundsPerGame",
    "assistsPerGame",
    "threesPerGame",
  ];
  const aggregateLines = [toCsvLine(aggregateHeader)];
  aggregateRows.forEach((row) => {
    aggregateLines.push(
      toCsvLine([
        row.playerName,
        row.team,
        row.games,
        row.points,
        row.rebounds,
        row.assists,
        row.threes,
        row.pointsPerGame,
        row.reboundsPerGame,
        row.assistsPerGame,
        row.threesPerGame,
      ]),
    );
  });
  await writeFile(aggregatePath, `${aggregateLines.join("\n")}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        season: args.season,
        from: args.from,
        to: args.to,
        gameLogRows: logs.length,
        uniquePlayers: aggregateRows.length,
        outputPath,
        aggregatePath,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Season export failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

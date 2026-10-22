import { readFileSync } from "node:fs";
import { NbaDataClient, parseNbaSchedulePayload, type NormalizedNbaScheduleGame } from "../lib/nba/client";
import { getTodayEtDateString, inferSeasonFromEtDate } from "../lib/snapshot/time";

// Seeds the season's NBA schedule (NBA game ids) into `games`, so the ESPN fallback feed can map ESPN
// events onto NBA ids. cdn.nba.com blocks Vercel but answers Node from a residential connection, so run
// this locally. Dry run by default.
//
//   npm run seed:nba-schedule                      # fetch live, dry run against DATABASE_URL
//   npm run seed:nba-schedule -- --file sched.json # use a saved scheduleLeagueV2_1.json
//   npm run seed:nba-schedule -- --no-db           # parse only, no database access
//   npm run seed:nba-schedule -- --apply           # write teams + games

type Args = { file: string | null; apply: boolean; noDb: boolean; season: string; from: string | null; to: string | null };

function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] ?? null : null;
  };
  const apply = argv.includes("--apply");
  const noDb = argv.includes("--no-db");
  if (apply && noDb) {
    throw new Error("--apply and --no-db cannot be combined.");
  }
  return {
    file: value("--file"),
    apply,
    noDb,
    season: value("--season") ?? inferSeasonFromEtDate(getTodayEtDateString()),
    from: value("--from"),
    to: value("--to"),
  };
}

function gameType(externalGameId: string): string {
  const prefix = externalGameId.slice(0, 3);
  return (
    { "001": "preseason", "002": "regular", "003": "all-star", "004": "playoffs", "005": "play-in", "006": "nba-cup" }[
      prefix
    ] ?? `other(${prefix})`
  );
}

function summarize(games: NormalizedNbaScheduleGame[]): Record<string, unknown> {
  const byType: Record<string, number> = {};
  games.forEach((game) => {
    const type = gameType(game.externalGameId);
    byType[type] = (byType[type] ?? 0) + 1;
  });
  const dates = games.map((game) => game.gameDateEt).sort();
  return { games: games.length, byType, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const all = args.file
    ? parseNbaSchedulePayload(JSON.parse(readFileSync(args.file, "utf8")))
    : await new NbaDataClient().fetchSchedule();
  // Preseason (001) and All-Star (003) games never reach the board or the model scripts.
  const games = all.filter(
    (game) =>
      game.season === args.season &&
      !["preseason", "all-star"].includes(gameType(game.externalGameId)) &&
      (!args.from || game.gameDateEt >= args.from) &&
      (!args.to || game.gameDateEt <= args.to),
  );

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ source: args.file ?? "cdn.nba.com", season: args.season, ...summarize(games) }, null, 2));
  if (games.length === 0) {
    throw new Error(`No ${args.season} games found in the schedule payload.`);
  }
  if (args.noDb) {
    return;
  }

  const { prisma } = await import("../lib/prisma");
  try {
    const existing = await prisma.game.findMany({
      where: { externalId: { in: games.map((game) => game.externalGameId) } },
      select: { externalId: true },
    });
    // eslint-disable-next-line no-console
    console.log(`Already in DB: ${existing.length}; new: ${games.length - existing.length}.`);

    if (!args.apply) {
      // eslint-disable-next-line no-console
      console.log("Dry run. Re-run with --apply to upsert teams and games.");
      return;
    }

    const { upsertScheduledGames } = await import("../lib/snapshot/nbaScheduleSync");
    const result = await upsertScheduledGames(games);
    // eslint-disable-next-line no-console
    console.log(`Upserted ${result.upsertedGames} games; skipped ${result.skippedGames} with unknown teams.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

import { readFileSync } from "node:fs";
import { EspnNbaDataClient } from "../lib/espn/client";
import { matchPlayers, type KnownPlayer, type PlayerMatch } from "../lib/espn/idMatch";
import { getTodayEtDateString, inferSeasonFromEtDate } from "../lib/snapshot/time";

// Links ESPN athlete ids to NBA person ids on `players.espnId`, so the ESPN fallback feed lands box
// scores on existing player rows. NBA's player index supplies current teams and the NBA ids of rostered
// players the DB has never seen (rookies); stats.nba.com answers Node from a residential connection, so
// run this locally. Dry run by default.
//
//   npm run seed:espn-players                          # dry run against DATABASE_URL
//   npm run seed:espn-players -- --nba-index idx.json  # use a saved stats.nba.com playerindex response
//   npm run seed:espn-players -- --no-db               # match ESPN rosters against the NBA index only
//   npm run seed:espn-players -- --apply               # create missing players, then store espnId links

type IndexPlayer = KnownPlayer & { teamAbbr: string | null };
type Args = { nbaIndexFile: string | null; apply: boolean; noDb: boolean; season: string };

function parseArgs(argv: string[]): Args {
  const index = argv.indexOf("--nba-index");
  const apply = argv.includes("--apply");
  const noDb = argv.includes("--no-db");
  if (apply && noDb) {
    throw new Error("--apply and --no-db cannot be combined.");
  }
  const season = inferSeasonFromEtDate(getTodayEtDateString());
  return {
    nbaIndexFile: index >= 0 ? argv[index + 1] ?? null : null,
    apply,
    noDb,
    season: `${season}-${String(Number(season) + 1).slice(2)}`,
  };
}

async function loadNbaPlayerIndex(args: Args): Promise<IndexPlayer[]> {
  let payload: unknown;
  if (args.nbaIndexFile) {
    payload = JSON.parse(readFileSync(args.nbaIndexFile, "utf8"));
  } else {
    const response = await fetch(
      `https://stats.nba.com/stats/playerindex?LeagueID=00&Season=${args.season}&Historical=0`,
      {
        headers: {
          Accept: "application/json, text/plain, */*",
          Origin: "https://www.nba.com",
          Referer: "https://www.nba.com/",
          "x-nba-stats-origin": "stats",
          "x-nba-stats-token": "true",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`stats.nba.com playerindex failed (${response.status}). Save it from a browser and pass --nba-index.`);
    }
    payload = await response.json();
  }

  const resultSet = (payload as { resultSets?: Array<{ headers: string[]; rowSet: unknown[][] }> }).resultSets?.[0];
  if (!resultSet) {
    throw new Error("Unexpected playerindex payload: no resultSets.");
  }
  const column = (name: string) => resultSet.headers.indexOf(name);
  const [id, first, last, team, position] = ["PERSON_ID", "PLAYER_FIRST_NAME", "PLAYER_LAST_NAME", "TEAM_ABBREVIATION", "POSITION"].map(column);

  return resultSet.rowSet.map((row) => {
    const firstName = row[first] ? String(row[first]) : null;
    const lastName = row[last] ? String(row[last]) : null;
    return {
      externalId: String(row[id]),
      espnId: null,
      fullName: [firstName, lastName].filter(Boolean).join(" "),
      firstName,
      lastName,
      position: row[position] ? String(row[position]) : null,
      teamAbbr: row[team] ? String(row[team]) : null,
      isActive: true,
    };
  });
}

function report(matches: PlayerMatch[], extra: Record<string, unknown>): void {
  const byMethod: Record<string, number> = {};
  matches.forEach((match) => {
    byMethod[match.method] = (byMethod[match.method] ?? 0) + 1;
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ espnRosterPlayers: matches.length, byMethod, ...extra }, null, 2));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [indexPlayers, roster] = await Promise.all([loadNbaPlayerIndex(args), new EspnNbaDataClient().fetchTeamRosters()]);
  const espnPlayers = roster.map((player) => ({ espnId: player.espnId, fullName: player.fullName, teamAbbr: player.teamAbbr }));
  const espnNameById = new Map(roster.map((player) => [player.espnId, `${player.fullName} (${player.teamAbbr})`]));
  const unresolvedNames = (matches: PlayerMatch[]) =>
    matches.filter((match) => match.method === "unresolved").map((match) => espnNameById.get(match.espnId));

  if (args.noDb) {
    const matches = Array.from(matchPlayers(espnPlayers, indexPlayers).values());
    report(matches, { nbaIndexPlayers: indexPlayers.length, unresolved: unresolvedNames(matches) });
    return;
  }

  const [{ prisma }, { loadKnownPlayers, persistEspnIdLinks }] = await Promise.all([
    import("../lib/prisma"),
    import("../lib/espn/idMap"),
  ]);
  try {
    const dbPlayers = await loadKnownPlayers();
    const indexById = new Map(indexPlayers.map((player) => [player.externalId, player]));
    const dbIds = new Set(dbPlayers.map((player) => player.externalId));
    // Current-season teams from the NBA index; the DB's team ids lag offseason moves until a refresh.
    const known: KnownPlayer[] = dbPlayers.map((player) => ({
      ...player,
      teamAbbr: indexById.get(player.externalId)?.teamAbbr ?? player.teamAbbr,
    }));
    const toCreate = indexPlayers.filter((player) => !dbIds.has(player.externalId));
    const matches = Array.from(matchPlayers(espnPlayers, [...known, ...toCreate]).values());
    const links = matches
      .filter((match) => match.method !== "unresolved" && match.method !== "espnId")
      .map((match) => ({ externalId: match.externalId, espnId: match.espnId }));

    report(matches, {
      dbPlayers: dbPlayers.length,
      nbaIndexPlayers: indexPlayers.length,
      playersToCreate: toCreate.length,
      newEspnLinks: links.length,
      unresolved: unresolvedNames(matches),
    });

    if (!args.apply) {
      // eslint-disable-next-line no-console
      console.log("Dry run. Re-run with --apply to create missing players and store espnId links.");
      return;
    }

    const teams = await prisma.team.findMany({ select: { id: true, abbreviation: true } });
    const teamIdByAbbr = new Map(teams.map((team) => [team.abbreviation, team.id]));
    const created = await prisma.player.createMany({
      data: toCreate.map((player) => ({
        externalId: player.externalId,
        fullName: player.fullName,
        firstName: player.firstName,
        lastName: player.lastName,
        position: player.position,
        isActive: true,
        teamId: player.teamAbbr ? teamIdByAbbr.get(player.teamAbbr) ?? null : null,
      })),
      skipDuplicates: true,
    });
    const linked = await persistEspnIdLinks({ players: links, games: [] });
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({ createdPlayers: created.count, linkedPlayers: linked.players, warnings: linked.warnings }, null, 2),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

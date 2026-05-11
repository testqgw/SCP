import { prisma } from "@/lib/prisma";
import { NbaDataClient } from "@/lib/nba/client";

export type NbaScheduleDateSyncResult = {
  dateEt: string;
  existingGames: number;
  scheduleGames: number;
  upsertedGames: number;
  skippedGames: number;
  warning?: string;
};

type ScheduledTeam = {
  abbreviation: string;
  name: string;
};

function rememberTeam(teams: Map<string, ScheduledTeam>, abbreviation: string, name: string | null | undefined): void {
  const normalized = abbreviation.toUpperCase();
  if (!normalized) return;
  const fallback = normalized;
  const nextName = name?.trim() || fallback;
  const existing = teams.get(normalized);
  if (!existing || existing.name === existing.abbreviation) {
    teams.set(normalized, { abbreviation: normalized, name: nextName });
  }
}

export async function ensureNbaScheduleGamesForDate(dateEt: string): Promise<NbaScheduleDateSyncResult> {
  const existingGames = await prisma.game.count({ where: { gameDateEt: dateEt } });
  if (existingGames > 0) {
    return {
      dateEt,
      existingGames,
      scheduleGames: existingGames,
      upsertedGames: 0,
      skippedGames: 0,
    };
  }

  let schedule;
  try {
    schedule = await new NbaDataClient().fetchSchedule();
  } catch (error) {
    return {
      dateEt,
      existingGames,
      scheduleGames: 0,
      upsertedGames: 0,
      skippedGames: 0,
      warning: `NBA schedule sync skipped: ${error instanceof Error ? error.message : "unknown schedule error"}`,
    };
  }
  const games = schedule.filter((game) => game.gameDateEt === dateEt);
  if (games.length === 0) {
    return {
      dateEt,
      existingGames,
      scheduleGames: 0,
      upsertedGames: 0,
      skippedGames: 0,
    };
  }

  const teams = new Map<string, ScheduledTeam>();
  games.forEach((game) => {
    rememberTeam(teams, game.homeTeamAbbr, game.homeTeamName);
    rememberTeam(teams, game.awayTeamAbbr, game.awayTeamName);
  });

  for (const team of teams.values()) {
    await prisma.team.upsert({
      where: { abbreviation: team.abbreviation },
      update: { name: team.name },
      create: {
        abbreviation: team.abbreviation,
        name: team.name,
      },
    });
  }

  const savedTeams = await prisma.team.findMany({
    where: { abbreviation: { in: [...teams.keys()] } },
    select: { id: true, abbreviation: true },
  });
  const teamIdByAbbr = new Map(savedTeams.map((team) => [team.abbreviation, team.id]));

  let upsertedGames = 0;
  let skippedGames = 0;
  for (const game of games) {
    const homeTeamId = teamIdByAbbr.get(game.homeTeamAbbr);
    const awayTeamId = teamIdByAbbr.get(game.awayTeamAbbr);
    if (!homeTeamId || !awayTeamId) {
      skippedGames += 1;
      continue;
    }

    await prisma.game.upsert({
      where: { externalId: game.externalGameId },
      update: {
        gameDateEt: game.gameDateEt,
        season: game.season,
        status: game.status,
        commenceTimeUtc: game.commenceTimeUtc,
        homeTeamId,
        awayTeamId,
      },
      create: {
        externalId: game.externalGameId,
        gameDateEt: game.gameDateEt,
        season: game.season,
        status: game.status,
        commenceTimeUtc: game.commenceTimeUtc,
        homeTeamId,
        awayTeamId,
      },
    });
    upsertedGames += 1;
  }

  return {
    dateEt,
    existingGames,
    scheduleGames: games.length,
    upsertedGames,
    skippedGames,
  };
}

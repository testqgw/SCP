import { prisma } from "@/lib/prisma";
import { etDateShift } from "@/lib/snapshot/time";
import {
  translateEspnPayload,
  type EspnIdLink,
  type EspnPayload,
  type KnownGame,
  type KnownPlayer,
  type TranslatedEspnPayload,
} from "./idMatch";

// DB-backed wrapper around lib/espn/idMatch.ts. Reads only, except persistEspnIdLinks.
const CANDIDATE_GAME_PADDING_DAYS = 3;

async function loadKnownGames(espnGameIds: string[], gameDates: string[]): Promise<KnownGame[]> {
  if (gameDates.length === 0 && espnGameIds.length === 0) {
    return [];
  }

  const sortedDates = [...gameDates].sort();
  const dateFilter =
    sortedDates.length > 0
      ? [
          {
            gameDateEt: {
              gte: etDateShift(sortedDates[0], -CANDIDATE_GAME_PADDING_DAYS),
              lte: etDateShift(sortedDates[sortedDates.length - 1], CANDIDATE_GAME_PADDING_DAYS),
            },
          },
        ]
      : [];
  const rows = await prisma.game.findMany({
    where: { OR: [...dateFilter, ...(espnGameIds.length > 0 ? [{ espnId: { in: espnGameIds } }] : [])] },
    select: {
      externalId: true,
      espnId: true,
      gameDateEt: true,
      homeTeam: { select: { abbreviation: true } },
      awayTeam: { select: { abbreviation: true } },
    },
  });

  return rows.map((row) => ({
    externalId: row.externalId,
    espnId: row.espnId,
    gameDateEt: row.gameDateEt,
    homeTeamAbbr: row.homeTeam.abbreviation,
    awayTeamAbbr: row.awayTeam.abbreviation,
  }));
}

export async function loadKnownPlayers(): Promise<KnownPlayer[]> {
  // Name matching needs the whole league (trades), and the table is only a few thousand rows.
  const rows = await prisma.player.findMany({
    where: { externalId: { not: null } },
    select: {
      externalId: true,
      espnId: true,
      fullName: true,
      firstName: true,
      lastName: true,
      position: true,
      isActive: true,
      team: { select: { abbreviation: true } },
    },
  });

  return rows.map((row) => ({
    externalId: row.externalId as string,
    espnId: row.espnId,
    fullName: row.fullName,
    firstName: row.firstName,
    lastName: row.lastName,
    position: row.position,
    teamAbbr: row.team?.abbreviation ?? null,
    isActive: row.isActive,
  }));
}

export type EspnIdResolver = {
  translate(payload: EspnPayload): Promise<TranslatedEspnPayload>;
};

/**
 * Read-only translator that loads the player table once and reuses it across calls, so a refresh can
 * translate the schedule and every box score without rescanning players.
 */
export function createEspnIdResolver(): EspnIdResolver {
  let playersPromise: Promise<KnownPlayer[]> | null = null;

  return {
    async translate(payload) {
      playersPromise ??= loadKnownPlayers();
      const [games, players] = await Promise.all([
        loadKnownGames(
          payload.games.map((game) => game.externalGameId),
          payload.games.map((game) => game.gameDateEt),
        ),
        playersPromise,
      ]);
      return translateEspnPayload(payload, { games, players });
    },
  };
}

/** Translates an ESPN-keyed payload onto NBA game/person ids using what is already in the DB. Read-only. */
export async function resolveEspnPayloadIds(payload: EspnPayload): Promise<TranslatedEspnPayload> {
  return createEspnIdResolver().translate(payload);
}

export type PersistEspnIdLinksResult = { players: number; games: number; warnings: string[] };

/**
 * Stores espnId on rows that already exist (call after the refresh upserts). Never overwrites a
 * different stored espnId; unique-index conflicts are reported, not thrown.
 */
export async function persistEspnIdLinks(links: TranslatedEspnPayload["links"]): Promise<PersistEspnIdLinksResult> {
  const warnings: string[] = [];

  const apply = async (
    entity: "player" | "game",
    entries: EspnIdLink[],
    update: (link: EspnIdLink) => Promise<{ count: number }>,
  ): Promise<number> => {
    let updated = 0;
    for (const link of entries) {
      try {
        updated += (await update(link)).count;
      } catch (error) {
        warnings.push(
          `Could not link ${entity} ${link.externalId} to ESPN ${link.espnId}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }
    return updated;
  };

  const players = await apply("player", links.players, (link) =>
    prisma.player.updateMany({ where: { externalId: link.externalId, espnId: null }, data: { espnId: link.espnId } }),
  );
  const games = await apply("game", links.games, (link) =>
    prisma.game.updateMany({ where: { externalId: link.externalId, espnId: null }, data: { espnId: link.espnId } }),
  );

  return { players, games, warnings };
}

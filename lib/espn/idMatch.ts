// Pure ESPN -> NBA id matching. No runtime imports so `node --test` can load this file directly.
//
// The DB keys players by NBA person id and games by NBA game id, and the model/research scripts filter
// games by NBA id prefix (002/004/005/006). ESPN payloads must be translated onto those ids before any
// write. Anything that cannot be matched safely gets an `espn:` prefixed id instead of a guess.
import type { NormalizedNbaScheduleGame } from "@/lib/nba/client";
import type { NormalizedPlayerGameStat, NormalizedPlayerSeason } from "@/lib/sportsdata/types";

export const ESPN_EXTERNAL_ID_PREFIX = "espn:";
const NEARBY_GAME_MAX_DAYS = 2;

export type KnownPlayer = {
  externalId: string;
  espnId: string | null;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  teamAbbr: string | null;
  isActive: boolean;
};

export type KnownGame = {
  externalId: string;
  espnId: string | null;
  gameDateEt: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
};

export type PlayerMatchMethod = "espnId" | "nameTeam" | "nameActive" | "nameAny" | "unresolved";
export type GameMatchMethod = "espnId" | "dateTeams" | "nearbyDate" | "unresolved";

export type PlayerMatch = {
  espnId: string;
  externalId: string;
  method: PlayerMatchMethod;
  known: KnownPlayer | null;
};

export type GameMatch = {
  espnId: string;
  externalId: string;
  method: GameMatchMethod;
  known: KnownGame | null;
};

export type EspnIdLink = { externalId: string; espnId: string };

export type EspnPayload = {
  games: NormalizedNbaScheduleGame[];
  players: NormalizedPlayerSeason[];
  logs: NormalizedPlayerGameStat[];
};

export type TranslatedEspnPayload = EspnPayload & {
  /** externalId -> espnId pairs to store once the rows exist (new matches and `espn:` fallbacks). */
  links: { players: EspnIdLink[]; games: EspnIdLink[] };
  unresolved: { players: PlayerMatch[]; games: GameMatch[] };
  methodCounts: { players: Record<PlayerMatchMethod, number>; games: Record<GameMatchMethod, number> };
};

/**
 * Accent-, punctuation- and suffix-insensitive name key. "Luka Dončić" and "Luka Doncic" match, as do
 * "Ernest Udeh, Jr." and "Ernest Udeh Jr".
 */
export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

function dayNumber(dateEt: string): number {
  const [year, month, day] = dateEt.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function groupBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    if (value === null) continue;
    groups.set(value, [...(groups.get(value) ?? []), item]);
  }
  return groups;
}

/** A known row can only be claimed by the ESPN id already stored on it, or by anyone if none is stored. */
function claimable<T extends { espnId: string | null }>(candidates: T[] | undefined, espnId: string): T[] {
  return (candidates ?? []).filter((candidate) => candidate.espnId === null || candidate.espnId === espnId);
}

function single<T>(candidates: T[]): T | null {
  return candidates.length === 1 ? candidates[0] : null;
}

export function matchPlayers(
  espnPlayers: Array<{ espnId: string; fullName: string; teamAbbr: string | null }>,
  known: KnownPlayer[],
): Map<string, PlayerMatch> {
  const byEspnId = new Map(known.filter((player) => player.espnId).map((player) => [player.espnId as string, player]));
  const byName = groupBy(known, (player) => normalizePlayerName(player.fullName));
  const matches = new Map<string, PlayerMatch>();
  const claimed = new Map<string, string>();

  for (const espnPlayer of espnPlayers) {
    if (matches.has(espnPlayer.espnId)) continue;

    let match: KnownPlayer | null = null;
    let method: PlayerMatchMethod = "unresolved";
    const stored = byEspnId.get(espnPlayer.espnId);
    if (stored) {
      match = stored;
      method = "espnId";
    } else {
      const sameName = claimable(byName.get(normalizePlayerName(espnPlayer.fullName)), espnPlayer.espnId);
      const sameTeam = sameName.filter((player) => espnPlayer.teamAbbr !== null && player.teamAbbr === espnPlayer.teamAbbr);
      const active = sameName.filter((player) => player.isActive);
      // Team first; DB teams lag offseason moves, so fall back to a league-unique active name, then any name.
      if (single(sameTeam)) {
        match = single(sameTeam);
        method = "nameTeam";
      } else if (sameTeam.length === 0 && single(active)) {
        match = single(active);
        method = "nameActive";
      } else if (sameTeam.length === 0 && active.length === 0 && single(sameName)) {
        match = single(sameName);
        method = "nameAny";
      }
    }

    // Two ESPN athletes resolving to one NBA player means the name key is ambiguous; trust neither.
    const previousClaim = match ? claimed.get(match.externalId) : undefined;
    if (match && previousClaim && previousClaim !== espnPlayer.espnId) {
      const previous = matches.get(previousClaim);
      if (previous && previous.method !== "espnId") {
        matches.set(previousClaim, unresolvedPlayer(previousClaim));
      }
      if (method !== "espnId") {
        match = null;
        method = "unresolved";
      }
    }

    if (match) {
      claimed.set(match.externalId, espnPlayer.espnId);
      matches.set(espnPlayer.espnId, { espnId: espnPlayer.espnId, externalId: match.externalId, method, known: match });
    } else {
      matches.set(espnPlayer.espnId, unresolvedPlayer(espnPlayer.espnId));
    }
  }

  return matches;
}

function unresolvedPlayer(espnId: string): PlayerMatch {
  return { espnId, externalId: `${ESPN_EXTERNAL_ID_PREFIX}${espnId}`, method: "unresolved", known: null };
}

export function matchGames(espnGames: NormalizedNbaScheduleGame[], known: KnownGame[]): Map<string, GameMatch> {
  const byEspnId = new Map(known.filter((game) => game.espnId).map((game) => [game.espnId as string, game]));
  const byTeams = groupBy(known, (game) => `${game.awayTeamAbbr}@${game.homeTeamAbbr}`);
  const matches = new Map<string, GameMatch>();
  const claimed = new Set<string>();

  for (const espnGame of espnGames) {
    const espnId = espnGame.externalGameId;
    let match: KnownGame | null = byEspnId.get(espnId) ?? null;
    let method: GameMatchMethod = match ? "espnId" : "unresolved";

    if (!match) {
      const sameTeams = claimable(byTeams.get(`${espnGame.awayTeamAbbr}@${espnGame.homeTeamAbbr}`), espnId).filter(
        (game) => !claimed.has(game.externalId),
      );
      const sameDay = sameTeams.filter((game) => game.gameDateEt === espnGame.gameDateEt);
      const nearby = sameTeams.filter(
        (game) => Math.abs(dayNumber(game.gameDateEt) - dayNumber(espnGame.gameDateEt)) <= NEARBY_GAME_MAX_DAYS,
      );
      if (single(sameDay)) {
        match = single(sameDay);
        method = "dateTeams";
      } else if (sameDay.length === 0 && single(nearby)) {
        // Postponed/rescheduled games keep their NBA id but move dates.
        match = single(nearby);
        method = "nearbyDate";
      }
    }

    if (match) {
      claimed.add(match.externalId);
      matches.set(espnId, { espnId, externalId: match.externalId, method, known: match });
    } else {
      matches.set(espnId, { espnId, externalId: `${ESPN_EXTERNAL_ID_PREFIX}${espnId}`, method: "unresolved", known: null });
    }
  }

  return matches;
}

function countMethods<M extends string>(methods: readonly M[], matches: Iterable<{ method: M }>): Record<M, number> {
  const counts = Object.fromEntries(methods.map((method) => [method, 0])) as Record<M, number>;
  for (const match of matches) counts[match.method] += 1;
  return counts;
}

function linksFor<T extends { espnId: string; externalId: string; known: { espnId: string | null } | null }>(
  matches: Iterable<T>,
): EspnIdLink[] {
  return Array.from(matches)
    .filter((match) => match.known?.espnId !== match.espnId)
    .map((match) => ({ externalId: match.externalId, espnId: match.espnId }));
}

/**
 * Rewrites an ESPN-keyed payload onto NBA ids. Matched players keep their stored names and position so
 * refresh upserts don't churn them to ESPN's spelling (ESPN drops diacritics).
 */
export function translateEspnPayload(payload: EspnPayload, known: { players: KnownPlayer[]; games: KnownGame[] }): TranslatedEspnPayload {
  const gameMatches = matchGames(payload.games, known.games);
  const espnPlayers = [...payload.players, ...payload.logs].map((player) => ({
    espnId: player.externalPlayerId,
    fullName: player.fullName ?? "",
    teamAbbr: player.teamAbbr,
  }));
  const playerMatches = matchPlayers(espnPlayers, known.players);

  const gameId = (espnId: string | null): string | null =>
    espnId === null ? null : gameMatches.get(espnId)?.externalId ?? `${ESPN_EXTERNAL_ID_PREFIX}${espnId}`;
  const playerFields = (espnId: string) => {
    const match = playerMatches.get(espnId) as PlayerMatch;
    return { match, known: match.known };
  };

  const games = payload.games.map((game) => ({ ...game, externalGameId: gameId(game.externalGameId) as string }));
  const players = payload.players.map((player) => {
    const { match, known: stored } = playerFields(player.externalPlayerId);
    return {
      ...player,
      externalPlayerId: match.externalId,
      fullName: stored?.fullName ?? player.fullName,
      firstName: stored ? stored.firstName : player.firstName,
      lastName: stored ? stored.lastName : player.lastName,
      position: stored?.position ?? player.position,
    };
  });
  const logs = payload.logs.map((log) => {
    const { match, known: stored } = playerFields(log.externalPlayerId);
    return {
      ...log,
      externalPlayerId: match.externalId,
      externalGameId: gameId(log.externalGameId),
      fullName: stored?.fullName ?? log.fullName,
      firstName: stored ? stored.firstName : log.firstName,
      lastName: stored ? stored.lastName : log.lastName,
      position: stored?.position ?? log.position,
    };
  });

  return {
    games,
    players,
    logs,
    links: { players: linksFor(playerMatches.values()), games: linksFor(gameMatches.values()) },
    unresolved: {
      players: Array.from(playerMatches.values()).filter((match) => match.method === "unresolved"),
      games: Array.from(gameMatches.values()).filter((match) => match.method === "unresolved"),
    },
    methodCounts: {
      players: countMethods(["espnId", "nameTeam", "nameActive", "nameAny", "unresolved"] as const, playerMatches.values()),
      games: countMethods(["espnId", "dateTeams", "nearbyDate", "unresolved"] as const, gameMatches.values()),
    },
  };
}

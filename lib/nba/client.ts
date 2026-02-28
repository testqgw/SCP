import { inferSeasonFromEtDate } from "@/lib/snapshot/time";
import type { NormalizedGame, NormalizedPlayerGameStat, NormalizedPlayerSeason } from "@/lib/sportsdata/types";
import { toNumber } from "@/lib/utils";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const NBA_SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json";
const NBA_BOXSCORE_URL = "https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{gameId}.json";

export type NormalizedNbaScheduleGame = NormalizedGame & {
  statusNumber: number;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(input: unknown): UnknownRecord | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as UnknownRecord;
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatEtDate(reference: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function parseScheduleDateToEt(input: string | null): string | null {
  if (!input) {
    return null;
  }
  const match = input.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) {
    return null;
  }
  const [, month, day, year] = match;
  return `${year}-${month}-${day}`;
}

function parseMinutes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.startsWith("PT")) {
    return null;
  }
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 60 + minutes + seconds / 60;
}

function playerFromBoxScore(
  player: UnknownRecord,
  teamAbbr: string,
  opponentAbbr: string,
): { season: NormalizedPlayerSeason; stats: Partial<NormalizedPlayerGameStat> } | null {
  const personId = toStringOrNull(player.personId);
  if (!personId) {
    return null;
  }

  const firstName = toStringOrNull(player.firstName);
  const lastName = toStringOrNull(player.familyName);
  const fullName =
    toStringOrNull(player.name) ??
    [firstName, lastName].filter((part): part is string => Boolean(part)).join(" ").trim();

  if (!fullName) {
    return null;
  }

  const statistics = asRecord(player.statistics) ?? {};
  const status = (toStringOrNull(player.status) ?? "").toUpperCase();
  const isActive = status !== "INACTIVE";

  return {
    season: {
      externalPlayerId: personId,
      fullName,
      firstName,
      lastName,
      teamAbbr,
      position: toStringOrNull(player.position),
      usageRate: null,
      isActive,
    },
    stats: {
      externalPlayerId: personId,
      fullName,
      firstName,
      lastName,
      position: toStringOrNull(player.position),
      teamAbbr,
      opponentAbbr,
      minutes: parseMinutes(statistics.minutes),
      points: toNumber(statistics.points),
      rebounds: toNumber(statistics.reboundsTotal),
      assists: toNumber(statistics.assists),
      threes: toNumber(statistics.threePointersMade),
      steals: toNumber(statistics.steals),
      blocks: toNumber(statistics.blocks),
      turnovers: toNumber(statistics.turnovers),
      pace: null,
      total: null,
    },
  };
}

export class NbaDataClient {
  private async fetchJson(url: string): Promise<unknown> {
    const requestInit: RequestInit = {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
    };

    const retryDelaysMs = [0, 400, 1200];
    let lastError: Error | null = null;

    for (const delay of retryDelaysMs) {
      if (delay > 0) {
        await sleep(delay);
      }

      try {
        const response = await fetch(url, requestInit);
        if (!response.ok) {
          if (RETRYABLE_STATUS.has(response.status)) {
            lastError = new Error(`Retryable NBA endpoint status ${response.status}: ${url}`);
            continue;
          }
          throw new Error(`NBA endpoint failed (${response.status}): ${url}`);
        }
        return (await response.json()) as unknown;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown network error");
      }
    }

    throw lastError ?? new Error(`NBA endpoint failed: ${url}`);
  }

  async fetchSchedule(): Promise<NormalizedNbaScheduleGame[]> {
    const payload = await this.fetchJson(NBA_SCHEDULE_URL);
    const root = asRecord(payload);
    const leagueSchedule = asRecord(root?.leagueSchedule);
    const gameDates = asArray(leagueSchedule?.gameDates);
    const results: NormalizedNbaScheduleGame[] = [];

    gameDates.forEach((dateEntry) => {
      const dateRecord = asRecord(dateEntry);
      if (!dateRecord) {
        return;
      }
      const dateEt = parseScheduleDateToEt(toStringOrNull(dateRecord.gameDate));
      if (!dateEt) {
        return;
      }

      const games = asArray(dateRecord.games);
      games.forEach((gameEntry) => {
        const game = asRecord(gameEntry);
        if (!game) {
          return;
        }

        const homeTeam = asRecord(game.homeTeam);
        const awayTeam = asRecord(game.awayTeam);
        const homeTricode = toStringOrNull(homeTeam?.teamTricode);
        const awayTricode = toStringOrNull(awayTeam?.teamTricode);
        const gameId = toStringOrNull(game.gameId);
        if (!homeTricode || !awayTricode || !gameId) {
          return;
        }

        const commenceTimeUtc =
          toDate(toStringOrNull(game.gameDateTimeUTC)) ??
          toDate(toStringOrNull(game.gameDateTimeEst)) ??
          null;

        results.push({
          externalGameId: gameId,
          gameDateEt: dateEt,
          commenceTimeUtc,
          status: toStringOrNull(game.gameStatusText),
          statusNumber: toNumber(game.gameStatus) ?? 0,
          homeTeamAbbr: homeTricode.toUpperCase(),
          awayTeamAbbr: awayTricode.toUpperCase(),
          homeTeamName: [toStringOrNull(homeTeam?.teamCity), toStringOrNull(homeTeam?.teamName)]
            .filter((part): part is string => Boolean(part))
            .join(" "),
          awayTeamName: [toStringOrNull(awayTeam?.teamCity), toStringOrNull(awayTeam?.teamName)]
            .filter((part): part is string => Boolean(part))
            .join(" "),
          season: inferSeasonFromEtDate(dateEt),
        });
      });
    });

    return results;
  }

  async fetchGameBoxScore(
    game: NormalizedNbaScheduleGame,
  ): Promise<{ players: NormalizedPlayerSeason[]; logs: NormalizedPlayerGameStat[] }> {
    const url = NBA_BOXSCORE_URL.replace("{gameId}", game.externalGameId);
    const payload = await this.fetchJson(url);
    const root = asRecord(payload);
    const gameData = asRecord(root?.game);

    const gameDate =
      toDate(toStringOrNull(gameData?.gameEt)) ??
      toDate(toStringOrNull(gameData?.gameDateUTC)) ??
      toDate(toStringOrNull(gameData?.gameTimeUTC));
    const gameDateEt = gameDate ? formatEtDate(gameDate) : game.gameDateEt;

    const home = asRecord(gameData?.homeTeam) ?? {};
    const away = asRecord(gameData?.awayTeam) ?? {};
    const homeTricode = toStringOrNull(home.teamTricode)?.toUpperCase() ?? game.homeTeamAbbr;
    const awayTricode = toStringOrNull(away.teamTricode)?.toUpperCase() ?? game.awayTeamAbbr;

    const players: NormalizedPlayerSeason[] = [];
    const logs: NormalizedPlayerGameStat[] = [];

    const ingestSide = (teamRecord: UnknownRecord, teamAbbr: string, opponentAbbr: string, isHome: boolean): void => {
      const sidePlayers = asArray(teamRecord.players);
      sidePlayers.forEach((rawPlayer) => {
        const player = asRecord(rawPlayer);
        if (!player) {
          return;
        }
        const parsed = playerFromBoxScore(player, teamAbbr, opponentAbbr);
        if (!parsed) {
          return;
        }

        players.push(parsed.season);
        logs.push({
          externalPlayerId: parsed.stats.externalPlayerId as string,
          externalGameId: game.externalGameId,
          gameDateEt,
          fullName: parsed.stats.fullName ?? null,
          firstName: parsed.stats.firstName ?? null,
          lastName: parsed.stats.lastName ?? null,
          position: parsed.stats.position ?? null,
          teamAbbr,
          opponentAbbr,
          isHome,
          minutes: parsed.stats.minutes ?? null,
          points: parsed.stats.points ?? null,
          rebounds: parsed.stats.rebounds ?? null,
          assists: parsed.stats.assists ?? null,
          threes: parsed.stats.threes ?? null,
          steals: parsed.stats.steals ?? null,
          blocks: parsed.stats.blocks ?? null,
          turnovers: parsed.stats.turnovers ?? null,
          pace: null,
          total: null,
        });
      });
    };

    ingestSide(home, homeTricode, awayTricode, true);
    ingestSide(away, awayTricode, homeTricode, false);

    return { players, logs };
  }
}

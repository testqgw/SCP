import { inferSeasonFromEtDate } from "@/lib/snapshot/time";
import type { NormalizedGame, NormalizedPlayerGameStat, NormalizedPlayerSeason } from "@/lib/sportsdata/types";
import { toNumber } from "@/lib/utils";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const NBA_SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json";
const NBA_BOXSCORE_URL = "https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{gameId}.json";
const NBA_HTTP_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.NBA_HTTP_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 12000;
  return Math.min(Math.max(3000, Math.floor(parsed)), 60000);
})();
const NBA_SCHEDULE_CACHE_TTL_MS = (() => {
  const parsed = Number(process.env.NBA_SCHEDULE_CACHE_TTL_MS);
  if (!Number.isFinite(parsed) || parsed < 0) return 60_000;
  return Math.min(Math.max(0, Math.floor(parsed)), 10 * 60_000);
})();
const NBA_CURRENT_DAY_FINAL_BOXSCORE_CACHE_TTL_MS = (() => {
  const parsed = Number(process.env.NBA_CURRENT_DAY_FINAL_BOXSCORE_CACHE_TTL_MS);
  if (!Number.isFinite(parsed) || parsed < 0) return 5 * 60_000;
  return Math.min(Math.max(0, Math.floor(parsed)), 60 * 60_000);
})();
const NBA_HISTORICAL_BOXSCORE_CACHE_TTL_MS = (() => {
  const parsed = Number(process.env.NBA_HISTORICAL_BOXSCORE_CACHE_TTL_MS);
  if (!Number.isFinite(parsed) || parsed < 0) return 60 * 60_000;
  return Math.min(Math.max(0, Math.floor(parsed)), 24 * 60 * 60_000);
})();

let cachedSchedule:
  | {
      expiresAt: number;
      data: NormalizedNbaScheduleGame[];
    }
  | null = null;
let inFlightSchedule: Promise<NormalizedNbaScheduleGame[]> | null = null;
type NormalizedNbaBoxScorePayload = {
  players: NormalizedPlayerSeason[];
  logs: NormalizedPlayerGameStat[];
};
const cachedBoxScores = new Map<string, { expiresAt: number; data: NormalizedNbaBoxScorePayload }>();
const inFlightBoxScores = new Map<string, Promise<NormalizedNbaBoxScorePayload>>();

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

function toBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "active"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "inactive"].includes(normalized)) return false;
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

function boxScoreCacheTtlMs(game: NormalizedNbaScheduleGame): number {
  if (game.statusNumber < 3) {
    return 0;
  }

  const todayEt = formatEtDate(new Date());
  return game.gameDateEt < todayEt
    ? NBA_HISTORICAL_BOXSCORE_CACHE_TTL_MS
    : NBA_CURRENT_DAY_FINAL_BOXSCORE_CACHE_TTL_MS;
}

function joinTeamNameParts(...parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

type FetchJsonAttemptResult =
  | { ok: true; data: unknown }
  | { ok: false; error: Error; retryable: boolean };

async function fetchJsonAttempt(url: string): Promise<FetchJsonAttemptResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, NBA_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      if (RETRYABLE_STATUS.has(response.status)) {
        return {
          ok: false,
          error: new Error(`Retryable NBA endpoint status ${response.status}: ${url}`),
          retryable: true,
        };
      }
      return {
        ok: false,
        error: new Error(`NBA endpoint failed (${response.status}): ${url}`),
        retryable: false,
      };
    }

    return { ok: true, data: (await response.json()) as unknown };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        error: new Error(`NBA endpoint timed out after ${NBA_HTTP_TIMEOUT_MS}ms: ${url}`),
        retryable: true,
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error : new Error("Unknown network error"),
      retryable: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function ingestBoxScoreSide(params: {
  teamRecord: UnknownRecord;
  teamAbbr: string;
  opponentAbbr: string;
  isHome: boolean;
  gameExternalId: string;
  gameDateEt: string;
  players: NormalizedPlayerSeason[];
  logs: NormalizedPlayerGameStat[];
}): void {
  for (const rawPlayer of asArray(params.teamRecord.players)) {
    const player = asRecord(rawPlayer);
    if (!player) {
      continue;
    }

    const parsed = playerFromBoxScore(player, params.teamAbbr, params.opponentAbbr);
    if (!parsed) {
      continue;
    }

    params.players.push(parsed.season);
    params.logs.push({
      externalPlayerId: parsed.stats.externalPlayerId as string,
      externalGameId: params.gameExternalId,
      gameDateEt: params.gameDateEt,
      fullName: parsed.stats.fullName ?? null,
      firstName: parsed.stats.firstName ?? null,
      lastName: parsed.stats.lastName ?? null,
      position: parsed.stats.position ?? null,
      teamAbbr: params.teamAbbr,
      opponentAbbr: params.opponentAbbr,
      isHome: params.isHome,
      starter: parsed.stats.starter ?? null,
      played: parsed.stats.played ?? null,
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
  }
}

function normalizeScheduleGame(game: UnknownRecord, dateEt: string): NormalizedNbaScheduleGame | null {
  const homeTeam = asRecord(game.homeTeam);
  const awayTeam = asRecord(game.awayTeam);
  const homeTricode = toStringOrNull(homeTeam?.teamTricode);
  const awayTricode = toStringOrNull(awayTeam?.teamTricode);
  const gameId = toStringOrNull(game.gameId);
  if (!homeTricode || !awayTricode || !gameId) {
    return null;
  }

  const commenceTimeUtc =
    toDate(toStringOrNull(game.gameDateTimeUTC)) ??
    toDate(toStringOrNull(game.gameDateTimeEst)) ??
    null;

  return {
    externalGameId: gameId,
    gameDateEt: dateEt,
    commenceTimeUtc,
    status: toStringOrNull(game.gameStatusText),
    statusNumber: toNumber(game.gameStatus) ?? 0,
    homeTeamAbbr: homeTricode.toUpperCase(),
    awayTeamAbbr: awayTricode.toUpperCase(),
    homeTeamName: joinTeamNameParts(toStringOrNull(homeTeam?.teamCity), toStringOrNull(homeTeam?.teamName)),
    awayTeamName: joinTeamNameParts(toStringOrNull(awayTeam?.teamCity), toStringOrNull(awayTeam?.teamName)),
    season: inferSeasonFromEtDate(dateEt),
  };
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
      starter: toBooleanOrNull(player.starter),
      played: toBooleanOrNull(player.played),
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
    const retryDelaysMs = [0, 400, 1200];
    let lastError: Error | null = null;

    for (const delay of retryDelaysMs) {
      if (delay > 0) {
        await sleep(delay);
      }

      const attempt = await fetchJsonAttempt(url);
      if (attempt.ok) {
        return attempt.data;
      }
      lastError = attempt.error;
      if (!attempt.retryable) {
        throw attempt.error;
      }
    }

    throw lastError ?? new Error(`NBA endpoint failed: ${url}`);
  }

  async fetchSchedule(): Promise<NormalizedNbaScheduleGame[]> {
    const now = Date.now();
    if (cachedSchedule && cachedSchedule.expiresAt > now) {
      return cachedSchedule.data;
    }
    if (inFlightSchedule) {
      return inFlightSchedule;
    }

    const task = (async (): Promise<NormalizedNbaScheduleGame[]> => {
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
          const normalizedGame = normalizeScheduleGame(game, dateEt);
          if (normalizedGame) {
            results.push(normalizedGame);
          }
        });
      });

      if (NBA_SCHEDULE_CACHE_TTL_MS > 0) {
        cachedSchedule = {
          expiresAt: Date.now() + NBA_SCHEDULE_CACHE_TTL_MS,
          data: results,
        };
      }

      return results;
    })();

    inFlightSchedule = task;
    try {
      return await task;
    } finally {
      if (inFlightSchedule === task) {
        inFlightSchedule = null;
      }
    }
  }

  async fetchGameBoxScore(
    game: NormalizedNbaScheduleGame,
  ): Promise<NormalizedNbaBoxScorePayload> {
    const cacheKey = game.externalGameId;
    const cacheTtlMs = boxScoreCacheTtlMs(game);
    const now = Date.now();

    if (cacheTtlMs > 0) {
      const cached = cachedBoxScores.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.data;
      }
      if (cached) {
        cachedBoxScores.delete(cacheKey);
      }

      const inFlight = inFlightBoxScores.get(cacheKey);
      if (inFlight) {
        return inFlight;
      }
    }

    const task = (async (): Promise<NormalizedNbaBoxScorePayload> => {
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
      ingestBoxScoreSide({
        teamRecord: home,
        teamAbbr: homeTricode,
        opponentAbbr: awayTricode,
        isHome: true,
        gameExternalId: game.externalGameId,
        gameDateEt,
        players,
        logs,
      });
      ingestBoxScoreSide({
        teamRecord: away,
        teamAbbr: awayTricode,
        opponentAbbr: homeTricode,
        isHome: false,
        gameExternalId: game.externalGameId,
        gameDateEt,
        players,
        logs,
      });

      const result = { players, logs };
      if (cacheTtlMs > 0) {
        cachedBoxScores.set(cacheKey, {
          expiresAt: Date.now() + cacheTtlMs,
          data: result,
        });
      }
      return result;
    })();

    if (cacheTtlMs <= 0) {
      return task;
    }

    inFlightBoxScores.set(cacheKey, task);
    try {
      return await task;
    } finally {
      if (inFlightBoxScores.get(cacheKey) === task) {
        inFlightBoxScores.delete(cacheKey);
      }
    }
  }
}

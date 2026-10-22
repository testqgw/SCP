import type { NormalizedNbaScheduleGame } from "@/lib/nba/client";
import { inferSeasonFromEtDate } from "@/lib/snapshot/time";
import {
  formatEtDate,
  listDatesInclusive,
  parseEspnBoxScore,
  parseEspnRoster,
  parseEspnScoreboard,
  parseEspnTeams,
  toEspnDateParam,
  type EspnBoxScorePayload,
  type EspnRosterPlayer,
} from "./parse";

// ESPN's public site API. Unofficial and undocumented, but not behind Akamai Bot Manager like cdn.nba.com.
// Everything returned here carries ESPN ids; see lib/espn/parse.ts.
const ESPN_NBA_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RANGE_DAYS = 14;
const ESPN_HTTP_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.ESPN_HTTP_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 12000;
  return Math.min(Math.max(3000, Math.floor(parsed)), 60000);
})();
const ESPN_SCOREBOARD_CACHE_TTL_MS = 60_000;
const ESPN_CURRENT_DAY_FINAL_BOXSCORE_CACHE_TTL_MS = 5 * 60_000;
const ESPN_HISTORICAL_BOXSCORE_CACHE_TTL_MS = 60 * 60_000;

const cachedScoreboards = new Map<string, { expiresAt: number; data: NormalizedNbaScheduleGame[] }>();
const cachedBoxScores = new Map<string, { expiresAt: number; data: EspnBoxScorePayload }>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function boxScoreCacheTtlMs(game: NormalizedNbaScheduleGame): number {
  if (game.statusNumber < 3) {
    return 0;
  }
  return game.gameDateEt < formatEtDate(new Date())
    ? ESPN_HISTORICAL_BOXSCORE_CACHE_TTL_MS
    : ESPN_CURRENT_DAY_FINAL_BOXSCORE_CACHE_TTL_MS;
}

type FetchJsonAttemptResult =
  | { ok: true; data: unknown }
  | { ok: false; error: Error; retryable: boolean };

async function fetchJsonAttempt(url: string): Promise<FetchJsonAttemptResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, ESPN_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: new Error(`ESPN endpoint failed (${response.status}): ${url}`),
        retryable: RETRYABLE_STATUS.has(response.status),
      };
    }

    return { ok: true, data: (await response.json()) as unknown };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        error: new Error(`ESPN endpoint timed out after ${ESPN_HTTP_TIMEOUT_MS}ms: ${url}`),
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

export class EspnNbaDataClient {
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

    throw lastError ?? new Error(`ESPN endpoint failed: ${url}`);
  }

  /**
   * Games scheduled on one ESPN scoreboard day. ESPN buckets by US date, so late West Coast tips can
   * belong to the previous ET date; callers should filter on `gameDateEt`.
   */
  async fetchScoreboard(dateEt: string): Promise<NormalizedNbaScheduleGame[]> {
    const cached = cachedScoreboards.get(dateEt);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const url = `${ESPN_NBA_BASE_URL}/scoreboard?dates=${toEspnDateParam(dateEt)}`;
    const games = parseEspnScoreboard(await this.fetchJson(url), inferSeasonFromEtDate);
    cachedScoreboards.set(dateEt, { expiresAt: Date.now() + ESPN_SCOREBOARD_CACHE_TTL_MS, data: games });
    return games;
  }

  /** ESPN rejects multi-day `dates` ranges, so this fetches one scoreboard per day. */
  async fetchScheduleRange(from: string, to: string): Promise<NormalizedNbaScheduleGame[]> {
    const dates = listDatesInclusive(from, to);
    if (dates.length > MAX_RANGE_DAYS) {
      throw new Error(`ESPN schedule range too large (${dates.length} days, max ${MAX_RANGE_DAYS}).`);
    }

    const perDay = await Promise.all(dates.map((dateEt) => this.fetchScoreboard(dateEt)));
    const byId = new Map<string, NormalizedNbaScheduleGame>();
    perDay.flat().forEach((game) => {
      if (game.gameDateEt >= from && game.gameDateEt <= to) {
        byId.set(game.externalGameId, game);
      }
    });
    return Array.from(byId.values());
  }

  /** Current rosters for all 30 teams (used by the ESPN player-id seed script). */
  async fetchTeamRosters(): Promise<EspnRosterPlayer[]> {
    const teams = parseEspnTeams(await this.fetchJson(`${ESPN_NBA_BASE_URL}/teams`));
    const rosters = await Promise.all(
      teams.map(async (team) =>
        parseEspnRoster(await this.fetchJson(`${ESPN_NBA_BASE_URL}/teams/${team.espnTeamId}/roster`), team.teamAbbr),
      ),
    );
    return rosters.flat();
  }

  async fetchGameBoxScore(game: NormalizedNbaScheduleGame): Promise<EspnBoxScorePayload> {
    const cacheTtlMs = boxScoreCacheTtlMs(game);
    if (cacheTtlMs > 0) {
      const cached = cachedBoxScores.get(game.externalGameId);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
      }
    }

    const url = `${ESPN_NBA_BASE_URL}/summary?event=${encodeURIComponent(game.externalGameId)}`;
    const result = parseEspnBoxScore(await this.fetchJson(url), game);
    if (cacheTtlMs > 0) {
      cachedBoxScores.set(game.externalGameId, { expiresAt: Date.now() + cacheTtlMs, data: result });
    }
    return result;
  }
}

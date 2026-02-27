type EndpointConfig = {
  baseUrl: string;
  apiKey: string;
  schedulePaths: string[];
  seasonStatsPaths: string[];
  injuryPaths: string[];
  playerPropsByDatePaths: string[];
  activeSportsbooksPath: string;
  bettingMetadataPath: string;
  bettingEventsByDatePath: string;
  bettingPlayerPropsByGamePath: string;
  boxScoresFinalByDatePath: string;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parsePaths(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveConfig(): EndpointConfig {
  const apiKey = process.env.SPORTS_DATA_IO_API_KEY;
  if (!apiKey) {
    throw new Error("SPORTS_DATA_IO_API_KEY is required.");
  }

  return {
    baseUrl: process.env.SPORTS_DATA_IO_BASE_URL ?? "https://api.sportsdata.io/v3/nba",
    apiKey,
    schedulePaths: parsePaths(process.env.SPORTS_DATA_IO_SCHEDULE_PATHS, ["/scores/json/GamesByDate/{date}"]),
    seasonStatsPaths: parsePaths(process.env.SPORTS_DATA_IO_SEASON_STATS_PATHS, ["/stats/json/PlayerSeasonStats/{season}"]),
    injuryPaths: parsePaths(process.env.SPORTS_DATA_IO_INJURY_PATHS, ["/projections/json/InjuredPlayers"]),
    playerPropsByDatePaths: parsePaths(process.env.SPORTS_DATA_IO_PLAYER_PROPS_PATHS, ["/odds/json/PlayerPropsByDate/{date}"]),
    activeSportsbooksPath: process.env.SPORTS_DATA_IO_ACTIVE_SPORTSBOOKS_PATH ?? "/odds/json/ActiveSportsbooks",
    bettingMetadataPath: process.env.SPORTS_DATA_IO_BETTING_METADATA_PATH ?? "/odds/json/BettingMetadata",
    bettingEventsByDatePath: process.env.SPORTS_DATA_IO_BETTING_EVENTS_PATH ?? "/odds/json/BettingEventsByDate/{date}",
    bettingPlayerPropsByGamePath:
      process.env.SPORTS_DATA_IO_BETTING_PLAYER_PROPS_PATH ?? "/odds/json/BettingPlayerPropsByGameID/{gameId}",
    boxScoresFinalByDatePath: process.env.SPORTS_DATA_IO_BOX_SCORES_FINAL_PATH ?? "/stats/json/BoxScoresFinal/{date}",
  };
}

function fillTemplate(path: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    path,
  );
}

function toArrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["data", "Data", "results", "Results", "items", "Items"]) {
      const candidate = record[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }
  return [];
}

export class SportsDataClient {
  private readonly config: EndpointConfig;

  constructor(config: EndpointConfig = resolveConfig()) {
    this.config = config;
  }

  private async fetchJson(path: string): Promise<unknown> {
    const url = new URL(`${this.config.baseUrl}${path}`);
    url.searchParams.set("key", this.config.apiKey);

    const requestInit: RequestInit = {
      method: "GET",
      headers: {
        "Ocp-Apim-Subscription-Key": this.config.apiKey,
        Accept: "application/json",
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
            lastError = new Error(`Retryable SportsData response: ${response.status}`);
            continue;
          }
          throw new Error(`SportsData request failed (${response.status}) for ${path}`);
        }
        return (await response.json()) as unknown;
      } catch (error) {
        const reason = error instanceof Error ? error : new Error("Unknown network error");
        lastError = reason;
      }
    }

    throw lastError ?? new Error(`SportsData request failed for ${path}`);
  }

  private async fetchArrayPath(path: string): Promise<unknown[]> {
    const payload = await this.fetchJson(path);
    return toArrayPayload(payload);
  }

  private async fetchArrayWithFallback(paths: string[], replacements: Record<string, string>): Promise<unknown[]> {
    let lastError: Error | null = null;

    for (const pathTemplate of paths) {
      const resolvedPath = fillTemplate(pathTemplate, replacements);
      try {
        const payload = await this.fetchArrayPath(resolvedPath);
        if (payload.length > 0) {
          return payload;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown endpoint error");
      }
    }

    if (lastError) {
      throw lastError;
    }
    return [];
  }

  async fetchSchedule(dateEt: string): Promise<unknown[]> {
    return this.fetchArrayWithFallback(this.config.schedulePaths, { date: dateEt });
  }

  async fetchSeasonStats(season: string): Promise<unknown[]> {
    return this.fetchArrayWithFallback(this.config.seasonStatsPaths, { season });
  }

  async fetchInjuries(): Promise<unknown[]> {
    return this.fetchArrayWithFallback(this.config.injuryPaths, {});
  }

  async fetchLegacyPlayerPropsByDate(dateEt: string): Promise<unknown[]> {
    return this.fetchArrayWithFallback(this.config.playerPropsByDatePaths, { date: dateEt });
  }

  async fetchActiveSportsbooks(): Promise<unknown[]> {
    return this.fetchArrayPath(this.config.activeSportsbooksPath);
  }

  async fetchBettingMetadata(): Promise<unknown> {
    return this.fetchJson(this.config.bettingMetadataPath);
  }

  async fetchBettingEventsByDate(dateEt: string): Promise<unknown[]> {
    const path = fillTemplate(this.config.bettingEventsByDatePath, { date: dateEt });
    return this.fetchArrayPath(path);
  }

  async fetchBettingPlayerPropsByGameId(gameId: string): Promise<unknown[]> {
    const path = fillTemplate(this.config.bettingPlayerPropsByGamePath, { gameId });
    return this.fetchArrayPath(path);
  }

  async fetchBoxScoresFinalByDate(dateEt: string): Promise<unknown[]> {
    const path = fillTemplate(this.config.boxScoresFinalByDatePath, { date: dateEt });
    return this.fetchArrayPath(path);
  }
}

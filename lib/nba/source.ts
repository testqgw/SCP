import { EspnNbaDataClient } from "@/lib/espn/client";
import { createEspnIdResolver, persistEspnIdLinks, type PersistEspnIdLinksResult } from "@/lib/espn/idMap";
import type { EspnIdLink, TranslatedEspnPayload } from "@/lib/espn/idMatch";
import { NbaDataClient, type NormalizedNbaScheduleGame } from "@/lib/nba/client";
import type { NormalizedPlayerGameStat, NormalizedPlayerSeason } from "@/lib/sportsdata/types";
import {
  parseNbaDataSourceMode,
  selectScheduleSource,
  type NbaDataSourceMode,
  type NbaDataSourceName,
} from "./sourceSelect";

export type NbaBoxScorePayload = {
  players: NormalizedPlayerSeason[];
  logs: NormalizedPlayerGameStat[];
};

/** Schedule + box score feed. Whatever the source, ids coming out are NBA ids (or `espn:` fallbacks). */
export type NbaScheduleProvider = {
  source: NbaDataSourceName;
  fetchGameBoxScore(game: NormalizedNbaScheduleGame): Promise<NbaBoxScorePayload>;
  /** Stores ESPN ids collected so far on rows that now exist. No-op for the NBA CDN. */
  persistIdLinks(): Promise<PersistEspnIdLinksResult | null>;
  /** One-line summary of ids that could not be matched, if any. */
  unresolvedSummary(): string | null;
};

export function getNbaDataSourceMode(): NbaDataSourceMode {
  return parseNbaDataSourceMode(process.env.NBA_DATA_SOURCE);
}

function nbaProvider(client: NbaDataClient): NbaScheduleProvider {
  return {
    source: "nba_official",
    fetchGameBoxScore: (game) => client.fetchGameBoxScore(game),
    persistIdLinks: async () => null,
    unresolvedSummary: () => null,
  };
}

class EspnScheduleProvider implements NbaScheduleProvider {
  readonly source = "espn" as const;
  private readonly client = new EspnNbaDataClient();
  private readonly resolver = createEspnIdResolver();
  private readonly espnGameByExternalId = new Map<string, NormalizedNbaScheduleGame>();
  private readonly playerLinks = new Map<string, EspnIdLink>();
  private readonly gameLinks = new Map<string, EspnIdLink>();
  private readonly unresolvedPlayers = new Set<string>();
  private readonly unresolvedGames = new Set<string>();

  private record(translated: TranslatedEspnPayload): void {
    translated.links.players.forEach((link) => this.playerLinks.set(link.espnId, link));
    translated.links.games.forEach((link) => this.gameLinks.set(link.espnId, link));
    translated.unresolved.players.forEach((match) => this.unresolvedPlayers.add(match.espnId));
    translated.unresolved.games.forEach((match) => this.unresolvedGames.add(match.espnId));
  }

  async fetchSchedule(from: string, to: string): Promise<NormalizedNbaScheduleGame[]> {
    const espnGames = await this.client.fetchScheduleRange(from, to);
    const translated = await this.resolver.translate({ games: espnGames, players: [], logs: [] });
    this.record(translated);
    translated.games.forEach((game, index) => {
      this.espnGameByExternalId.set(game.externalGameId, espnGames[index]);
    });
    return translated.games;
  }

  async fetchGameBoxScore(game: NormalizedNbaScheduleGame): Promise<NbaBoxScorePayload> {
    const espnGame = this.espnGameByExternalId.get(game.externalGameId);
    if (!espnGame) {
      throw new Error(`No ESPN event known for game ${game.externalGameId}`);
    }
    const box = await this.client.fetchGameBoxScore(espnGame);
    const translated = await this.resolver.translate({ games: [espnGame], players: box.players, logs: box.logs });
    this.record(translated);
    return { players: translated.players, logs: translated.logs };
  }

  async persistIdLinks(): Promise<PersistEspnIdLinksResult> {
    return persistEspnIdLinks({
      players: Array.from(this.playerLinks.values()),
      games: Array.from(this.gameLinks.values()),
    });
  }

  unresolvedSummary(): string | null {
    if (this.unresolvedPlayers.size === 0 && this.unresolvedGames.size === 0) {
      return null;
    }
    return (
      `ESPN feed: ${this.unresolvedPlayers.size} player(s) and ${this.unresolvedGames.size} game(s) had no NBA id match ` +
      `and were stored under espn: ids. Run the ESPN seed scripts to link them.`
    );
  }
}

/**
 * Fetches games in [from, to] from the source picked by NBA_DATA_SOURCE and returns a provider bound to
 * that source for the box score calls that follow.
 */
export async function openNbaSchedule(
  from: string,
  to: string,
  mode: NbaDataSourceMode = getNbaDataSourceMode(),
): Promise<{ provider: NbaScheduleProvider; schedule: NormalizedNbaScheduleGame[]; warnings: string[] }> {
  const selected = await selectScheduleSource(mode, {
    nba: async () => {
      const client = new NbaDataClient();
      const season = await client.fetchSchedule();
      return {
        provider: nbaProvider(client),
        schedule: season.filter((game) => game.gameDateEt >= from && game.gameDateEt <= to),
      };
    },
    espn: async () => {
      const provider = new EspnScheduleProvider();
      return { provider, schedule: await provider.fetchSchedule(from, to) };
    },
  });

  return { ...selected.result, warnings: selected.warnings };
}

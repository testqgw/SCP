import { load } from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { round } from "../lib/utils";

export type HistoricalPregameOdds = {
  source: "sportsbookreview" | "vegasinsider";
  gameId: number;
  awayCode: string;
  homeCode: string;
  openingHomeSpread: number | null;
  currentHomeSpread: number | null;
  openingTotal: number | null;
  currentTotal: number | null;
  sportsbookCount: number;
};

export type RotowireAvailabilityStatus =
  | "OUT"
  | "DOUBTFUL"
  | "QUESTIONABLE"
  | "PROBABLE"
  | "ACTIVE"
  | "UNKNOWN";

export type HistoricalRotowireUnavailablePlayer = {
  playerName: string;
  status: RotowireAvailabilityStatus;
  percentPlay: number | null;
  title: string | null;
};

export type HistoricalRotowireTeamSignal = {
  teamCode: string;
  gameTimeEt: string | null;
  status: "CONFIRMED" | "EXPECTED" | "UNKNOWN";
  starters: string[];
  unavailablePlayers: HistoricalRotowireUnavailablePlayer[];
};

export type HistoricalRotowireSnapshot = {
  source: "sportsdata" | "rotowire";
  sourceUrl: string;
  fetchedAt: string;
  dateEt: string;
  pageDateLabel: string | null;
  teams: HistoricalRotowireTeamSignal[];
};

type SportsDataStartingLineupPlayer = {
  FirstName?: string;
  LastName?: string;
  Starting?: boolean;
  Confirmed?: boolean;
};

type SportsDataStartingLineupGame = {
  DateTime?: string;
  HomeTeam?: string;
  AwayTeam?: string;
  HomeLineup?: SportsDataStartingLineupPlayer[];
  AwayLineup?: SportsDataStartingLineupPlayer[];
};

type SbrDailyGameRow = {
  gameId: number;
  awayCode: string;
  homeCode: string;
};

const PROVIDER_TO_CANONICAL_TEAM: Record<string, string> = {
  NY: "NYK",
  NO: "NOP",
  GS: "GSW",
  SA: "SAS",
  BK: "BKN",
  BRK: "BKN",
  PHO: "PHX",
};

const SBR_BOOK_PRIORITY = ["draftkings", "fanduel", "betmgm", "caesars", "bet365", "fanatics"];

const sbrDailyCache = new Map<string, Promise<SbrDailyGameRow[]>>();
const sbrMatchupCache = new Map<number, Promise<HistoricalPregameOdds | null>>();
const rotowireHistoricalCache = new Map<string, Promise<HistoricalRotowireSnapshot | null>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithRetry(url: string): Promise<string> {
  const delays = [0, 700, 1800, 4200];
  let lastError: Error | null = null;

  for (const delayMs of delays) {
    if (delayMs > 0) await sleep(delayMs);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status} for ${url}`);
        continue;
      }

      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`Failed to fetch ${url}`);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

function extractNextData(html: string): unknown {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match?.[1]) {
    throw new Error("Unable to parse __NEXT_DATA__ payload.");
  }
  return JSON.parse(match[1]);
}

export function canonicalizeProviderTeamCode(code: string | null | undefined): string {
  const normalized = (code ?? "").trim().toUpperCase();
  return PROVIDER_TO_CANONICAL_TEAM[normalized] ?? normalized;
}

function medianNumber(values: number[]): number | null {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (filtered.length === 0) return null;
  const middle = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 1) return filtered[middle];
  return round((filtered[middle - 1] + filtered[middle]) / 2, 2);
}

function orderedLines<T>(
  views: T[],
  getBook: (view: T) => string | null | undefined,
  getValue: (view: T) => number | null,
): number[] {
  const ranked = views
    .map((view) => {
      const book = (getBook(view) ?? "").toLowerCase();
      const priority = SBR_BOOK_PRIORITY.indexOf(book);
      return {
        priority: priority === -1 ? SBR_BOOK_PRIORITY.length + 1 : priority,
        value: getValue(view),
      };
    })
    .filter((entry) => entry.value != null && Number.isFinite(entry.value))
    .sort((left, right) => left.priority - right.priority);

  return ranked.map((entry) => entry.value as number);
}

async function fetchSbrDailyGames(dateEt: string): Promise<SbrDailyGameRow[]> {
  const cached = sbrDailyCache.get(dateEt);
  if (cached) return cached;

  const task = (async () => {
    const html = await fetchTextWithRetry(
      `https://www.sportsbookreview.com/scores/nba-basketball/matchups/?date=${encodeURIComponent(dateEt)}`,
    );
    const data = extractNextData(html) as {
      props?: {
        pageProps?: {
          oddsTables?: Array<{
            oddsTableModel?: {
              gameRows?: Array<{
                gameView?: {
                  gameId?: number;
                  awayTeam?: { shortName?: string | null } | null;
                  homeTeam?: { shortName?: string | null } | null;
                } | null;
              }>;
            };
          }>;
        };
      };
    };

    const rows = data.props?.pageProps?.oddsTables?.[0]?.oddsTableModel?.gameRows ?? [];
    return rows
      .map((row) => ({
        gameId: Number(row.gameView?.gameId),
        awayCode: canonicalizeProviderTeamCode(row.gameView?.awayTeam?.shortName),
        homeCode: canonicalizeProviderTeamCode(row.gameView?.homeTeam?.shortName),
      }))
      .filter((row) => Number.isFinite(row.gameId) && row.awayCode && row.homeCode);
  })();

  sbrDailyCache.set(dateEt, task);
  return task;
}

async function fetchSbrPregameOdds(gameId: number, awayCode: string, homeCode: string): Promise<HistoricalPregameOdds | null> {
  const cached = sbrMatchupCache.get(gameId);
  if (cached) return cached;

  const task = (async () => {
    const html = await fetchTextWithRetry(`https://www.sportsbookreview.com/scores/nba-basketball/matchup/${gameId}/`);
    const data = extractNextData(html) as {
      props?: {
        pageProps?: {
          matchupModel?: {
            matchup?: {
              oddsViews?: {
                spreadOddsViews?: Array<{
                  sportsbook?: string | null;
                  openingLine?: { homeSpread?: number | null } | null;
                  currentLine?: { homeSpread?: number | null } | null;
                }>;
                totalOddsViews?: Array<{
                  sportsbook?: string | null;
                  openingLine?: { total?: number | null } | null;
                  currentLine?: { total?: number | null } | null;
                }>;
              };
            };
          };
        };
      };
    };

    const spreadViews = data.props?.pageProps?.matchupModel?.matchup?.oddsViews?.spreadOddsViews ?? [];
    const totalViews = data.props?.pageProps?.matchupModel?.matchup?.oddsViews?.totalOddsViews ?? [];
    const openingHomeSpread = medianNumber(
      orderedLines(spreadViews, (view) => view.sportsbook, (view) => view.openingLine?.homeSpread ?? null),
    );
    const currentHomeSpread = medianNumber(
      orderedLines(spreadViews, (view) => view.sportsbook, (view) => view.currentLine?.homeSpread ?? null),
    );
    const openingTotal = medianNumber(
      orderedLines(totalViews, (view) => view.sportsbook, (view) => view.openingLine?.total ?? null),
    );
    const currentTotal = medianNumber(
      orderedLines(totalViews, (view) => view.sportsbook, (view) => view.currentLine?.total ?? null),
    );

    return {
      source: "sportsbookreview",
      gameId,
      awayCode,
      homeCode,
      openingHomeSpread,
      currentHomeSpread,
      openingTotal,
      currentTotal,
      sportsbookCount: Math.max(spreadViews.length, totalViews.length),
    } satisfies HistoricalPregameOdds;
  })();

  sbrMatchupCache.set(gameId, task);
  return task;
}

function extractLineValue(raw: string): number | null {
  const match = raw.match(/[ou]?([+-]?\d+(?:\.\d+)?)/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractViRowNumbers($: ReturnType<typeof load>, $row: ReturnType<ReturnType<typeof load>>): number[] {
  return $row
    .find("td.game-odds")
    .toArray()
    .map((cell: unknown) => extractLineValue($(cell as never).text().replace(/\s+/g, " ").trim()))
    .filter((value: number | null): value is number => value != null && Number.isFinite(value));
}

async function fetchVegasInsiderPregameOdds(
  dateEt: string,
  awayCode: string,
  homeCode: string,
): Promise<HistoricalPregameOdds | null> {
  const html = await fetchTextWithRetry(`https://www.vegasinsider.com/nba/odds/las-vegas/?date=${encodeURIComponent(dateEt)}`);
  const $ = load(html);

  const resolvePairFromTable = (prefix: string) => {
    let openHome: number | null = null;
    let currentHome: number | null = null;
    let openTotal: number | null = null;
    let currentTotal: number | null = null;

    $(`tbody[id^="${prefix}"]`).each((_, tbody) => {
      const rows = $(tbody).find("tr").toArray();
      for (let index = 0; index < rows.length - 1; index += 1) {
        const awayRow = $(rows[index]);
        const homeRow = $(rows[index + 1]);
        const awayAbbr = canonicalizeProviderTeamCode(awayRow.find("a.team-name").attr("data-abbr"));
        const homeAbbr = canonicalizeProviderTeamCode(homeRow.find("a.team-name").attr("data-abbr"));
        if (awayAbbr !== awayCode || homeAbbr !== homeCode) continue;

        const awayNumbers = extractViRowNumbers($, awayRow);
        const homeNumbers = extractViRowNumbers($, homeRow);
        if (prefix.includes("spread")) {
          openHome = homeNumbers[0] ?? null;
          currentHome = medianNumber(homeNumbers.slice(1)) ?? homeNumbers[1] ?? null;
        } else {
          openTotal = awayNumbers[0] ?? null;
          currentTotal = medianNumber(awayNumbers.slice(1)) ?? awayNumbers[1] ?? null;
        }
        return false;
      }
      return undefined;
    });

    return { openHome, currentHome, openTotal, currentTotal };
  };

  const spread = resolvePairFromTable("odds-table-spread--");
  const total = resolvePairFromTable("odds-table-total--");
  if (spread.openHome == null && total.openTotal == null) return null;

  return {
    source: "vegasinsider",
    gameId: Number.NaN,
    awayCode,
    homeCode,
    openingHomeSpread: spread.openHome,
    currentHomeSpread: spread.currentHome,
    openingTotal: total.openTotal,
    currentTotal: total.currentTotal,
    sportsbookCount: 0,
  };
}

export async function fetchHistoricalPregameOdds(
  dateEt: string,
  awayCode: string,
  homeCode: string,
): Promise<HistoricalPregameOdds | null> {
  const dailyGames = await fetchSbrDailyGames(dateEt);
  const row = dailyGames.find((item) => item.awayCode === awayCode && item.homeCode === homeCode);
  if (row) {
    const sbr = await fetchSbrPregameOdds(row.gameId, awayCode, homeCode).catch(() => null);
    if (sbr?.openingHomeSpread != null || sbr?.openingTotal != null) {
      return sbr;
    }
  }
  return fetchVegasInsiderPregameOdds(dateEt, awayCode, homeCode).catch(() => null);
}

function sportsDataApiKey(): string | null {
  const key = process.env.SPORTS_DATA_IO_API_KEY?.trim();
  if (key) return key;
  for (const name of [".env.production", ".env.local", ".env", ".env.vercel"]) {
    const full = path.resolve(process.cwd(), name);
    if (!fs.existsSync(full)) continue;
    const line = fs
      .readFileSync(full, "utf8")
      .split(/\r?\n/)
      .find((entry) => entry.trim().startsWith("SPORTS_DATA_IO_API_KEY="));
    if (!line) continue;
    const resolved = line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
    if (resolved) return resolved;
  }
  return null;
}

async function fetchSportsDataJsonWithRetry<T>(apiPath: string): Promise<T> {
  const apiKey = sportsDataApiKey();
  if (!apiKey) {
    throw new Error("SPORTS_DATA_IO_API_KEY is required for historical lineup backtesting.");
  }

  const url = new URL(`https://api.sportsdata.io/v3/nba${apiPath}`);
  url.searchParams.set("key", apiKey);
  const delays = [0, 500, 1400, 3200];
  let lastError: Error | null = null;

  for (const delayMs of delays) {
    if (delayMs > 0) await sleep(delayMs);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Ocp-Apim-Subscription-Key": apiKey,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        lastError = new Error(`SportsData request failed (${response.status}) for ${apiPath}`);
        continue;
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`SportsData request failed for ${apiPath}`);
    }
  }

  throw lastError ?? new Error(`SportsData request failed for ${apiPath}`);
}

function parseRotowireLineupStatus(raw: string): "CONFIRMED" | "EXPECTED" | "UNKNOWN" {
  const text = raw.toLowerCase();
  if (text.includes("confirmed")) return "CONFIRMED";
  if (text.includes("expected")) return "EXPECTED";
  return "UNKNOWN";
}

function parseRotowireAvailabilityStatus(raw: string | null): RotowireAvailabilityStatus {
  const normalized = (raw ?? "").trim().toUpperCase();
  if (!normalized) return "UNKNOWN";
  if (["OUT", "OFS", "INJ", "SUSP", "NWT"].includes(normalized)) return "OUT";
  if (["DOUBTFUL", "D", "DTD"].includes(normalized)) return "DOUBTFUL";
  if (["QUESTIONABLE", "QUES", "Q", "GTD"].includes(normalized)) return "QUESTIONABLE";
  if (["PROBABLE", "PROB", "P"].includes(normalized)) return "PROBABLE";
  if (["ACTIVE", "OK"].includes(normalized)) return "ACTIVE";
  return "UNKNOWN";
}

function parseRotowirePercentPlay(className: string): number | null {
  const match = className.match(/is-pct-play-(\d{1,3})/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(parsed, 100));
}

function parseRotowireTeamSignal(
  $: ReturnType<typeof load>,
  root: ReturnType<ReturnType<typeof load>>,
  teamCode: string,
  gameTimeEt: string | null,
): HistoricalRotowireTeamSignal | null {
  if (!teamCode) return null;
  const status = parseRotowireLineupStatus(root.find("li.lineup__status").first().text().trim());
  const starters = root
    .find("li.lineup__player a[title]")
    .slice(0, 5)
    .toArray()
    .map((node) => $(node).attr("title")?.trim() || $(node).text().trim())
    .filter((value): value is string => Boolean(value));

  const unavailablePlayers = root
    .find("li.lineup__player.has-injury-status")
    .toArray()
    .map((node) => {
      const row = $(node);
      const playerName = row.find("a[title]").attr("title")?.trim() || row.find("a").first().text().trim();
      if (!playerName) return null;
      const injuryText = row.find(".lineup__inj").first().text().trim() || null;
      return {
        playerName,
        status: parseRotowireAvailabilityStatus(injuryText),
        percentPlay: parseRotowirePercentPlay(row.attr("class") ?? ""),
        title: row.attr("title")?.trim() || null,
      } satisfies HistoricalRotowireUnavailablePlayer;
    })
    .filter((value): value is HistoricalRotowireUnavailablePlayer => Boolean(value));

  if (starters.length === 0 && unavailablePlayers.length === 0) return null;

  return {
    teamCode,
    gameTimeEt,
    status,
    starters,
    unavailablePlayers,
  };
}

function formatSportsDataGameTimeEt(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function parseSportsDataHistoricalLineupSnapshot(
  payload: unknown[],
  dateEt: string,
): HistoricalRotowireSnapshot | null {
  const teams: HistoricalRotowireTeamSignal[] = [];
  (Array.isArray(payload) ? payload : []).forEach((row) => {
    const game = row as SportsDataStartingLineupGame;
    const gameTimeEt = formatSportsDataGameTimeEt(game.DateTime);
    const toTeamSignal = (
      teamCodeRaw: string | undefined,
      lineup: SportsDataStartingLineupPlayer[] | undefined,
    ): HistoricalRotowireTeamSignal | null => {
      const teamCode = canonicalizeProviderTeamCode(teamCodeRaw);
      const starters = (Array.isArray(lineup) ? lineup : [])
        .filter((player) => player?.Starting === true)
        .map((player) => [player.FirstName, player.LastName].filter(Boolean).join(" ").trim())
        .filter(Boolean);
      if (!teamCode || starters.length === 0) return null;
      const confirmed = (Array.isArray(lineup) ? lineup : []).some((player) => player?.Confirmed === true);
      return {
        teamCode,
        gameTimeEt,
        status: confirmed ? "CONFIRMED" : "EXPECTED",
        starters,
        unavailablePlayers: [],
      };
    };

    const away = toTeamSignal(game.AwayTeam, game.AwayLineup);
    const home = toTeamSignal(game.HomeTeam, game.HomeLineup);
    if (away) teams.push(away);
    if (home) teams.push(home);
  });

  if (teams.length === 0) return null;
  return {
    source: "sportsdata",
    sourceUrl: `https://api.sportsdata.io/v3/nba/projections/json/StartingLineupsByDate/${dateEt}`,
    fetchedAt: new Date().toISOString(),
    dateEt,
    pageDateLabel: dateEt,
    teams,
  };
}

export async function fetchHistoricalRotowireSnapshot(dateEt: string): Promise<HistoricalRotowireSnapshot | null> {
  const cached = rotowireHistoricalCache.get(dateEt);
  if (cached) return cached;

  const task = (async () => {
    const sportsDataSnapshot = await fetchSportsDataJsonWithRetry<unknown[]>(
      "/projections/json/StartingLineupsByDate/" + encodeURIComponent(dateEt),
    )
      .then((payload) => parseSportsDataHistoricalLineupSnapshot(payload, dateEt))
      .catch(() => null);
    if (sportsDataSnapshot) return sportsDataSnapshot;

    const sourceUrl = `https://www.rotowire.com/basketball/nba-lineups.php?date=${encodeURIComponent(dateEt)}`;
    const html = await fetchTextWithRetry(sourceUrl);
    const $ = load(html);
    const teams: HistoricalRotowireTeamSignal[] = [];
    const pageDateLabel = $(".page-title__secondary").first().text().trim() || null;

    $(".lineups .lineup.is-nba").each((_, card) => {
      const awayCode = canonicalizeProviderTeamCode($(card).find(".lineup__team.is-visit .lineup__abbr").first().text());
      const homeCode = canonicalizeProviderTeamCode($(card).find(".lineup__team.is-home .lineup__abbr").first().text());
      const gameTimeEt = $(card).find(".lineup__time, .lineup__meta").first().text().replace(/\s+/g, " ").trim() || null;
      const away = parseRotowireTeamSignal($, $(card).find("ul.lineup__list.is-visit").first(), awayCode, gameTimeEt);
      const home = parseRotowireTeamSignal($, $(card).find("ul.lineup__list.is-home").first(), homeCode, gameTimeEt);
      if (away) teams.push(away);
      if (home) teams.push(home);
    });

    if (teams.length === 0) return null;

    return {
      source: "rotowire",
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      dateEt,
      pageDateLabel,
      teams,
    } satisfies HistoricalRotowireSnapshot;
  })();

  rotowireHistoricalCache.set(dateEt, task);
  return task;
}

export function getHistoricalRotowireTeamSignal(
  snapshot: HistoricalRotowireSnapshot | null,
  teamCode: string | null,
): HistoricalRotowireTeamSignal | null {
  if (!snapshot || !teamCode) return null;
  return snapshot.teams.find((team) => team.teamCode === teamCode) ?? null;
}

function lineupStatusWeight(status: "CONFIRMED" | "EXPECTED" | "UNKNOWN"): number {
  if (status === "CONFIRMED") return 1;
  if (status === "EXPECTED") return 0.72;
  return 0.45;
}

function unavailableStatusWeight(status: RotowireAvailabilityStatus, percentPlay: number | null): number {
  if (status === "OUT") return 1;
  if (status === "DOUBTFUL") return 0.9;
  if (status === "QUESTIONABLE") return 0.58;
  if (status === "PROBABLE") return 0.24;
  if (status === "ACTIVE") return 0.08;
  if (percentPlay != null) return round((100 - percentPlay) / 100, 2);
  return 0.4;
}

export function computeLineupTimingConfidence(teamSignal: HistoricalRotowireTeamSignal | null): number | null {
  if (!teamSignal) return null;
  let confidence = lineupStatusWeight(teamSignal.status);
  if (teamSignal.starters.length >= 5) confidence += 0.08;

  if (teamSignal.unavailablePlayers.length > 0) {
    const certaintyWeights = teamSignal.unavailablePlayers.map((player) =>
      unavailableStatusWeight(player.status, player.percentPlay),
    );
    const strongest = Math.max(...certaintyWeights);
    const averageWeight = certaintyWeights.reduce((sum, value) => sum + value, 0) / certaintyWeights.length;
    confidence += Math.max(0, Math.min(strongest * 0.12 + averageWeight * 0.08, 0.18));
  }

  return round(Math.max(0.35, Math.min(confidence, 1)), 2);
}

export async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => worker()));
  return results;
}

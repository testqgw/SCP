import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { prisma } from "../lib/prisma";
import type { SnapshotMarket } from "../lib/types/snapshot";

type Args = {
  playerSearch: string;
  from: string;
  to: string;
  markets: SnapshotMarket[];
  out: string;
};

type PlayerRow = {
  id: string;
  externalId: string | null;
  fullName: string;
};

type ExportRow = {
  gameDateEt: string;
  market: SnapshotMarket;
  line: number;
  overLine: number | null;
  underLine: number | null;
  overPrice: number | null;
  underPrice: number | null;
  playerId: string;
  externalPlayerId: string | null;
  playerName: string;
  matchup: string | null;
  sportsbookOver: string | null;
  sportsbookUnder: string | null;
  source: string;
  sourceUrl: string;
};

type PageRow = {
  line: number | null;
  matchup: string | null;
  overLine: number | null;
  underLine: number | null;
  overPrice: number | null;
  underPrice: number | null;
  sportsbookOver: string | null;
  sportsbookUnder: string | null;
};

type DateRow = {
  gameDateEt: string;
  teamAbbreviation: string | null;
  opponentAbbreviation: string | null;
  isHome: boolean | null;
};

type ScoresAndOddsEvent = {
  identifier: number;
  awayCode: string;
  homeCode: string;
  matchup: string;
  pageUrl: string;
};

type CoversScheduleGame = {
  boxscoreId: string;
  gameDateEt: string;
  awayCode: string;
  homeCode: string;
  matchup: string;
};

type ScoresAndOddsMarket = {
  player?: {
    first_name?: string;
    last_name?: string;
  };
  comparison?: Record<
    string,
    {
      sportsbook?: number;
      favorite?: string;
      value?: number;
      available?: boolean;
      over?: number;
      under?: number;
    }
  >;
};

const EVENT_CACHE = new Map<string, Promise<ScoresAndOddsEvent[]>>();
const COMPARISON_CACHE = new Map<string, Promise<ScoresAndOddsMarket[]>>();
const COVERS_SCHEDULE_CACHE = new Map<string, Promise<CoversScheduleGame[]>>();

const MARKET_CONFIG: Record<SnapshotMarket, { slug: string }> = {
  PTS: { slug: "points" },
  REB: { slug: "rebounds" },
  AST: { slug: "assists" },
  THREES: { slug: "3-pointers" },
  PRA: { slug: "points,-rebounds,-&-assists" },
  PA: { slug: "points-&-assists" },
  PR: { slug: "points-&-rebounds" },
  RA: { slug: "rebounds-&-assists" },
};

const COVERS_PROP_EVENT: Partial<Record<SnapshotMarket, string>> = {
  PTS: "NBA_GAME_PLAYER_POINTS",
  REB: "NBA_GAME_PLAYER_REBOUNDS",
  AST: "NBA_GAME_PLAYER_ASSISTS",
  THREES: "NBA_GAME_PLAYER_3_POINTERS_MADE",
};

const COVERS_TEAM_SLUG: Record<string, string> = {
  ATL: "atlanta-hawks",
  BKN: "brooklyn-nets",
  BOS: "boston-celtics",
  CHA: "charlotte-hornets",
  CHI: "chicago-bulls",
  CLE: "cleveland-cavaliers",
  DAL: "dallas-mavericks",
  DEN: "denver-nuggets",
  DET: "detroit-pistons",
  GSW: "golden-state-warriors",
  HOU: "houston-rockets",
  IND: "indiana-pacers",
  LAC: "los-angeles-clippers",
  LAL: "los-angeles-lakers",
  MEM: "memphis-grizzlies",
  MIA: "miami-heat",
  MIL: "milwaukee-bucks",
  MIN: "minnesota-timberwolves",
  NOP: "new-orleans-pelicans",
  NYK: "new-york-knicks",
  OKC: "oklahoma-city-thunder",
  ORL: "orlando-magic",
  PHI: "philadelphia-76ers",
  PHX: "phoenix-suns",
  POR: "portland-trail-blazers",
  SAC: "sacramento-kings",
  SAS: "san-antonio-spurs",
  TOR: "toronto-raptors",
  UTA: "utah-jazz",
  WAS: "washington-wizards",
};

const DEFAULT_MARKETS: SnapshotMarket[] = ["PTS"];

const PAGE_CACHE = new Map<string, Promise<string>>();

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let playerSearch = "";
  let from = "2025-10-01";
  let to = "2026-03-09";
  let out = "";
  let markets = DEFAULT_MARKETS;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];

    if (token === "--player" && next) {
      playerSearch = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--player=")) {
      playerSearch = token.slice("--player=".length);
      continue;
    }
    if (token === "--from" && next) {
      from = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--from=")) {
      from = token.slice("--from=".length);
      continue;
    }
    if (token === "--to" && next) {
      to = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--to=")) {
      to = token.slice("--to=".length);
      continue;
    }
    if (token === "--markets" && next) {
      markets = parseMarkets(next);
      index += 1;
      continue;
    }
    if (token.startsWith("--markets=")) {
      markets = parseMarkets(token.slice("--markets=".length));
      continue;
    }
    if (token === "--out" && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
    }
  }

  if (!playerSearch.trim()) {
    throw new Error("Missing required --player argument.");
  }

  const outputPath =
    out.trim() ||
    path.join(
      "exports",
      "historical-lines",
      `${slugify(playerSearch)}-${markets.join("-").toLowerCase()}-${from}-to-${to}.csv`,
    );

  return {
    playerSearch: playerSearch.trim(),
    from,
    to,
    markets,
    out: outputPath,
  };
}

function parseMarkets(value: string): SnapshotMarket[] {
  const tokens = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean) as SnapshotMarket[];
  const resolved = tokens.filter((token) => token in MARKET_CONFIG);
  if (resolved.length === 0) {
    throw new Error(`No supported markets found in "${value}".`);
  }
  return Array.from(new Set(resolved));
}

function slugify(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, "-");
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function scorePlayerMatch(search: string, candidate: string): number {
  if (!search || !candidate) return 0;
  if (search === candidate) return 100;
  if (candidate.startsWith(search)) return 80;
  if (search.startsWith(candidate)) return 75;
  if (candidate.includes(search)) return 60;
  const searchTokens = search.split(" ");
  const candidateTokens = candidate.split(" ");
  const overlap = searchTokens.filter((token) => candidateTokens.includes(token)).length;
  return overlap * 10;
}

async function resolvePlayer(search: string): Promise<PlayerRow> {
  const players = await prisma.player.findMany({
    select: {
      id: true,
      externalId: true,
      fullName: true,
    },
  });

  const normalizedSearch = normalizeSearchText(search);
  const ranked = players
    .map((player) => ({
      player,
      score: scorePlayerMatch(normalizedSearch, normalizeSearchText(player.fullName)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.player.fullName.localeCompare(right.player.fullName));

  if (ranked.length === 0) {
    throw new Error(`No player found for "${search}".`);
  }

  return ranked[0].player;
}

async function fetchTextWithRetry(url: string): Promise<string> {
  const cached = PAGE_CACHE.get(url);
  if (cached) return cached;

  const task = (async () => {
    const delays = [0, 700, 1800, 4000];
    let lastError: Error | null = null;

    for (const delayMs of delays) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const response = await fetch(url, {
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
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
  })();

  PAGE_CACHE.set(url, task);
  return task;
}

function deriveLine(overLine: number | null, underLine: number | null): number | null {
  if (overLine != null && underLine != null) {
    return round((overLine + underLine) / 2, 2);
  }
  if (overLine != null) return overLine;
  if (underLine != null) return underLine;
  return null;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function csvCell(value: string | number | null): string {
  if (value == null) return "";
  return String(value).replace(/,/g, " ").replace(/\r?\n/g, " ").trim();
}

function parseAmericanOddsText(value: string | null | undefined): number | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "even" || normalized === "ev" || normalized === "evs") return 100;
  const parsed = Number(normalized.replace(/[^\d+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGamePageLineText(value: string | null | undefined): { side: "OVER" | "UNDER"; line: number } | null {
  const normalized = (value ?? "").trim().toLowerCase();
  const match = normalized.match(/^([ou])\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return null;
  return {
    side: match[1] === "o" ? "OVER" : "UNDER",
    line,
  };
}

function parseCoversOddsCell(value: string | null | undefined): { side: "OVER" | "UNDER"; line: number; price: number | null } | null {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const match = normalized.match(/([ou])\s*(-?\d+(?:\.\d+)?)(?:\s*([+-]\d+|even|ev|evs))?/);
  if (!match) return null;
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return null;
  return {
    side: match[1] === "o" ? "OVER" : "UNDER",
    line,
    price: parseAmericanOddsText(match[3] ?? null),
  };
}

function parseCoversBookSlug(src: string | null | undefined): string | null {
  const normalized = (src ?? "").trim();
  if (!normalized) return null;
  const match = normalized.match(/\/([^/]+)\.(?:svg|png)(?:\?|$)/i);
  if (!match) return null;
  return normalizeSearchText(match[1]);
}

function extractTeamCode(name: string | null | undefined): string | null {
  const normalized = (name ?? "").trim();
  if (!normalized) return null;
  const token = normalized.split(/\s+/)[0]?.trim().toUpperCase();
  return canonicalizeTeamCode(token || null);
}

function canonicalizeTeamCode(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) return null;

  switch (normalized) {
    case "NY":
      return "NYK";
    case "GS":
      return "GSW";
    case "NO":
      return "NOP";
    case "SA":
      return "SAS";
    case "PHO":
      return "PHX";
    default:
      return normalized;
  }
}

function medianNumber(values: number[]): number | null {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (filtered.length === 0) return null;
  const middle = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 1) return filtered[middle];
  return round((filtered[middle - 1] + filtered[middle]) / 2, 2);
}

function normalizeFilterName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchScoresAndOddsEventsByDate(dateEt: string): Promise<ScoresAndOddsEvent[]> {
  const cacheKey = dateEt;
  const cached = EVENT_CACHE.get(cacheKey);
  if (cached) return cached;

  const task = (async () => {
    const html = await fetchTextWithRetry(`https://www.scoresandodds.com/nba?date=${encodeURIComponent(dateEt)}`);
    const $ = load(html);
    const scripts = $('script[type="application/ld+json"]')
      .toArray()
      .map((element) => $(element).html()?.trim() || "")
      .filter(Boolean);

    const events: ScoresAndOddsEvent[] = [];
    for (const raw of scripts) {
      try {
        const payload = JSON.parse(raw) as Record<string, unknown>;
        if (payload["@type"] !== "SportsEvent") continue;
        const identifier = Number(payload.identifier);
        const awayCode = extractTeamCode(((payload.awayTeam as Record<string, unknown> | undefined)?.name as string | undefined) ?? null);
        const homeCode = extractTeamCode(((payload.homeTeam as Record<string, unknown> | undefined)?.name as string | undefined) ?? null);
        const matchup = typeof payload.name === "string" ? payload.name.trim() : "";
        const pageUrl = typeof payload.url === "string" ? payload.url.trim() : "";
        if (!Number.isFinite(identifier) || !awayCode || !homeCode) continue;
        events.push({
          identifier,
          awayCode,
          homeCode,
          matchup: matchup || `${awayCode} @ ${homeCode}`,
          pageUrl: pageUrl || `https://www.scoresandodds.com/nba/${homeCode.toLowerCase()}-vs-${awayCode.toLowerCase()}`,
        });
      } catch {
        continue;
      }
    }

    return events;
  })();

  EVENT_CACHE.set(cacheKey, task);
  return task;
}

async function fetchScoresAndOddsMarketComparison(
  eventId: number,
  market: SnapshotMarket,
  playerFilter: string,
): Promise<ScoresAndOddsMarket[]> {
  const cacheKey = `${eventId}|${market}|${playerFilter}`;
  const cached = COMPARISON_CACHE.get(cacheKey);
  if (cached) return cached;

  const task = (async () => {
    const url =
      `https://rga51lus77.execute-api.us-east-1.amazonaws.com/prod/market-comparison?event=${encodeURIComponent(`nba/${eventId}`)}` +
      `&market=${encodeURIComponent(MARKET_CONFIG[market].slug)}` +
      `&filter=${encodeURIComponent(playerFilter)}`;
    const responseText = await fetchTextWithRetry(url);
    const payload = JSON.parse(responseText) as { markets?: ScoresAndOddsMarket[] };
    return Array.isArray(payload.markets) ? payload.markets : [];
  })();

  COMPARISON_CACHE.set(cacheKey, task);
  return task;
}

function parseCoversDate(dateLabel: string): string | null {
  const cleaned = dateLabel.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^([A-Za-z]{3})\s+(\d{1,2})/);
  if (!match) return null;

  const monthToken = match[1].slice(0, 3).toLowerCase();
  const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(monthToken);
  if (monthIndex < 0) return null;

  const day = Number(match[2]);
  if (!Number.isFinite(day)) return null;
  const year = monthIndex >= 9 ? 2025 : 2026;
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function fetchCoversScheduleByTeam(teamCode: string): Promise<CoversScheduleGame[]> {
  const normalizedTeamCode = teamCode.trim().toUpperCase();
  const cached = COVERS_SCHEDULE_CACHE.get(normalizedTeamCode);
  if (cached) return cached;

  const task = (async () => {
    const teamSlug = COVERS_TEAM_SLUG[normalizedTeamCode];
    if (!teamSlug) return [];

    const html = await fetchTextWithRetry(`https://www.covers.com/sport/basketball/nba/teams/main/${teamSlug}`);
    const $ = load(html);
    const rows = $("#past-results tbody tr").toArray();
    const games: CoversScheduleGame[] = [];

    for (const rowElement of rows) {
      const row = $(rowElement);
      const cells = row.find("td");
      if (cells.length < 3) continue;

      const gameDateEt = parseCoversDate($(cells[0]).text());
      const opponentText = $(cells[1]).text().replace(/\s+/g, " ").trim().toUpperCase();
      const boxscoreHref = $(cells[2]).find('a[href*="/boxscore/"]').attr("href") ?? "";
      const boxscoreMatch = boxscoreHref.match(/\/boxscore\/(\d+)/);
      if (!gameDateEt || !boxscoreMatch) continue;

      const isAway = opponentText.startsWith("@");
      const opponentCode = canonicalizeTeamCode(opponentText.replace(/^@\s*/, "").trim());
      if (!opponentCode) continue;

      const awayCode = isAway ? normalizedTeamCode : opponentCode;
      const homeCode = isAway ? opponentCode : normalizedTeamCode;
      games.push({
        boxscoreId: boxscoreMatch[1],
        gameDateEt,
        awayCode,
        homeCode,
        matchup: `${awayCode} @ ${homeCode}`,
      });
    }

    return games;
  })();

  COVERS_SCHEDULE_CACHE.set(normalizedTeamCode, task);
  return task;
}

function bestBookValue(
  entries: Array<{ slug: string; value: number; price: number | null }>,
  side: "OVER" | "UNDER",
): { line: number | null; price: number | null; book: string | null } {
  if (entries.length === 0) return { line: null, price: null, book: null };
  const sorted = [...entries].sort((left, right) => {
    if (side === "OVER") {
      if (left.value !== right.value) return left.value - right.value;
    } else if (left.value !== right.value) {
      return right.value - left.value;
    }
    return (right.price ?? -10_000) - (left.price ?? -10_000);
  });
  return {
    line: sorted[0]?.value ?? null,
    price: sorted[0]?.price ?? null,
    book: sorted[0]?.slug ?? null,
  };
}

function parseScoresAndOddsMarketComparison(markets: ScoresAndOddsMarket[]): PageRow | null {
  const market = markets[0];
  const comparisonEntries = Object.entries(market?.comparison ?? {})
    .map(([slug, entry]) => ({
      slug,
      value: Number(entry?.value),
      available: entry?.available !== false,
      over: Number(entry?.over),
      under: Number(entry?.under),
    }))
    .filter((entry) => Number.isFinite(entry.value) && entry.available);

  if (comparisonEntries.length === 0) return null;

  const medianLine = medianNumber(comparisonEntries.map((entry) => entry.value));
  const overEntries = comparisonEntries
    .filter((entry) => Number.isFinite(entry.over))
    .map((entry) => ({ slug: entry.slug, value: entry.value, price: Number.isFinite(entry.over) ? entry.over : null }));
  const underEntries = comparisonEntries
    .filter((entry) => Number.isFinite(entry.under))
    .map((entry) => ({ slug: entry.slug, value: entry.value, price: Number.isFinite(entry.under) ? entry.under : null }));
  const bestOver = bestBookValue(overEntries, "OVER");
  const bestUnder = bestBookValue(underEntries, "UNDER");

  return {
    line: medianLine,
    matchup: null,
    overLine: bestOver.line,
    underLine: bestUnder.line,
    overPrice: medianNumber(overEntries.map((entry) => entry.price).filter((value): value is number => value != null)),
    underPrice: medianNumber(underEntries.map((entry) => entry.price).filter((value): value is number => value != null)),
    sportsbookOver: bestOver.book,
    sportsbookUnder: bestUnder.book,
  };
}

function parseScoresAndOddsGamePageMarket(
  html: string,
  eventId: number,
  market: SnapshotMarket,
  playerFilter: string,
): PageRow | null {
  const $ = load(html);
  const tableKey = `odds-table--${MARKET_CONFIG[market].slug}-p-${eventId}`;
  const fallbackPrefix = `odds-table--${MARKET_CONFIG[market].slug}-p-`;
  const tbodyCandidates = [
    ...$(`tbody[data-key="${tableKey}"]`).toArray(),
    ...$(`tbody[data-key^="${fallbackPrefix}"]`).toArray(),
  ];
  const uniqueCandidates = Array.from(new Set(tbodyCandidates));
  if (uniqueCandidates.length === 0) return null;

  const normalizedPlayer = normalizeSearchText(playerFilter);
  for (const tbodyElement of uniqueCandidates) {
    const tbody = $(tbodyElement);
    const bookOrder = tbody
      .closest("table")
      .find("thead th.book-logo img")
      .toArray()
      .map((element) => normalizeSearchText($(element).attr("alt") ?? ""))
      .filter(Boolean);

    const rows = tbody.find("tr").toArray();

    for (let index = 0; index < rows.length; index += 1) {
      const row = $(rows[index]);
      const rowName = normalizeSearchText(row.attr("data-name") ?? row.find('td.bet-type a[href^="/prop-bets/"]').first().text());
      if (!rowName || rowName !== normalizedPlayer) continue;

      const overEntries: Array<{ slug: string; value: number; price: number | null }> = [];
      const underEntries: Array<{ slug: string; value: number; price: number | null }> = [];
      const pair = [row, rows[index + 1] ? $(rows[index + 1]) : null];

      pair.forEach((entryRow) => {
        if (!entryRow) return;
        entryRow.find("td.game-odds").each((cellIndex, cell) => {
          const parsedLine = parseGamePageLineText($(cell).find("span.data-value").first().text());
          if (!parsedLine) return;
          const bookSlug = bookOrder[cellIndex] ?? `book-${cellIndex + 1}`;
          const parsedPrice = parseAmericanOddsText($(cell).find("small.data-odds").first().text());
          const parsedEntry = {
            slug: bookSlug,
            value: parsedLine.line,
            price: parsedPrice,
          };
          if (parsedLine.side === "OVER") {
            overEntries.push(parsedEntry);
          } else {
            underEntries.push(parsedEntry);
          }
        });
      });

      if (overEntries.length === 0 && underEntries.length === 0) {
        return null;
      }

      const bestOver = bestBookValue(overEntries, "OVER");
      const bestUnder = bestBookValue(underEntries, "UNDER");
      const overPrices = overEntries.map((entry) => entry.price).filter((value): value is number => value != null);
      const underPrices = underEntries.map((entry) => entry.price).filter((value): value is number => value != null);

      return {
        line: deriveLine(medianNumber(overEntries.map((entry) => entry.value)), medianNumber(underEntries.map((entry) => entry.value))),
        matchup: null,
        overLine: medianNumber(overEntries.map((entry) => entry.value)),
        underLine: medianNumber(underEntries.map((entry) => entry.value)),
        overPrice: medianNumber(overPrices),
        underPrice: medianNumber(underPrices),
        sportsbookOver: bestOver.book,
        sportsbookUnder: bestUnder.book,
      };
    }
  }

  return null;
}

function parseCoversMarketPage(html: string, playerFilter: string): PageRow | null {
  const $ = load(html);
  const normalizedPlayer = normalizeSearchText(playerFilter);
  const articles = $("article.player-prop-article").toArray();

  for (const articleElement of articles) {
    const article = $(articleElement);
    const heading = normalizeSearchText(article.find("h2").first().text());
    if (!heading || !heading.includes(normalizedPlayer)) continue;

    const overEntries: Array<{ slug: string; value: number; price: number | null }> = [];
    const underEntries: Array<{ slug: string; value: number; price: number | null }> = [];

    article.find(".collapse .other-odds-row").each((_, rowElement) => {
      const row = $(rowElement);
      const bookSlug =
        parseCoversBookSlug(row.find(".other-odds-label img").attr("src")) ??
        normalizeSearchText(row.find(".other-odds-label").text()) ??
        "covers-book";

      const overCell = parseCoversOddsCell(row.find(".other-over-odds").first().text());
      if (overCell) {
        overEntries.push({ slug: bookSlug, value: overCell.line, price: overCell.price });
      }

      const underCell = parseCoversOddsCell(row.find(".other-under-odds").first().text());
      if (underCell) {
        underEntries.push({ slug: bookSlug, value: underCell.line, price: underCell.price });
      }
    });

    if (overEntries.length === 0 && underEntries.length === 0) {
      continue;
    }

    const bestOver = bestBookValue(overEntries, "OVER");
    const bestUnder = bestBookValue(underEntries, "UNDER");
    const overPrices = overEntries.map((entry) => entry.price).filter((value): value is number => value != null);
    const underPrices = underEntries.map((entry) => entry.price).filter((value): value is number => value != null);

    return {
      line: deriveLine(medianNumber(overEntries.map((entry) => entry.value)), medianNumber(underEntries.map((entry) => entry.value))),
      matchup: null,
      overLine: medianNumber(overEntries.map((entry) => entry.value)),
      underLine: medianNumber(underEntries.map((entry) => entry.value)),
      overPrice: medianNumber(overPrices),
      underPrice: medianNumber(underPrices),
      sportsbookOver: bestOver.book,
      sportsbookUnder: bestUnder.book,
    };
  }

  return null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const player = await resolvePlayer(args.playerSearch);
  const playerFilter = normalizeFilterName(player.fullName);
  const dateRows = await prisma.playerGameLog.findMany({
    where: {
      playerId: player.id,
      gameDateEt: { gte: args.from, lte: args.to },
      minutes: { gt: 0 },
    },
    orderBy: [{ gameDateEt: "asc" }],
    select: {
      gameDateEt: true,
      isHome: true,
      team: { select: { abbreviation: true } },
      opponentTeam: { select: { abbreviation: true } },
    },
  });

  const gameDates = dateRows.map((row) => ({
    gameDateEt: row.gameDateEt,
    isHome: row.isHome,
    teamAbbreviation: row.team?.abbreviation ?? null,
    opponentAbbreviation: row.opponentTeam?.abbreviation ?? null,
  })) satisfies DateRow[];
  const uniqueDates = Array.from(new Set(gameDates.map((row) => row.gameDateEt)));
  if (uniqueDates.length === 0) {
    throw new Error(`No played games found for ${player.fullName} between ${args.from} and ${args.to}.`);
  }
  const exports: ExportRow[] = [];
  const misses: string[] = [];

  for (const market of args.markets) {
    for (const game of gameDates) {
      const expectedAway = game.isHome ? game.opponentAbbreviation : game.teamAbbreviation;
      const expectedHome = game.isHome ? game.teamAbbreviation : game.opponentAbbreviation;
      if (!expectedAway || !expectedHome) {
        misses.push(`${game.gameDateEt} ${market} (missing teams)`);
        continue;
      }

      const events = await fetchScoresAndOddsEventsByDate(game.gameDateEt);
      const event = events.find((entry) => entry.awayCode === expectedAway && entry.homeCode === expectedHome) ?? null;

      let match: PageRow | null = null;
      let source = "scoresandodds";
      let sourceUrl = "";
      let matchup = event?.matchup ?? `${expectedAway} @ ${expectedHome}`;

      if (event) {
        const apiSourceUrl = `https://rga51lus77.execute-api.us-east-1.amazonaws.com/prod/market-comparison?event=nba/${event.identifier}&market=${MARKET_CONFIG[market].slug}&filter=${encodeURIComponent(playerFilter)}`;
        const markets = await fetchScoresAndOddsMarketComparison(event.identifier, market, playerFilter);
        match = parseScoresAndOddsMarketComparison(markets);
        sourceUrl = apiSourceUrl;

        if (!match) {
          const gamePageHtml = await fetchTextWithRetry(event.pageUrl);
          match = parseScoresAndOddsGamePageMarket(gamePageHtml, event.identifier, market, playerFilter);
          if (match) {
            source = "scoresandodds-game-page";
            sourceUrl = event.pageUrl;
          }
        }
      }

      if (!match) {
        const coversPropEvent = COVERS_PROP_EVENT[market];
        const coversGames = game.teamAbbreviation ? await fetchCoversScheduleByTeam(game.teamAbbreviation) : [];
        const coversGame =
          coversGames.find((entry) => entry.gameDateEt === game.gameDateEt && entry.awayCode === expectedAway && entry.homeCode === expectedHome) ??
          null;

        if (coversPropEvent && coversGame) {
          const coversUrl =
            `https://www.covers.com/sport/player-props/matchup/nba/${coversGame.boxscoreId}` +
            `?propEvent=${coversPropEvent}&countryCode=US&stateProv=NY&isLeagueVersion=false&isTeamVersion=true`;
          const coversHtml = await fetchTextWithRetry(coversUrl);
          match = parseCoversMarketPage(coversHtml, playerFilter);
          if (match) {
            source = "covers-player-props";
            sourceUrl = coversUrl;
            matchup = coversGame.matchup;
          }
        }
      }

      if (!match) {
        misses.push(`${game.gameDateEt} ${market} (${event ? "market missing" : "event not found"})`);
        continue;
      }

      const line = match.line ?? deriveLine(match.overLine, match.underLine);
      if (line == null) {
        misses.push(`${game.gameDateEt} ${market} (no line)`);
        continue;
      }

      exports.push({
        gameDateEt: game.gameDateEt,
        market,
        line,
        overLine: match.overLine,
        underLine: match.underLine,
        overPrice: match.overPrice,
        underPrice: match.underPrice,
        playerId: player.id,
        externalPlayerId: player.externalId,
        playerName: playerFilter,
        matchup,
        sportsbookOver: match.sportsbookOver,
        sportsbookUnder: match.sportsbookUnder,
        source,
        sourceUrl,
      });
    }
  }

  const header = [
    "gameDateEt",
    "market",
    "line",
    "overLine",
    "underLine",
    "overPrice",
    "underPrice",
    "playerId",
    "externalPlayerId",
    "playerName",
    "matchup",
    "sportsbookOver",
    "sportsbookUnder",
    "source",
    "sourceUrl",
  ];

  const body = exports
    .sort((left, right) => left.gameDateEt.localeCompare(right.gameDateEt) || left.market.localeCompare(right.market))
    .map((row) =>
      [
        row.gameDateEt,
        row.market,
        row.line,
        row.overLine,
        row.underLine,
        row.overPrice,
        row.underPrice,
        row.playerId,
        row.externalPlayerId,
        row.playerName,
        row.matchup,
        row.sportsbookOver,
        row.sportsbookUnder,
        row.source,
        row.sourceUrl,
      ]
        .map(csvCell)
        .join(","),
    );

  const output = [header.join(","), ...body].join("\n");
  const outputPath = path.resolve(process.cwd(), args.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${output}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        player: player.fullName,
        playerId: player.id,
        externalPlayerId: player.externalId,
        datesRequested: uniqueDates.length,
        rowsExported: exports.length,
        markets: args.markets,
        misses,
        out: outputPath,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

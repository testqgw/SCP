import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { prisma } from "../lib/prisma";
import type { SnapshotMarket } from "../lib/types/snapshot";

type Args = {
  from: string;
  to: string;
  market: SnapshotMarket;
  out: string;
};

type DbPlayedRow = {
  gameDateEt: string;
  playerId: string;
  externalPlayerId: string | null;
  playerName: string;
  teamCode: string | null;
};

type ScoresAndOddsEvent = {
  identifier: number;
  awayCode: string;
  homeCode: string;
  matchup: string;
  pageUrl: string | null;
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
    team?: {
      key?: string;
    };
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
  source: "scoresandodds" | "covers-player-props";
  sourceUrl: string;
};

type ParsedMarketRow = {
  playerName: string;
  teamCode: string | null;
  line: number | null;
  overLine: number | null;
  underLine: number | null;
  overPrice: number | null;
  underPrice: number | null;
  sportsbookOver: string | null;
  sportsbookUnder: string | null;
};

const EVENT_CACHE = new Map<string, Promise<ScoresAndOddsEvent[]>>();
const MARKET_CACHE = new Map<string, Promise<ScoresAndOddsMarket[]>>();
const PAGE_CACHE = new Map<string, Promise<string>>();
const COVERS_SCHEDULE_CACHE = new Map<string, Promise<CoversScheduleGame[]>>();

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

const TEAM_CODE_MAP: Record<string, string> = {
  NY: "NYK",
  NO: "NOP",
  GS: "GSW",
  SA: "SAS",
  BK: "BKN",
  BRK: "BKN",
  PHO: "PHX",
};

const MARKET_CONFIG: Record<SnapshotMarket, { slug: string; fileSlug: string }> = {
  PTS: { slug: "points", fileSlug: "pts" },
  REB: { slug: "rebounds", fileSlug: "reb" },
  AST: { slug: "assists", fileSlug: "ast" },
  THREES: { slug: "3-pointers", fileSlug: "threes" },
  PRA: { slug: "points,-rebounds,-&-assists", fileSlug: "pra" },
  PA: { slug: "points-&-assists", fileSlug: "pa" },
  PR: { slug: "points-&-rebounds", fileSlug: "pr" },
  RA: { slug: "rebounds-&-assists", fileSlug: "ra" },
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let from = "2025-10-23";
  let to = "2026-03-09";
  let market: SnapshotMarket = "PTS";
  let out = "";

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];

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
    if (token === "--market" && next) {
      market = parseMarket(next);
      index += 1;
      continue;
    }
    if (token.startsWith("--market=")) {
      market = parseMarket(token.slice("--market=".length));
      continue;
    }
    if (token === "--out" && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("Expected --from and --to in YYYY-MM-DD format.");
  }

  return {
    from,
    to,
    market,
    out:
      out ||
      path.join(
        "exports",
        "historical-lines",
        `all-players-${MARKET_CONFIG[market].fileSlug}-${from}-to-${to}.csv`,
      ),
  };
}

function parseMarket(value: string): SnapshotMarket {
  const normalized = value.trim().toUpperCase() as SnapshotMarket;
  if (!(normalized in MARKET_CONFIG)) {
    throw new Error(`Unsupported market "${value}".`);
  }
  return normalized;
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

function canonicalTeamCode(code: string | null | undefined): string | null {
  const normalized = (code ?? "").trim().toUpperCase();
  if (!normalized) return null;
  return TEAM_CODE_MAP[normalized] ?? normalized;
}

function parseAmericanOddsText(value: string | null | undefined): number | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "even" || normalized === "ev" || normalized === "evs") return 100;
  const parsed = Number(normalized.replace(/[^\d+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
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

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function deriveLine(overLine: number | null, underLine: number | null): number | null {
  if (overLine != null && underLine != null) {
    return round((overLine + underLine) / 2, 2);
  }
  if (overLine != null) return overLine;
  if (underLine != null) return underLine;
  return null;
}

function medianNumber(values: number[]): number | null {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (filtered.length === 0) return null;
  const middle = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 1) return filtered[middle];
  return round((filtered[middle - 1] + filtered[middle]) / 2, 2);
}

function csvCell(value: string | number | null): string {
  if (value == null) return "";
  return String(value).replace(/,/g, " ").replace(/\r?\n/g, " ").trim();
}

function extractTeamCode(name: string | null | undefined): string | null {
  const normalized = (name ?? "").trim();
  if (!normalized) return null;
  const token = normalized.split(/\s+/)[0]?.trim().toUpperCase();
  return canonicalTeamCode(token);
}

async function fetchTextWithRetry(url: string): Promise<string> {
  const cached = PAGE_CACHE.get(url);
  if (cached) return cached;

  const task = (async () => {
    const delays = [0, 700, 1800, 4200];
    let lastError: Error | null = null;

    for (const delayMs of delays) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const response = await fetch(url, {
          headers: {
            Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*",
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

async function fetchScoresAndOddsEventsByDate(dateEt: string): Promise<ScoresAndOddsEvent[]> {
  const cached = EVENT_CACHE.get(dateEt);
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
          pageUrl: pageUrl || null,
        });
      } catch {
        continue;
      }
    }

    return events;
  })();

  EVENT_CACHE.set(dateEt, task);
  return task;
}

async function fetchScoresAndOddsMarketsByEvent(eventId: number, market: SnapshotMarket): Promise<ScoresAndOddsMarket[]> {
  const cacheKey = `${eventId}|${market}`;
  const cached = MARKET_CACHE.get(cacheKey);
  if (cached) return cached;

  const task = (async () => {
    const marketSlug = MARKET_CONFIG[market].slug;
    const url =
      `https://rga51lus77.execute-api.us-east-1.amazonaws.com/prod/market-comparison?event=${encodeURIComponent(`nba/${eventId}`)}` +
      `&market=${encodeURIComponent(marketSlug)}`;
    const responseText = await fetchTextWithRetry(url);
    const payload = JSON.parse(responseText) as { markets?: ScoresAndOddsMarket[] };
    return Array.isArray(payload.markets) ? payload.markets : [];
  })();

  MARKET_CACHE.set(cacheKey, task);
  return task;
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
      const opponentCode = canonicalTeamCode(opponentText.replace(/^@\s*/, "").trim());
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

function parseScoresAndOddsPointRow(market: ScoresAndOddsMarket): ParsedMarketRow | null {
  const playerName = normalizeSearchText(
    `${market.player?.first_name ?? ""} ${market.player?.last_name ?? ""}`.trim(),
  );
  const teamCode = canonicalTeamCode(market.player?.team?.key ?? null);
  if (!playerName) return null;

  const comparisonEntries = Object.entries(market.comparison ?? {})
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
    playerName,
    teamCode,
    line: medianLine,
    overLine: bestOver.line,
    underLine: bestUnder.line,
    overPrice: medianNumber(overEntries.map((entry) => entry.price).filter((value): value is number => value != null)),
    underPrice: medianNumber(underEntries.map((entry) => entry.price).filter((value): value is number => value != null)),
    sportsbookOver: bestOver.book,
    sportsbookUnder: bestUnder.book,
  };
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

function parseScoresAndOddsGamePageRows(html: string, eventId: number, market: SnapshotMarket): ParsedMarketRow[] {
  const $ = load(html);
  const tableKey = `odds-table--${MARKET_CONFIG[market].slug}-p-${eventId}`;
  const fallbackPrefix = `odds-table--${MARKET_CONFIG[market].slug}-p-`;
  const tbodyCandidates = [
    ...$(`tbody[data-key="${tableKey}"]`).toArray(),
    ...$(`tbody[data-key^="${fallbackPrefix}"]`).toArray(),
  ];
  const uniqueCandidates = Array.from(new Set(tbodyCandidates));
  if (uniqueCandidates.length === 0) return [];

  const parsedRows = new Map<string, ParsedMarketRow>();

  for (const tbodyElement of uniqueCandidates) {
    const tbody = $(tbodyElement);
    const bookOrder = tbody
      .closest("table")
      .find("thead th.book-logo img")
      .toArray()
      .map((element) => normalizeSearchText($(element).attr("alt") ?? ""))
      .filter(Boolean);

    const rows = tbody.find("tr").toArray();
    for (let index = 0; index < rows.length; index += 2) {
      const row = $(rows[index]);
      const rowName = normalizeSearchText(row.attr("data-name") ?? row.find('td.bet-type a[href^="/prop-bets/"]').first().text());
      if (!rowName) continue;

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
        continue;
      }

      const bestOver = bestBookValue(overEntries, "OVER");
      const bestUnder = bestBookValue(underEntries, "UNDER");
      const overPrices = overEntries.map((entry) => entry.price).filter((value): value is number => value != null);
      const underPrices = underEntries.map((entry) => entry.price).filter((value): value is number => value != null);

      parsedRows.set(rowName, {
        playerName: rowName,
        teamCode: null,
        line: deriveLine(medianNumber(overEntries.map((entry) => entry.value)), medianNumber(underEntries.map((entry) => entry.value))),
        overLine: medianNumber(overEntries.map((entry) => entry.value)),
        underLine: medianNumber(underEntries.map((entry) => entry.value)),
        overPrice: medianNumber(overPrices),
        underPrice: medianNumber(underPrices),
        sportsbookOver: bestOver.book,
        sportsbookUnder: bestUnder.book,
      });
    }
  }

  return Array.from(parsedRows.values());
}

function parseAllCoversMarketPage(html: string): ParsedMarketRow[] {
  const $ = load(html);
  const rows: ParsedMarketRow[] = [];

  $("article.player-prop-article").each((_, articleElement) => {
    const article = $(articleElement);
    const playerName = normalizeSearchText(
      article.find("a.player-link-modal h3").first().text() || article.find("h3").first().text(),
    );
    if (!playerName) return;

    const overEntries: Array<{ slug: string; value: number; price: number | null }> = [];
    const underEntries: Array<{ slug: string; value: number; price: number | null }> = [];

    article.find(".collapse .other-odds-row").each((__, rowElement) => {
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

    if (overEntries.length === 0 && underEntries.length === 0) return;

    const bestOver = bestBookValue(overEntries, "OVER");
    const bestUnder = bestBookValue(underEntries, "UNDER");
    rows.push({
      playerName,
      teamCode: null,
      line: medianNumber([...overEntries, ...underEntries].map((entry) => entry.value)),
      overLine: medianNumber(overEntries.map((entry) => entry.value)),
      underLine: medianNumber(underEntries.map((entry) => entry.value)),
      overPrice: medianNumber(overEntries.map((entry) => entry.price).filter((value): value is number => value != null)),
      underPrice: medianNumber(underEntries.map((entry) => entry.price).filter((value): value is number => value != null)),
      sportsbookOver: bestOver.book,
      sportsbookUnder: bestUnder.book,
    });
  });

  return rows;
}

function mapLimit<T, R>(items: T[], limit: number, iteratee: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await iteratee(items[index]);
    }
  }

  return Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => worker())).then(() => results);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const playedRows = await prisma.playerGameLog.findMany({
    where: {
      gameDateEt: { gte: args.from, lte: args.to },
      minutes: { gt: 0 },
    },
    select: {
      gameDateEt: true,
      playerId: true,
      player: {
        select: {
          externalId: true,
          fullName: true,
        },
      },
      team: {
        select: {
          abbreviation: true,
        },
      },
    },
    orderBy: [{ gameDateEt: "asc" }, { playerId: "asc" }],
  });

  if (playedRows.length === 0) {
    throw new Error(`No player logs found between ${args.from} and ${args.to}.`);
  }

  const playersByDate = new Map<
    string,
    {
      byNameTeam: Map<string, DbPlayedRow>;
      byName: Map<string, DbPlayedRow[]>;
    }
  >();
  playedRows.forEach((row) => {
    const dateBucket = playersByDate.get(row.gameDateEt) ?? {
      byNameTeam: new Map<string, DbPlayedRow>(),
      byName: new Map<string, DbPlayedRow[]>(),
    };
    const playerName = normalizeSearchText(row.player.fullName);
    const teamCode = canonicalTeamCode(row.team?.abbreviation ?? null);
    const dbRow: DbPlayedRow = {
      gameDateEt: row.gameDateEt,
      playerId: row.playerId,
      externalPlayerId: row.player.externalId,
      playerName,
      teamCode,
    };
    if (teamCode) {
      dateBucket.byNameTeam.set(`${playerName}|${teamCode}`, dbRow);
    }
    const sameName = dateBucket.byName.get(playerName) ?? [];
    sameName.push(dbRow);
    dateBucket.byName.set(playerName, sameName);
    playersByDate.set(row.gameDateEt, dateBucket);
  });

  const uniqueDates = Array.from(playersByDate.keys()).sort((left, right) => left.localeCompare(right));
  const exportRows = new Map<string, ExportRow>();
  const misses: string[] = [];

  await mapLimit(uniqueDates, 3, async (dateEt) => {
    const bucket = playersByDate.get(dateEt);
    if (!bucket) return;
    const events = await fetchScoresAndOddsEventsByDate(dateEt);

    await mapLimit(events, 4, async (event) => {
      const markets = await fetchScoresAndOddsMarketsByEvent(event.identifier, args.market);
      const sourceUrl = `https://rga51lus77.execute-api.us-east-1.amazonaws.com/prod/market-comparison?event=nba/${event.identifier}&market=${MARKET_CONFIG[args.market].slug}`;
      const parsedPageRows =
        markets.length === 0 && event.pageUrl
          ? parseScoresAndOddsGamePageRows(await fetchTextWithRetry(event.pageUrl), event.identifier, args.market)
          : [];

      markets.forEach((market) => {
        const parsed = parseScoresAndOddsPointRow(market);
        if (!parsed || parsed.line == null) return;

        let match =
          parsed.teamCode == null ? null : bucket.byNameTeam.get(`${parsed.playerName}|${parsed.teamCode}`) ?? null;
        if (!match) {
          const byName = bucket.byName.get(parsed.playerName) ?? [];
          match = byName.length === 1 ? byName[0] : null;
        }
        if (!match) {
          misses.push(`${dateEt}|${event.matchup}|${parsed.playerName}|${parsed.teamCode ?? "na"}`);
          return;
        }

        const key = `${match.playerId}|${dateEt}|${args.market}`;
        exportRows.set(key, {
          gameDateEt: dateEt,
          market: args.market,
          line: parsed.line,
          overLine: parsed.overLine,
          underLine: parsed.underLine,
          overPrice: parsed.overPrice,
          underPrice: parsed.underPrice,
          playerId: match.playerId,
          externalPlayerId: match.externalPlayerId,
          playerName: match.playerName,
          matchup: event.matchup,
          sportsbookOver: parsed.sportsbookOver,
          sportsbookUnder: parsed.sportsbookUnder,
          source: "scoresandodds",
          sourceUrl,
        });
      });

      parsedPageRows.forEach((parsed) => {
        if (parsed.line == null) return;

        let match =
          parsed.teamCode == null ? null : bucket.byNameTeam.get(`${parsed.playerName}|${parsed.teamCode}`) ?? null;
        if (!match) {
          const byName = bucket.byName.get(parsed.playerName) ?? [];
          match = byName.length === 1 ? byName[0] : null;
        }
        if (!match) {
          misses.push(`${dateEt}|${event.matchup}|${parsed.playerName}|${parsed.teamCode ?? "na"}`);
          return;
        }

        const key = `${match.playerId}|${dateEt}|${args.market}`;
        if (exportRows.has(key)) return;

        exportRows.set(key, {
          gameDateEt: dateEt,
          market: args.market,
          line: parsed.line,
          overLine: parsed.overLine,
          underLine: parsed.underLine,
          overPrice: parsed.overPrice,
          underPrice: parsed.underPrice,
          playerId: match.playerId,
          externalPlayerId: match.externalPlayerId,
          playerName: match.playerName,
          matchup: event.matchup,
          sportsbookOver: parsed.sportsbookOver,
          sportsbookUnder: parsed.sportsbookUnder,
          source: "scoresandodds",
          sourceUrl: event.pageUrl ?? sourceUrl,
        });
      });

      if (args.market === "THREES") {
        const coversGames = await fetchCoversScheduleByTeam(event.homeCode);
        const coversGame =
          coversGames.find((entry) => entry.gameDateEt === dateEt && entry.awayCode === event.awayCode && entry.homeCode === event.homeCode) ??
          null;
        if (!coversGame) {
          return;
        }

        const coversUrl =
          `https://www.covers.com/sport/player-props/matchup/nba/${coversGame.boxscoreId}` +
          `?propEvent=NBA_GAME_PLAYER_3_POINTERS_MADE&countryCode=US&stateProv=NY&isLeagueVersion=false&isTeamVersion=true`;
        const coversHtml = await fetchTextWithRetry(coversUrl);
        const coversRows = parseAllCoversMarketPage(coversHtml);
        coversRows.forEach((parsed) => {
          if (parsed.line == null) return;
          const byName = bucket.byName.get(parsed.playerName) ?? [];
          const match = byName.length === 1 ? byName[0] : null;
          if (!match) return;

          const key = `${match.playerId}|${dateEt}|${args.market}`;
          if (exportRows.has(key)) return;

          exportRows.set(key, {
            gameDateEt: dateEt,
            market: args.market,
            line: parsed.line,
            overLine: parsed.overLine,
            underLine: parsed.underLine,
            overPrice: parsed.overPrice,
            underPrice: parsed.underPrice,
            playerId: match.playerId,
            externalPlayerId: match.externalPlayerId,
            playerName: match.playerName,
            matchup: coversGame.matchup,
            sportsbookOver: parsed.sportsbookOver,
            sportsbookUnder: parsed.sportsbookUnder,
            source: "covers-player-props",
            sourceUrl: coversUrl,
          });
        });
      }
    });
  });

  const rows = Array.from(exportRows.values()).sort(
    (left, right) => left.gameDateEt.localeCompare(right.gameDateEt) || left.playerId.localeCompare(right.playerId),
  );
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
  const body = rows.map((row) =>
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

  const outputPath = path.resolve(args.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, [header.join(","), ...body].join("\n"), "utf8");

  console.log(
    JSON.stringify(
      {
        outputPath,
        market: args.market,
        exportedRows: rows.length,
        uniqueDates: uniqueDates.length,
        playedRows: playedRows.length,
        misses: misses.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

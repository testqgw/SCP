import { load } from "cheerio";
import { round } from "@/lib/utils";

export type DailyGameOdds = {
  source: "vegasinsider";
  awayCode: string;
  homeCode: string;
  openingHomeSpread: number | null;
  currentHomeSpread: number | null;
  openingTotal: number | null;
  currentTotal: number | null;
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

const DAILY_ODDS_CACHE_TTL_MS = 10 * 60_000;
const dailyOddsCache = new Map<string, { expiresAt: number; data: Map<string, DailyGameOdds> }>();

function canonicalizeProviderTeamCode(code: string | null | undefined): string {
  const normalized = (code ?? "").trim().toUpperCase();
  return PROVIDER_TO_CANONICAL_TEAM[normalized] ?? normalized;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithRetry(url: string): Promise<string> {
  const delays = [0, 500, 1400, 3200];
  let lastError: Error | null = null;

  for (const delayMs of delays) {
    if (delayMs > 0) await sleep(delayMs);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
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

function extractLineValue(raw: string): number | null {
  const match = raw.match(/[ou]?([+-]?\d+(?:\.\d+)?)/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function medianNumber(values: number[]): number | null {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (filtered.length === 0) return null;
  const middle = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 1) return filtered[middle];
  return round((filtered[middle - 1] + filtered[middle]) / 2, 2);
}

function extractRowNumbers($: ReturnType<typeof load>, row: ReturnType<ReturnType<typeof load>>): number[] {
  return row
    .find("td.game-odds")
    .toArray()
    .map((cell: unknown) => extractLineValue($(cell as never).text().replace(/\s+/g, " ").trim()))
    .filter((value: number | null): value is number => value != null && Number.isFinite(value));
}

function parseVegasInsiderDailyOdds(html: string): Map<string, DailyGameOdds> {
  const $ = load(html);
  const result = new Map<string, DailyGameOdds>();

  const ensure = (awayCode: string, homeCode: string): DailyGameOdds => {
    const key = `${awayCode}@${homeCode}`;
    const existing = result.get(key);
    if (existing) return existing;
    const created: DailyGameOdds = {
      source: "vegasinsider",
      awayCode,
      homeCode,
      openingHomeSpread: null,
      currentHomeSpread: null,
      openingTotal: null,
      currentTotal: null,
    };
    result.set(key, created);
    return created;
  };

  const parseTable = (prefix: string) => {
    $(`tbody[id^="${prefix}"]`).each((_, tbody) => {
      const rows = $(tbody).find("tr").toArray();
      for (let index = 0; index < rows.length - 1; index += 1) {
        const awayRow = $(rows[index]);
        const homeRow = $(rows[index + 1]);
        const awayCode = canonicalizeProviderTeamCode(awayRow.find("a.team-name").attr("data-abbr"));
        const homeCode = canonicalizeProviderTeamCode(homeRow.find("a.team-name").attr("data-abbr"));
        if (!awayCode || !homeCode) continue;

        const entry = ensure(awayCode, homeCode);
        const awayNumbers = extractRowNumbers($, awayRow);
        const homeNumbers = extractRowNumbers($, homeRow);

        if (prefix.includes("spread")) {
          entry.openingHomeSpread = homeNumbers[0] ?? entry.openingHomeSpread;
          entry.currentHomeSpread = medianNumber(homeNumbers.slice(1)) ?? homeNumbers[1] ?? entry.currentHomeSpread;
        } else {
          entry.openingTotal = awayNumbers[0] ?? entry.openingTotal;
          entry.currentTotal = medianNumber(awayNumbers.slice(1)) ?? awayNumbers[1] ?? entry.currentTotal;
        }
      }
    });
  };

  parseTable("odds-table-spread--");
  parseTable("odds-table-total--");
  return result;
}

export async function fetchDailyGameOddsMap(dateEt: string): Promise<Map<string, DailyGameOdds>> {
  const cached = dailyOddsCache.get(dateEt);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const html = await fetchTextWithRetry(
    `https://www.vegasinsider.com/nba/odds/las-vegas/?date=${encodeURIComponent(dateEt)}`,
  );
  const data = parseVegasInsiderDailyOdds(html);
  dailyOddsCache.set(dateEt, {
    expiresAt: now + DAILY_ODDS_CACHE_TTL_MS,
    data,
  });
  return data;
}

export function resolveTeamSpreadForMatchup(odds: DailyGameOdds | null, isHome: boolean): number | null {
  if (!odds || odds.openingHomeSpread == null) return null;
  return isHome ? odds.openingHomeSpread : round(-odds.openingHomeSpread, 2);
}

export function applyPointsGameOddsAdjustment(
  baseProjection: number | null,
  gameTotal: number | null,
  teamSpread: number | null,
): number | null {
  if (baseProjection == null) return null;
  let projection = baseProjection;

  if (gameTotal != null && Number.isFinite(gameTotal)) {
    projection += Math.max(-0.9, Math.min(0.9, (gameTotal - 228) * 0.03));
  }

  if (teamSpread != null && Number.isFinite(teamSpread)) {
    projection += Math.max(-0.75, Math.min(0.2, -Math.max(0, Math.abs(teamSpread) - 6) * 0.06));
  }

  return round(Math.max(0, projection), 2);
}

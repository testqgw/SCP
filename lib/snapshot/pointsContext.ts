import { load } from "cheerio";
import { canonicalTeamCode, normalizePlayerName, type LineupStatus } from "@/lib/lineups/rotowire";
import { predictLivePlayerModelSide } from "@/lib/snapshot/livePlayerSideModels";
import { predictLiveUniversalModelSide } from "@/lib/snapshot/liveUniversalSideModels";
import { SportsDataClient } from "@/lib/sportsdata/client";
import { inferSeasonFromEtDate } from "@/lib/snapshot/time";
import type {
  SnapshotAstSignal,
  SnapshotModelSide,
  SnapshotPaSignal,
  SnapshotPraSignal,
  SnapshotPrSignal,
  SnapshotPtsConfidenceTier,
  SnapshotPtsQualifiedRule,
  SnapshotPtsSignal,
  SnapshotRaSignal,
  SnapshotRebSignal,
  SnapshotThreesSignal,
} from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

export type PositionToken = "G" | "F" | "C";

export type SeasonVolumeLog = {
  playerExternalId: string;
  gameDateEt: string;
  teamCode: string;
  opponentCode: string | null;
  minutes: number;
  fga: number;
  fg3a: number;
  fta: number;
  points: number;
};

export type ShotPressureSummary = {
  fgaRate: number | null;
  fg3aRate: number | null;
  ftaRate: number | null;
  threeShare: number | null;
  freeThrowPressure: number | null;
  aggression: number | null;
  sample: number;
};

export type OpponentShotVolumeMetrics = {
  fgaPerMinute: number | null;
  fg3aPerMinute: number | null;
  ftaPerMinute: number | null;
  threeShare: number | null;
  freeThrowPressure: number | null;
  sample: number;
};

export type DailyPlayerPropLine = {
  line: number;
  sportsbookCount: number;
  overPrice: number | null;
  underPrice: number | null;
  source: "sportsdata" | "scoresandodds";
};

export type LivePtsSignalInput = {
  playerName: string | null;
  playerPosition: string | null;
  projection: number | null;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection: number | null;
  threesProjection?: number | null;
  marketLine: DailyPlayerPropLine | null;
  openingTotal: number | null;
  openingTeamSpread: number | null;
  lineupStarter: boolean | null;
  lineupStatus: LineupStatus | null;
  starterRateLast10: number | null;
  archetypeExpectedMinutes?: number | null;
  projectedMinutes: number | null;
  projectedMinutesFloor: number | null;
  projectedMinutesCeiling: number | null;
  minutesVolatility: number | null;
  playerShotPressure: ShotPressureSummary | null;
  opponentShotVolume: OpponentShotVolumeMetrics | null;
  completenessScore: number | null;
};

export type LiveRebSignalInput = LivePtsSignalInput;
export type LiveAstSignalInput = LivePtsSignalInput;
export type LiveThreesSignalInput = LivePtsSignalInput;
export type LiveComboSignalInput = LivePtsSignalInput & {
  market: "PRA" | "PA" | "PR" | "RA";
  projectedPoints: number | null;
  projectedRebounds: number | null;
  projectedAssists: number | null;
};
type LiveComboSignalBaseInput = Omit<LiveComboSignalInput, "market">;

const LIVE_PTS_QUALIFIED_RULE: SnapshotPtsQualifiedRule = {
  minConfidence: 60,
  maxMinutesRisk: 0.65,
  minProjectionGap: 1.5,
  blockOverWhenFavoriteBy: -6.5,
};

const LIVE_REB_QUALIFIED_RULE: SnapshotPtsQualifiedRule = {
  minConfidence: 56,
  maxMinutesRisk: 0.72,
  minProjectionGap: 0.6,
  blockOverWhenFavoriteBy: -99,
};

const LIVE_AST_QUALIFIED_RULE: SnapshotPtsQualifiedRule = {
  minConfidence: 56,
  maxMinutesRisk: 0.72,
  minProjectionGap: 0.6,
  blockOverWhenFavoriteBy: -99,
};

const LIVE_THREES_QUALIFIED_RULE: SnapshotPtsQualifiedRule = {
  minConfidence: 54,
  maxMinutesRisk: 0.74,
  minProjectionGap: 0.35,
  blockOverWhenFavoriteBy: -99,
};

const LIVE_PRA_QUALIFIED_RULE: SnapshotPtsQualifiedRule = {
  minConfidence: 58,
  maxMinutesRisk: 0.72,
  minProjectionGap: 1.5,
  blockOverWhenFavoriteBy: -99,
};

const LIVE_PA_QUALIFIED_RULE: SnapshotPtsQualifiedRule = {
  minConfidence: 58,
  maxMinutesRisk: 0.72,
  minProjectionGap: 1,
  blockOverWhenFavoriteBy: -99,
};

const LIVE_PR_QUALIFIED_RULE: SnapshotPtsQualifiedRule = {
  minConfidence: 58,
  maxMinutesRisk: 0.72,
  minProjectionGap: 1,
  blockOverWhenFavoriteBy: -99,
};

const LIVE_RA_QUALIFIED_RULE: SnapshotPtsQualifiedRule = {
  minConfidence: 56,
  maxMinutesRisk: 0.72,
  minProjectionGap: 1,
  blockOverWhenFavoriteBy: -99,
};

export type EnhancedPointsProjectionInput = {
  baseProjection: number | null;
  openingTotal: number | null;
  openingTeamSpread: number | null;
  lineupStarter: boolean | null;
  lineupStatus: LineupStatus | null;
  starterRateLast10: number | null;
  playerShotPressure: ShotPressureSummary | null;
  opponentShotVolume: OpponentShotVolumeMetrics | null;
  marketLine: DailyPlayerPropLine | null;
};

const sportsDataClient = new SportsDataClient();
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const NBA_STATS_CACHE = new Map<string, Promise<SeasonVolumeLog[]>>();
const DAILY_PROP_LINE_CACHE = new Map<string, { expiresAt: number; data: Promise<Map<string, DailyPlayerPropLine>> }>();
const SCORES_AND_ODDS_EVENT_CACHE = new Map<string, Promise<ScoresAndOddsEvent[]>>();
const SCORES_AND_ODDS_MARKET_CACHE = new Map<string, Promise<ScoresAndOddsMarket[]>>();
const SCORES_AND_ODDS_PAGE_CACHE = new Map<string, Promise<string>>();
const DAILY_PROP_LINE_TTL_MS = 5 * 60_000;

type ScoresAndOddsEvent = {
  identifier: number;
  awayCode: string;
  homeCode: string;
  matchupKey: string;
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
      value?: number;
      available?: boolean;
      over?: number;
      under?: number;
    }
  >;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithRetry(url: string): Promise<string> {
  const cached = SCORES_AND_ODDS_PAGE_CACHE.get(url);
  if (cached) return cached;

  const task = (async () => {
    const delays = [0, 400, 1200, 2600];
    let lastError: Error | null = null;

    for (const delayMs of delays) {
      if (delayMs > 0) await sleep(delayMs);

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

  SCORES_AND_ODDS_PAGE_CACHE.set(url, task);
  return task;
}

function seasonLabelFromDateEt(dateEt: string): string {
  const startYear = Number(inferSeasonFromEtDate(dateEt));
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseEtDate(raw: string): string | null {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function medianNumber(values: number[]): number | null {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (filtered.length === 0) return null;
  const middle = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 1) return round(filtered[middle], 2);
  return round((filtered[middle - 1] + filtered[middle]) / 2, 2);
}

function compareIsoMaybe(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

function parsePropLine(participant: string | null, value: unknown): number | null {
  const normalizedParticipant = (participant ?? "").replace(",", ".");
  const participantMatch = normalizedParticipant.match(/\b(?:over|under)\s+(\d+(?:\.\d+)?)\b/i);
  if (participantMatch?.[1]) {
    const parsed = Number(participantMatch[1]);
    if (Number.isFinite(parsed)) return parsed;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  return round(Math.max(0.5, Math.floor(numericValue) + 0.5), 1);
}

function stripOutcomeParticipantName(participant: string | null): string | null {
  if (!participant) return null;
  const stripped = participant
    .replace(/\b(?:over|under)\b/gi, " ")
    .replace(/[+-]?\d+(?:[.,]\d+)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = normalizePlayerName(stripped);
  return normalized || null;
}

function extractTeamCode(name: string | null | undefined): string | null {
  const normalized = (name ?? "").trim();
  if (!normalized) return null;
  const token = normalized.split(/\s+/)[0]?.trim().toUpperCase();
  return canonicalTeamCode(token);
}

function parsePropSide(value: unknown): "OVER" | "UNDER" | null {
  const numeric = Number(value);
  if (numeric === 3) return "OVER";
  if (numeric === 4) return "UNDER";
  return null;
}

async function fetchScoresAndOddsEventsByDate(dateEt: string): Promise<ScoresAndOddsEvent[]> {
  const cached = SCORES_AND_ODDS_EVENT_CACHE.get(dateEt);
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
        if (!Number.isFinite(identifier) || !awayCode || !homeCode) continue;
        events.push({
          identifier,
          awayCode,
          homeCode,
          matchupKey: `${awayCode}@${homeCode}`,
        });
      } catch {
        continue;
      }
    }

    return events;
  })();

  SCORES_AND_ODDS_EVENT_CACHE.set(dateEt, task);
  return task;
}

async function fetchScoresAndOddsMarketsByEvent(eventId: number, marketSlug: string): Promise<ScoresAndOddsMarket[]> {
  const cacheKey = `${eventId}|${marketSlug}`;
  const cached = SCORES_AND_ODDS_MARKET_CACHE.get(cacheKey);
  if (cached) return cached;

  const task = (async () => {
    const url =
      `https://rga51lus77.execute-api.us-east-1.amazonaws.com/prod/market-comparison?event=${encodeURIComponent(`nba/${eventId}`)}` +
      `&market=${encodeURIComponent(marketSlug)}`;
    const responseText = await fetchTextWithRetry(url);
    const payload = JSON.parse(responseText) as { markets?: ScoresAndOddsMarket[] };
    return Array.isArray(payload.markets) ? payload.markets : [];
  })();

  SCORES_AND_ODDS_MARKET_CACHE.set(cacheKey, task);
  return task;
}

function parseScoresAndOddsMarketRow(market: ScoresAndOddsMarket): {
  playerName: string;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
} | null {
  const playerName = normalizePlayerName(`${market.player?.first_name ?? ""} ${market.player?.last_name ?? ""}`.trim());
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

  const overEntries = comparisonEntries
    .filter((entry) => Number.isFinite(entry.over))
    .map((entry) => ({ slug: entry.slug, value: entry.value, price: Number.isFinite(entry.over) ? entry.over : null }));
  const underEntries = comparisonEntries
    .filter((entry) => Number.isFinite(entry.under))
    .map((entry) => ({ slug: entry.slug, value: entry.value, price: Number.isFinite(entry.under) ? entry.under : null }));

  return {
    playerName,
    line: medianNumber(comparisonEntries.map((entry) => entry.value)),
    overPrice: medianNumber(overEntries.map((entry) => entry.price).filter((value): value is number => value != null)),
    underPrice: medianNumber(underEntries.map((entry) => entry.price).filter((value): value is number => value != null)),
  };
}

function isCompatiblePosition(playerTokens: Set<PositionToken>, candidatePosition: string | null | undefined): boolean {
  if (playerTokens.size === 0 || !candidatePosition) return true;
  const candidate = new Set<PositionToken>();
  const upper = candidatePosition.toUpperCase();
  if (upper.includes("G")) candidate.add("G");
  if (upper.includes("F")) candidate.add("F");
  if (upper.includes("C")) candidate.add("C");
  if (candidate.size === 0) return true;
  for (const token of playerTokens) {
    if (candidate.has(token)) return true;
  }
  return false;
}

async function fetchJsonWithRetry(url: string): Promise<unknown> {
  const delays = [0, 600, 1800, 4200];
  let lastError: Error | null = null;

  for (const delay of delays) {
    if (delay > 0) await sleep(delay);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.nba.com/",
          Origin: "https://www.nba.com",
          "x-nba-stats-origin": "stats",
          "x-nba-stats-token": "true",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        if (RETRYABLE.has(response.status)) {
          lastError = new Error(`Retryable NBA Stats response: ${response.status}`);
          continue;
        }
        throw new Error(`NBA Stats request failed (${response.status})`);
      }

      return (await response.json()) as unknown;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("NBA Stats fetch failed");
    }
  }

  throw lastError ?? new Error("NBA Stats fetch failed");
}

export async function fetchSeasonVolumeLogs(dateEt: string): Promise<SeasonVolumeLog[]> {
  const seasonLabel = seasonLabelFromDateEt(dateEt);
  const cached = NBA_STATS_CACHE.get(seasonLabel);
  if (cached) return cached;

  const task = (async () => {
    const url =
      "https://stats.nba.com/stats/leaguegamelog?Counter=0&Direction=DESC&LeagueID=00&PlayerOrTeam=P" +
      `&Season=${encodeURIComponent(seasonLabel)}&SeasonType=Regular%20Season&Sorter=DATE`;
    const payload = await fetchJsonWithRetry(url);
    const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const resultSets = Array.isArray(root?.resultSets) ? root.resultSets : [];
    const primary = resultSets.length > 0 && typeof resultSets[0] === "object" ? (resultSets[0] as Record<string, unknown>) : null;
    const headers = Array.isArray(primary?.headers) ? primary.headers.map((value) => String(value)) : [];
    const rowSet = Array.isArray(primary?.rowSet) ? primary.rowSet : [];
    if (headers.length === 0) return [];

    const index = (name: string): number => headers.indexOf(name);
    const idxPlayerId = index("PLAYER_ID");
    const idxTeamAbbr = index("TEAM_ABBREVIATION");
    const idxGameDate = index("GAME_DATE");
    const idxMatchup = index("MATCHUP");
    const idxMinutes = index("MIN");
    const idxPts = index("PTS");
    const idxFga = index("FGA");
    const idxFg3a = index("FG3A");
    const idxFta = index("FTA");

    return rowSet
      .map((row) => {
        if (!Array.isArray(row)) return null;
        const playerExternalId = String(row[idxPlayerId] ?? "").trim();
        const teamCode = canonicalTeamCode(String(row[idxTeamAbbr] ?? "").trim());
        const gameDateEt = parseEtDate(String(row[idxGameDate] ?? "").trim());
        const matchup = String(row[idxMatchup] ?? "").trim();
        const opponentMatch = matchup.match(/\b(?:vs\.|@)\s+([A-Z]{2,3})$/i);
        const opponentCode = opponentMatch?.[1] ? canonicalTeamCode(opponentMatch[1]) : null;
        if (!playerExternalId || !teamCode || !gameDateEt) return null;
        return {
          playerExternalId,
          gameDateEt,
          teamCode,
          opponentCode,
          minutes: toNumber(row[idxMinutes]),
          fga: toNumber(row[idxFga]),
          fg3a: toNumber(row[idxFg3a]),
          fta: toNumber(row[idxFta]),
          points: toNumber(row[idxPts]),
        } satisfies SeasonVolumeLog;
      })
      .filter((row): row is SeasonVolumeLog => Boolean(row));
  })();

  NBA_STATS_CACHE.set(seasonLabel, task);
  return task;
}

export function buildShotPressureSummary(
  seasonLogs: SeasonVolumeLog[],
  playerExternalId: string | null | undefined,
  dateEt: string,
  sampleSize = 10,
): ShotPressureSummary | null {
  if (!playerExternalId) return null;
  const logs = seasonLogs
    .filter((log) => log.playerExternalId === playerExternalId && log.gameDateEt < dateEt && log.minutes > 0)
    .sort((left, right) => right.gameDateEt.localeCompare(left.gameDateEt))
    .slice(0, sampleSize);
  if (logs.length === 0) return null;

  const minutes = logs.reduce((sum, log) => sum + log.minutes, 0);
  const fga = logs.reduce((sum, log) => sum + log.fga, 0);
  const fg3a = logs.reduce((sum, log) => sum + log.fg3a, 0);
  const fta = logs.reduce((sum, log) => sum + log.fta, 0);
  if (minutes <= 0) return null;

  const fgaRate = fga / minutes;
  const fg3aRate = fg3a / minutes;
  const ftaRate = fta / minutes;
  const threeShare = fga > 0 ? fg3a / fga : null;
  const freeThrowPressure = fga > 0 ? fta / fga : null;
  const aggression = (fga + 0.44 * fta) / minutes;

  return {
    fgaRate: round(fgaRate, 3),
    fg3aRate: round(fg3aRate, 3),
    ftaRate: round(ftaRate, 3),
    threeShare: threeShare == null ? null : round(threeShare, 3),
    freeThrowPressure: freeThrowPressure == null ? null : round(freeThrowPressure, 3),
    aggression: round(aggression, 3),
    sample: logs.length,
  };
}

export function resolveOpponentShotVolumeMetrics(input: {
  opponentCode: string;
  dateEt: string;
  playerPositionTokens: Set<PositionToken>;
  seasonLogs: SeasonVolumeLog[];
  positionByExternalId: Map<string, string | null>;
}): OpponentShotVolumeMetrics | null {
  const relevant = input.seasonLogs
    .filter((log) => {
      if (log.opponentCode !== input.opponentCode || log.gameDateEt >= input.dateEt || log.minutes <= 0) return false;
      return isCompatiblePosition(input.playerPositionTokens, input.positionByExternalId.get(log.playerExternalId) ?? null);
    })
    .sort((left, right) => right.gameDateEt.localeCompare(left.gameDateEt));

  if (relevant.length === 0) return null;

  const gameDates = new Set<string>();
  const sample: SeasonVolumeLog[] = [];
  for (const log of relevant) {
    if (!gameDates.has(log.gameDateEt) && gameDates.size >= 10) break;
    gameDates.add(log.gameDateEt);
    sample.push(log);
  }
  if (sample.length === 0) return null;

  const minutes = sample.reduce((sum, log) => sum + log.minutes, 0);
  const fga = sample.reduce((sum, log) => sum + log.fga, 0);
  const fg3a = sample.reduce((sum, log) => sum + log.fg3a, 0);
  const fta = sample.reduce((sum, log) => sum + log.fta, 0);
  if (minutes <= 0) return null;

  return {
    fgaPerMinute: round(fga / minutes, 3),
    fg3aPerMinute: round(fg3a / minutes, 3),
    ftaPerMinute: round(fta / minutes, 3),
    threeShare: fga > 0 ? round(fg3a / fga, 3) : null,
    freeThrowPressure: fga > 0 ? round(fta / fga, 3) : null,
    sample: sample.length,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, iteratee: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await iteratee(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => worker()));
  return results;
}

function matchesBetTypeName(name: string, aliases: string[]): boolean {
  const normalized = name.trim().toLowerCase();
  return aliases.some((alias) => normalized === alias || normalized.includes(alias));
}

async function fetchDailyPropLineMap(
  dateEt: string,
  betTypeNames: string[],
  fallbackBetTypeId: number | null,
  publicMarketSlug: string | null,
): Promise<Map<string, DailyPlayerPropLine>> {
  const cacheKey = `${dateEt}|${betTypeNames.join("|").toLowerCase()}`;
  const now = Date.now();
  const cached = DAILY_PROP_LINE_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const task = (async () => {
    const metadata = (await sportsDataClient.fetchBettingMetadata().catch(() => null)) as
      | { BettingBetTypes?: Array<Record<string, unknown>> }
      | null;
    const betTypeId =
      metadata?.BettingBetTypes?.find((entry) => matchesBetTypeName(String(entry.Name ?? ""), betTypeNames))?.RecordId ??
      fallbackBetTypeId;
    const eventsRaw = await sportsDataClient.fetchBettingEventsByDate(dateEt).catch(() => []);
    const events = eventsRaw
      .map((row) => {
        const record = row as Record<string, unknown>;
        const gameId = String(record.GameID ?? "").trim();
        const awayCode = canonicalTeamCode(String(record.AwayTeam ?? "").trim());
        const homeCode = canonicalTeamCode(String(record.HomeTeam ?? "").trim());
        if (!gameId || !awayCode || !homeCode) return null;
        return { gameId, matchupKey: `${awayCode}@${homeCode}` };
      })
      .filter((row): row is { gameId: string; matchupKey: string } => Boolean(row));

    const result = new Map<string, DailyPlayerPropLine>();
    await mapLimit(events, 4, async (event) => {
      const props = await sportsDataClient.fetchBettingPlayerPropsByGameId(event.gameId).catch(() => []);
      props.forEach((row) => {
        const record = row as Record<string, unknown>;
        if (betTypeId == null) return;
        if (Number(record.BettingBetTypeID) !== Number(betTypeId)) return;
        const periodTypeId = Number(record.BettingPeriodTypeID);
        if (periodTypeId !== 0 && periodTypeId !== 1) return;
        const outcomes = Array.isArray(record.BettingOutcomes) ? (record.BettingOutcomes as Record<string, unknown>[]) : [];

        const marketPlayerName =
          typeof record.PlayerName === "string" && record.PlayerName.toLowerCase() !== "scrambled"
            ? normalizePlayerName(record.PlayerName)
            : null;
        const fallbackName =
          outcomes
            .map((outcome) => stripOutcomeParticipantName(typeof outcome.Participant === "string" ? outcome.Participant : null))
            .find((value): value is string => Boolean(value)) ?? null;
        const playerName = marketPlayerName ?? fallbackName;
        if (!playerName) return;

        const byBookLine = new Map<
          string,
          { sportsbookId: number | null; line: number; over: Record<string, unknown> | null; under: Record<string, unknown> | null; latestAt: string | null }
        >();

        outcomes.forEach((outcome) => {
          const side = parsePropSide(outcome.BettingOutcomeTypeID);
          if (!side) return;
          const line = parsePropLine(typeof outcome.Participant === "string" ? outcome.Participant : null, outcome.Value);
          if (line == null) return;
          const sportsbookId =
            outcome.SportsBook && typeof outcome.SportsBook === "object"
              ? Number((outcome.SportsBook as Record<string, unknown>).SportsbookID)
              : Number(outcome.SportsbookID);
          const timestamp =
            (typeof outcome.Updated === "string" && outcome.Updated) ||
            (typeof outcome.Created === "string" && outcome.Created) ||
            null;
          const key = `${Number.isFinite(sportsbookId) ? sportsbookId : "na"}|${line.toFixed(1)}`;
          const entry = byBookLine.get(key) ?? {
            sportsbookId: Number.isFinite(sportsbookId) ? sportsbookId : null,
            line,
            over: null,
            under: null,
            latestAt: null,
          };
          if (side === "OVER") entry.over = outcome;
          if (side === "UNDER") entry.under = outcome;
          entry.latestAt = [entry.latestAt, timestamp].sort(compareIsoMaybe).slice(-1)[0] ?? entry.latestAt;
          byBookLine.set(key, entry);
        });

        const selected = Array.from(byBookLine.values()).filter((entry) => entry.over && entry.under);
        if (selected.length === 0) return;
        const line = medianNumber(selected.map((entry) => entry.line));
        if (line == null) return;
        const overPrice = medianNumber(selected.map((entry) => Number(entry.over?.PayoutAmerican)).filter(Number.isFinite));
        const underPrice = medianNumber(selected.map((entry) => Number(entry.under?.PayoutAmerican)).filter(Number.isFinite));
        const key = `${event.matchupKey}|${playerName}`;
        const existing = result.get(key);
        if (!existing || selected.length >= existing.sportsbookCount) {
          result.set(key, {
            line,
            sportsbookCount: selected.length,
            overPrice,
            underPrice,
            source: "sportsdata",
          });
        }
      });
    });

    if (publicMarketSlug) {
      const fallbackMap = await fetchScoresAndOddsPropLineMap(dateEt, publicMarketSlug).catch(() => new Map());
      fallbackMap.forEach((value, key) => {
        if (!result.has(key)) {
          result.set(key, value);
        }
      });
    }

    return result;
  })();

  DAILY_PROP_LINE_CACHE.set(cacheKey, {
    expiresAt: now + DAILY_PROP_LINE_TTL_MS,
    data: task,
  });
  return task;
}

async function fetchScoresAndOddsPropLineMap(
  dateEt: string,
  marketSlug: string,
): Promise<Map<string, DailyPlayerPropLine>> {
  const events = await fetchScoresAndOddsEventsByDate(dateEt);
  const result = new Map<string, DailyPlayerPropLine>();

  await mapLimit(events, 4, async (event) => {
    const markets = await fetchScoresAndOddsMarketsByEvent(event.identifier, marketSlug).catch(() => []);
    markets.forEach((market) => {
      const parsed = parseScoresAndOddsMarketRow(market);
      if (!parsed || parsed.line == null) return;
      const key = `${event.matchupKey}|${parsed.playerName}`;
      result.set(key, {
        line: parsed.line,
        sportsbookCount: 1,
        overPrice: parsed.overPrice,
        underPrice: parsed.underPrice,
        source: "scoresandodds",
      });
    });
  });

  return result;
}

export function fetchDailyPtsLineMap(dateEt: string): Promise<Map<string, DailyPlayerPropLine>> {
  return fetchDailyPropLineMap(dateEt, ["total points"], 3, "points");
}

export function fetchDailyRebLineMap(dateEt: string): Promise<Map<string, DailyPlayerPropLine>> {
  return fetchDailyPropLineMap(dateEt, ["total rebounds"], 4, "rebounds");
}

export function fetchDailyAstLineMap(dateEt: string): Promise<Map<string, DailyPlayerPropLine>> {
  return fetchDailyPropLineMap(dateEt, ["total assists"], 5, "assists");
}

export function fetchDailyThreesLineMap(dateEt: string): Promise<Map<string, DailyPlayerPropLine>> {
  return fetchDailyPropLineMap(
    dateEt,
    [
      "three-pointers made",
      "total three-pointers made",
      "3-pointers made",
      "total 3-pointers made",
      "threes made",
      "total threes made",
    ],
    null,
    "3-pointers",
  );
}

export function fetchDailyPraLineMap(dateEt: string): Promise<Map<string, DailyPlayerPropLine>> {
  return fetchDailyPropLineMap(
    dateEt,
    [
      "points, rebounds & assists",
      "points + rebounds + assists",
      "points, rebounds and assists",
      "total points, rebounds and assists",
      "pts + reb + ast",
    ],
    null,
    "points,-rebounds,-&-assists",
  );
}

export function fetchDailyPaLineMap(dateEt: string): Promise<Map<string, DailyPlayerPropLine>> {
  return fetchDailyPropLineMap(
    dateEt,
    ["points & assists", "points + assists", "total points and assists", "pts + ast"],
    null,
    "points-&-assists",
  );
}

export function fetchDailyPrLineMap(dateEt: string): Promise<Map<string, DailyPlayerPropLine>> {
  return fetchDailyPropLineMap(
    dateEt,
    ["points & rebounds", "points + rebounds", "total points and rebounds", "pts + reb"],
    null,
    "points-&-rebounds",
  );
}

export function fetchDailyRaLineMap(dateEt: string): Promise<Map<string, DailyPlayerPropLine>> {
  return fetchDailyPropLineMap(
    dateEt,
    ["rebounds & assists", "rebounds + assists", "total rebounds and assists", "reb + ast"],
    null,
    "rebounds-&-assists",
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function americanOddsToProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const absolute = Math.abs(odds);
    return absolute / (absolute + 100);
  }
  return 100 / (odds + 100);
}

function resolveMarketFavoredSide(input: {
  overPrice: number | null;
  underPrice: number | null;
}): {
  priceLean: number | null;
  favoredSide: SnapshotModelSide;
  marketStrong: boolean;
} {
  const overProbability = americanOddsToProbability(input.overPrice);
  const underProbability = americanOddsToProbability(input.underPrice);
  if (overProbability == null || underProbability == null) {
    return {
      priceLean: null,
      favoredSide: "NEUTRAL",
      marketStrong: false,
    };
  }

  const priceLean = round(overProbability - underProbability, 4);
  return {
    priceLean,
    favoredSide: priceLean > 0 ? "OVER" : priceLean < 0 ? "UNDER" : "NEUTRAL",
    marketStrong: Math.abs(priceLean) >= 0.0075 && priceLean !== 0,
  };
}

function confidenceTier(confidence: number | null): SnapshotPtsConfidenceTier | null {
  if (confidence == null) return null;
  if (confidence >= 76) return "HIGH";
  if (confidence >= 64) return "MEDIUM";
  return "LOW";
}

function lineupTimingConfidence(input: {
  lineupStatus: LineupStatus | null;
  lineupStarter: boolean | null;
  starterRateLast10: number | null;
}): number | null {
  if (input.lineupStatus == null && input.starterRateLast10 == null) return null;

  let confidence =
    input.lineupStatus === "CONFIRMED"
      ? 0.86
      : input.lineupStatus === "EXPECTED"
        ? 0.72
        : input.lineupStatus === "UNKNOWN"
          ? 0.5
          : 0.58;

  if (input.starterRateLast10 != null) {
    const starterCertainty = Math.abs(input.starterRateLast10 - 0.5) * 0.5;
    confidence += clamp(starterCertainty, 0, 0.18);
    if (input.lineupStarter === true && input.starterRateLast10 >= 0.7) confidence += 0.05;
    if (input.lineupStarter === false && input.starterRateLast10 <= 0.3) confidence += 0.05;
  }

  return round(clamp(confidence, 0.35, 1), 2);
}

function computeMinutesRisk(input: {
  projectedMinutes: number | null;
  projectedMinutesFloor: number | null;
  projectedMinutesCeiling: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  lineupTimingConfidence: number | null;
  openingTeamSpread: number | null;
}): number | null {
  if (
    input.projectedMinutes == null &&
    input.projectedMinutesFloor == null &&
    input.minutesVolatility == null &&
    input.lineupTimingConfidence == null
  ) {
    return null;
  }

  const expectedMinutes = input.projectedMinutes ?? input.projectedMinutesFloor ?? 28;
  const floor = input.projectedMinutesFloor ?? Math.max(0, expectedMinutes - 4);
  const ceiling = input.projectedMinutesCeiling ?? Math.min(48, expectedMinutes + 4);
  const minuteBand = Math.max(0, ceiling - floor);
  const lowMinutesRisk = clamp((28 - expectedMinutes) / 18, 0, 0.42);
  const bandRisk = clamp((minuteBand - 5) / 14, 0, 0.28);
  const volatilityRisk =
    input.minutesVolatility == null ? 0.08 : clamp((input.minutesVolatility - 3.2) / 7.5, 0, 0.24);
  const starterUncertainty =
    input.starterRateLast10 == null
      ? 0.12
      : Math.abs(0.5 - input.starterRateLast10) < 0.18
        ? 0.18
        : 0.05;
  const lineupPenalty = input.lineupTimingConfidence == null ? 0.14 : clamp(1 - input.lineupTimingConfidence, 0, 0.4);
  const blowoutRisk =
    input.openingTeamSpread == null
      ? 0
      : clamp(Math.max(0, Math.abs(input.openingTeamSpread) - 6) / 8, 0, 1) * 0.26;

  return round(clamp(lowMinutesRisk + bandRisk + volatilityRisk + starterUncertainty + lineupPenalty + blowoutRisk, 0, 1), 3);
}

function buildPassReasons(input: {
  marketLine: number | null;
  side: SnapshotModelSide;
  confidence: number | null;
  projectionGap: number | null;
  minutesRisk: number | null;
  openingTeamSpread: number | null;
}): string[] {
  const reasons: string[] = [];
  if (input.marketLine == null) reasons.push("No live consensus PTS line.");
  if (input.side === "NEUTRAL") reasons.push("No side edge.");
  if (input.projectionGap != null && Math.abs(input.projectionGap) < LIVE_PTS_QUALIFIED_RULE.minProjectionGap) {
    reasons.push(`Projection gap under ${LIVE_PTS_QUALIFIED_RULE.minProjectionGap}.`);
  }
  if (input.confidence != null && input.confidence < LIVE_PTS_QUALIFIED_RULE.minConfidence) {
    reasons.push(`Confidence under ${LIVE_PTS_QUALIFIED_RULE.minConfidence}.`);
  }
  if (input.minutesRisk != null && input.minutesRisk > LIVE_PTS_QUALIFIED_RULE.maxMinutesRisk) {
    reasons.push(`Minutes risk above ${LIVE_PTS_QUALIFIED_RULE.maxMinutesRisk}.`);
  }
  if (
    input.side === "OVER" &&
    input.openingTeamSpread != null &&
    input.openingTeamSpread <= LIVE_PTS_QUALIFIED_RULE.blockOverWhenFavoriteBy
  ) {
    reasons.push(`Blocked OVER in heavy favorite spot (${input.openingTeamSpread.toFixed(1)} spread).`);
  }
  return reasons;
}

function buildRebPassReasons(input: {
  marketLine: number | null;
  side: SnapshotModelSide;
  confidence: number | null;
  projectionGap: number | null;
  minutesRisk: number | null;
}): string[] {
  const reasons: string[] = [];
  if (input.marketLine == null) reasons.push("No live consensus REB line.");
  if (input.side === "NEUTRAL") reasons.push("No side edge.");
  if (input.projectionGap != null && Math.abs(input.projectionGap) < LIVE_REB_QUALIFIED_RULE.minProjectionGap) {
    reasons.push(`Projection gap under ${LIVE_REB_QUALIFIED_RULE.minProjectionGap}.`);
  }
  if (input.confidence != null && input.confidence < LIVE_REB_QUALIFIED_RULE.minConfidence) {
    reasons.push(`Confidence under ${LIVE_REB_QUALIFIED_RULE.minConfidence}.`);
  }
  if (input.minutesRisk != null && input.minutesRisk > LIVE_REB_QUALIFIED_RULE.maxMinutesRisk) {
    reasons.push(`Minutes risk above ${LIVE_REB_QUALIFIED_RULE.maxMinutesRisk}.`);
  }
  return reasons;
}

function buildAstPassReasons(input: {
  marketLine: number | null;
  side: SnapshotModelSide;
  confidence: number | null;
  projectionGap: number | null;
  minutesRisk: number | null;
}): string[] {
  const reasons: string[] = [];
  if (input.marketLine == null) reasons.push("No live consensus AST line.");
  if (input.side === "NEUTRAL") reasons.push("No side edge.");
  if (input.projectionGap != null && Math.abs(input.projectionGap) < LIVE_AST_QUALIFIED_RULE.minProjectionGap) {
    reasons.push(`Projection gap under ${LIVE_AST_QUALIFIED_RULE.minProjectionGap}.`);
  }
  if (input.confidence != null && input.confidence < LIVE_AST_QUALIFIED_RULE.minConfidence) {
    reasons.push(`Confidence under ${LIVE_AST_QUALIFIED_RULE.minConfidence}.`);
  }
  if (input.minutesRisk != null && input.minutesRisk > LIVE_AST_QUALIFIED_RULE.maxMinutesRisk) {
    reasons.push(`Minutes risk above ${LIVE_AST_QUALIFIED_RULE.maxMinutesRisk}.`);
  }
  return reasons;
}

function buildThreesPassReasons(input: {
  marketLine: number | null;
  side: SnapshotModelSide;
  confidence: number | null;
  projectionGap: number | null;
  minutesRisk: number | null;
}): string[] {
  const reasons: string[] = [];
  if (input.marketLine == null) reasons.push("No live consensus 3PM line.");
  if (input.side === "NEUTRAL") reasons.push("No side edge.");
  if (input.projectionGap != null && Math.abs(input.projectionGap) < LIVE_THREES_QUALIFIED_RULE.minProjectionGap) {
    reasons.push(`Projection gap under ${LIVE_THREES_QUALIFIED_RULE.minProjectionGap}.`);
  }
  if (input.confidence != null && input.confidence < LIVE_THREES_QUALIFIED_RULE.minConfidence) {
    reasons.push(`Confidence under ${LIVE_THREES_QUALIFIED_RULE.minConfidence}.`);
  }
  if (input.minutesRisk != null && input.minutesRisk > LIVE_THREES_QUALIFIED_RULE.maxMinutesRisk) {
    reasons.push(`Minutes risk above ${LIVE_THREES_QUALIFIED_RULE.maxMinutesRisk}.`);
  }
  return reasons;
}

function buildComboPassReasons(input: {
  marketLabel: "PRA" | "PA" | "PR" | "RA";
  marketLine: number | null;
  side: SnapshotModelSide;
  confidence: number | null;
  projectionGap: number | null;
  minutesRisk: number | null;
  rule: SnapshotPtsQualifiedRule;
}): string[] {
  const reasons: string[] = [];
  if (input.marketLine == null) reasons.push(`No live consensus ${input.marketLabel} line.`);
  if (input.side === "NEUTRAL") reasons.push("No side edge.");
  if (input.projectionGap != null && Math.abs(input.projectionGap) < input.rule.minProjectionGap) {
    reasons.push(`Projection gap under ${input.rule.minProjectionGap}.`);
  }
  if (input.confidence != null && input.confidence < input.rule.minConfidence) {
    reasons.push(`Confidence under ${input.rule.minConfidence}.`);
  }
  if (input.minutesRisk != null && input.minutesRisk > input.rule.maxMinutesRisk) {
    reasons.push(`Minutes risk above ${input.rule.maxMinutesRisk}.`);
  }
  return reasons;
}

function applyJokicRebLiveOverride(input: {
  playerName: string | null;
  projection: number | null;
  line: number | null;
  openingTeamSpread: number | null;
  openingTotal: number | null;
}): SnapshotModelSide {
  if (normalizePlayerName(input.playerName ?? "") !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null) return "NEUTRAL";

  const spread = input.openingTeamSpread ?? 0;
  const total = input.openingTotal ?? 0;
  const projectionGap = input.projection - input.line;

  if (spread <= -5.25) {
    if (input.projection <= 13.1) {
      return spread <= -11 ? "OVER" : "UNDER";
    }
    return input.projection <= 13.275 ? "OVER" : "UNDER";
  }

  if (projectionGap <= 0.36) {
    return total <= 240.75 ? "OVER" : "UNDER";
  }

  return total <= 227.5 ? "OVER" : "UNDER";
}

function applyJokicAstLiveOverride(input: {
  playerName: string | null;
  projection: number | null;
  line: number | null;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  overPrice: number | null;
  underPrice: number | null;
}): SnapshotModelSide {
  if (normalizePlayerName(input.playerName ?? "") !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null) return "NEUTRAL";

  const total = input.openingTotal ?? 0;
  const spread = input.openingTeamSpread ?? 0;
  const gap = input.projection - input.line;
  const overProbability = americanOddsToProbability(input.overPrice);
  const underProbability = americanOddsToProbability(input.underPrice);
  const lean =
    overProbability == null || underProbability == null ? 0 : round(overProbability - underProbability, 4);

  if (total <= 235) {
    if (gap <= 0.88) {
      return gap <= 0.76 ? "OVER" : "UNDER";
    }
    return gap <= 1.435 ? "OVER" : "UNDER";
  }

  if (lean <= 0.04) {
    return lean <= -0.045 ? "OVER" : "UNDER";
  }

  return spread <= -4.375 ? "OVER" : "UNDER";
}

function applyJokicThreesLiveOverride(input: {
  playerName: string | null;
  projection: number | null;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  openingTotal: number | null;
  projectedMinutes: number | null;
  completenessScore: number | null;
}): SnapshotModelSide {
  if (normalizePlayerName(input.playerName ?? "") !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null) return "NEUTRAL";

  if (input.openingTotal != null) {
    if (input.openingTotal <= 235) {
      if (input.completenessScore != null && input.completenessScore <= 86.5) {
        if (input.projectedMinutes != null && input.projectedMinutes <= 34.155) {
          return "OVER";
        }
        return "UNDER";
      }

      if (input.overPrice != null && input.overPrice <= -156) {
        return "UNDER";
      }

      if (input.projectedMinutes != null && input.projectedMinutes <= 33.725) {
        return "UNDER";
      }

      return "OVER";
    }

    if (input.projection <= 1.615) {
      return input.projection <= 0.7 ? "UNDER" : "OVER";
    }

    if (input.overPrice != null && input.overPrice <= -175.25) {
      return "OVER";
    }

    return "UNDER";
  }

  const marketSignal = resolveMarketFavoredSide({
    overPrice: input.overPrice,
    underPrice: input.underPrice,
  });
  if (input.line >= 2.5) {
    return "UNDER";
  }
  if ((marketSignal.priceLean ?? 0) >= 0.17) {
    return "UNDER";
  }
  return input.projection > input.line ? "OVER" : "UNDER";
}

function applyJokicPraLiveOverride(input: {
  playerName: string | null;
  projection: number | null;
  line: number | null;
  projectedPoints: number | null;
  completenessScore: number | null;
}): SnapshotModelSide {
  if (normalizePlayerName(input.playerName ?? "") !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null) return "NEUTRAL";

  if (input.line <= 52) {
    if (input.completenessScore != null && input.completenessScore <= 90.5) return "UNDER";
    return "OVER";
  }

  if (input.projection <= 53.84) return "OVER";
  return "UNDER";
}

function applyJokicPaLiveOverride(input: {
  playerName: string | null;
  projection: number | null;
  line: number | null;
  openingTotal: number | null;
  projectedPoints: number | null;
}): SnapshotModelSide {
  if (normalizePlayerName(input.playerName ?? "") !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null || input.projectedPoints == null) return "NEUTRAL";

  if (input.openingTotal != null && input.openingTotal <= 224.5) return "UNDER";
  if (input.projectedPoints <= 30.73) return "OVER";
  if (input.projectedPoints <= 31.97) return "UNDER";
  return "OVER";
}

function applyJokicPrLiveOverride(input: {
  playerName: string | null;
  projection: number | null;
  line: number | null;
  openingTotal: number | null;
  projectedAssists: number | null;
}): SnapshotModelSide {
  if (normalizePlayerName(input.playerName ?? "") !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null || input.projectedAssists == null) return "NEUTRAL";

  if (input.projectedAssists <= 10.73) return "OVER";
  if (input.projectedAssists <= 11.06) return "UNDER";
  if (input.openingTotal != null && input.openingTotal <= 241.5) return "OVER";
  return "UNDER";
}

function applyJokicRaLiveOverride(input: {
  playerName: string | null;
  projection: number | null;
  line: number | null;
  projectedRebounds: number | null;
  completenessScore: number | null;
  openingTotal: number | null;
}): SnapshotModelSide {
  if (normalizePlayerName(input.playerName ?? "") !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null) return "NEUTRAL";

  if (input.line <= 23) {
    if (input.projectedRebounds != null && input.projectedRebounds <= 13.34) return "OVER";
    return "UNDER";
  }

  if (input.openingTotal != null && input.openingTotal <= 234) return "OVER";
  return "UNDER";
}

export function buildLivePtsSignal(input: LivePtsSignalInput): SnapshotPtsSignal | null {
  if (input.projection == null) return null;

  const marketLine = input.marketLine?.line ?? null;
  const projectionGap = marketLine == null ? null : round(input.projection - marketLine, 2);
  const liveLineupTimingConfidence = lineupTimingConfidence({
    lineupStatus: input.lineupStatus,
    lineupStarter: input.lineupStarter,
    starterRateLast10: input.starterRateLast10,
  });
  const minutesRisk = computeMinutesRisk({
    projectedMinutes: input.projectedMinutes,
    projectedMinutesFloor: input.projectedMinutesFloor,
    projectedMinutesCeiling: input.projectedMinutesCeiling,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    lineupTimingConfidence: liveLineupTimingConfidence,
    openingTeamSpread: input.openingTeamSpread,
  });

  let overScore = projectionGap == null ? 0 : projectionGap * 1.65;
  let underScore = projectionGap == null ? 0 : -projectionGap * 1.5;

  if (minutesRisk != null) {
    overScore += clamp((1 - minutesRisk) * 1.15 - 0.45, -0.25, 0.8);
    underScore += clamp(minutesRisk * 1.3 - 0.35, -0.1, 1);
  }

  if (input.openingTotal != null) {
    overScore += clamp((input.openingTotal - 229) * 0.04, -0.4, 0.8);
    underScore += clamp((229 - input.openingTotal) * 0.035, -0.35, 0.7);
  }

  if (input.openingTeamSpread != null) {
    const absSpread = Math.abs(input.openingTeamSpread);
    if (absSpread <= 4.5) {
      overScore += 0.42;
      underScore -= 0.08;
    }
    if (absSpread >= 7) {
      underScore += clamp((absSpread - 6.5) * 0.15, 0, 1);
      overScore -= clamp((absSpread - 6.5) * 0.14, 0, 0.95);
    }
    if (input.openingTeamSpread <= -7) {
      underScore += 0.38;
      overScore -= 0.34;
    }
  }

  if (liveLineupTimingConfidence != null) {
    overScore += clamp((liveLineupTimingConfidence - 0.72) * 1.2, -0.35, 0.42);
    underScore += clamp((0.72 - liveLineupTimingConfidence) * 0.95, -0.2, 0.4);
  }

  if (input.playerShotPressure?.aggression != null) {
    overScore += clamp((input.playerShotPressure.aggression - 0.92) * 2.4, -0.35, 0.75);
  }
  if (input.playerShotPressure?.freeThrowPressure != null) {
    overScore += clamp((input.playerShotPressure.freeThrowPressure - 0.25) * 2.0, -0.25, 0.6);
  }
  if (input.playerShotPressure?.threeShare != null) {
    underScore += clamp((input.playerShotPressure.threeShare - 0.26) * 0.8, -0.15, 0.28);
  }

  if (input.opponentShotVolume?.fgaPerMinute != null && input.playerShotPressure?.fgaRate != null) {
    const fgaEdge = input.opponentShotVolume.fgaPerMinute - input.playerShotPressure.fgaRate;
    overScore += clamp(fgaEdge * 10.5, -0.55, 0.95);
    underScore += clamp(-fgaEdge * 8.2, -0.35, 0.75);
  }
  if (input.opponentShotVolume?.ftaPerMinute != null && input.playerShotPressure?.ftaRate != null) {
    const ftaEdge = input.opponentShotVolume.ftaPerMinute - input.playerShotPressure.ftaRate;
    overScore += clamp(ftaEdge * 10.5, -0.45, 0.85);
    underScore += clamp(-ftaEdge * 7.2, -0.3, 0.65);
  }

  let scoreGap = round(overScore - underScore, 3);
  let side: SnapshotModelSide =
    marketLine == null
      ? "NEUTRAL"
      : scoreGap > 0.04
        ? "OVER"
        : scoreGap < -0.04
          ? "UNDER"
          : projectionGap != null && projectionGap >= 0
          ? "OVER"
          : "UNDER";

  const confidenceBase =
    Math.abs(scoreGap) * 7.5 +
    Math.abs(projectionGap ?? 0) * 3.2 +
    clamp((input.marketLine?.sportsbookCount ?? 0) * 0.9, 0, 4.5);
  const confidenceSupport =
    (liveLineupTimingConfidence ?? 0.62) * 6 +
    (1 - (minutesRisk ?? 0.35)) * 7 +
    clamp((1 - (input.minutesVolatility ?? 3.5) / 10) * 5, 0, 5);
  let confidence = marketLine == null ? null : round(clamp(48 + confidenceBase + confidenceSupport, 48, 88), 2);

  const marketSignal = resolveMarketFavoredSide({
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
  });

  if (marketSignal.marketStrong && marketSignal.favoredSide !== "NEUTRAL" && marketSignal.favoredSide !== side) {
    side = marketSignal.favoredSide;
    confidence =
      confidence == null
        ? null
        : round(clamp(confidence + Math.min(8, Math.abs(marketSignal.priceLean ?? 0) * 240), 48, 90), 2);
    if (side === "OVER") {
      overScore = round(overScore + Math.abs(marketSignal.priceLean ?? 0) * 16, 3);
      underScore = round(underScore - Math.abs(marketSignal.priceLean ?? 0) * 10, 3);
    } else {
      underScore = round(underScore + Math.abs(marketSignal.priceLean ?? 0) * 16, 3);
      overScore = round(overScore - Math.abs(marketSignal.priceLean ?? 0) * 10, 3);
    }
  }

  if (side === "OVER" && input.openingTeamSpread != null && input.openingTeamSpread <= -5.5) {
    side = "UNDER";
    confidence = confidence == null ? null : round(clamp(confidence + 2.5, 48, 90), 2);
    underScore = round(underScore + 0.8, 3);
    overScore = round(overScore - 0.8, 3);
  }

  if (
    side === "UNDER" &&
    input.openingTotal != null &&
    input.openingTotal >= 235 &&
    marketSignal.marketStrong &&
    marketSignal.favoredSide === "OVER"
  ) {
    side = "OVER";
    confidence = confidence == null ? null : round(clamp(confidence + 1.5, 48, 90), 2);
    overScore = round(overScore + 0.45, 3);
    underScore = round(underScore - 0.45, 3);
  }

  if (marketLine != null && (minutesRisk ?? 1) <= 0.2) {
    const projectionSide: SnapshotModelSide =
      input.projection > marketLine ? "OVER" : input.projection < marketLine ? "UNDER" : "NEUTRAL";
    if (projectionSide !== "NEUTRAL") {
      side = projectionSide;
      confidence = confidence == null ? null : round(clamp(confidence + 1.5, 48, 90), 2);
      if (side === "OVER") {
        overScore = round(overScore + 0.35, 3);
        underScore = round(underScore - 0.35, 3);
      } else {
        underScore = round(underScore + 0.35, 3);
        overScore = round(overScore - 0.35, 3);
      }
    }
  }

  if (
    marketLine != null &&
    input.openingTotal != null &&
    input.openingTotal >= 234 &&
    Math.abs(input.projection - marketLine) <= 2 &&
    marketSignal.favoredSide !== "NEUTRAL"
  ) {
    side = marketSignal.favoredSide;
    confidence = confidence == null ? null : round(clamp(confidence + 1.2, 48, 90), 2);
    if (side === "OVER") {
      overScore = round(overScore + 0.28, 3);
      underScore = round(underScore - 0.28, 3);
    } else {
      underScore = round(underScore + 0.28, 3);
      overScore = round(overScore - 0.28, 3);
    }
  }

  const universalModelOverride = predictLiveUniversalModelSide({
    market: "PTS",
    projectedValue: input.projection,
    line: marketLine,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
    finalSide: side,
    expectedMinutes: input.projectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    archetypeExpectedMinutes: input.archetypeExpectedMinutes ?? null,
    openingTeamSpread: input.openingTeamSpread,
    openingTotal: input.openingTotal,
    lineupTimingConfidence: liveLineupTimingConfidence,
    completenessScore: input.completenessScore,
    playerPosition: input.playerPosition,
    pointsProjection: input.pointsProjection ?? input.projection,
    reboundsProjection: input.reboundsProjection ?? null,
    assistProjection: input.assistProjection,
    threesProjection: input.threesProjection ?? null,
  });
  if (universalModelOverride !== "NEUTRAL") {
    side = universalModelOverride;
    confidence = confidence == null ? null : round(clamp(confidence + 2.5, 48, 91), 2);
  }

  const playerModelOverride = predictLivePlayerModelSide({
    playerName: input.playerName,
    market: "PTS",
    projectedValue: input.projection,
    line: marketLine,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
    finalSide: side,
    expectedMinutes: input.projectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
  });
  if (playerModelOverride !== "NEUTRAL") {
    side = playerModelOverride;
    confidence = confidence == null ? null : round(clamp(confidence + 5.5, 48, 92), 2);
    if (side === "OVER") {
      overScore = round(overScore + 0.42, 3);
      underScore = round(underScore - 0.42, 3);
    } else {
      underScore = round(underScore + 0.42, 3);
      overScore = round(overScore - 0.42, 3);
    }
  }

  scoreGap = round(overScore - underScore, 3);
  const passReasons = buildPassReasons({
    marketLine,
    side,
    confidence,
    projectionGap,
    minutesRisk,
    openingTeamSpread: input.openingTeamSpread,
  });

  return {
    marketLine,
    sportsbookCount: input.marketLine?.sportsbookCount ?? 0,
    side,
    confidence,
    confidenceTier: confidenceTier(confidence),
    projectionGap,
    minutesRisk,
    lineupTimingConfidence: liveLineupTimingConfidence,
    qualified: passReasons.length === 0,
    passReasons,
    rule: LIVE_PTS_QUALIFIED_RULE,
  };
}

export function buildLiveRebSignal(input: LiveRebSignalInput): SnapshotRebSignal | null {
  if (input.projection == null) return null;

  const marketLine = input.marketLine?.line ?? null;
  const projectionGap = marketLine == null ? null : round(input.projection - marketLine, 2);
  const liveLineupTimingConfidence = lineupTimingConfidence({
    lineupStatus: input.lineupStatus,
    lineupStarter: input.lineupStarter,
    starterRateLast10: input.starterRateLast10,
  });
  const minutesRisk = computeMinutesRisk({
    projectedMinutes: input.projectedMinutes,
    projectedMinutesFloor: input.projectedMinutesFloor,
    projectedMinutesCeiling: input.projectedMinutesCeiling,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    lineupTimingConfidence: liveLineupTimingConfidence,
    openingTeamSpread: input.openingTeamSpread,
  });

  const marketSignal = resolveMarketFavoredSide({
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
  });

  let side: SnapshotModelSide =
    marketLine == null
      ? "NEUTRAL"
      : input.projection > marketLine
        ? "OVER"
        : input.projection < marketLine
          ? "UNDER"
          : "NEUTRAL";

  if (
    marketLine != null &&
    Math.abs(projectionGap ?? 0) <= 0.85 &&
    marketSignal.marketStrong &&
    marketSignal.favoredSide !== "NEUTRAL"
  ) {
    side = marketSignal.favoredSide;
  } else if ((minutesRisk ?? 0) >= 0.48 && marketSignal.favoredSide !== "NEUTRAL") {
    side = marketSignal.favoredSide;
  } else if (marketLine != null && (minutesRisk ?? 1) <= 0.16) {
    side = input.projection > marketLine ? "OVER" : input.projection < marketLine ? "UNDER" : "NEUTRAL";
  }

  const universalModelOverride = predictLiveUniversalModelSide({
    market: "REB",
    projectedValue: input.projection,
    line: marketLine,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
    finalSide: side,
    expectedMinutes: input.projectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    archetypeExpectedMinutes: input.archetypeExpectedMinutes ?? null,
    openingTeamSpread: input.openingTeamSpread,
    openingTotal: input.openingTotal,
    lineupTimingConfidence: liveLineupTimingConfidence,
    completenessScore: input.completenessScore,
    playerPosition: input.playerPosition,
    pointsProjection: input.pointsProjection ?? null,
    reboundsProjection: input.reboundsProjection ?? input.projection,
    assistProjection: input.assistProjection,
    threesProjection: input.threesProjection ?? null,
  });
  if (universalModelOverride !== "NEUTRAL") {
    side = universalModelOverride;
  }

  const jokicOverride = applyJokicRebLiveOverride({
    playerName: input.playerName,
    projection: input.projection,
    line: marketLine,
    openingTeamSpread: input.openingTeamSpread,
    openingTotal: input.openingTotal,
  });
  if (jokicOverride !== "NEUTRAL") {
    side = jokicOverride;
  }

  const playerModelOverride = predictLivePlayerModelSide({
    playerName: input.playerName,
    market: "REB",
    projectedValue: input.projection,
    line: marketLine,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
    finalSide: side,
    expectedMinutes: input.projectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
  });
  if (playerModelOverride !== "NEUTRAL") {
    side = playerModelOverride;
  }

  const confidenceBase =
    Math.abs(projectionGap ?? 0) * 8.8 +
    clamp((input.marketLine?.sportsbookCount ?? 0) * 0.8, 0, 4) +
    Math.min(7.5, Math.abs(marketSignal.priceLean ?? 0) * 220);
  const confidenceSupport =
    (liveLineupTimingConfidence ?? 0.62) * 5.5 +
    (1 - (minutesRisk ?? 0.35)) * 8.5 +
    clamp((1 - (input.minutesVolatility ?? 3.5) / 10) * 4.2, 0, 4.2);
  let confidence = marketLine == null ? null : round(clamp(46 + confidenceBase + confidenceSupport, 46, 86), 2);
  if (universalModelOverride !== "NEUTRAL" && confidence != null) {
    confidence = round(clamp(confidence + 2.5, 46, 89), 2);
  }
  if (jokicOverride !== "NEUTRAL" && confidence != null) {
    confidence = round(clamp(confidence + 5.5, 46, 90), 2);
  }
  if (playerModelOverride !== "NEUTRAL" && confidence != null) {
    confidence = round(clamp(confidence + 4.5, 46, 90), 2);
  }

  const passReasons = buildRebPassReasons({
    marketLine,
    side,
    confidence,
    projectionGap,
    minutesRisk,
  });

  return {
    marketLine,
    sportsbookCount: input.marketLine?.sportsbookCount ?? 0,
    side,
    confidence,
    confidenceTier: confidenceTier(confidence),
    projectionGap,
    minutesRisk,
    lineupTimingConfidence: liveLineupTimingConfidence,
    qualified: passReasons.length === 0,
    passReasons,
    rule: LIVE_REB_QUALIFIED_RULE,
  };
}

export function buildLiveAstSignal(input: LiveAstSignalInput): SnapshotAstSignal | null {
  if (input.projection == null) return null;

  const marketLine = input.marketLine?.line ?? null;
  const projectionGap = marketLine == null ? null : round(input.projection - marketLine, 2);
  const liveLineupTimingConfidence = lineupTimingConfidence({
    lineupStatus: input.lineupStatus,
    lineupStarter: input.lineupStarter,
    starterRateLast10: input.starterRateLast10,
  });
  const minutesRisk = computeMinutesRisk({
    projectedMinutes: input.projectedMinutes,
    projectedMinutesFloor: input.projectedMinutesFloor,
    projectedMinutesCeiling: input.projectedMinutesCeiling,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    lineupTimingConfidence: liveLineupTimingConfidence,
    openingTeamSpread: input.openingTeamSpread,
  });
  const marketSignal = resolveMarketFavoredSide({
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
  });

  let side: SnapshotModelSide =
    marketLine == null
      ? "NEUTRAL"
      : input.projection > marketLine
        ? "OVER"
        : input.projection < marketLine
          ? "UNDER"
          : "NEUTRAL";

  if (
    marketLine != null &&
    Math.abs(projectionGap ?? 0) <= 0.9 &&
    marketSignal.marketStrong &&
    marketSignal.favoredSide !== "NEUTRAL"
  ) {
    side = marketSignal.favoredSide;
  } else if ((minutesRisk ?? 0) >= 0.42 && marketSignal.favoredSide !== "NEUTRAL") {
    side = marketSignal.favoredSide;
  } else if (marketLine != null && (minutesRisk ?? 1) <= 0.18) {
    side = input.projection > marketLine ? "OVER" : input.projection < marketLine ? "UNDER" : "NEUTRAL";
  }

  const universalModelOverride = predictLiveUniversalModelSide({
    market: "AST",
    projectedValue: input.projection,
    line: marketLine,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
    finalSide: side,
    expectedMinutes: input.projectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    archetypeExpectedMinutes: input.archetypeExpectedMinutes ?? null,
    openingTeamSpread: input.openingTeamSpread,
    openingTotal: input.openingTotal,
    lineupTimingConfidence: liveLineupTimingConfidence,
    completenessScore: input.completenessScore,
    playerPosition: input.playerPosition,
    pointsProjection: input.pointsProjection ?? null,
    reboundsProjection: input.reboundsProjection ?? null,
    assistProjection: input.assistProjection,
    threesProjection: input.threesProjection ?? null,
  });
  if (universalModelOverride !== "NEUTRAL") {
    side = universalModelOverride;
  }

  const jokicOverride = applyJokicAstLiveOverride({
    playerName: input.playerName,
    projection: input.projection,
    line: marketLine,
    openingTeamSpread: input.openingTeamSpread,
    openingTotal: input.openingTotal,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
  });
  if (jokicOverride !== "NEUTRAL") {
    side = jokicOverride;
  }

  const playerModelOverride = predictLivePlayerModelSide({
    playerName: input.playerName,
    market: "AST",
    projectedValue: input.projection,
    line: marketLine,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
    finalSide: side,
    expectedMinutes: input.projectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
  });
  if (playerModelOverride !== "NEUTRAL") {
    side = playerModelOverride;
  }

  const universalAstOverrideUsed =
    universalModelOverride !== "NEUTRAL" ||
    (jokicOverride === "NEUTRAL" &&
    marketLine != null &&
    side !== "NEUTRAL" &&
    (Math.abs(projectionGap ?? 0) <= 0.9 ||
      ((minutesRisk ?? 0) >= 0.42 && marketSignal.favoredSide === side) ||
      ((minutesRisk ?? 1) <= 0.18 &&
        side === (input.projection > marketLine ? "OVER" : input.projection < marketLine ? "UNDER" : "NEUTRAL"))));

  let confidence =
    marketLine == null
      ? null
      : round(
          clamp(
            46 +
              Math.abs(projectionGap ?? 0) * 9.2 +
              clamp((input.marketLine?.sportsbookCount ?? 0) * 0.8, 0, 4) +
              Math.min(8, Math.abs(marketSignal.priceLean ?? 0) * 225) +
              (liveLineupTimingConfidence ?? 0.62) * 5.2 +
              (1 - (minutesRisk ?? 0.35)) * 8.2,
            46,
            88,
          ),
          2,
        );
  if (universalAstOverrideUsed && confidence != null) {
    confidence = round(clamp(confidence + 1.5, 46, 89), 2);
  }
  if (jokicOverride !== "NEUTRAL" && confidence != null) {
    confidence = round(clamp(confidence + 6, 46, 92), 2);
  }
  if (playerModelOverride !== "NEUTRAL" && confidence != null) {
    confidence = round(clamp(confidence + 4.5, 46, 92), 2);
  }

  const passReasons = buildAstPassReasons({
    marketLine,
    side,
    confidence,
    projectionGap,
    minutesRisk,
  });

  return {
    marketLine,
    sportsbookCount: input.marketLine?.sportsbookCount ?? 0,
    side,
    confidence,
    confidenceTier: confidenceTier(confidence),
    projectionGap,
    minutesRisk,
    lineupTimingConfidence: liveLineupTimingConfidence,
    qualified: passReasons.length === 0,
    passReasons,
    rule: LIVE_AST_QUALIFIED_RULE,
  };
}

export function buildLiveThreesSignal(input: LiveThreesSignalInput): SnapshotThreesSignal | null {
  if (input.projection == null) return null;

  const marketLine = input.marketLine?.line ?? null;
  const projectionGap = marketLine == null ? null : round(input.projection - marketLine, 2);
  const liveLineupTimingConfidence = lineupTimingConfidence({
    lineupStatus: input.lineupStatus,
    lineupStarter: input.lineupStarter,
    starterRateLast10: input.starterRateLast10,
  });
  const minutesRisk = computeMinutesRisk({
    projectedMinutes: input.projectedMinutes,
    projectedMinutesFloor: input.projectedMinutesFloor,
    projectedMinutesCeiling: input.projectedMinutesCeiling,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    lineupTimingConfidence: liveLineupTimingConfidence,
    openingTeamSpread: input.openingTeamSpread,
  });
  const marketSignal = resolveMarketFavoredSide({
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
  });

  let side: SnapshotModelSide =
    marketLine == null
      ? "NEUTRAL"
      : input.projection > marketLine
        ? "OVER"
        : input.projection < marketLine
          ? "UNDER"
          : "NEUTRAL";

  const universalModelOverride = predictLiveUniversalModelSide({
    market: "THREES",
    projectedValue: input.projection,
    line: marketLine,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
    finalSide: side,
    expectedMinutes: input.projectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    archetypeExpectedMinutes: input.archetypeExpectedMinutes ?? null,
    openingTeamSpread: input.openingTeamSpread,
    openingTotal: input.openingTotal,
    lineupTimingConfidence: liveLineupTimingConfidence,
    completenessScore: input.completenessScore,
    playerPosition: input.playerPosition,
    pointsProjection: input.pointsProjection ?? null,
    reboundsProjection: input.reboundsProjection ?? null,
    assistProjection: input.assistProjection,
    threesProjection: input.threesProjection ?? input.projection,
  });
  if (universalModelOverride !== "NEUTRAL") {
    side = universalModelOverride;
  }

  const jokicOverride = applyJokicThreesLiveOverride({
    playerName: input.playerName,
    projection: input.projection,
    line: marketLine,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
    openingTotal: input.openingTotal,
    projectedMinutes: input.projectedMinutes,
    completenessScore: input.completenessScore,
  });
  if (jokicOverride !== "NEUTRAL") {
    side = jokicOverride;
  }

  const playerModelOverride = predictLivePlayerModelSide({
    playerName: input.playerName,
    market: "THREES",
    projectedValue: input.projection,
    line: marketLine,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
    finalSide: side,
    expectedMinutes: input.projectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
  });
  if (playerModelOverride !== "NEUTRAL") {
    side = playerModelOverride;
  }

  const confidenceBase =
    Math.abs(projectionGap ?? 0) * 12 +
    clamp((input.marketLine?.sportsbookCount ?? 0) * 0.75, 0, 4) +
    Math.min(8, Math.abs(marketSignal.priceLean ?? 0) * 230);
  const confidenceSupport =
    (liveLineupTimingConfidence ?? 0.62) * 4.8 +
    (1 - (minutesRisk ?? 0.35)) * 8.4 +
    clamp(((input.completenessScore ?? 72) - 60) * 0.18, 0, 6);
  let confidence =
    marketLine == null
      ? null
      : round(clamp(45 + confidenceBase + confidenceSupport, 45, 88), 2);
  if (universalModelOverride !== "NEUTRAL" && confidence != null) {
    confidence = round(clamp(confidence + 2.5, 45, 90), 2);
  }
  if (jokicOverride !== "NEUTRAL" && confidence != null) {
    confidence = round(clamp(confidence + 6.5, 45, 92), 2);
  }
  if (playerModelOverride !== "NEUTRAL" && confidence != null) {
    confidence = round(clamp(confidence + 4.5, 45, 92), 2);
  }

  const passReasons = buildThreesPassReasons({
    marketLine,
    side,
    confidence,
    projectionGap,
    minutesRisk,
  });

  return {
    marketLine,
    sportsbookCount: input.marketLine?.sportsbookCount ?? 0,
    side,
    confidence,
    confidenceTier: confidenceTier(confidence),
    projectionGap,
    minutesRisk,
    lineupTimingConfidence: liveLineupTimingConfidence,
    qualified: passReasons.length === 0,
    passReasons,
    rule: LIVE_THREES_QUALIFIED_RULE,
  };
}

function comboRuleForMarket(market: LiveComboSignalInput["market"]): SnapshotPtsQualifiedRule {
  if (market === "PRA") return LIVE_PRA_QUALIFIED_RULE;
  if (market === "PA") return LIVE_PA_QUALIFIED_RULE;
  if (market === "PR") return LIVE_PR_QUALIFIED_RULE;
  return LIVE_RA_QUALIFIED_RULE;
}

function buildLiveComboSignal(input: LiveComboSignalInput): SnapshotPtsSignal | null {
  if (input.projection == null) return null;

  const marketLine = input.marketLine?.line ?? null;
  const projectionGap = marketLine == null ? null : round(input.projection - marketLine, 2);
  const liveLineupTimingConfidence = lineupTimingConfidence({
    lineupStatus: input.lineupStatus,
    lineupStarter: input.lineupStarter,
    starterRateLast10: input.starterRateLast10,
  });
  const minutesRisk = computeMinutesRisk({
    projectedMinutes: input.projectedMinutes,
    projectedMinutesFloor: input.projectedMinutesFloor,
    projectedMinutesCeiling: input.projectedMinutesCeiling,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    lineupTimingConfidence: liveLineupTimingConfidence,
    openingTeamSpread: input.openingTeamSpread,
  });
  const marketSignal = resolveMarketFavoredSide({
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
  });
  const rule = comboRuleForMarket(input.market);

  let overScore = projectionGap == null ? 0 : projectionGap * (input.market === "PRA" ? 1.45 : 1.55);
  let underScore = projectionGap == null ? 0 : -projectionGap * (input.market === "PRA" ? 1.35 : 1.45);

  if (minutesRisk != null) {
    overScore += clamp((1 - minutesRisk) * 0.95 - 0.35, -0.2, 0.7);
    underScore += clamp(minutesRisk * 1.05 - 0.25, -0.1, 0.8);
  }

  if (input.openingTotal != null) {
    const totalOverBoost =
      input.market === "PRA" ? 0.05 : input.market === "PA" || input.market === "PR" ? 0.04 : 0.035;
    const totalUnderBoost =
      input.market === "PRA" ? 0.045 : input.market === "PA" || input.market === "PR" ? 0.038 : 0.032;
    overScore += clamp((input.openingTotal - 228) * totalOverBoost, -0.35, 0.85);
    underScore += clamp((228 - input.openingTotal) * totalUnderBoost, -0.3, 0.75);
  }

  if (input.openingTeamSpread != null) {
    const absSpread = Math.abs(input.openingTeamSpread);
    if (absSpread <= 4.5) {
      overScore += input.market === "PRA" ? 0.34 : 0.24;
      underScore -= 0.06;
    }
    if (absSpread >= 8) {
      const penalty = clamp((absSpread - 7.5) * (input.market === "PRA" ? 0.12 : 0.09), 0, 0.75);
      underScore += penalty;
      overScore -= penalty;
    }
  }

  if (liveLineupTimingConfidence != null) {
    overScore += clamp((liveLineupTimingConfidence - 0.7) * 1.0, -0.25, 0.35);
    underScore += clamp((0.7 - liveLineupTimingConfidence) * 0.8, -0.15, 0.35);
  }

  if (input.playerShotPressure != null) {
    if (input.market === "PRA" || input.market === "PA" || input.market === "PR") {
      if (input.playerShotPressure.fgaRate != null) {
        overScore += clamp((input.playerShotPressure.fgaRate - 0.42) * 2.6, -0.2, 0.45);
      }
      if (input.playerShotPressure.freeThrowPressure != null) {
        overScore += clamp((input.playerShotPressure.freeThrowPressure - 0.24) * 1.8, -0.15, 0.35);
      }
    }
    if ((input.market === "PRA" || input.market === "PA" || input.market === "RA") && input.playerShotPressure.threeShare != null) {
      underScore += clamp((input.playerShotPressure.threeShare - 0.25) * 0.45, -0.08, 0.15);
    }
  }

  if (input.opponentShotVolume != null) {
    if (input.market === "PRA" || input.market === "PA" || input.market === "PR") {
      if (input.opponentShotVolume.fgaPerMinute != null) {
        overScore += clamp((input.opponentShotVolume.fgaPerMinute - 0.43) * 4.5, -0.25, 0.45);
      }
      if (input.opponentShotVolume.ftaPerMinute != null) {
        overScore += clamp((input.opponentShotVolume.ftaPerMinute - 0.11) * 5.5, -0.2, 0.4);
      }
    }
    if ((input.market === "PRA" || input.market === "PA" || input.market === "RA") && input.opponentShotVolume.freeThrowPressure != null) {
      overScore += clamp((input.opponentShotVolume.freeThrowPressure - 0.22) * 1.2, -0.12, 0.24);
    }
  }

  let side: SnapshotModelSide =
    marketLine == null
      ? "NEUTRAL"
      : overScore - underScore > 0.04
        ? "OVER"
        : overScore - underScore < -0.04
          ? "UNDER"
          : projectionGap != null && projectionGap >= 0
            ? "OVER"
            : "UNDER";

  const comboNearLineThreshold = input.market === "PRA" ? 1.4 : 1;
  if (
    marketLine != null &&
    Math.abs(projectionGap ?? 0) <= comboNearLineThreshold &&
    marketSignal.marketStrong &&
    marketSignal.favoredSide !== "NEUTRAL"
  ) {
    side = marketSignal.favoredSide;
  } else if ((minutesRisk ?? 0) >= 0.45 && marketSignal.favoredSide !== "NEUTRAL") {
    side = marketSignal.favoredSide;
  } else if (marketLine != null && (minutesRisk ?? 1) <= 0.18) {
    side = input.projection > marketLine ? "OVER" : input.projection < marketLine ? "UNDER" : "NEUTRAL";
  }

  const universalModelOverride = predictLiveUniversalModelSide({
    market: input.market,
    projectedValue: input.projection,
    line: marketLine,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
    finalSide: side,
    expectedMinutes: input.projectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    archetypeExpectedMinutes: input.archetypeExpectedMinutes ?? null,
    openingTeamSpread: input.openingTeamSpread,
    openingTotal: input.openingTotal,
    lineupTimingConfidence: liveLineupTimingConfidence,
    completenessScore: input.completenessScore,
    playerPosition: input.playerPosition,
    pointsProjection: input.projectedPoints,
    reboundsProjection: input.projectedRebounds,
    assistProjection: input.assistProjection,
    threesProjection: input.threesProjection ?? null,
  });
  if (universalModelOverride !== "NEUTRAL") {
    side = universalModelOverride;
  }

  const jokicComboOverride =
    input.market === "PRA"
      ? applyJokicPraLiveOverride({
          playerName: input.playerName,
          projection: input.projection,
          line: marketLine,
          projectedPoints: input.projectedPoints,
          completenessScore: input.completenessScore,
        })
      : input.market === "PA"
        ? applyJokicPaLiveOverride({
            playerName: input.playerName,
            projection: input.projection,
            line: marketLine,
            openingTotal: input.openingTotal,
            projectedPoints: input.projectedPoints,
          })
        : input.market === "PR"
          ? applyJokicPrLiveOverride({
              playerName: input.playerName,
              projection: input.projection,
              line: marketLine,
              openingTotal: input.openingTotal,
              projectedAssists: input.projectedAssists,
            })
          : applyJokicRaLiveOverride({
              playerName: input.playerName,
              projection: input.projection,
              line: marketLine,
              projectedRebounds: input.projectedRebounds,
              completenessScore: input.completenessScore,
              openingTotal: input.openingTotal,
            });
  if (jokicComboOverride !== "NEUTRAL") {
    side = jokicComboOverride;
  }

  const playerModelOverride = predictLivePlayerModelSide({
    playerName: input.playerName,
    market: input.market,
    projectedValue: input.projection,
    line: marketLine,
    overPrice: input.marketLine?.overPrice ?? null,
    underPrice: input.marketLine?.underPrice ?? null,
    finalSide: side,
    expectedMinutes: input.projectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
  });
  if (playerModelOverride !== "NEUTRAL") {
    side = playerModelOverride;
  }

  const confidence =
    marketLine == null
      ? null
      : round(
          clamp(
            46 +
              Math.abs(projectionGap ?? 0) * (input.market === "PRA" ? 3.9 : 4.8) +
              clamp((input.marketLine?.sportsbookCount ?? 0) * 0.8, 0, 4.5) +
              Math.min(7.5, Math.abs(marketSignal.priceLean ?? 0) * 215) +
              (liveLineupTimingConfidence ?? 0.62) * 5.6 +
              (1 - (minutesRisk ?? 0.35)) * 7.2,
            46,
            88,
          ),
          2,
        );
  const adjustedConfidence =
    jokicComboOverride !== "NEUTRAL" && confidence != null
      ? round(clamp(confidence + 5.5, 46, 90), 2)
      : universalModelOverride !== "NEUTRAL" && confidence != null
        ? round(clamp(confidence + 2.5, 46, 89), 2)
        : confidence;
  const playerAdjustedConfidence =
    playerModelOverride !== "NEUTRAL" && adjustedConfidence != null
      ? round(clamp(adjustedConfidence + 4.5, 46, 90), 2)
      : adjustedConfidence;

  const passReasons = buildComboPassReasons({
    marketLabel: input.market,
    marketLine,
    side,
    confidence: playerAdjustedConfidence,
    projectionGap,
    minutesRisk,
    rule,
  });

  return {
    marketLine,
    sportsbookCount: input.marketLine?.sportsbookCount ?? 0,
    side,
    confidence: playerAdjustedConfidence,
    confidenceTier: confidenceTier(playerAdjustedConfidence),
    projectionGap,
    minutesRisk,
    lineupTimingConfidence: liveLineupTimingConfidence,
    qualified: passReasons.length === 0,
    passReasons,
    rule,
  };
}

export function buildLivePraSignal(input: LiveComboSignalBaseInput): SnapshotPraSignal | null {
  return buildLiveComboSignal({ ...input, market: "PRA" });
}

export function buildLivePaSignal(input: LiveComboSignalBaseInput): SnapshotPaSignal | null {
  return buildLiveComboSignal({ ...input, market: "PA" });
}

export function buildLivePrSignal(input: LiveComboSignalBaseInput): SnapshotPrSignal | null {
  return buildLiveComboSignal({ ...input, market: "PR" });
}

export function buildLiveRaSignal(input: LiveComboSignalBaseInput): SnapshotRaSignal | null {
  return buildLiveComboSignal({ ...input, market: "RA" });
}

export function applyEnhancedPointsProjection(input: EnhancedPointsProjectionInput): number | null {
  if (input.baseProjection == null) return null;
  let projection = input.baseProjection;

  if (input.openingTotal != null && Number.isFinite(input.openingTotal)) {
    projection += clamp((input.openingTotal - 228) * 0.03, -0.9, 0.9);
  }
  if (input.openingTeamSpread != null && Number.isFinite(input.openingTeamSpread)) {
    projection += clamp(-Math.max(0, Math.abs(input.openingTeamSpread) - 6) * 0.06, -0.75, 0.2);
  }

  if (input.lineupStatus != null) {
    const certainty = input.lineupStatus === "CONFIRMED" ? 1 : input.lineupStatus === "EXPECTED" ? 0.6 : 0.3;
    if (input.lineupStarter === true && (input.starterRateLast10 ?? 0.5) < 0.6) {
      projection += 0.65 * certainty;
    }
    if (input.lineupStarter === false && (input.starterRateLast10 ?? 0.5) > 0.6) {
      projection -= 0.9 * certainty;
    }
  }

  if (input.playerShotPressure && input.opponentShotVolume) {
    if (input.playerShotPressure.fgaRate != null && input.opponentShotVolume.fgaPerMinute != null) {
      projection += clamp((input.opponentShotVolume.fgaPerMinute - input.playerShotPressure.fgaRate) * 10.5, -1.15, 1.15);
    }
    if (input.playerShotPressure.ftaRate != null && input.opponentShotVolume.ftaPerMinute != null) {
      projection += clamp((input.opponentShotVolume.ftaPerMinute - input.playerShotPressure.ftaRate) * 12.5, -0.95, 1.05);
    }
    if (input.playerShotPressure.threeShare != null && input.opponentShotVolume.threeShare != null) {
      projection += clamp(-(input.opponentShotVolume.threeShare - input.playerShotPressure.threeShare) * 2.2, -0.45, 0.35);
    }
  }

  if (input.marketLine?.line != null) {
    const anchorWeight =
      input.marketLine.sportsbookCount >= 4
        ? 0.24
        : input.marketLine.sportsbookCount >= 2
          ? 0.18
          : 0.12;
    projection = projection * (1 - anchorWeight) + input.marketLine.line * anchorWeight;
  }

  return round(Math.max(0, projection), 2);
}


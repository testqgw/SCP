import { load } from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { deriveRotowireAvailabilityImpact } from "../lib/lineups/rotowire";
import { prisma } from "../lib/prisma";
import {
  SNAPSHOT_MARKETS,
  buildPlayerPersonalModels,
  projectMinutesProfile,
  projectTonightMetrics,
} from "../lib/snapshot/projection";
import { buildModelLineRecord } from "../lib/snapshot/modelLines";
import type { SnapshotDataCompleteness, SnapshotMarket, SnapshotMetricRecord, SnapshotStatLog } from "../lib/types/snapshot";
import { round } from "../lib/utils";

type Args = {
  playerSearch: string;
  from: string;
  to: string;
  out: string | null;
  lineFile: string | null;
  minActualMinutes: number;
};

type LookupPlayer = {
  id: string;
  externalId: string | null;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  teamId: string | null;
};

type PlayerLog = SnapshotStatLog & {
  playerId: string;
  externalGameId: string;
  teamId: string | null;
  opponentTeamId: string | null;
};

type PlayerVolumeLog = {
  externalGameId: string;
  gameDateEt: string;
  isHome: boolean | null;
  starter: boolean | null;
  minutes: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  points: number;
};

type OpponentGameAggregate = {
  count: number;
  sums: SnapshotMetricRecord;
};

type PositionToken = "G" | "F" | "C";

type PlayerMeta = {
  id: string;
  externalId: string | null;
  fullName: string;
  position: string | null;
};

type PlayerProfile = {
  playerId: string;
  position: string | null;
  positionTokens: Set<PositionToken>;
  minutesLast10Avg: number | null;
  ptsLast10Avg: number | null;
  astLast10Avg: number | null;
  starterRateLast10: number | null;
  stocksPer36Last10: number | null;
};

type TeamMargin = {
  gameDateEt: string;
  externalGameId: string;
  teamId: string;
  margin: number | null;
};

type TeamEnvironment = {
  gameDateEt: string;
  externalGameId: string;
  teamId: string;
  teamPoints: number | null;
  opponentPoints: number | null;
  total: number | null;
  margin: number | null;
};

type HistoricalPregameOdds = {
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

type HistoricalStartingLineup = {
  source: "nba-cdn" | "basketball-reference";
  awayCode: string;
  homeCode: string;
  awayStarters: string[];
  homeStarters: string[];
  awayStarterExternalIds: string[];
  homeStarterExternalIds: string[];
};

type SportsDataBettingEvent = {
  gameId: string;
  awayCode: string;
  homeCode: string;
};

type HistoricalPropSide = "OVER" | "UNDER";

type HistoricalPlayerPropLine = {
  source: "sportsdata" | "csv";
  market: SnapshotMarket;
  line: number;
  sportsbookCount: number;
  sportsbookIds: number[];
  capturedAt: string | null;
  overPrice: number | null;
  underPrice: number | null;
};

type RotowireAvailabilityStatus = "OUT" | "DOUBTFUL" | "QUESTIONABLE" | "PROBABLE" | "ACTIVE" | "UNKNOWN";

type HistoricalRotowireUnavailablePlayer = {
  playerName: string;
  status: RotowireAvailabilityStatus;
  percentPlay: number | null;
  title: string | null;
};

type HistoricalRotowireTeamSignal = {
  teamCode: string;
  gameTimeEt: string | null;
  status: "CONFIRMED" | "EXPECTED" | "UNKNOWN";
  starters: string[];
  unavailablePlayers: HistoricalRotowireUnavailablePlayer[];
};

type HistoricalRotowireSnapshot = {
  source: "rotowire" | "sportsdata";
  sourceUrl: string;
  fetchedAt: string;
  dateEt: string;
  pageDateLabel: string | null;
  teams: HistoricalRotowireTeamSignal[];
};

type HistoricalGameContext = {
  openingTeamSpread: number | null;
  openingTotal: number | null;
  playerStarted: boolean | null;
  starterResolved: boolean;
  starterSource: string | null;
  starterStatus: string | null;
  missingKeyTeammatePts: number;
  benchedKeyTeammatePts: number;
  defenderStocksPer36: number | null;
  spreadResolved: boolean;
  spreadSource: string | null;
  bookPtsLine: number | null;
  bookPtsLineSource: string | null;
  opponentShotVolumeSample: number;
  ptsSideConfidence: number | null;
  ptsOverScore: number | null;
  ptsUnderScore: number | null;
  ptsMinutesRisk: number | null;
  lineupTimingConfidence: number | null;
  ptsQualifiedBet: boolean | null;
};

type PtsRegime = "EARLY" | "MID" | "LATE";

type HistoricalTeammateCoreContext = {
  missingPts: number;
  benchedPts: number;
  activePts: number;
  activeAst: number;
  activeStarterCount: number;
  availableCoreCount: number;
  missingCoreCount: number;
  continuityScore: number;
};

type PositionAllowanceMetrics = {
  pts: number | null;
  ast: number | null;
  reb: number | null;
  sample: number;
};

type ShotPressureSummary = {
  fgaRate: number | null;
  fg3aRate: number | null;
  ftaRate: number | null;
  threeShare: number | null;
  rimRate: number | null;
  freeThrowPressure: number | null;
  aggression: number | null;
  shotPressureIndex: number | null;
};

type SeasonVolumeLog = PlayerVolumeLog & {
  playerExternalId: string;
  teamCode: string;
  opponentCode: string | null;
};

type OpponentShotVolumeMetrics = {
  fga: number | null;
  fg3a: number | null;
  fta: number | null;
  fgaPerMinute: number | null;
  fg3aPerMinute: number | null;
  ftaPerMinute: number | null;
  threeShare: number | null;
  freeThrowPressure: number | null;
  sample: number;
};

type PtsResidualCalibrationRow = {
  gameDateEt: string;
  regime: PtsRegime;
  isHome: boolean | null;
  expectedMinutes: number | null;
  openingTotal: number | null;
  openingSpread: number | null;
  unavailableTeammatePts: number;
  activeCorePts: number;
  activeCoreAst: number;
  continuityScore: number | null;
  opponentPositionPts: number | null;
  opponentPositionAst: number | null;
  defenderStocksPer36: number | null;
  shotPressureIndex: number | null;
  threeShare: number | null;
  freeThrowPressure: number | null;
  baselineProjection: number;
  lineAnchor: number;
  actualPoints: number;
};

type EnhancedPtsProjectionResult = {
  projection: number;
  baselineProjection: number;
  regime: PtsRegime;
  shotPressure: ShotPressureSummary;
  teamShareProjection: number | null;
  volumeProjection: number | null;
  residualAdjustment: number;
  sideDecision: PtsSideDecision;
  minutesRisk: PtsMinutesRiskSummary;
  lineupTimingConfidence: number | null;
};

type PtsMinutesRiskSummary = {
  riskScore: number;
  stabilityScore: number;
  volatility: number | null;
  lowMinutesRate: number;
  trendDelta: number | null;
  blowoutRisk: number;
};

type PtsSideDecision = {
  side: "OVER" | "UNDER" | "NEUTRAL";
  confidence: number;
  overScore: number;
  underScore: number;
  scoreGap: number;
};

type PtsMarketSignal = {
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
};

type TargetGameResult = {
  gameDateEt: string;
  matchupKey: string;
  teamCode: string | null;
  opponentCode: string | null;
  projectedMinutes: number | null;
  actualMinutes: number;
  completenessScore: number;
  projections: SnapshotMetricRecord;
  fairLines: Record<SnapshotMarket, number | null>;
  predictedSides: Record<SnapshotMarket, "OVER" | "UNDER" | "PUSH" | "NO_LINE">;
  actuals: SnapshotMetricRecord;
  actualSides: Record<SnapshotMarket, "OVER" | "UNDER" | "PUSH" | "NO_LINE">;
  sideCorrect: Record<SnapshotMarket, boolean | null>;
  historicalContext: HistoricalGameContext | null;
};

type MarketAggregate = {
  samples: number;
  absErrorSum: number;
  squaredErrorSum: number;
  errorSum: number;
  correctSide: number;
  wrongSide: number;
  pushes: number;
  overCalls: number;
  underCalls: number;
};

type SbrDailyGameRow = {
  gameId: number;
  awayCode: string;
  homeCode: string;
};

const BR_TEAM_CODE: Record<string, string> = {
  BKN: "BRK",
  CHA: "CHO",
  PHX: "PHO",
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

const PERSON_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const SBR_BOOK_PRIORITY = ["draftkings", "fanduel", "betmgm", "caesars", "bet365", "fanatics"];

const sbrDailyCache = new Map<string, Promise<SbrDailyGameRow[]>>();
const sbrMatchupCache = new Map<number, Promise<HistoricalPregameOdds | null>>();
const nbaStarterCache = new Map<string, Promise<HistoricalStartingLineup | null>>();
const bRefStarterCache = new Map<string, Promise<HistoricalStartingLineup | null>>();
const sportsDataEventCache = new Map<string, Promise<SportsDataBettingEvent[]>>();
const sportsDataPropCache = new Map<string, Promise<unknown[]>>();
const rotowireHistoricalCache = new Map<string, Promise<HistoricalRotowireSnapshot | null>>();
const seasonVolumeCache = new Map<string, Promise<SeasonVolumeLog[]>>();

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let playerSearch = "";
  let from = "2025-10-01";
  let to = "2026-03-09";
  let out: string | null = null;
  let lineFile: string | null = null;
  let minActualMinutes = 15;

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
    if (token === "--out" && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if (token === "--line-file" && next) {
      lineFile = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--line-file=")) {
      lineFile = token.slice("--line-file=".length);
      continue;
    }
    if (token === "--min-actual-minutes" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        minActualMinutes = parsed;
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--min-actual-minutes=")) {
      const parsed = Number(token.slice("--min-actual-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        minActualMinutes = parsed;
      }
      continue;
    }
  }

  if (!playerSearch.trim()) {
    throw new Error("Missing required --player argument.");
  }

  return {
    playerSearch: playerSearch.trim(),
    from,
    to,
    out,
    lineFile,
    minActualMinutes,
  };
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

function normalizePersonName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !PERSON_SUFFIXES.has(token))
    .join(" ");
}

function parseCsvCells(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === '"') {
      if (inQuotes && row[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

async function loadHistoricalLineFileForPlayer(
  lineFile: string | null,
  player: Pick<LookupPlayer, "id" | "externalId" | "fullName">,
): Promise<Map<string, HistoricalPlayerPropLine>> {
  const result = new Map<string, HistoricalPlayerPropLine>();
  if (!lineFile) return result;

  const resolved = path.resolve(lineFile);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Line file not found: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, "utf8");
  const rows = raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (rows.length <= 1) return result;

  const header = parseCsvCells(rows[0]);
  const indexOf = (name: string) => header.findIndex((column) => column.toLowerCase() === name.toLowerCase());
  const idxDate = indexOf("gameDateEt");
  const idxMarket = indexOf("market");
  const idxLine = indexOf("line");
  const idxPlayerId = indexOf("playerId");
  const idxExternalId = indexOf("externalPlayerId");
  const idxPlayerName = indexOf("playerName");
  const idxOverPrice = indexOf("overPrice");
  const idxUnderPrice = indexOf("underPrice");
  const idxOverBook = indexOf("sportsbookOver");
  const idxUnderBook = indexOf("sportsbookUnder");

  for (const row of rows.slice(1)) {
    const cells = parseCsvCells(row);
    const gameDateEt = idxDate >= 0 ? cells[idxDate] ?? "" : "";
    const market = (idxMarket >= 0 ? cells[idxMarket] ?? "" : "").toUpperCase() as SnapshotMarket;
    const line = Number(idxLine >= 0 ? cells[idxLine] ?? "" : "");
    if (!gameDateEt || !SNAPSHOT_MARKETS.includes(market) || !Number.isFinite(line)) continue;

    const matchesPlayerId = idxPlayerId >= 0 && (cells[idxPlayerId] ?? "") === player.id;
    const matchesExternalId =
      idxExternalId >= 0 && player.externalId && (cells[idxExternalId] ?? "") === String(player.externalId);
    const matchesName =
      idxPlayerName >= 0 &&
      normalizePersonName(cells[idxPlayerName] ?? "") === normalizePersonName(player.fullName);
    if (!matchesPlayerId && !matchesExternalId && !matchesName) continue;

    const overBook = idxOverBook >= 0 ? cells[idxOverBook] ?? "" : "";
    const underBook = idxUnderBook >= 0 ? cells[idxUnderBook] ?? "" : "";
    const sportsbookCount = [overBook, underBook].filter(Boolean).length;

    result.set(`${gameDateEt}|${market}`, {
      source: "csv",
      market,
      line: round(line, 1),
      sportsbookCount: sportsbookCount > 0 ? sportsbookCount : 1,
      sportsbookIds: [],
      capturedAt: null,
      overPrice: idxOverPrice >= 0 && Number.isFinite(Number(cells[idxOverPrice] ?? "")) ? Number(cells[idxOverPrice]) : null,
      underPrice:
        idxUnderPrice >= 0 && Number.isFinite(Number(cells[idxUnderPrice] ?? "")) ? Number(cells[idxUnderPrice]) : null,
    });
  }

  return result;
}

function getSeasonStartDateEt(dateEt: string): string {
  const [yearText, monthText] = dateEt.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return dateEt;
  const seasonStartYear = month >= 9 ? year : year - 1;
  return `${seasonStartYear}-10-01`;
}

function seasonLabelFromDateEt(dateEt: string): string {
  const [yearText, monthText] = dateEt.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return dateEt;
  }
  const seasonStartYear = month >= 9 ? year : year - 1;
  const seasonEndYear = String(seasonStartYear + 1).slice(-2);
  return `${seasonStartYear}-${seasonEndYear}`;
}

function parseMinutes(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (/^\d+:\d+$/.test(trimmed)) {
    const [minutes, seconds] = trimmed.split(":").map((part) => Number(part));
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
      return Math.round((minutes + seconds / 60) * 100) / 100;
    }
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseGameDateEt(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

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

async function fetchJsonWithRetry<T>(url: string): Promise<T> {
  const delays = [0, 500, 1400, 3200];
  let lastError: Error | null = null;

  for (const delayMs of delays) {
    if (delayMs > 0) await sleep(delayMs);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Referer: "https://www.nba.com/",
          Origin: "https://www.nba.com",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status} for ${url}`);
        continue;
      }

      return (await response.json()) as T;
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

function expandCommentTables(html: string): string {
  return html.replace(/<!--([\s\S]*?)-->/g, (_match, inner: string) => (inner.includes("<table") ? inner : ""));
}

function canonicalToBrTeamCode(code: string | null): string | null {
  if (!code) return null;
  return BR_TEAM_CODE[code] ?? code;
}

function canonicalizeProviderTeamCode(code: string | null | undefined): string {
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

function orderedLines<T>(views: T[], getBook: (view: T) => string | null | undefined, getValue: (view: T) => number | null): number[] {
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
    const openingHomeSpread = medianNumber(orderedLines(spreadViews, (view) => view.sportsbook, (view) => view.openingLine?.homeSpread ?? null));
    const currentHomeSpread = medianNumber(orderedLines(spreadViews, (view) => view.sportsbook, (view) => view.currentLine?.homeSpread ?? null));
    const openingTotal = medianNumber(orderedLines(totalViews, (view) => view.sportsbook, (view) => view.openingLine?.total ?? null));
    const currentTotal = medianNumber(orderedLines(totalViews, (view) => view.sportsbook, (view) => view.currentLine?.total ?? null));

    const result: HistoricalPregameOdds = {
      source: "sportsbookreview",
      gameId,
      awayCode,
      homeCode,
      openingHomeSpread,
      currentHomeSpread,
      openingTotal,
      currentTotal,
      sportsbookCount: Math.max(spreadViews.length, totalViews.length),
    };
    return result;
  })();

  sbrMatchupCache.set(gameId, task);
  return task;
}

async function fetchHistoricalPregameOdds(dateEt: string, awayCode: string, homeCode: string): Promise<HistoricalPregameOdds | null> {
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

function parseBRefStarters(html: string, awayCode: string, homeCode: string): HistoricalStartingLineup | null {
  const expanded = expandCommentTables(html);
  const $ = load(expanded);
  const awayBrCode = canonicalToBrTeamCode(awayCode);
  const homeBrCode = canonicalToBrTeamCode(homeCode);
  if (!awayBrCode || !homeBrCode) return null;

  const parseTeam = (brCode: string) => {
    const names: string[] = [];
    $(`#box-${brCode}-game-basic tbody tr`).each((_, row) => {
      if (names.length >= 5) return false;
      const className = $(row).attr("class") ?? "";
      if (className.includes("thead")) return false;
      const name =
        $(row).find('th[data-stat="player"] a').first().text().trim() ||
        $(row).find('th[data-stat="player"]').first().text().trim();
      if (name) names.push(name);
      return undefined;
    });
    return names;
  };

  const awayStarters = parseTeam(awayBrCode);
  const homeStarters = parseTeam(homeBrCode);
  if (awayStarters.length < 5 || homeStarters.length < 5) return null;

  const result: HistoricalStartingLineup = {
    source: "basketball-reference",
    awayCode,
    homeCode,
    awayStarters,
    homeStarters,
    awayStarterExternalIds: [],
    homeStarterExternalIds: [],
  };
  return result;
}

type NbaCdnBoxscorePlayer = {
  personId?: number | string;
  starter?: string;
  name?: string;
  firstName?: string;
  familyName?: string;
};

type NbaCdnBoxscoreTeam = {
  teamTricode?: string;
  players?: NbaCdnBoxscorePlayer[];
};

type NbaCdnBoxscoreResponse = {
  game?: {
    awayTeam?: NbaCdnBoxscoreTeam;
    homeTeam?: NbaCdnBoxscoreTeam;
  };
};

function parseNbaCdnStartingLineup(
  payload: NbaCdnBoxscoreResponse,
  awayCode: string,
  homeCode: string,
): HistoricalStartingLineup | null {
  const awayTeam = payload.game?.awayTeam;
  const homeTeam = payload.game?.homeTeam;
  const awayTri = canonicalizeProviderTeamCode(awayTeam?.teamTricode);
  const homeTri = canonicalizeProviderTeamCode(homeTeam?.teamTricode);
  if (awayTri !== awayCode || homeTri !== homeCode) return null;

  const extract = (team: NbaCdnBoxscoreTeam | undefined) => {
    const players = Array.isArray(team?.players) ? team.players : [];
    const starters = players
      .filter((player) => player.starter === "1")
      .map((player) => ({
        name:
          player.name?.trim() ||
          `${player.firstName ?? ""} ${player.familyName ?? ""}`.trim(),
        externalId:
          player.personId == null || String(player.personId).trim() === ""
            ? null
            : String(player.personId).trim(),
      }));
    return {
      names: starters.map((player) => player.name).filter((name) => name.length > 0),
      externalIds: starters
        .map((player) => player.externalId)
        .filter((externalId): externalId is string => Boolean(externalId)),
    };
  };

  const away = extract(awayTeam);
  const home = extract(homeTeam);
  if (away.names.length < 5 || home.names.length < 5) return null;

  return {
    source: "nba-cdn",
    awayCode,
    homeCode,
    awayStarters: away.names,
    homeStarters: home.names,
    awayStarterExternalIds: away.externalIds,
    homeStarterExternalIds: home.externalIds,
  };
}

async function fetchNbaCdnStartingLineup(
  externalGameId: string,
  awayCode: string,
  homeCode: string,
): Promise<HistoricalStartingLineup | null> {
  const cacheKey = `${externalGameId}|${awayCode}|${homeCode}`;
  const cached = nbaStarterCache.get(cacheKey);
  if (cached) return cached;

  const task = (async () => {
    const payload = await fetchJsonWithRetry<NbaCdnBoxscoreResponse>(
      `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${encodeURIComponent(externalGameId)}.json`,
    );
    return parseNbaCdnStartingLineup(payload, awayCode, homeCode);
  })();

  nbaStarterCache.set(cacheKey, task);
  return task;
}

async function fetchHistoricalStartingLineup(
  externalGameId: string,
  dateEt: string,
  awayCode: string,
  homeCode: string,
): Promise<HistoricalStartingLineup | null> {
  const nbaLineup = await fetchNbaCdnStartingLineup(externalGameId, awayCode, homeCode).catch(() => null);
  if (nbaLineup) return nbaLineup;

  const homeBrCode = canonicalToBrTeamCode(homeCode);
  if (!homeBrCode) return null;
  const cacheKey = `${externalGameId}|${dateEt}|${awayCode}|${homeCode}`;
  const cached = bRefStarterCache.get(cacheKey);
  if (cached) return cached;

  const task = (async () => {
    await sleep(900);
    const yyyymmdd = dateEt.replace(/-/g, "");
    const url = `https://www.basketball-reference.com/boxscores/${yyyymmdd}0${homeBrCode}.html`;
    const html = await fetchTextWithRetry(url);
    return parseBRefStarters(html, awayCode, homeCode);
  })();

  bRefStarterCache.set(cacheKey, task);
  return task;
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

async function fetchSportsDataJsonWithRetry<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const apiKey = sportsDataApiKey();
  if (!apiKey) {
    throw new Error("SPORTS_DATA_IO_API_KEY is required for historical prop backtesting.");
  }

  const url = new URL(`https://api.sportsdata.io/v3/nba${path}`);
  url.searchParams.set("key", apiKey);
  Object.entries(query).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

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
        lastError = new Error(`SportsData request failed (${response.status}) for ${path}`);
        continue;
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`SportsData request failed for ${path}`);
    }
  }

  throw lastError ?? new Error(`SportsData request failed for ${path}`);
}

async function fetchSportsDataBettingEventsByDate(dateEt: string): Promise<SportsDataBettingEvent[]> {
  const cached = sportsDataEventCache.get(dateEt);
  if (cached) return cached;

  const task = (async () => {
    const payload = await fetchSportsDataJsonWithRetry<unknown[]>("/odds/json/BettingEventsByDate/" + encodeURIComponent(dateEt));
    return (Array.isArray(payload) ? payload : [])
      .map((row) => {
        const record = row as Record<string, unknown>;
        const gameId = record.GameID == null ? "" : String(record.GameID).trim();
        const awayCode = canonicalizeProviderTeamCode(typeof record.AwayTeam === "string" ? record.AwayTeam : null);
        const homeCode = canonicalizeProviderTeamCode(typeof record.HomeTeam === "string" ? record.HomeTeam : null);
        if (!gameId || !awayCode || !homeCode) return null;
        return { gameId, awayCode, homeCode };
      })
      .filter((row): row is SportsDataBettingEvent => Boolean(row));
  })();

  sportsDataEventCache.set(dateEt, task);
  return task;
}

async function fetchSportsDataPlayerPropsByGameId(gameId: string): Promise<unknown[]> {
  const cached = sportsDataPropCache.get(gameId);
  if (cached) return cached;

  const task = fetchSportsDataJsonWithRetry<unknown[]>(
    "/odds/json/BettingPlayerPropsByGameID/" + encodeURIComponent(gameId),
    { include: "unlisted" },
  ).then((payload) => (Array.isArray(payload) ? payload : []));

  sportsDataPropCache.set(gameId, task);
  return task;
}

function parseHistoricalPropSide(value: unknown): HistoricalPropSide | null {
  const numeric = Number(value);
  if (numeric === 3) return "OVER";
  if (numeric === 4) return "UNDER";
  return null;
}

function parseHistoricalPropLine(participant: string | null, value: unknown): number | null {
  const normalizedParticipant = (participant ?? "").replace(",", ".");
  const participantMatch = normalizedParticipant.match(/\b(?:over|under)\s+(\d+(?:\.\d+)?)\b/i);
  if (participantMatch?.[1]) {
    const parsed = Number(participantMatch[1]);
    if (Number.isFinite(parsed)) return parsed;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  return toHalfHookLineLocal(numericValue);
}

function stripOutcomeParticipantName(participant: string | null): string | null {
  if (!participant) return null;
  const stripped = participant
    .replace(/\b(?:over|under)\b/gi, " ")
    .replace(/[+-]?\d+(?:[.,]\d+)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = normalizePersonName(stripped);
  return normalized || null;
}

function resolveHistoricalPropTimestamp(record: Record<string, unknown>): string | null {
  const fields = ["Unlisted", "Updated", "Created"];
  for (const field of fields) {
    const value = typeof record[field] === "string" ? String(record[field]).trim() : "";
    if (value) return value;
  }
  return null;
}

function compareIsoMaybe(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

async function resolveHistoricalPlayerPropLine(input: {
  dateEt: string;
  awayCode: string;
  homeCode: string;
  playerName: string;
  market: SnapshotMarket;
  commenceTimeUtc: Date | null;
}): Promise<HistoricalPlayerPropLine | null> {
  const betTypeId = input.market === "PTS" ? 3 : null;
  if (betTypeId == null) return null;

  const events = await fetchSportsDataBettingEventsByDate(input.dateEt).catch(() => []);
  const event = events.find((row) => row.awayCode === input.awayCode && row.homeCode === input.homeCode);
  if (!event) return null;

  const props = await fetchSportsDataPlayerPropsByGameId(event.gameId).catch(() => []);
  const playerNameNormalized = normalizePersonName(input.playerName);
  const tipoffIso = input.commenceTimeUtc ? input.commenceTimeUtc.toISOString() : null;
  const graceIso = input.commenceTimeUtc ? new Date(input.commenceTimeUtc.getTime() + 10 * 60_000).toISOString() : null;

  const byBookLine = new Map<
    string,
    { sportsbookId: number | null; line: number; over: Record<string, unknown> | null; under: Record<string, unknown> | null; latestAt: string | null }
  >();

  props.forEach((row) => {
    const record = row as Record<string, unknown>;
    if (Number(record.BettingBetTypeID) !== betTypeId) return;
    const periodTypeId = Number(record.BettingPeriodTypeID);
    if (periodTypeId !== 0 && periodTypeId !== 1) return;
    const outcomes = Array.isArray(record.BettingOutcomes) ? (record.BettingOutcomes as Record<string, unknown>[]) : [];
    const marketPlayerName =
      typeof record.PlayerName === "string" && record.PlayerName.toLowerCase() !== "scrambled"
        ? normalizePersonName(record.PlayerName)
        : null;
    const matchesPlayer =
      marketPlayerName === playerNameNormalized ||
      outcomes.some((outcome) => {
        const participant = typeof outcome.Participant === "string" ? outcome.Participant : null;
        const inferred = stripOutcomeParticipantName(participant);
        return inferred === playerNameNormalized || normalizePersonName(participant ?? "") === playerNameNormalized;
      });
    if (!matchesPlayer) return;

    outcomes.forEach((outcome) => {
      const side = parseHistoricalPropSide(outcome.BettingOutcomeTypeID);
      if (!side) return;
      const line = parseHistoricalPropLine(typeof outcome.Participant === "string" ? outcome.Participant : null, outcome.Value);
      if (line == null) return;
      const sportsbookId = outcome.SportsBook && typeof outcome.SportsBook === "object"
        ? Number((outcome.SportsBook as Record<string, unknown>).SportsbookID)
        : Number(outcome.SportsbookID);
      const timestamp = resolveHistoricalPropTimestamp(outcome);
      if (tipoffIso && timestamp && compareIsoMaybe(timestamp, graceIso) > 0) {
        return;
      }
      const key = `${Number.isFinite(sportsbookId) ? sportsbookId : "na"}|${line.toFixed(1)}`;
      const entry = byBookLine.get(key) ?? { sportsbookId: Number.isFinite(sportsbookId) ? sportsbookId : null, line, over: null, under: null, latestAt: null };
      if (side === "OVER") entry.over = outcome;
      if (side === "UNDER") entry.under = outcome;
      const latestCandidate = [entry.latestAt, timestamp].sort(compareIsoMaybe).slice(-1)[0] ?? entry.latestAt;
      entry.latestAt = latestCandidate ?? entry.latestAt;
      byBookLine.set(key, entry);
    });
  });

  const latestByBook = new Map<number | null, { line: number; over: Record<string, unknown> | null; under: Record<string, unknown> | null; latestAt: string | null }>();
  byBookLine.forEach((entry) => {
    const existing = latestByBook.get(entry.sportsbookId ?? null);
    const entryHasPair = Boolean(entry.over && entry.under);
    const existingHasPair = Boolean(existing?.over && existing?.under);
    if (!existing) {
      latestByBook.set(entry.sportsbookId ?? null, entry);
      return;
    }
    if (entryHasPair && !existingHasPair) {
      latestByBook.set(entry.sportsbookId ?? null, entry);
      return;
    }
    if (compareIsoMaybe(entry.latestAt, existing.latestAt) >= 0) {
      latestByBook.set(entry.sportsbookId ?? null, entry);
    }
  });

  const selected = Array.from(latestByBook.values()).filter((entry) => entry.line != null);
  if (selected.length === 0) return null;

  const consensusLine = medianNumber(selected.map((entry) => entry.line));
  if (consensusLine == null) return null;

  const latestAt = selected
    .map((entry) => entry.latestAt)
    .filter((value): value is string => Boolean(value))
    .sort(compareIsoMaybe)
    .slice(-1)[0] ?? null;

  const overPrices = selected
    .map((entry) => Number(entry.over?.PayoutAmerican))
    .filter((value) => Number.isFinite(value));
  const underPrices = selected
    .map((entry) => Number(entry.under?.PayoutAmerican))
    .filter((value) => Number.isFinite(value));

  return {
    source: "sportsdata",
    market: input.market,
    line: consensusLine,
    sportsbookCount: selected.length,
    sportsbookIds: Array.from(
      new Set(
        Array.from(latestByBook.entries())
          .map(([sportsbookId]) => sportsbookId)
          .filter((value): value is number => value != null && Number.isFinite(value)),
      ),
    ),
    capturedAt: latestAt,
    overPrice: medianNumber(overPrices),
    underPrice: medianNumber(underPrices),
  };
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
  return clamp(parsed, 0, 100);
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
      };
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

async function fetchHistoricalRotowireSnapshot(dateEt: string): Promise<HistoricalRotowireSnapshot | null> {
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

    const snapshot: HistoricalRotowireSnapshot = {
      source: "rotowire",
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      dateEt,
      pageDateLabel,
      teams,
    };
    return snapshot;
  })();

  rotowireHistoricalCache.set(dateEt, task);
  return task;
}

function getHistoricalRotowireTeamSignal(
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

function computeRotowireTeammateLineupLoad(input: {
  teamId: string | null;
  dateEt: string;
  excludePlayerId: string;
  logsByPlayerId: Map<string, PlayerLog[]>;
  playerMetaById: Map<string, PlayerMeta>;
  teamSignal: HistoricalRotowireTeamSignal;
}): HistoricalTeammateCoreContext {
  const profiles = buildTeamProfiles(input.teamId, input.dateEt, input.excludePlayerId, input.logsByPlayerId, input.playerMetaById)
    .filter((profile) => (profile.minutesLast10Avg ?? 0) >= 12)
    .slice(0, 4);
  const starterNames = new Set(input.teamSignal.starters.map((name) => normalizePersonName(name)));
  const unavailable = new Map(
    input.teamSignal.unavailablePlayers.map((player) => [
      normalizePersonName(player.playerName),
      unavailableStatusWeight(player.status, player.percentPlay),
    ]),
  );

  let missingPts = 0;
  let benchedPts = 0;
  let activePts = 0;
  let activeAst = 0;
  let activeStarterCount = 0;
  let availableCoreCount = 0;
  let missingCoreCount = 0;

  profiles.forEach((profile) => {
    const meta = input.playerMetaById.get(profile.playerId);
    const normalizedName = normalizePersonName(meta?.fullName ?? "");
    const pts = profile.ptsLast10Avg ?? 0;
    if (!normalizedName || pts <= 0) return;

    const unavailableWeight = unavailable.get(normalizedName);
    if (unavailableWeight != null && unavailableWeight >= 0.35) {
      missingPts += pts * unavailableWeight;
      missingCoreCount += 1;
      return;
    }

    availableCoreCount += 1;
    activePts += pts;
    activeAst += profile.astLast10Avg ?? 0;

    if (starterNames.size > 0 && starterNames.has(normalizedName)) {
      activeStarterCount += 1;
    } else if (starterNames.size > 0 && (profile.starterRateLast10 ?? 0) >= 0.55) {
      benchedPts += pts * 0.32 * lineupStatusWeight(input.teamSignal.status);
    }
  });

  const baseContinuity = profiles.length === 0 ? null : activeStarterCount / profiles.length;
  return {
    missingPts: round(missingPts, 2),
    benchedPts: round(benchedPts, 2),
    activePts: round(activePts, 2),
    activeAst: round(activeAst, 2),
    activeStarterCount,
    availableCoreCount,
    missingCoreCount,
    continuityScore:
      baseContinuity == null
        ? 0
        : round(baseContinuity * 4 + (availableCoreCount / Math.max(1, profiles.length)) * 2, 2),
  };
}

function mergeHistoricalLineupContexts(
  primary: HistoricalTeammateCoreContext | null,
  secondary: HistoricalTeammateCoreContext,
  primaryWeight: number,
): HistoricalTeammateCoreContext {
  if (!primary) return secondary;
  const secondaryWeight = 1 - clamp(primaryWeight, 0, 1);
  const weight = clamp(primaryWeight, 0, 1);
  return {
    missingPts: round(primary.missingPts * weight + secondary.missingPts * secondaryWeight, 2),
    benchedPts: round(primary.benchedPts * weight + secondary.benchedPts * secondaryWeight, 2),
    activePts: round(primary.activePts * weight + secondary.activePts * secondaryWeight, 2),
    activeAst: round(primary.activeAst * weight + secondary.activeAst * secondaryWeight, 2),
    activeStarterCount: Math.round(primary.activeStarterCount * weight + secondary.activeStarterCount * secondaryWeight),
    availableCoreCount: Math.round(primary.availableCoreCount * weight + secondary.availableCoreCount * secondaryWeight),
    missingCoreCount: Math.round(primary.missingCoreCount * weight + secondary.missingCoreCount * secondaryWeight),
    continuityScore: round(primary.continuityScore * weight + secondary.continuityScore * secondaryWeight, 2),
  };
}

async function fetchSeasonVolumeLogs(seasonLabel: string): Promise<SeasonVolumeLog[]> {
  const cached = seasonVolumeCache.get(seasonLabel);
  if (cached) return cached;

  const task = (async () => {
    const url =
      `https://stats.nba.com/stats/leaguegamelog?Counter=0&Direction=DESC&LeagueID=00&PlayerOrTeam=P&Season=${encodeURIComponent(
        seasonLabel,
      )}&SeasonType=Regular%20Season&Sorter=DATE`;
    const payload = await fetchJsonWithRetry<{
      resultSets?: Array<{ headers?: string[]; rowSet?: unknown[][] }>;
    }>(url);
    const primary = Array.isArray(payload.resultSets) ? payload.resultSets[0] : null;
    const headers = Array.isArray(primary?.headers) ? primary.headers.map((value) => String(value)) : [];
    const rowSet = Array.isArray(primary?.rowSet) ? primary.rowSet : [];
    if (headers.length === 0) return [];

    const indexOf = (name: string) => headers.indexOf(name);
    const idxPlayerId = indexOf("PLAYER_ID");
    const idxGameId = indexOf("GAME_ID");
    const idxGameDate = indexOf("GAME_DATE");
    const idxTeamAbbr = indexOf("TEAM_ABBREVIATION");
    const idxMatchup = indexOf("MATCHUP");
    const idxMinutes = indexOf("MIN");
    const idxFgm = indexOf("FGM");
    const idxFga = indexOf("FGA");
    const idxFg3m = indexOf("FG3M");
    const idxFg3a = indexOf("FG3A");
    const idxFtm = indexOf("FTM");
    const idxFta = indexOf("FTA");
    const idxPts = indexOf("PTS");

    return rowSet
      .map((entry) => {
        if (!Array.isArray(entry)) return null;
        const externalGameId = String(entry[idxGameId] ?? "").trim();
        const playerExternalId = String(entry[idxPlayerId] ?? "").trim();
        const teamCode = canonicalizeProviderTeamCode(String(entry[idxTeamAbbr] ?? ""));
        const gameDateEt = parseGameDateEt(String(entry[idxGameDate] ?? ""));
        if (!externalGameId || !playerExternalId || !teamCode || !gameDateEt) return null;
        const matchup = idxMatchup >= 0 ? String(entry[idxMatchup] ?? "").trim() : "";
        const matchupMatch = matchup.match(/^([A-Z]{2,3})\s+(vs\.|@)\s+([A-Z]{2,3})$/i);
        const isHome = matchupMatch ? matchupMatch[2].toLowerCase() !== "@" : null;
        const opponentCode = matchupMatch ? canonicalizeProviderTeamCode(matchupMatch[3]) : null;
        const row: SeasonVolumeLog = {
          playerExternalId,
          externalGameId,
          gameDateEt,
          teamCode,
          opponentCode,
          isHome,
          starter: null,
          minutes: parseMinutes(entry[idxMinutes]),
          fgm: idxFgm >= 0 ? toStat(entry[idxFgm] as number | null) : 0,
          fga: idxFga >= 0 ? toStat(entry[idxFga] as number | null) : 0,
          fg3m: idxFg3m >= 0 ? toStat(entry[idxFg3m] as number | null) : 0,
          fg3a: idxFg3a >= 0 ? toStat(entry[idxFg3a] as number | null) : 0,
          ftm: idxFtm >= 0 ? toStat(entry[idxFtm] as number | null) : 0,
          fta: idxFta >= 0 ? toStat(entry[idxFta] as number | null) : 0,
          points: idxPts >= 0 ? toStat(entry[idxPts] as number | null) : 0,
        };
        return row;
      })
      .filter((row): row is SeasonVolumeLog => row != null)
      .filter((row) => row.minutes > 0 && isRegularSeasonGameId(row.externalGameId));
  })();

  seasonVolumeCache.set(seasonLabel, task);
  return task;
}

function resolveOpponentShotVolumeMetrics(input: {
  opponentCode: string | null;
  dateEt: string;
  playerPosTokens: Set<PositionToken>;
  seasonVolumeLogs: SeasonVolumeLog[];
  gamesByTeamCode: Map<string, Array<{ gameDateEt: string; externalId: string }>>;
  playerMetaByExternalId: Map<string, PlayerMeta>;
}): OpponentShotVolumeMetrics {
  if (!input.opponentCode) {
    return {
      fga: null,
      fg3a: null,
      fta: null,
      fgaPerMinute: null,
      fg3aPerMinute: null,
      ftaPerMinute: null,
      threeShare: null,
      freeThrowPressure: null,
      sample: 0,
    };
  }

  const recentOpponentGameIds = (input.gamesByTeamCode.get(input.opponentCode) ?? [])
    .filter((game) => game.gameDateEt < input.dateEt)
    .slice(-10)
    .map((game) => game.externalId);
  if (recentOpponentGameIds.length === 0) {
    return {
      fga: null,
      fg3a: null,
      fta: null,
      fgaPerMinute: null,
      fg3aPerMinute: null,
      ftaPerMinute: null,
      threeShare: null,
      freeThrowPressure: null,
      sample: 0,
    };
  }

  const matching = input.seasonVolumeLogs.filter((log) => {
    if (log.opponentCode !== input.opponentCode) return false;
    if (!recentOpponentGameIds.includes(log.externalGameId)) return false;
    const meta = input.playerMetaByExternalId.get(log.playerExternalId);
    return isCompatibleDefender(input.playerPosTokens, positionTokens(meta?.position ?? null));
  });
  if (matching.length === 0) {
    return {
      fga: null,
      fg3a: null,
      fta: null,
      fgaPerMinute: null,
      fg3aPerMinute: null,
      ftaPerMinute: null,
      threeShare: null,
      freeThrowPressure: null,
      sample: 0,
    };
  }

  const fga = average(matching.map((log) => log.fga));
  const fg3a = average(matching.map((log) => log.fg3a));
  const fta = average(matching.map((log) => log.fta));
  const fgaPerMinute = average(matching.filter((log) => log.minutes > 0).map((log) => log.fga / log.minutes));
  const fg3aPerMinute = average(matching.filter((log) => log.minutes > 0).map((log) => log.fg3a / log.minutes));
  const ftaPerMinute = average(matching.filter((log) => log.minutes > 0).map((log) => log.fta / log.minutes));
  const threeShare =
    fgaPerMinute == null || fgaPerMinute <= 0 || fg3aPerMinute == null ? null : round(clamp(fg3aPerMinute / fgaPerMinute, 0, 0.95), 4);
  const freeThrowPressure =
    fgaPerMinute == null || fgaPerMinute <= 0 || ftaPerMinute == null ? null : round(clamp(ftaPerMinute / fgaPerMinute, 0, 1.6), 4);

  return {
    fga,
    fg3a,
    fta,
    fgaPerMinute,
    fg3aPerMinute,
    ftaPerMinute,
    threeShare,
    freeThrowPressure,
    sample: matching.length,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
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

function toStat(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildGameParticipantsByTeam(regularLogs: PlayerLog[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  regularLogs.forEach((log) => {
    if (!log.teamId) return;
    const key = `${log.externalGameId}|${log.teamId}`;
    const set = result.get(key) ?? new Set<string>();
    set.add(log.playerId);
    result.set(key, set);
  });
  return result;
}

function buildGameStartersByTeam(regularLogs: PlayerLog[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  regularLogs.forEach((log) => {
    if (!log.teamId || log.starter !== true) return;
    const key = `${log.externalGameId}|${log.teamId}`;
    const set = result.get(key) ?? new Set<string>();
    set.add(log.playerId);
    result.set(key, set);
  });
  return result;
}

function getStarterNamesForTeam(lineup: HistoricalStartingLineup | null, teamCode: string | null): string[] {
  if (!lineup || !teamCode) return [];
  if (lineup.awayCode === teamCode) return lineup.awayStarters;
  if (lineup.homeCode === teamCode) return lineup.homeStarters;
  return [];
}

function resolveStarterIds(
  starterNames: string[],
  participantIds: Set<string> | null,
  playerMetaById: Map<string, PlayerMeta>,
): Set<string> {
  if (!participantIds || starterNames.length === 0) return new Set<string>();
  const byName = new Map<string, string>();
  participantIds.forEach((playerId) => {
    const fullName = playerMetaById.get(playerId)?.fullName;
    const normalized = normalizePersonName(fullName ?? "");
    if (normalized) byName.set(normalized, playerId);
  });

  const result = new Set<string>();
  starterNames.forEach((name) => {
    const playerId = byName.get(normalizePersonName(name));
    if (playerId) result.add(playerId);
  });
  return result;
}

function resolveStarterIdsFromExternalIds(
  starterExternalIds: string[],
  participantIds: Set<string> | null,
  playerMetaById: Map<string, PlayerMeta>,
): Set<string> {
  if (starterExternalIds.length === 0) return new Set<string>();

  const buildExternalMap = (restrictToParticipants: boolean) => {
    const map = new Map<string, string>();
    playerMetaById.forEach((meta, playerId) => {
      if (!meta.externalId) return;
      if (restrictToParticipants && participantIds && !participantIds.has(playerId)) return;
      map.set(meta.externalId, playerId);
    });
    return map;
  };

  const restrictedMap = buildExternalMap(true);
  const resolved = new Set<string>();
  starterExternalIds.forEach((externalId) => {
    const playerId = restrictedMap.get(externalId);
    if (playerId) resolved.add(playerId);
  });
  if (resolved.size > 0 || !participantIds || participantIds.size === 0) {
    return resolved;
  }

  const globalMap = buildExternalMap(false);
  starterExternalIds.forEach((externalId) => {
    const playerId = globalMap.get(externalId);
    if (playerId) resolved.add(playerId);
  });
  return resolved;
}

function getStarterExternalIdsForTeam(lineup: HistoricalStartingLineup | null, teamCode: string | null): string[] {
  if (!lineup || !teamCode) return [];
  if (lineup.awayCode === teamCode) return lineup.awayStarterExternalIds;
  if (lineup.homeCode === teamCode) return lineup.homeStarterExternalIds;
  return [];
}

async function fetchPlayerVolumeLogs(seasonLabel: string, playerExternalId: string | null): Promise<PlayerVolumeLog[]> {
  if (!playerExternalId) return [];

  const url =
    `https://stats.nba.com/stats/leaguegamelog?Counter=0&Direction=DESC&LeagueID=00&PlayerOrTeam=P&Season=${encodeURIComponent(
      seasonLabel,
    )}&SeasonType=Regular%20Season&Sorter=DATE`;
  const retryDelays = [0, 500, 1500, 3500];
  let payload: unknown = null;

  for (const delay of retryDelays) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

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

    if (response.ok) {
      payload = (await response.json()) as unknown;
      break;
    }

    if (![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`NBA Stats request failed (${response.status}) for season ${seasonLabel}`);
    }
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as Record<string, unknown>;
  const resultSets = Array.isArray(root.resultSets) ? root.resultSets : [];
  const primary =
    resultSets.length > 0 && resultSets[0] && typeof resultSets[0] === "object"
      ? (resultSets[0] as Record<string, unknown>)
      : null;
  const headers = Array.isArray(primary?.headers) ? primary.headers.map((value) => String(value)) : [];
  const rows = Array.isArray(primary?.rowSet) ? primary.rowSet : [];
  if (headers.length === 0) {
    return [];
  }

  const indexOf = (name: string): number => headers.indexOf(name);
  const idxPlayerId = indexOf("PLAYER_ID");
  const idxGameId = indexOf("GAME_ID");
  const idxGameDate = indexOf("GAME_DATE");
  const idxMatchup = indexOf("MATCHUP");
  const idxMinutes = indexOf("MIN");
  const idxFgm = indexOf("FGM");
  const idxFga = indexOf("FGA");
  const idxFg3m = indexOf("FG3M");
  const idxFg3a = indexOf("FG3A");
  const idxFtm = indexOf("FTM");
  const idxFta = indexOf("FTA");
  const idxPts = indexOf("PTS");
  const idxStartPos = indexOf("START_POSITION");

  return rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .filter((row) => String(row[idxPlayerId] ?? "").trim() === playerExternalId)
    .map((row) => {
      const matchup = String(row[idxMatchup] ?? "").trim();
      const matchupMatch = matchup.match(/^([A-Z]{2,3})\s+(vs\.|@)\s+([A-Z]{2,3})$/i);
      const gameDateEt = parseGameDateEt(String(row[idxGameDate] ?? "").trim());
      return {
        externalGameId: String(row[idxGameId] ?? "").trim(),
        gameDateEt: gameDateEt ?? "",
        isHome: matchupMatch ? matchupMatch[2].toLowerCase() !== "@" : null,
        starter: idxStartPos >= 0 ? Boolean(String(row[idxStartPos] ?? "").trim()) : null,
        minutes: parseMinutes(row[idxMinutes]),
        fgm: toStat(typeof row[idxFgm] === "number" ? row[idxFgm] : Number(row[idxFgm] ?? 0)),
        fga: toStat(typeof row[idxFga] === "number" ? row[idxFga] : Number(row[idxFga] ?? 0)),
        fg3m: toStat(typeof row[idxFg3m] === "number" ? row[idxFg3m] : Number(row[idxFg3m] ?? 0)),
        fg3a: toStat(typeof row[idxFg3a] === "number" ? row[idxFg3a] : Number(row[idxFg3a] ?? 0)),
        ftm: toStat(typeof row[idxFtm] === "number" ? row[idxFtm] : Number(row[idxFtm] ?? 0)),
        fta: toStat(typeof row[idxFta] === "number" ? row[idxFta] : Number(row[idxFta] ?? 0)),
        points: toStat(typeof row[idxPts] === "number" ? row[idxPts] : Number(row[idxPts] ?? 0)),
      } satisfies PlayerVolumeLog;
    })
    .filter((row) => row.externalGameId && row.gameDateEt)
    .sort((left, right) => {
      if (left.gameDateEt !== right.gameDateEt) return left.gameDateEt.localeCompare(right.gameDateEt);
      return left.externalGameId.localeCompare(right.externalGameId);
    });
}

function blankMetricRecord(): SnapshotMetricRecord {
  return {
    PTS: null,
    REB: null,
    AST: null,
    THREES: null,
    PRA: null,
    PA: null,
    PR: null,
    RA: null,
  };
}

function metricsFromBase(points: number, rebounds: number, assists: number, threes: number): SnapshotMetricRecord {
  return {
    PTS: points,
    REB: rebounds,
    AST: assists,
    THREES: threes,
    PRA: points + rebounds + assists,
    PA: points + assists,
    PR: points + rebounds,
    RA: rebounds + assists,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function standardDeviation(values: number[]): number | null {
  const avg = average(values);
  if (avg == null || values.length === 0) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
  return round(Math.sqrt(variance), 2);
}

function averagesByMarket(logs: SnapshotStatLog[]): SnapshotMetricRecord {
  return {
    PTS: average(logs.map((log) => log.points)),
    REB: average(logs.map((log) => log.rebounds)),
    AST: average(logs.map((log) => log.assists)),
    THREES: average(logs.map((log) => log.threes)),
    PRA: average(logs.map((log) => log.points + log.rebounds + log.assists)),
    PA: average(logs.map((log) => log.points + log.assists)),
    PR: average(logs.map((log) => log.points + log.rebounds)),
    RA: average(logs.map((log) => log.rebounds + log.assists)),
  };
}

function arraysByMarket(logs: SnapshotStatLog[]): Record<SnapshotMarket, number[]> {
  return {
    PTS: logs.map((log) => log.points),
    REB: logs.map((log) => log.rebounds),
    AST: logs.map((log) => log.assists),
    THREES: logs.map((log) => log.threes),
    PRA: logs.map((log) => log.points + log.rebounds + log.assists),
    PA: logs.map((log) => log.points + log.assists),
    PR: logs.map((log) => log.points + log.rebounds),
    RA: logs.map((log) => log.rebounds + log.assists),
  };
}

function deltaFromLeague(teamAverage: SnapshotMetricRecord, leagueAverage: SnapshotMetricRecord): SnapshotMetricRecord {
  const result = blankMetricRecord();
  SNAPSHOT_MARKETS.forEach((market) => {
    const teamValue = teamAverage[market];
    const leagueValue = leagueAverage[market];
    result[market] = teamValue == null || leagueValue == null ? null : round(teamValue - leagueValue, 2);
  });
  return result;
}

function weightedBlend(parts: Array<{ value: number | null; weight: number }>): number | null {
  let weightedTotal = 0;
  let totalWeight = 0;
  parts.forEach((part) => {
    if (part.value == null || !Number.isFinite(part.value) || part.weight <= 0) return;
    weightedTotal += part.value * part.weight;
    totalWeight += part.weight;
  });
  if (totalWeight <= 0) return null;
  return round(weightedTotal / totalWeight, 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return round((sorted[middle - 1] + sorted[middle]) / 2, 2);
  }
  return round(sorted[middle], 2);
}

function toHalfHookLineLocal(value: number): number {
  const base = Math.floor(value);
  const lower = Math.max(0.5, base + 0.5);
  const upper = lower + 1;
  return round(Math.abs(value - lower) <= Math.abs(upper - value) ? lower : upper, 1);
}

function isRegularSeasonGameId(externalGameId: string): boolean {
  return externalGameId.startsWith("002");
}

function daysBetweenEt(fromEt: string, toEt: string): number | null {
  const from = new Date(`${fromEt}T00:00:00Z`).getTime();
  const to = new Date(`${toEt}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function positionTokens(position: string | null): Set<PositionToken> {
  const value = (position ?? "").toUpperCase();
  const tokens = new Set<PositionToken>();
  if (value.includes("G")) tokens.add("G");
  if (value.includes("F")) tokens.add("F");
  if (value.includes("C")) tokens.add("C");
  return tokens;
}

function isCompatibleDefender(offense: Set<PositionToken>, defense: Set<PositionToken>): boolean {
  if (offense.size === 0 || defense.size === 0) return true;
  if (offense.has("C")) return defense.has("C") || defense.has("F");
  if (offense.has("G")) return defense.has("G") || defense.has("F");
  return defense.has("F") || defense.has("G") || defense.has("C");
}

function computeStarterRate(logs: PlayerLog[]): number | null {
  const recent = logs.slice(-10);
  if (recent.length === 0) return null;
  const starts = recent.reduce((sum, log) => sum + (log.starter === true ? 1 : 0), 0);
  return round(starts / recent.length, 2);
}

function computeStocksPer36(logs: PlayerLog[]): number | null {
  const recent = logs.slice(-10);
  const minutes = average(recent.map((log) => log.minutes));
  if (minutes == null || minutes <= 0) return null;
  const stocks = average(recent.map((log) => log.steals + log.blocks));
  if (stocks == null) return null;
  return round((stocks / minutes) * 36, 2);
}

function recentGameLoad(priorLogs: PlayerLog[], targetDateEt: string): { restDays: number | null; gamesIn4Days: number } {
  const latest = priorLogs.slice(-1)[0];
  const restDays = latest ? daysBetweenEt(latest.gameDateEt, targetDateEt) : null;
  const recent = priorLogs.filter((log) => {
    const delta = daysBetweenEt(log.gameDateEt, targetDateEt);
    return delta != null && delta >= 1 && delta <= 4;
  });
  return {
    restDays,
    gamesIn4Days: recent.length,
  };
}

function trimmedPointsPerMinute(logs: PlayerLog[], expectedMinutes: number | null): number | null {
  const seasonMinutes = average(logs.map((log) => log.minutes)) ?? expectedMinutes ?? 0;
  const pointsMedian = median(logs.map((log) => log.points)) ?? average(logs.map((log) => log.points)) ?? 0;
  const pointsStd = standardDeviation(logs.map((log) => log.points)) ?? 0;

  const values = logs
    .map((log, index) => {
      if (log.minutes <= 0) return null;
      const ppm = log.points / log.minutes;
      const minutesPenalty = expectedMinutes == null ? 1 : Math.exp(-Math.abs(log.minutes - expectedMinutes) / 8);
      const lowMinutesPenalty = seasonMinutes <= 0 ? 1 : clamp(log.minutes / Math.max(12, seasonMinutes), 0.35, 1.15);
      const outlierPenalty =
        pointsStd <= 0 ? 1 : clamp(1 - Math.abs(log.points - pointsMedian) / Math.max(8, pointsStd * 3), 0.35, 1);
      const recencyWeight = 1 + Math.max(0, logs.length - index) * 0.015;
      return {
        value: ppm,
        weight: minutesPenalty * lowMinutesPenalty * outlierPenalty * recencyWeight,
      };
    })
    .filter((item): item is { value: number; weight: number } => item != null);

  return weightedBlend(values.map((item) => ({ value: item.value, weight: item.weight })));
}

function similarMinutesPoints(logs: PlayerLog[], expectedMinutes: number | null): { medianPts: number | null; ppm: number | null; sample: number } {
  if (expectedMinutes == null) {
    return {
      medianPts: median(logs.map((log) => log.points)),
      ppm: trimmedPointsPerMinute(logs, null),
      sample: logs.length,
    };
  }

  const near = logs
    .map((log, index) => ({
      log,
      score: Math.abs(log.minutes - expectedMinutes) + index * 0.12,
    }))
    .sort((left, right) => left.score - right.score)
    .slice(0, 18)
    .map((entry) => entry.log);

  return {
    medianPts: median(near.map((log) => log.points)),
    ppm: trimmedPointsPerMinute(near, expectedMinutes),
    sample: near.length,
  };
}

function weightedAttemptRate(
  logs: PlayerVolumeLog[],
  expectedMinutes: number | null,
  selector: (log: PlayerVolumeLog) => number,
): number | null {
  const values = logs
    .map((log, index) => {
      if (log.minutes <= 0) return null;
      const attempts = selector(log);
      const rate = attempts / log.minutes;
      const minutesPenalty = expectedMinutes == null ? 1 : Math.exp(-Math.abs(log.minutes - expectedMinutes) / 8);
      const recencyWeight = 1 + Math.max(0, logs.length - index) * 0.018;
      const attemptWeight = clamp(attempts / 6, 0.35, 1.2);
      return {
        value: rate,
        weight: minutesPenalty * recencyWeight * attemptWeight,
      };
    })
    .filter((item): item is { value: number; weight: number } => item != null);

  return weightedBlend(values);
}

function stablePointsLogs(logs: PlayerLog[], expectedMinutes: number | null): PlayerLog[] {
  if (logs.length <= 6) return logs;
  const targetMinutes = expectedMinutes ?? average(logs.map((log) => log.minutes)) ?? 0;
  const pointsMedian = median(logs.map((log) => log.points)) ?? 0;
  const pointsStd = standardDeviation(logs.map((log) => log.points)) ?? 0;

  const filtered = logs.filter((log) => {
    const minutePenalty =
      targetMinutes <= 0 ? false : log.minutes < Math.max(10, targetMinutes * 0.52) || log.minutes > targetMinutes * 1.45;
    const pointsPenalty =
      pointsStd <= 0 ? false : Math.abs(log.points - pointsMedian) > Math.max(12, pointsStd * 2.35);
    return !(minutePenalty && pointsPenalty);
  });

  return filtered.length >= Math.max(5, Math.floor(logs.length * 0.65)) ? filtered : logs;
}

function stableVolumeLogs(logs: PlayerVolumeLog[], expectedMinutes: number | null): PlayerVolumeLog[] {
  if (logs.length <= 6) return logs;
  const targetMinutes = expectedMinutes ?? average(logs.map((log) => log.minutes)) ?? 0;
  const fgaMedian = median(logs.map((log) => log.fga)) ?? 0;
  const fgaStd = standardDeviation(logs.map((log) => log.fga)) ?? 0;

  const filtered = logs.filter((log) => {
    const minutePenalty =
      targetMinutes <= 0 ? false : log.minutes < Math.max(10, targetMinutes * 0.52) || log.minutes > targetMinutes * 1.45;
    const attemptPenalty = fgaStd <= 0 ? false : Math.abs(log.fga - fgaMedian) > Math.max(6, fgaStd * 2.5);
    return !(minutePenalty && attemptPenalty);
  });

  return filtered.length >= Math.max(5, Math.floor(logs.length * 0.65)) ? filtered : logs;
}

function summarizeShotPressure(input: {
  last3Logs: PlayerVolumeLog[];
  last10Logs: PlayerVolumeLog[];
  seasonLogs: PlayerVolumeLog[];
  homeAwayLogs: PlayerVolumeLog[];
  sameTeamLogs: PlayerVolumeLog[];
  expectedMinutes: number | null;
}): ShotPressureSummary {
  const expectedMinutes = input.expectedMinutes;
  const groups = {
    last3: stableVolumeLogs(input.last3Logs, expectedMinutes),
    last10: stableVolumeLogs(input.last10Logs, expectedMinutes),
    season: stableVolumeLogs(input.seasonLogs, expectedMinutes),
    homeAway: stableVolumeLogs(input.homeAwayLogs, expectedMinutes),
    sameTeam: stableVolumeLogs(input.sameTeamLogs, expectedMinutes),
  };

  const blendRate = (selector: (log: PlayerVolumeLog) => number) =>
    weightedBlend([
      { value: weightedAttemptRate(groups.last3, expectedMinutes, selector), weight: 0.18 },
      { value: weightedAttemptRate(groups.last10, expectedMinutes, selector), weight: 0.3 },
      { value: weightedAttemptRate(groups.season, expectedMinutes, selector), weight: 0.24 },
      { value: weightedAttemptRate(groups.homeAway, expectedMinutes, selector), weight: 0.1 },
      { value: weightedAttemptRate(groups.sameTeam, expectedMinutes, selector), weight: 0.18 },
    ]);

  const fgaRate = blendRate((log) => log.fga);
  const fg3aRate = blendRate((log) => log.fg3a);
  const ftaRate = blendRate((log) => log.fta);
  const threeShare = fgaRate == null || fgaRate <= 0 || fg3aRate == null ? null : round(clamp(fg3aRate / fgaRate, 0, 0.9), 4);
  const rimRate = fgaRate == null || fg3aRate == null ? null : round(Math.max(0, fgaRate - fg3aRate), 4);
  const freeThrowPressure =
    fgaRate == null || fgaRate <= 0 || ftaRate == null ? null : round(clamp(ftaRate / fgaRate, 0, 1.5), 4);
  const aggression = fgaRate == null || ftaRate == null ? null : round(fgaRate + ftaRate * 0.44, 4);
  const shotPressureIndex =
    aggression == null
      ? null
      : round(
          aggression * (1 - (threeShare ?? 0.32) * 0.25) +
            (freeThrowPressure ?? 0.22) * 0.42 +
            (rimRate ?? 0.34) * 0.55,
          4,
        );

  return {
    fgaRate,
    fg3aRate,
    ftaRate,
    threeShare,
    rimRate,
    freeThrowPressure,
    aggression,
    shotPressureIndex,
  };
}

function weightedPercentage(
  logs: PlayerVolumeLog[],
  madeSelector: (log: PlayerVolumeLog) => number,
  attemptSelector: (log: PlayerVolumeLog) => number,
): number | null {
  let weightedMade = 0;
  let weightedAttempts = 0;

  logs.forEach((log, index) => {
    const attempts = attemptSelector(log);
    if (attempts <= 0) return;
    const made = madeSelector(log);
    const recencyWeight = 1 + Math.max(0, logs.length - index) * 0.018;
    const weight = attempts * recencyWeight;
    weightedMade += made * recencyWeight;
    weightedAttempts += weight;
  });

  if (weightedAttempts <= 0) return null;
  return round(weightedMade / weightedAttempts, 4);
}

function weightedAttemptsProjection(
  logs: {
    last3: PlayerVolumeLog[];
    last10: PlayerVolumeLog[];
    season: PlayerVolumeLog[];
    homeAway: PlayerVolumeLog[];
    sameTeam: PlayerVolumeLog[];
  },
  expectedMinutes: number | null,
  selector: (log: PlayerVolumeLog) => number,
): number | null {
  if (expectedMinutes == null) return null;
  const rate =
    weightedBlend([
      { value: weightedAttemptRate(logs.last3, expectedMinutes, selector), weight: 0.2 },
      { value: weightedAttemptRate(logs.last10, expectedMinutes, selector), weight: 0.28 },
      { value: weightedAttemptRate(logs.season, expectedMinutes, selector), weight: 0.22 },
      { value: weightedAttemptRate(logs.homeAway, expectedMinutes, selector), weight: 0.12 },
      { value: weightedAttemptRate(logs.sameTeam, expectedMinutes, selector), weight: 0.18 },
    ]) ?? null;
  return rate == null ? null : round(rate * expectedMinutes, 2);
}

function buildVolumePointsProjection(input: {
  priorLogs: PlayerVolumeLog[];
  last3Logs: PlayerVolumeLog[];
  last10Logs: PlayerVolumeLog[];
  homeAwayLogs: PlayerVolumeLog[];
  sameTeamLogs: PlayerVolumeLog[];
  expectedMinutes: number | null;
  unavailableTeammatePts: number;
  expectedGameTotalProxy: number | null;
  expectedSpreadProxy: number | null;
  opponentAllowancePts: number | null;
  opponentShotVolume: OpponentShotVolumeMetrics | null;
  seasonAveragePts: number | null;
}): number | null {
  const expectedMinutes = input.expectedMinutes;
  if (expectedMinutes == null || input.priorLogs.length === 0) return null;

  const last3FgaRate = weightedAttemptRate(input.last3Logs, expectedMinutes, (log) => log.fga);
  const last10FgaRate = weightedAttemptRate(input.last10Logs, expectedMinutes, (log) => log.fga);
  const last3FtaRate = weightedAttemptRate(input.last3Logs, expectedMinutes, (log) => log.fta);
  const last10FtaRate = weightedAttemptRate(input.last10Logs, expectedMinutes, (log) => log.fta);

  const projectedFga = weightedAttemptsProjection(
    {
      last3: input.last3Logs,
      last10: input.last10Logs,
      season: input.priorLogs,
      homeAway: input.homeAwayLogs,
      sameTeam: input.sameTeamLogs,
    },
    expectedMinutes,
    (log) => log.fga,
  );
  const projectedFg3a = weightedAttemptsProjection(
    {
      last3: input.last3Logs,
      last10: input.last10Logs,
      season: input.priorLogs,
      homeAway: input.homeAwayLogs,
      sameTeam: input.sameTeamLogs,
    },
    expectedMinutes,
    (log) => log.fg3a,
  );
  const projectedFta = weightedAttemptsProjection(
    {
      last3: input.last3Logs,
      last10: input.last10Logs,
      season: input.priorLogs,
      homeAway: input.homeAwayLogs,
      sameTeam: input.sameTeamLogs,
    },
    expectedMinutes,
    (log) => log.fta,
  );

  if (projectedFga == null || projectedFg3a == null || projectedFta == null) {
    return null;
  }

  let fga = projectedFga;
  let fg3a = clamp(projectedFg3a, 0, projectedFga * 0.92);
  let fta = projectedFta;

  if (last3FgaRate != null && last10FgaRate != null) {
    fga *= 1 + clamp((last3FgaRate - last10FgaRate) * 2.2, -0.05, 0.09);
  }
  if (last3FtaRate != null && last10FtaRate != null) {
    fta *= 1 + clamp((last3FtaRate - last10FtaRate) * 2.8, -0.04, 0.08);
  }

  if (input.unavailableTeammatePts > 0) {
    const usageLift = clamp(input.unavailableTeammatePts * 0.009, 0, 0.12);
    fga *= 1 + usageLift;
    fta *= 1 + usageLift * 0.65;
  }

  if (input.expectedGameTotalProxy != null) {
    const envLift = clamp((input.expectedGameTotalProxy - 228) * 0.0035, -0.05, 0.05);
    fga *= 1 + envLift;
    fta *= 1 + envLift * 0.8;
  }

  if (input.expectedSpreadProxy != null) {
    const blowoutPenalty = clamp((Math.abs(input.expectedSpreadProxy) - 6) * 0.012, 0, 0.05);
    fga *= 1 - blowoutPenalty;
    fta *= 1 - blowoutPenalty * 0.75;
  }

  if (input.opponentAllowancePts != null && input.seasonAveragePts != null) {
    const allowanceFactor = clamp((input.opponentAllowancePts - input.seasonAveragePts) * 0.004, -0.04, 0.04);
    fga *= 1 + allowanceFactor;
  }

  if (input.opponentShotVolume?.fgaPerMinute != null && last10FgaRate != null) {
    const fgaFactor = clamp((input.opponentShotVolume.fgaPerMinute - last10FgaRate) * 2.6, -0.08, 0.11);
    fga *= 1 + fgaFactor;
  }
  if (input.opponentShotVolume?.ftaPerMinute != null && last10FtaRate != null) {
    const ftaFactor = clamp((input.opponentShotVolume.ftaPerMinute - last10FtaRate) * 3.2, -0.08, 0.12);
    fta *= 1 + ftaFactor;
  }
  if (input.opponentShotVolume?.threeShare != null && fga > 0) {
    const projectedThreeShare = clamp(fg3a / Math.max(1, fga), 0, 0.9);
    const shareFactor = clamp((input.opponentShotVolume.threeShare - projectedThreeShare) * 0.85, -0.08, 0.08);
    const adjustedFg3a = fg3a * (1 + shareFactor);
    fg3a = clamp(adjustedFg3a, 0, fga * 0.92);
  }

  const twoPointPct =
    weightedBlend([
      {
        value: weightedPercentage(input.last3Logs, (log) => log.fgm - log.fg3m, (log) => Math.max(0, log.fga - log.fg3a)),
        weight: 0.18,
      },
      {
        value: weightedPercentage(input.last10Logs, (log) => log.fgm - log.fg3m, (log) => Math.max(0, log.fga - log.fg3a)),
        weight: 0.32,
      },
      {
        value: weightedPercentage(input.priorLogs, (log) => log.fgm - log.fg3m, (log) => Math.max(0, log.fga - log.fg3a)),
        weight: 0.28,
      },
      {
        value: weightedPercentage(input.homeAwayLogs, (log) => log.fgm - log.fg3m, (log) => Math.max(0, log.fga - log.fg3a)),
        weight: 0.1,
      },
      {
        value: weightedPercentage(input.sameTeamLogs, (log) => log.fgm - log.fg3m, (log) => Math.max(0, log.fga - log.fg3a)),
        weight: 0.12,
      },
    ]) ?? 0.53;
  const threePointPct =
    weightedBlend([
      { value: weightedPercentage(input.last3Logs, (log) => log.fg3m, (log) => log.fg3a), weight: 0.18 },
      { value: weightedPercentage(input.last10Logs, (log) => log.fg3m, (log) => log.fg3a), weight: 0.32 },
      { value: weightedPercentage(input.priorLogs, (log) => log.fg3m, (log) => log.fg3a), weight: 0.3 },
      { value: weightedPercentage(input.homeAwayLogs, (log) => log.fg3m, (log) => log.fg3a), weight: 0.08 },
      { value: weightedPercentage(input.sameTeamLogs, (log) => log.fg3m, (log) => log.fg3a), weight: 0.12 },
    ]) ?? 0.34;
  const freeThrowPct =
    weightedBlend([
      { value: weightedPercentage(input.last3Logs, (log) => log.ftm, (log) => log.fta), weight: 0.14 },
      { value: weightedPercentage(input.last10Logs, (log) => log.ftm, (log) => log.fta), weight: 0.32 },
      { value: weightedPercentage(input.priorLogs, (log) => log.ftm, (log) => log.fta), weight: 0.34 },
      { value: weightedPercentage(input.sameTeamLogs, (log) => log.ftm, (log) => log.fta), weight: 0.2 },
    ]) ?? 0.78;

  const twoPointAttempts = Math.max(0, fga - fg3a);
  const points = twoPointAttempts * clamp(twoPointPct, 0.34, 0.78) * 2 + fg3a * clamp(threePointPct, 0.2, 0.55) * 3 + fta * clamp(freeThrowPct, 0.45, 0.95);
  return round(Math.max(0, points), 2);
}

function buildTeamProfiles(
  teamId: string | null,
  dateEt: string,
  excludePlayerId: string | null,
  logsByPlayerId: Map<string, PlayerLog[]>,
  playerMetaById: Map<string, PlayerMeta>,
): PlayerProfile[] {
  if (!teamId) return [];
  const profiles: PlayerProfile[] = [];

  logsByPlayerId.forEach((logs, playerId) => {
    const priorTeamLogs = logs.filter((log) => log.gameDateEt < dateEt && log.teamId === teamId);
    if (priorTeamLogs.length === 0) return;
    if (excludePlayerId && playerId === excludePlayerId) return;
    const last10 = priorTeamLogs.slice(-10);
    const meta = playerMetaById.get(playerId);
    profiles.push({
      playerId,
      position: meta?.position ?? null,
      positionTokens: positionTokens(meta?.position ?? null),
      minutesLast10Avg: average(last10.map((log) => log.minutes)),
      ptsLast10Avg: average(last10.map((log) => log.points)),
      astLast10Avg: average(last10.map((log) => log.assists)),
      starterRateLast10: computeStarterRate(priorTeamLogs),
      stocksPer36Last10: computeStocksPer36(priorTeamLogs),
    });
  });

  profiles.sort((left, right) => {
    const minuteDiff = (right.minutesLast10Avg ?? 0) - (left.minutesLast10Avg ?? 0);
    if (minuteDiff !== 0) return minuteDiff;
    return (right.ptsLast10Avg ?? 0) - (left.ptsLast10Avg ?? 0);
  });

  return profiles;
}

function computeTeammateUnavailablePtsLoad(
  teamId: string | null,
  dateEt: string,
  excludePlayerId: string,
  logsByPlayerId: Map<string, PlayerLog[]>,
  playerMetaById: Map<string, PlayerMeta>,
): number {
  const profiles = buildTeamProfiles(teamId, dateEt, excludePlayerId, logsByPlayerId, playerMetaById).slice(0, 3);
  let unavailablePtsLoad = 0;

  profiles.forEach((profile) => {
    const recent = (logsByPlayerId.get(profile.playerId) ?? [])
      .filter((log) => log.gameDateEt < dateEt && log.teamId === teamId)
      .slice(-2);
    if (recent.length === 0) return;
    const latest = recent[recent.length - 1];
    const missedLatest = latest.played === false || latest.minutes <= 0;
    const missedTwoStraight = recent.length >= 2 && recent.every((log) => log.played === false || log.minutes <= 0);

    if (missedTwoStraight) {
      unavailablePtsLoad += (profile.ptsLast10Avg ?? 0) * 1.05;
      return;
    }
    if (missedLatest) {
      unavailablePtsLoad += (profile.ptsLast10Avg ?? 0) * 0.62;
    }
  });

  return round(unavailablePtsLoad, 2);
}

function computeHistoricalTeammateLineupLoad(input: {
  teamId: string | null;
  dateEt: string;
  externalGameId: string;
  excludePlayerId: string;
  logsByPlayerId: Map<string, PlayerLog[]>;
  playerMetaById: Map<string, PlayerMeta>;
  participantIds: Set<string> | null;
  starterIds: Set<string>;
}): HistoricalTeammateCoreContext {
  const profiles = buildTeamProfiles(input.teamId, input.dateEt, input.excludePlayerId, input.logsByPlayerId, input.playerMetaById)
    .filter((profile) => (profile.minutesLast10Avg ?? 0) >= 12)
    .slice(0, 4);

  let missingPts = 0;
  let benchedPts = 0;
  let activePts = 0;
  let activeAst = 0;
  let activeStarterCount = 0;
  let availableCoreCount = 0;
  let missingCoreCount = 0;

  profiles.forEach((profile) => {
    const pts = profile.ptsLast10Avg ?? 0;
    if (pts <= 0) return;

    const participantIds = input.participantIds;
    if (!participantIds || !participantIds.has(profile.playerId)) {
      const multiplier = (profile.starterRateLast10 ?? 0) >= 0.55 ? 1 : 0.78;
      missingPts += pts * multiplier;
      missingCoreCount += 1;
      return;
    }

    availableCoreCount += 1;
    activePts += pts;
    activeAst += profile.astLast10Avg ?? 0;
    if (input.starterIds.has(profile.playerId)) {
      activeStarterCount += 1;
    }

    if (input.starterIds.size > 0 && (profile.starterRateLast10 ?? 0) >= 0.55 && !input.starterIds.has(profile.playerId)) {
      benchedPts += pts * 0.28;
    }
  });

  const continuityBase = profiles.length === 0 ? null : activeStarterCount / profiles.length;

  return {
    missingPts: round(missingPts, 2),
    benchedPts: round(benchedPts, 2),
    activePts: round(activePts, 2),
    activeAst: round(activeAst, 2),
    activeStarterCount,
    availableCoreCount,
    missingCoreCount,
    continuityScore: continuityBase == null ? 0 : round(continuityBase * 4 + (availableCoreCount / Math.max(1, profiles.length)) * 2, 2),
  };
}

function choosePrimaryDefenderStocks(
  playerPosition: string | null,
  opponentTeamId: string | null,
  dateEt: string,
  logsByPlayerId: Map<string, PlayerLog[]>,
  playerMetaById: Map<string, PlayerMeta>,
): number | null {
  const targetTokens = positionTokens(playerPosition);
  const profiles = buildTeamProfiles(opponentTeamId, dateEt, null, logsByPlayerId, playerMetaById)
    .filter((profile) => isCompatibleDefender(targetTokens, profile.positionTokens))
    .filter((profile) => (profile.minutesLast10Avg ?? 0) >= 8);
  return profiles[0]?.stocksPer36Last10 ?? null;
}

function chooseHistoricalPrimaryDefenderStocks(input: {
  playerPosition: string | null;
  opponentTeamId: string | null;
  dateEt: string;
  logsByPlayerId: Map<string, PlayerLog[]>;
  playerMetaById: Map<string, PlayerMeta>;
  participantIds: Set<string> | null;
  starterIds: Set<string>;
}): number | null {
  if (!input.opponentTeamId || input.starterIds.size === 0) return null;
  const targetTokens = positionTokens(input.playerPosition);
  const starterProfiles = buildTeamProfiles(input.opponentTeamId, input.dateEt, null, input.logsByPlayerId, input.playerMetaById)
    .filter((profile) => input.starterIds.has(profile.playerId))
    .filter((profile) => isCompatibleDefender(targetTokens, profile.positionTokens))
    .filter((profile) => (profile.minutesLast10Avg ?? 0) >= 8);
  return starterProfiles[0]?.stocksPer36Last10 ?? null;
}

function buildTeamPointsByGameTeam(regularLogs: PlayerLog[]): Map<string, number> {
  const result = new Map<string, number>();
  regularLogs.forEach((log) => {
    if (!log.teamId) return;
    const key = `${log.externalGameId}|${log.teamId}`;
    result.set(key, (result.get(key) ?? 0) + log.points);
  });
  return result;
}

function buildTeamMargins(
  regularLogs: PlayerLog[],
  gameByExternalId: Map<string, { gameDateEt: string; homeTeamId: string; awayTeamId: string }>,
): Map<string, TeamMargin[]> {
  const teamPointsByGameTeam = buildTeamPointsByGameTeam(regularLogs);

  const result = new Map<string, TeamMargin[]>();
  teamPointsByGameTeam.forEach((teamPoints, key) => {
    const [externalGameId, teamId] = key.split("|");
    const game = gameByExternalId.get(externalGameId);
    if (!game) return;
    const opponentTeamId = game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId;
    const opponentPoints = teamPointsByGameTeam.get(`${externalGameId}|${opponentTeamId}`) ?? null;
    const margin = opponentPoints == null ? null : teamPoints - opponentPoints;
    const list = result.get(teamId) ?? [];
    list.push({
      gameDateEt: game.gameDateEt,
      externalGameId,
      teamId,
      margin,
    });
    result.set(teamId, list);
  });

  result.forEach((items, teamId) => {
    items.sort((left, right) => {
      if (left.gameDateEt !== right.gameDateEt) return left.gameDateEt.localeCompare(right.gameDateEt);
      return left.externalGameId.localeCompare(right.externalGameId);
    });
    result.set(teamId, items);
  });

  return result;
}

function buildTeamEnvironments(
  regularLogs: PlayerLog[],
  gameByExternalId: Map<string, { gameDateEt: string; homeTeamId: string; awayTeamId: string }>,
): Map<string, TeamEnvironment[]> {
  const teamPointsByGameTeam = buildTeamPointsByGameTeam(regularLogs);

  const result = new Map<string, TeamEnvironment[]>();
  teamPointsByGameTeam.forEach((teamPoints, key) => {
    const [externalGameId, teamId] = key.split("|");
    const game = gameByExternalId.get(externalGameId);
    if (!game) return;
    const opponentTeamId = game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId;
    const opponentPoints = teamPointsByGameTeam.get(`${externalGameId}|${opponentTeamId}`) ?? null;
    const margin = opponentPoints == null ? null : teamPoints - opponentPoints;
    const total = opponentPoints == null ? null : teamPoints + opponentPoints;
    const list = result.get(teamId) ?? [];
    list.push({
      gameDateEt: game.gameDateEt,
      externalGameId,
      teamId,
      teamPoints,
      opponentPoints,
      total,
      margin,
    });
    result.set(teamId, list);
  });

  result.forEach((items, teamId) => {
    items.sort((left, right) => {
      if (left.gameDateEt !== right.gameDateEt) return left.gameDateEt.localeCompare(right.gameDateEt);
      return left.externalGameId.localeCompare(right.externalGameId);
    });
    result.set(teamId, items);
  });

  return result;
}

function expectedMatchupEnvironment(
  teamId: string | null,
  opponentTeamId: string | null,
  dateEt: string,
  teamEnvironmentsByTeamId: Map<string, TeamEnvironment[]>,
): { totalProxy: number | null; spreadProxy: number | null } {
  const teamRecent = teamId
    ? (teamEnvironmentsByTeamId.get(teamId) ?? []).filter((item) => item.gameDateEt < dateEt).slice(-10)
    : [];
  const opponentRecent = opponentTeamId
    ? (teamEnvironmentsByTeamId.get(opponentTeamId) ?? []).filter((item) => item.gameDateEt < dateEt).slice(-10)
    : [];

  const totalProxy = weightedBlend([
    { value: average(teamRecent.map((item) => item.total).filter((value): value is number => value != null)), weight: 0.55 },
    { value: average(opponentRecent.map((item) => item.total).filter((value): value is number => value != null)), weight: 0.45 },
  ]);
  const teamMarginAvg = average(teamRecent.map((item) => item.margin).filter((value): value is number => value != null));
  const opponentMarginAvg = average(
    opponentRecent.map((item) => item.margin).filter((value): value is number => value != null),
  );
  const spreadProxy =
    teamMarginAvg == null && opponentMarginAvg == null
      ? null
      : round(((teamMarginAvg ?? 0) - (opponentMarginAvg ?? 0)) * 0.5, 2);

  return {
    totalProxy: totalProxy == null ? null : round(totalProxy, 2),
    spreadProxy: spreadProxy == null ? null : round(spreadProxy, 2),
  };
}

function recentMarginRates(teamId: string | null, dateEt: string, teamMarginsByTeamId: Map<string, TeamMargin[]>): {
  closeRate10: number | null;
  blowoutRate10: number | null;
} {
  if (!teamId) return { closeRate10: null, blowoutRate10: null };
  const recent = (teamMarginsByTeamId.get(teamId) ?? [])
    .filter((item) => item.gameDateEt < dateEt && item.margin != null)
    .slice(-10);
  if (recent.length === 0) return { closeRate10: null, blowoutRate10: null };
  const closeGames = recent.filter((item) => Math.abs(item.margin ?? 0) <= 10).length;
  const blowouts = recent.filter((item) => Math.abs(item.margin ?? 0) >= 18).length;
  return {
    closeRate10: round(closeGames / recent.length, 2),
    blowoutRate10: round(blowouts / recent.length, 2),
  };
}

function resolvePositionAllowance(
  opponentTeamId: string | null,
  dateEt: string,
  playerPosTokens: Set<PositionToken>,
  regularLogs: PlayerLog[],
  gamesByTeamId: Map<string, Array<{ gameDateEt: string; externalId: string }>>,
  playerMetaById: Map<string, PlayerMeta>,
): number | null {
  if (!opponentTeamId) return null;
  const recentOpponentGameIds = (gamesByTeamId.get(opponentTeamId) ?? [])
    .filter((game) => game.gameDateEt < dateEt)
    .slice(-10)
    .map((game) => game.externalId);
  if (recentOpponentGameIds.length === 0) return null;

  const values = regularLogs
    .filter((log) => log.opponentTeamId === opponentTeamId && recentOpponentGameIds.includes(log.externalGameId))
    .filter((log) => isCompatibleDefender(playerPosTokens, positionTokens(playerMetaById.get(log.playerId)?.position ?? null)))
    .map((log) => log.points);

  return average(values);
}

function resolvePositionAllowanceMetrics(
  opponentTeamId: string | null,
  dateEt: string,
  playerPosTokens: Set<PositionToken>,
  regularLogs: PlayerLog[],
  gamesByTeamId: Map<string, Array<{ gameDateEt: string; externalId: string }>>,
  playerMetaById: Map<string, PlayerMeta>,
): PositionAllowanceMetrics {
  if (!opponentTeamId) return { pts: null, ast: null, reb: null, sample: 0 };
  const recentOpponentGameIds = (gamesByTeamId.get(opponentTeamId) ?? [])
    .filter((game) => game.gameDateEt < dateEt)
    .slice(-10)
    .map((game) => game.externalId);
  if (recentOpponentGameIds.length === 0) return { pts: null, ast: null, reb: null, sample: 0 };

  const matching = regularLogs
    .filter((log) => log.opponentTeamId === opponentTeamId && recentOpponentGameIds.includes(log.externalGameId))
    .filter((log) => isCompatibleDefender(playerPosTokens, positionTokens(playerMetaById.get(log.playerId)?.position ?? null)));

  return {
    pts: average(matching.map((log) => log.points)),
    ast: average(matching.map((log) => log.assists)),
    reb: average(matching.map((log) => log.rebounds)),
    sample: matching.length,
  };
}

function averagePlayerPointsShare(
  logs: PlayerLog[],
  teamPointsByGameTeam: Map<string, number>,
): number | null {
  const values = logs
    .map((log, index) => {
      if (!log.teamId) return null;
      const teamPoints = teamPointsByGameTeam.get(`${log.externalGameId}|${log.teamId}`);
      if (teamPoints == null || teamPoints <= 0) return null;
      return {
        value: log.points / teamPoints,
        weight: 1 + Math.max(0, logs.length - index) * 0.02,
      };
    })
    .filter((item): item is { value: number; weight: number } => item != null);
  return weightedBlend(values);
}

function getPtsRegime(currentTeamGames: number): PtsRegime {
  if (currentTeamGames < 18) return "EARLY";
  if (currentTeamGames < 55) return "MID";
  return "LATE";
}

function computePtsResidualAdjustment(
  current: Omit<PtsResidualCalibrationRow, "gameDateEt" | "actualPoints" | "lineAnchor">,
  priorRows: PtsResidualCalibrationRow[],
): number {
  if (priorRows.length < 6) return 0;

  const scored = priorRows
    .map((row, index) => {
      let weight = 1;
      if (row.regime === current.regime) weight *= 1.18;
      if (row.isHome === current.isHome) weight *= 1.08;
      if (row.expectedMinutes != null && current.expectedMinutes != null) {
        weight *= Math.exp(-Math.abs(row.expectedMinutes - current.expectedMinutes) / 4.8);
      }
      if (row.openingTotal != null && current.openingTotal != null) {
        weight *= Math.exp(-Math.abs(row.openingTotal - current.openingTotal) / 13);
      }
      if (row.openingSpread != null && current.openingSpread != null) {
        weight *= Math.exp(-Math.abs(row.openingSpread - current.openingSpread) / 5.5);
      }
      weight *= Math.exp(-Math.abs(row.unavailableTeammatePts - current.unavailableTeammatePts) / 15);
      weight *= Math.exp(-Math.abs(row.activeCorePts - current.activeCorePts) / 22);
      weight *= Math.exp(-Math.abs(row.activeCoreAst - current.activeCoreAst) / 9);
      if (row.continuityScore != null && current.continuityScore != null) {
        weight *= Math.exp(-Math.abs(row.continuityScore - current.continuityScore) / 1.6);
      }
      if (row.opponentPositionPts != null && current.opponentPositionPts != null) {
        weight *= Math.exp(-Math.abs(row.opponentPositionPts - current.opponentPositionPts) / 5.5);
      }
      if (row.opponentPositionAst != null && current.opponentPositionAst != null) {
        weight *= Math.exp(-Math.abs(row.opponentPositionAst - current.opponentPositionAst) / 2.8);
      }
      if (row.defenderStocksPer36 != null && current.defenderStocksPer36 != null) {
        weight *= Math.exp(-Math.abs(row.defenderStocksPer36 - current.defenderStocksPer36) / 1.4);
      }
      if (row.shotPressureIndex != null && current.shotPressureIndex != null) {
        weight *= Math.exp(-Math.abs(row.shotPressureIndex - current.shotPressureIndex) / 0.22);
      }
      if (row.threeShare != null && current.threeShare != null) {
        weight *= Math.exp(-Math.abs(row.threeShare - current.threeShare) / 0.1);
      }
      if (row.freeThrowPressure != null && current.freeThrowPressure != null) {
        weight *= Math.exp(-Math.abs(row.freeThrowPressure - current.freeThrowPressure) / 0.12);
      }
      const recencyBoost = 1 + (index / Math.max(1, priorRows.length)) * 0.65;
      weight *= recencyBoost;
      return {
        weight,
        residual: row.actualPoints - row.baselineProjection,
        sideHit: row.actualPoints > row.lineAnchor ? 1 : row.actualPoints < row.lineAnchor ? -1 : 0,
      };
    })
    .filter((entry) => entry.weight > 0.08)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 18);

  if (scored.length < 5) return 0;
  const totalWeight = scored.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return 0;

  const weightedResidual =
    scored.reduce((sum, entry) => sum + entry.residual * entry.weight, 0) / totalWeight;
  const residualMedian = median(scored.map((entry) => entry.residual)) ?? weightedResidual;
  const directional =
    scored.reduce((sum, entry) => sum + entry.sideHit * entry.weight, 0) / totalWeight;

  let adjustment = weightedResidual * 0.42 + residualMedian * 0.18;
  if (directional >= 0.22) adjustment += 0.42;
  if (directional <= -0.22) adjustment -= 0.42;
  if (scored.length < 8) adjustment *= 0.74;

  return round(clamp(adjustment, -2.8, 2.8), 2);
}

function computePtsDirectionalCalibration(
  current: Omit<PtsResidualCalibrationRow, "gameDateEt" | "actualPoints"> & { lineAnchor: number | null },
  priorRows: PtsResidualCalibrationRow[],
): { lean: number; sample: number } {
  if (current.lineAnchor == null || priorRows.length < 8) return { lean: 0, sample: 0 };

  const scored = priorRows
    .map((row, index) => {
      let weight = 1;
      if (row.regime === current.regime) weight *= 1.18;
      if (row.isHome === current.isHome) weight *= 1.06;
      if (row.expectedMinutes != null && current.expectedMinutes != null) {
        weight *= Math.exp(-Math.abs(row.expectedMinutes - current.expectedMinutes) / 4.8);
      }
      if (row.openingTotal != null && current.openingTotal != null) {
        weight *= Math.exp(-Math.abs(row.openingTotal - current.openingTotal) / 9);
      }
      if (row.openingSpread != null && current.openingSpread != null) {
        weight *= Math.exp(-Math.abs(row.openingSpread - current.openingSpread) / 4.2);
      }
      if (row.lineAnchor != null && current.lineAnchor != null) {
        weight *= Math.exp(-Math.abs(row.lineAnchor - current.lineAnchor) / 2.8);
      }
      weight *= Math.exp(-Math.abs(row.unavailableTeammatePts - current.unavailableTeammatePts) / 12);
      weight *= Math.exp(-Math.abs(row.activeCorePts - current.activeCorePts) / 15);
      weight *= Math.exp(-Math.abs(row.activeCoreAst - current.activeCoreAst) / 5.5);
      if (row.continuityScore != null && current.continuityScore != null) {
        weight *= Math.exp(-Math.abs(row.continuityScore - current.continuityScore) / 1.2);
      }
      if (row.opponentPositionPts != null && current.opponentPositionPts != null) {
        weight *= Math.exp(-Math.abs(row.opponentPositionPts - current.opponentPositionPts) / 4);
      }
      if (row.opponentPositionAst != null && current.opponentPositionAst != null) {
        weight *= Math.exp(-Math.abs(row.opponentPositionAst - current.opponentPositionAst) / 2.5);
      }
      if (row.defenderStocksPer36 != null && current.defenderStocksPer36 != null) {
        weight *= Math.exp(-Math.abs(row.defenderStocksPer36 - current.defenderStocksPer36) / 1.4);
      }
      if (row.shotPressureIndex != null && current.shotPressureIndex != null) {
        weight *= Math.exp(-Math.abs(row.shotPressureIndex - current.shotPressureIndex) / 0.2);
      }
      if (row.threeShare != null && current.threeShare != null) {
        weight *= Math.exp(-Math.abs(row.threeShare - current.threeShare) / 0.08);
      }
      if (row.freeThrowPressure != null && current.freeThrowPressure != null) {
        weight *= Math.exp(-Math.abs(row.freeThrowPressure - current.freeThrowPressure) / 0.1);
      }
      weight *= 1 + (index / Math.max(1, priorRows.length)) * 0.8;

      const actualSide = row.actualPoints > row.lineAnchor ? 1 : row.actualPoints < row.lineAnchor ? -1 : 0;
      const modelGap = row.baselineProjection - row.lineAnchor;
      return { weight, actualSide, modelGap };
    })
    .filter((entry) => entry.weight > 0.09 && entry.actualSide !== 0)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 18);

  if (scored.length < 6) return { lean: 0, sample: scored.length };
  const totalWeight = scored.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return { lean: 0, sample: scored.length };

  const weightedDirection = scored.reduce((sum, entry) => sum + entry.actualSide * entry.weight, 0) / totalWeight;
  const weightedGap = scored.reduce((sum, entry) => sum + entry.modelGap * entry.weight, 0) / totalWeight;
  const lean = clamp(weightedDirection * 1.4 + weightedGap * 0.12, -1.35, 1.35);
  return { lean: round(lean, 3), sample: scored.length };
}

function computeCompleteness(input: {
  last10Logs: SnapshotStatLog[];
  statusLast10: Array<{ starter: boolean | null; played: boolean | null }>;
  opponentAllowance: SnapshotMetricRecord;
  minutesVolatility: number | null;
}): SnapshotDataCompleteness {
  const sampleCoverage = Math.min(100, input.last10Logs.length * 10);
  const statusCoverage = Math.min(100, input.statusLast10.length * 10);
  const contextCoverage =
    input.opponentAllowance.PTS != null && input.opponentAllowance.REB != null && input.opponentAllowance.AST != null
      ? 90
      : 55;
  const stabilityCoverage =
    input.minutesVolatility == null ? 45 : Math.max(30, Math.min(100, Math.round(100 - input.minutesVolatility * 8)));
  const score = Math.round(sampleCoverage * 0.4 + statusCoverage * 0.2 + contextCoverage * 0.2 + stabilityCoverage * 0.2);
  const tier: SnapshotDataCompleteness["tier"] = score >= 80 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW";

  const issues: string[] = [];
  if (input.last10Logs.length < 10) issues.push("Limited last-10 completed game sample.");
  if (input.statusLast10.length < 10) issues.push("Starter status history is incomplete.");
  if (input.opponentAllowance.PTS == null) issues.push("Opponent allowance sample is thin.");
  if (input.minutesVolatility == null) issues.push("Minutes volatility sample is incomplete.");

  return {
    score,
    tier,
    issues,
    components: {
      sampleCoverage,
      statusCoverage,
      contextCoverage,
      stabilityCoverage,
    },
  };
}

function emptyAggregate(): MarketAggregate {
  return {
    samples: 0,
    absErrorSum: 0,
    squaredErrorSum: 0,
    errorSum: 0,
    correctSide: 0,
    wrongSide: 0,
    pushes: 0,
    overCalls: 0,
    underCalls: 0,
  };
}

function sideFromValue(value: number, line: number | null): "OVER" | "UNDER" | "PUSH" | "NO_LINE" {
  if (line == null || !Number.isFinite(line)) return "NO_LINE";
  if (value > line) return "OVER";
  if (value < line) return "UNDER";
  return "PUSH";
}

function applyJokicRebSideOverride(input: {
  playerName: string;
  projection: number | null;
  line: number | null;
  openingTeamSpread: number | null;
  openingTotal: number | null;
}): "OVER" | "UNDER" | "NEUTRAL" {
  if (normalizePersonName(input.playerName) !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null) return "NEUTRAL";

  const spread = input.openingTeamSpread ?? 0;
  const total = input.openingTotal ?? 0;
  const projection = input.projection;
  const projectionGap = projection - input.line;

  if (spread <= -5.25) {
    if (projection <= 13.1) {
      return spread <= -11 ? "OVER" : "UNDER";
    }
    return projection <= 13.275 ? "OVER" : "UNDER";
  }

  if (projectionGap <= 0.36) {
    return total <= 240.75 ? "OVER" : "UNDER";
  }

  return total <= 227.5 ? "OVER" : "UNDER";
}

function applyJokicAstSideOverride(input: {
  playerName: string;
  projection: number | null;
  line: number | null;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  overPrice: number | null;
  underPrice: number | null;
}): "OVER" | "UNDER" | "NEUTRAL" {
  if (normalizePersonName(input.playerName) !== "nikola jokic") return "NEUTRAL";
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

function applyJokicThreesSideOverride(input: {
  playerName: string;
  projection: number | null;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  openingTotal: number | null;
  projectedMinutes: number | null;
  completenessScore: number | null;
}): "OVER" | "UNDER" | "NEUTRAL" {
  if (normalizePersonName(input.playerName) !== "nikola jokic") return "NEUTRAL";
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

  const overProbability = americanOddsToProbability(input.overPrice);
  const underProbability = americanOddsToProbability(input.underPrice);
  const lean =
    overProbability == null || underProbability == null ? null : round(overProbability - underProbability, 4);

  if (input.line >= 2.5) {
    return "UNDER";
  }

  if (lean != null && lean >= 0.17) {
    return "UNDER";
  }

  return input.projection > input.line ? "OVER" : "UNDER";
}

function applyJokicPraSideOverride(input: {
  playerName: string;
  projection: number | null;
  line: number | null;
  projectedPoints: number | null;
  completenessScore: number | null;
}): "OVER" | "UNDER" | "NEUTRAL" {
  if (normalizePersonName(input.playerName) !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null) return "NEUTRAL";

  if (input.line <= 52) {
    if (input.completenessScore != null && input.completenessScore <= 90.5) return "UNDER";
    return "OVER";
  }

  if (input.projection <= 53.84) return "OVER";
  return "UNDER";
}

function applyJokicPaSideOverride(input: {
  playerName: string;
  projection: number | null;
  line: number | null;
  openingTotal: number | null;
  projectedPoints: number | null;
}): "OVER" | "UNDER" | "NEUTRAL" {
  if (normalizePersonName(input.playerName) !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null || input.projectedPoints == null) return "NEUTRAL";

  if (input.openingTotal != null && input.openingTotal <= 224.5) return "UNDER";
  if (input.projectedPoints <= 30.73) return "OVER";
  if (input.projectedPoints <= 31.97) return "UNDER";
  return "OVER";
}

function applyJokicPrSideOverride(input: {
  playerName: string;
  projection: number | null;
  line: number | null;
  openingTotal: number | null;
  projectedAssists: number | null;
}): "OVER" | "UNDER" | "NEUTRAL" {
  if (normalizePersonName(input.playerName) !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null || input.projectedAssists == null) return "NEUTRAL";

  if (input.projectedAssists <= 10.73) return "OVER";
  if (input.projectedAssists <= 11.06) return "UNDER";
  if (input.openingTotal != null && input.openingTotal <= 241.5) return "OVER";
  return "UNDER";
}

function applyJokicRaSideOverride(input: {
  playerName: string;
  projection: number | null;
  line: number | null;
  projectedRebounds: number | null;
  completenessScore: number | null;
  openingTotal: number | null;
}): "OVER" | "UNDER" | "NEUTRAL" {
  if (normalizePersonName(input.playerName) !== "nikola jokic") return "NEUTRAL";
  if (input.projection == null || input.line == null) return "NEUTRAL";

  if (input.line <= 23) {
    if (input.projectedRebounds != null && input.projectedRebounds <= 13.34) return "OVER";
    return "UNDER";
  }

  if (input.openingTotal != null && input.openingTotal <= 234) return "OVER";
  return "UNDER";
}

function americanOddsToProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function resolvePtsMarketSignal(input: {
  overPrice: number | null;
  underPrice: number | null;
}): PtsMarketSignal {
  const overProbability = americanOddsToProbability(input.overPrice);
  const underProbability = americanOddsToProbability(input.underPrice);
  if (overProbability == null || underProbability == null) {
    return {
      priceLean: null,
      favoredSide: "NEUTRAL",
    };
  }

  const lean = round(overProbability - underProbability, 4);
  return {
    priceLean: lean,
    favoredSide: lean > 0 ? "OVER" : lean < 0 ? "UNDER" : "NEUTRAL",
  };
}

function applyPtsMarketSideOverride(input: {
  sideDecision: PtsSideDecision;
  marketSignal: PtsMarketSignal;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  projection: number;
  line: number | null;
  minutesRisk: PtsMinutesRiskSummary;
}): PtsSideDecision {
  let side = input.sideDecision.side;
  let confidence = input.sideDecision.confidence;
  let overScore = input.sideDecision.overScore;
  let underScore = input.sideDecision.underScore;

  const priceLean = input.marketSignal.priceLean ?? 0;
  const marketStrong = Math.abs(priceLean) >= 0.0075 && input.marketSignal.favoredSide !== "NEUTRAL";

  if (marketStrong && input.marketSignal.favoredSide !== side) {
    side = input.marketSignal.favoredSide;
    confidence = round(clamp(confidence + Math.min(8, Math.abs(priceLean) * 240), 48, 90), 2);
    if (side === "OVER") {
      overScore = round(overScore + Math.abs(priceLean) * 16, 3);
      underScore = round(underScore - Math.abs(priceLean) * 10, 3);
    } else {
      underScore = round(underScore + Math.abs(priceLean) * 16, 3);
      overScore = round(overScore - Math.abs(priceLean) * 10, 3);
    }
  }

  if (side === "OVER" && input.openingTeamSpread != null && input.openingTeamSpread <= -5.5) {
    side = "UNDER";
    confidence = round(clamp(confidence + 2.5, 48, 90), 2);
    underScore = round(underScore + 0.8, 3);
    overScore = round(overScore - 0.8, 3);
  }

  if (
    side === "UNDER" &&
    input.openingTotal != null &&
    input.openingTotal >= 235 &&
    marketStrong &&
    input.marketSignal.favoredSide === "OVER"
  ) {
    side = "OVER";
    confidence = round(clamp(confidence + 1.5, 48, 90), 2);
    overScore = round(overScore + 0.45, 3);
    underScore = round(underScore - 0.45, 3);
  }

  if (input.line != null && input.minutesRisk.riskScore <= 0.2) {
    const projectionSide = input.projection > input.line ? "OVER" : input.projection < input.line ? "UNDER" : "NEUTRAL";
    if (projectionSide !== "NEUTRAL") {
      side = projectionSide;
      confidence = round(clamp(confidence + 1.5, 48, 90), 2);
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
    input.line != null &&
    input.openingTotal != null &&
    input.openingTotal >= 234 &&
    Math.abs(input.projection - input.line) <= 2 &&
    input.marketSignal.favoredSide !== "NEUTRAL"
  ) {
    side = input.marketSignal.favoredSide;
    confidence = round(clamp(confidence + 1.2, 48, 90), 2);
    if (side === "OVER") {
      overScore = round(overScore + 0.28, 3);
      underScore = round(underScore - 0.28, 3);
    } else {
      underScore = round(underScore + 0.28, 3);
      overScore = round(overScore - 0.28, 3);
    }
  }

  return {
    side,
    confidence,
    overScore,
    underScore,
    scoreGap: round(overScore - underScore, 3),
  };
}

function computeLineupTimingConfidence(teamSignal: HistoricalRotowireTeamSignal | null): number | null {
  if (!teamSignal) return null;
  let confidence = lineupStatusWeight(teamSignal.status);
  if (teamSignal.starters.length >= 5) confidence += 0.08;

  if (teamSignal.unavailablePlayers.length > 0) {
    const certaintyWeights = teamSignal.unavailablePlayers.map((player) =>
      unavailableStatusWeight(player.status, player.percentPlay),
    );
    const strongest = Math.max(...certaintyWeights);
    const averageWeight = average(certaintyWeights) ?? strongest;
    confidence += clamp(strongest * 0.12 + averageWeight * 0.08, 0, 0.18);
  }

  return round(clamp(confidence, 0.35, 1), 2);
}

function computePtsMinutesRisk(input: {
  expectedMinutes: number | null;
  last3Logs: PlayerLog[];
  last10Logs: PlayerLog[];
  homeAwayLogs: PlayerLog[];
  sameTeamLogs: PlayerLog[];
  starterRateLast10: number | null;
  lineupTimingConfidence: number | null;
  expectedSpreadProxy: number | null;
  blowoutRate10: number | null;
  closeRate10: number | null;
  restDays: number | null;
  gamesIn4Days: number;
}): PtsMinutesRiskSummary {
  const minutesLast10 = input.last10Logs.map((log) => log.minutes).filter((value) => value > 0);
  const minutesLast3 = input.last3Logs.map((log) => log.minutes).filter((value) => value > 0);
  const expectedMinutes =
    input.expectedMinutes ?? average(minutesLast10) ?? average(minutesLast3) ?? average(input.sameTeamLogs.map((log) => log.minutes));
  const minutesVolatility = standardDeviation(minutesLast10);
  const lowMinutesThreshold = expectedMinutes == null ? 22 : Math.max(18, expectedMinutes - 4);
  const lowMinutesRate =
    minutesLast10.length === 0
      ? 0
      : minutesLast10.filter((value) => value < lowMinutesThreshold).length / minutesLast10.length;
  const trendDelta =
    minutesLast3.length > 0 && minutesLast10.length > 0 ? (average(minutesLast3) ?? 0) - (average(minutesLast10) ?? 0) : null;
  const starterUncertainty =
    input.starterRateLast10 == null ? 0.12 : Math.abs(0.5 - input.starterRateLast10) < 0.18 ? 0.2 : 0.05;
  const lineupPenalty = input.lineupTimingConfidence == null ? 0.14 : 1 - input.lineupTimingConfidence;
  const blowoutRisk =
    clamp(Math.max(0, Math.abs(input.expectedSpreadProxy ?? 0) - 6) / 8, 0, 1) * 0.52 +
    clamp(input.blowoutRate10 ?? 0, 0, 1) * 0.36 -
    clamp(input.closeRate10 ?? 0, 0, 1) * 0.12;
  const fatigueRisk =
    (input.restDays === 1 ? 0.16 : 0) + (input.gamesIn4Days >= 3 ? 0.18 : 0) + (input.restDays != null && input.restDays >= 3 ? -0.05 : 0);
  const volatilityRisk =
    minutesVolatility == null ? 0.08 : clamp((minutesVolatility - 3.2) / 7.5, 0, 0.42);
  const trendRisk =
    trendDelta == null
      ? 0
      : trendDelta < -2.2
        ? clamp(Math.abs(trendDelta) / 8, 0, 0.32)
        : trendDelta > 1.8
          ? -clamp(trendDelta / 10, 0, 0.14)
          : 0;
  const stabilityScore = round(clamp(1 - (volatilityRisk + lowMinutesRate * 0.42 + starterUncertainty * 0.3), 0, 1), 3);
  const riskScore = round(
    clamp(lineupPenalty * 0.22 + blowoutRisk + fatigueRisk + volatilityRisk + lowMinutesRate * 0.45 + starterUncertainty + trendRisk, 0, 1),
    3,
  );

  return {
    riskScore,
    stabilityScore,
    volatility: minutesVolatility == null ? null : round(minutesVolatility, 2),
    lowMinutesRate: round(lowMinutesRate, 3),
    trendDelta: trendDelta == null ? null : round(trendDelta, 2),
    blowoutRisk: round(clamp(blowoutRisk, 0, 1), 3),
  };
}

function buildPtsSideDecision(input: {
  regime: PtsRegime;
  isHome: boolean | null;
  expectedMinutes: number | null;
  line: number | null;
  projection: number;
  baselineProjection: number;
  volumeProjection: number | null;
  teamShareProjection: number | null;
  shotPressure: ShotPressureSummary;
  minutesRisk: PtsMinutesRiskSummary;
  lineupTimingConfidence: number | null;
  expectedGameTotalProxy: number | null;
  expectedSpreadProxy: number | null;
  closeRate10: number | null;
  blowoutRate10: number | null;
  unavailableTeammatePts: number;
  activeCorePts: number;
  activeCoreAst: number;
  continuityScore: number | null;
  opponentPositionAllowance: number | null;
  opponentPositionAst: number | null;
  defenderStocksPer36: number | null;
  seasonAveragePts: number | null;
  opponentShotVolume: OpponentShotVolumeMetrics | null;
  recentResiduals: number[];
  residualCalibrationRows: PtsResidualCalibrationRow[];
}): PtsSideDecision {
  if (input.line == null || !Number.isFinite(input.line)) {
    return { side: "NEUTRAL", confidence: 50, overScore: 0, underScore: 0, scoreGap: 0 };
  }

  const gap = input.projection - input.line;
  const baselineGap = input.baselineProjection - input.line;
  const volumeGap = input.volumeProjection == null ? 0 : input.volumeProjection - input.line;
  const teamShareGap = input.teamShareProjection == null ? 0 : input.teamShareProjection - input.line;
  const recentResidual = average(input.recentResiduals.slice(-6)) ?? 0;
  const directionalCalibration = computePtsDirectionalCalibration(
    {
      regime: input.regime,
      isHome: input.isHome,
      expectedMinutes: input.expectedMinutes,
      openingTotal: input.expectedGameTotalProxy,
      openingSpread: input.expectedSpreadProxy,
      unavailableTeammatePts: input.unavailableTeammatePts,
      activeCorePts: input.activeCorePts,
      activeCoreAst: input.activeCoreAst,
      continuityScore: input.continuityScore,
      opponentPositionPts: input.opponentPositionAllowance,
      opponentPositionAst: input.opponentPositionAst,
      defenderStocksPer36: input.defenderStocksPer36,
      shotPressureIndex: input.shotPressure.shotPressureIndex,
      threeShare: input.shotPressure.threeShare,
      freeThrowPressure: input.shotPressure.freeThrowPressure,
      baselineProjection: input.baselineProjection,
      lineAnchor: input.line,
    },
    input.residualCalibrationRows,
  );

  let overScore = gap * 1.6 + baselineGap * 0.45 + volumeGap * 0.75 + teamShareGap * 0.28;
  let underScore = -gap * 1.45 + -baselineGap * 0.35 + -volumeGap * 0.55 + -teamShareGap * 0.2;

  overScore += clamp((1 - input.minutesRisk.riskScore) * 1.15 - 0.45, -0.25, 0.8);
  underScore += clamp(input.minutesRisk.riskScore * 1.3 - 0.35, -0.1, 1);

  if (input.expectedGameTotalProxy != null) {
    overScore += clamp((input.expectedGameTotalProxy - 229) * 0.04, -0.4, 0.8);
    underScore += clamp((229 - input.expectedGameTotalProxy) * 0.035, -0.35, 0.7);
  }

  if (input.expectedSpreadProxy != null) {
    const absSpread = Math.abs(input.expectedSpreadProxy);
    if (absSpread <= 4.5) {
      overScore += 0.42;
      underScore -= 0.08;
    }
    if (absSpread >= 7) {
      underScore += clamp((absSpread - 6.5) * 0.15, 0, 1);
      overScore -= clamp((absSpread - 6.5) * 0.14, 0, 0.95);
    }
    if (input.expectedSpreadProxy <= -7) {
      underScore += 0.38;
      overScore -= 0.34;
    }
  }

  if (input.unavailableTeammatePts > 0) {
    overScore += clamp(input.unavailableTeammatePts * 0.05, 0, 1.15);
  }
  if (input.activeCoreAst > 0) {
    underScore += clamp((input.activeCoreAst - 14) * 0.085, -0.15, 0.85);
  }
  if (input.activeCorePts > 0) {
    underScore += clamp((input.activeCorePts - 41) * 0.035, -0.1, 0.55);
  }
  if (input.continuityScore != null) {
    overScore += clamp((3.25 - input.continuityScore) * 0.22, -0.1, 0.55);
  }

  if (input.lineupTimingConfidence != null) {
    overScore += clamp((input.lineupTimingConfidence - 0.72) * 1.2, -0.35, 0.42);
    underScore += clamp((0.72 - input.lineupTimingConfidence) * 0.95, -0.2, 0.4);
  }

  if (input.shotPressure.shotPressureIndex != null) {
    overScore += clamp((input.shotPressure.shotPressureIndex - 0.92) * 2.8, -0.35, 0.9);
  }
  if (input.shotPressure.freeThrowPressure != null) {
    overScore += clamp((input.shotPressure.freeThrowPressure - 0.25) * 2.2, -0.25, 0.7);
  }
  if (input.shotPressure.threeShare != null) {
    underScore += clamp((input.shotPressure.threeShare - 0.26) * 0.85, -0.15, 0.3);
  }

  if (input.opponentPositionAllowance != null && input.seasonAveragePts != null) {
    const allowanceEdge = input.opponentPositionAllowance - input.seasonAveragePts;
    overScore += clamp(allowanceEdge * 0.15, -0.5, 0.95);
    underScore += clamp(-allowanceEdge * 0.12, -0.4, 0.8);
  }
  if (input.opponentShotVolume?.fgaPerMinute != null && input.shotPressure.fgaRate != null) {
    const fgaEdge = input.opponentShotVolume.fgaPerMinute - input.shotPressure.fgaRate;
    overScore += clamp(fgaEdge * 10.5, -0.55, 0.95);
    underScore += clamp(-fgaEdge * 8.2, -0.35, 0.75);
  }
  if (input.opponentShotVolume?.ftaPerMinute != null && input.shotPressure.ftaRate != null) {
    const ftaEdge = input.opponentShotVolume.ftaPerMinute - input.shotPressure.ftaRate;
    overScore += clamp(ftaEdge * 10.5, -0.45, 0.85);
    underScore += clamp(-ftaEdge * 7.2, -0.3, 0.65);
  }

  if (input.closeRate10 != null) {
    overScore += clamp((input.closeRate10 - 0.45) * 1.2, -0.25, 0.55);
  }
  if (input.blowoutRate10 != null) {
    underScore += clamp((input.blowoutRate10 - 0.2) * 1.3, -0.2, 0.65);
  }

  overScore += clamp(recentResidual * 0.12, -0.45, 0.55);
  underScore += clamp(-recentResidual * 0.1, -0.35, 0.5);
  overScore += clamp(directionalCalibration.lean, -1.1, 1.1);
  underScore += clamp(-directionalCalibration.lean, -1.1, 1.1);

  const scoreGap = round(overScore - underScore, 3);
  const side = scoreGap > 0.04 ? "OVER" : scoreGap < -0.04 ? "UNDER" : gap >= 0 ? "OVER" : "UNDER";
  const confidenceBase = Math.abs(scoreGap) * 7.5 + Math.abs(gap) * 3.2 + directionalCalibration.sample * 0.18;
  const confidenceSupport =
    (input.lineupTimingConfidence ?? 0.62) * 6 + (1 - input.minutesRisk.riskScore) * 7 + input.minutesRisk.stabilityScore * 5;
  const confidence = round(clamp(48 + confidenceBase + confidenceSupport, 48, 88), 2);

  return {
    side,
    confidence,
    overScore: round(overScore, 3),
    underScore: round(underScore, 3),
    scoreGap,
  };
}

function ptsConfidenceTier(confidence: number): "HIGH" | "MEDIUM" | "LOW" {
  if (confidence >= 76) return "HIGH";
  if (confidence >= 64) return "MEDIUM";
  return "LOW";
}

function qualifiesPtsBet(input: {
  predictionGap: number | null;
  predictedSide: "OVER" | "UNDER" | "NEUTRAL";
  confidence: number;
  minutesRisk: number;
  openingTeamSpread: number | null;
}): boolean {
  if (input.predictionGap == null) return false;
  if (Math.abs(input.predictionGap) < 1.5) return false;
  if (input.confidence < 60) return false;
  if (input.minutesRisk > 0.65) return false;
  if (input.predictedSide === "OVER" && input.openingTeamSpread != null && input.openingTeamSpread <= -6.5) return false;
  return input.predictedSide !== "NEUTRAL";
}

function buildEnhancedPtsProjection(input: {
  baseProjection: number;
  isHome: boolean | null;
  priorLogs: PlayerLog[];
  priorVolumeLogs: PlayerVolumeLog[];
  last3VolumeLogs: PlayerVolumeLog[];
  last10VolumeLogs: PlayerVolumeLog[];
  homeAwayVolumeLogs: PlayerVolumeLog[];
  sameTeamVolumeLogs: PlayerVolumeLog[];
  sameTeamLogs: PlayerLog[];
  homeAwayLogs: PlayerLog[];
  last3Logs: PlayerLog[];
  last10Logs: PlayerLog[];
  minutesProfileExpected: number | null;
  seasonAveragePts: number | null;
  last10AveragePts: number | null;
  seasonAverageAst: number | null;
  last3AverageAst: number | null;
  currentTeamGames: number;
  expectedTeamPointsProxy: number | null;
  pointsShareLast10: number | null;
  pointsShareSeason: number | null;
  pointsShareCurrentTeam: number | null;
  restDays: number | null;
  gamesIn4Days: number;
  unavailableTeammatePts: number;
  activeCorePts: number;
  activeCoreAst: number;
  continuityScore: number | null;
  defenderStocksPer36: number | null;
  opponentPositionAllowance: number | null;
  opponentPositionAst: number | null;
  opponentPositionReb: number | null;
  opponentAllowancePts: number | null;
  closeRate10: number | null;
  blowoutRate10: number | null;
  expectedGameTotalProxy: number | null;
  expectedSpreadProxy: number | null;
  bookLine: number | null;
  bookOverPrice: number | null;
  bookUnderPrice: number | null;
  lineupCertainty: number | null;
  lineupTimingConfidence: number | null;
  opponentShotVolume: OpponentShotVolumeMetrics | null;
  recentResiduals: number[];
  residualCalibrationRows: PtsResidualCalibrationRow[];
}): EnhancedPtsProjectionResult {
  const expectedMinutes =
    input.minutesProfileExpected ??
    average(input.last10Logs.map((log) => log.minutes)) ??
    average(input.priorLogs.map((log) => log.minutes));
  const regime = getPtsRegime(input.currentTeamGames);
  const stablePriorLogs = stablePointsLogs(input.priorLogs, expectedMinutes);
  const stableLast10Logs = stablePointsLogs(input.last10Logs, expectedMinutes);
  const stableLast3Logs = stablePointsLogs(input.last3Logs, expectedMinutes);
  const stableHomeAwayLogs = stablePointsLogs(input.homeAwayLogs, expectedMinutes);
  const stableSameTeamLogs = stablePointsLogs(input.sameTeamLogs, expectedMinutes);
  const ppmL3 = trimmedPointsPerMinute(stableLast3Logs, expectedMinutes);
  const ppmL10 = trimmedPointsPerMinute(stableLast10Logs, expectedMinutes);
  const ppmSeason = trimmedPointsPerMinute(stablePriorLogs, expectedMinutes);
  const ppmHomeAway = trimmedPointsPerMinute(stableHomeAwayLogs, expectedMinutes);
  const ppmCurrentTeam = trimmedPointsPerMinute(stableSameTeamLogs, expectedMinutes);
  const similar = similarMinutesPoints(stablePriorLogs, expectedMinutes);
  const shotPressure = summarizeShotPressure({
    last3Logs: input.last3VolumeLogs,
    last10Logs: input.last10VolumeLogs,
    seasonLogs: input.priorVolumeLogs,
    homeAwayLogs: input.homeAwayVolumeLogs,
    sameTeamLogs: input.sameTeamVolumeLogs,
    expectedMinutes,
  });
  const volumeProjection = buildVolumePointsProjection({
    priorLogs: input.priorVolumeLogs,
    last3Logs: input.last3VolumeLogs,
    last10Logs: input.last10VolumeLogs,
    homeAwayLogs: input.homeAwayVolumeLogs,
    sameTeamLogs: input.sameTeamVolumeLogs,
    expectedMinutes,
    unavailableTeammatePts: input.unavailableTeammatePts,
    expectedGameTotalProxy: input.expectedGameTotalProxy,
    expectedSpreadProxy: input.expectedSpreadProxy,
    opponentAllowancePts: input.opponentAllowancePts,
    opponentShotVolume: input.opponentShotVolume,
    seasonAveragePts: input.seasonAveragePts,
  });
  const last3ShotPressure = summarizeShotPressure({
    last3Logs: input.last3VolumeLogs,
    last10Logs: input.last3VolumeLogs,
    seasonLogs: input.last10VolumeLogs,
    homeAwayLogs: input.homeAwayVolumeLogs,
    sameTeamLogs: input.sameTeamVolumeLogs,
    expectedMinutes,
  });
  const last10ShotPressure = summarizeShotPressure({
    last3Logs: input.last10VolumeLogs.slice(0, 3),
    last10Logs: input.last10VolumeLogs,
    seasonLogs: input.priorVolumeLogs,
    homeAwayLogs: input.homeAwayVolumeLogs,
    sameTeamLogs: input.sameTeamVolumeLogs,
    expectedMinutes,
  });
  const minutesRisk = computePtsMinutesRisk({
    expectedMinutes,
    last3Logs: stableLast3Logs,
    last10Logs: stableLast10Logs,
    homeAwayLogs: stableHomeAwayLogs,
    sameTeamLogs: stableSameTeamLogs,
    starterRateLast10: computeStarterRate(stableLast10Logs),
    lineupTimingConfidence: input.lineupTimingConfidence ?? input.lineupCertainty,
    expectedSpreadProxy: input.expectedSpreadProxy,
    blowoutRate10: input.blowoutRate10,
    closeRate10: input.closeRate10,
    restDays: input.restDays,
    gamesIn4Days: input.gamesIn4Days,
  });
  const marketSignal = resolvePtsMarketSignal({
    overPrice: input.bookOverPrice,
    underPrice: input.bookUnderPrice,
  });

  const ppmProjection =
    expectedMinutes == null
      ? null
      : weightedBlend([
          { value: ppmL3 == null ? null : ppmL3 * expectedMinutes, weight: 0.2 },
          { value: ppmL10 == null ? null : ppmL10 * expectedMinutes, weight: 0.24 },
          { value: ppmSeason == null ? null : ppmSeason * expectedMinutes, weight: 0.16 },
          { value: ppmHomeAway == null ? null : ppmHomeAway * expectedMinutes, weight: 0.08 },
          { value: ppmCurrentTeam == null ? null : ppmCurrentTeam * expectedMinutes, weight: 0.12 },
          { value: similar.ppm == null ? null : similar.ppm * expectedMinutes, weight: 0.2 },
        ]);
  const teamShareProjection =
    input.expectedTeamPointsProxy == null
      ? null
      : weightedBlend([
          {
            value:
              input.pointsShareLast10 == null
                ? null
                : input.pointsShareLast10 * input.expectedTeamPointsProxy,
            weight: regime === "EARLY" ? 0.28 : 0.34,
          },
          {
            value:
              input.pointsShareSeason == null
                ? null
                : input.pointsShareSeason * input.expectedTeamPointsProxy,
            weight: regime === "LATE" ? 0.18 : 0.26,
          },
          {
            value:
              input.pointsShareCurrentTeam == null
                ? null
                : input.pointsShareCurrentTeam * input.expectedTeamPointsProxy,
            weight: regime === "LATE" ? 0.34 : 0.22,
          },
        ]);

  const baselineProjection =
    weightedBlend(
      regime === "EARLY"
        ? [
            { value: input.baseProjection, weight: 0.28 },
            { value: ppmProjection, weight: 0.2 },
            { value: volumeProjection, weight: 0.22 },
            { value: teamShareProjection, weight: 0.1 },
            { value: similar.medianPts, weight: 0.12 },
            { value: median(stableLast10Logs.map((log) => log.points)), weight: 0.04 },
            { value: input.seasonAveragePts, weight: 0.04 },
          ]
        : regime === "MID"
          ? [
              { value: input.baseProjection, weight: 0.18 },
              { value: ppmProjection, weight: 0.22 },
              { value: volumeProjection, weight: 0.28 },
              { value: teamShareProjection, weight: 0.12 },
              { value: similar.medianPts, weight: 0.12 },
              { value: median(stableLast10Logs.map((log) => log.points)), weight: 0.04 },
              { value: input.seasonAveragePts, weight: 0.04 },
            ]
          : [
              { value: input.baseProjection, weight: 0.14 },
              { value: ppmProjection, weight: 0.2 },
              { value: volumeProjection, weight: 0.3 },
              { value: teamShareProjection, weight: 0.16 },
              { value: similar.medianPts, weight: 0.12 },
              { value: median(stableLast10Logs.map((log) => log.points)), weight: 0.04 },
              { value: input.seasonAveragePts, weight: 0.04 },
            ],
    ) ?? input.baseProjection;

  let projection = baselineProjection;

  if (volumeProjection != null) {
    projection += clamp((volumeProjection - input.baseProjection) * (regime === "LATE" ? 0.34 : 0.26), -0.95, 1.9);
  }

  if (teamShareProjection != null) {
    projection += clamp((teamShareProjection - baselineProjection) * 0.16, -0.95, 1.15);
  }

  const recentFormBoost =
    input.last10AveragePts == null ? 0 : clamp((input.last10AveragePts - input.baseProjection) * 0.4, -0.8, 2.1);
  projection += recentFormBoost;

  if (input.currentTeamGames >= 5 && ppmCurrentTeam != null && expectedMinutes != null) {
    projection =
      weightedBlend([
        { value: projection, weight: 0.8 },
        { value: ppmCurrentTeam * expectedMinutes, weight: 0.2 },
      ]) ?? projection;
  }

  if (input.unavailableTeammatePts > 0) {
    projection += clamp(input.unavailableTeammatePts * 0.072, 0, 2.35);
  }
  if (input.activeCoreAst > 0) {
    projection += clamp(-(input.activeCoreAst - 14) * 0.07, -1.1, 0.45);
  }
  if (input.activeCorePts > 0) {
    projection += clamp(-(input.activeCorePts - 42) * 0.028, -1.1, 0.35);
  }
  if (input.continuityScore != null) {
    projection += clamp((3.2 - input.continuityScore) * 0.26, -0.45, 0.9);
  }
  if (input.lineupCertainty != null) {
    projection += clamp((input.lineupCertainty - 0.7) * 1.1, -0.35, 0.3);
  }
  if (input.lineupTimingConfidence != null) {
    projection += clamp((input.lineupTimingConfidence - 0.72) * 1.45, -0.35, 0.45);
  }

  if (input.opponentPositionAllowance != null && input.seasonAveragePts != null) {
    projection += clamp((input.opponentPositionAllowance - input.seasonAveragePts) * 0.12, -1.4, 1.6);
  } else if (input.opponentAllowancePts != null && input.seasonAveragePts != null) {
    projection += clamp((input.opponentAllowancePts - input.seasonAveragePts) * 0.06, -0.9, 0.9);
  }
  if (input.opponentPositionAst != null && input.seasonAverageAst != null) {
    projection += clamp(-(input.opponentPositionAst - input.seasonAverageAst) * 0.22, -0.85, 0.75);
  }
  if (input.opponentPositionReb != null) {
    projection += clamp((input.opponentPositionReb - 11.5) * 0.06, -0.35, 0.45);
  }
  if (input.opponentShotVolume?.fgaPerMinute != null && shotPressure.fgaRate != null) {
    projection += clamp((input.opponentShotVolume.fgaPerMinute - shotPressure.fgaRate) * 14.5, -1.15, 1.6);
  }
  if (input.opponentShotVolume?.ftaPerMinute != null && shotPressure.ftaRate != null) {
    projection += clamp((input.opponentShotVolume.ftaPerMinute - shotPressure.ftaRate) * 15.5, -1, 1.35);
  }
  if (input.opponentShotVolume?.threeShare != null && shotPressure.threeShare != null) {
    projection += clamp(-(input.opponentShotVolume.threeShare - shotPressure.threeShare) * 1.9, -0.4, 0.35);
  }

  if (input.defenderStocksPer36 != null) {
    projection += clamp(-(input.defenderStocksPer36 - 2.8) * 0.18, -0.7, 0.3);
  }

  if (input.restDays != null) {
    if (input.restDays === 1) projection -= 0.35;
    if (input.restDays >= 3) projection += 0.2;
    if (input.gamesIn4Days >= 3) projection -= 0.45;
  }

  if (input.expectedGameTotalProxy != null) {
    projection += clamp((input.expectedGameTotalProxy - 228) * 0.03, -0.9, 0.9);
  }

  if (input.expectedSpreadProxy != null) {
    projection += clamp(-Math.max(0, Math.abs(input.expectedSpreadProxy) - 6) * 0.055, -0.75, 0.24);
  }

  projection += clamp((0.52 - minutesRisk.riskScore) * 1.15, -0.8, 0.4);

  if (input.closeRate10 != null || input.blowoutRate10 != null) {
    const closeRate = input.closeRate10 ?? 0.5;
    const blowoutRate = input.blowoutRate10 ?? 0;
    projection += clamp((closeRate - blowoutRate - 0.25) * 1.15, -0.6, 0.8);
  }

  const lastGame = input.priorLogs[0];
  if (lastGame && input.last10AveragePts != null) {
    const badGameThreshold = Math.max(6, input.last10AveragePts * 0.22);
    const missedBadly = lastGame.points < input.last10AveragePts - badGameThreshold;
    const minutesNormal = expectedMinutes == null ? true : lastGame.minutes >= Math.max(18, expectedMinutes * 0.82);
    const weirdLastGame =
      expectedMinutes != null &&
      (lastGame.minutes < Math.max(12, expectedMinutes * 0.58) ||
        lastGame.minutes > expectedMinutes * 1.34 ||
        Math.abs(lastGame.points - (median(stableLast10Logs.map((log) => log.points)) ?? lastGame.points)) >
          Math.max(12, (standardDeviation(stableLast10Logs.map((log) => log.points)) ?? 5) * 2.4));
    if (missedBadly && minutesNormal && !weirdLastGame) {
      projection += 0.75;
    } else if (expectedMinutes != null && lastGame.minutes < expectedMinutes - 5) {
      const ppm = ppmSeason ?? ppmL10 ?? ppmL3 ?? null;
      if (ppm != null) {
        projection += clamp((expectedMinutes - lastGame.minutes) * ppm * 0.18, 0, 1.5);
      }
    }
  }

  if (input.last3AverageAst != null && input.seasonAverageAst != null) {
    projection += clamp(-(input.last3AverageAst - input.seasonAverageAst) * 0.28, -0.9, 0.6);
  }

  if (shotPressure.shotPressureIndex != null && last10ShotPressure.shotPressureIndex != null) {
    projection += clamp((shotPressure.shotPressureIndex - last10ShotPressure.shotPressureIndex) * 8.2, -1.35, 1.55);
  }
  if (last3ShotPressure.freeThrowPressure != null && last10ShotPressure.freeThrowPressure != null) {
    projection += clamp((last3ShotPressure.freeThrowPressure - last10ShotPressure.freeThrowPressure) * 10.2, -0.85, 1.35);
  }
  if (last3ShotPressure.threeShare != null && last10ShotPressure.threeShare != null) {
    projection += clamp(-(last3ShotPressure.threeShare - last10ShotPressure.threeShare) * 3.2, -0.45, 0.45);
  }

  const recentBias = average(input.recentResiduals.slice(-6));
  if (recentBias != null) {
    projection += clamp(recentBias * 0.75, -2.8, 2.8);
  }

  const residualAdjustment = computePtsResidualAdjustment(
    {
      regime,
      isHome: input.isHome,
      expectedMinutes,
      openingTotal: input.expectedGameTotalProxy,
      openingSpread: input.expectedSpreadProxy,
      unavailableTeammatePts: input.unavailableTeammatePts,
      activeCorePts: input.activeCorePts,
      activeCoreAst: input.activeCoreAst,
      continuityScore: input.continuityScore,
      opponentPositionPts: input.opponentPositionAllowance,
      opponentPositionAst: input.opponentPositionAst,
      defenderStocksPer36: input.defenderStocksPer36,
      shotPressureIndex: shotPressure.shotPressureIndex,
      threeShare: shotPressure.threeShare,
      freeThrowPressure: shotPressure.freeThrowPressure,
      baselineProjection,
    },
    input.residualCalibrationRows,
  );
  projection += residualAdjustment;

  const sideDecisionPreAnchor = buildPtsSideDecision({
    regime,
    isHome: input.isHome,
    expectedMinutes,
    line: input.bookLine,
    projection,
    baselineProjection,
    volumeProjection,
    teamShareProjection,
    shotPressure,
    minutesRisk,
    lineupTimingConfidence: input.lineupTimingConfidence ?? input.lineupCertainty,
    expectedGameTotalProxy: input.expectedGameTotalProxy,
    expectedSpreadProxy: input.expectedSpreadProxy,
    closeRate10: input.closeRate10,
    blowoutRate10: input.blowoutRate10,
    unavailableTeammatePts: input.unavailableTeammatePts,
    activeCorePts: input.activeCorePts,
    activeCoreAst: input.activeCoreAst,
    continuityScore: input.continuityScore,
    opponentPositionAllowance: input.opponentPositionAllowance,
    opponentPositionAst: input.opponentPositionAst,
    defenderStocksPer36: input.defenderStocksPer36,
    seasonAveragePts: input.seasonAveragePts,
    opponentShotVolume: input.opponentShotVolume,
    recentResiduals: input.recentResiduals,
    residualCalibrationRows: input.residualCalibrationRows,
  });

  if (input.bookLine != null) {
    const anchoredProjection =
      input.bookLine +
      clamp(projection - input.bookLine, -5.5, 5.5) *
        (input.lineupCertainty != null && input.lineupCertainty >= 0.9 ? 0.92 : 0.86);
    projection =
      weightedBlend([
        { value: projection, weight: 0.6 },
        { value: anchoredProjection, weight: 0.4 },
      ]) ?? projection;
    const sideTargetMagnitude = clamp((sideDecisionPreAnchor.confidence - 50) / 32, 0.12, 1.05);
    const sideTarget =
      sideDecisionPreAnchor.side === "OVER"
        ? input.bookLine + sideTargetMagnitude
        : sideDecisionPreAnchor.side === "UNDER"
          ? input.bookLine - sideTargetMagnitude
          : input.bookLine;
    projection =
      weightedBlend([
        { value: projection, weight: 0.76 },
        { value: sideTarget, weight: 0.24 },
      ]) ?? projection;
  }

  let sideLeanScore = 0;
  if (input.expectedGameTotalProxy != null) {
    if (input.expectedGameTotalProxy >= 236) sideLeanScore += 0.95;
    else if (input.expectedGameTotalProxy >= 231) sideLeanScore += 0.45;
    else if (input.expectedGameTotalProxy <= 224) sideLeanScore -= 0.9;
  }
  if (input.expectedSpreadProxy != null) {
    if (Math.abs(input.expectedSpreadProxy) <= 4.5) sideLeanScore += 0.55;
    if (Math.abs(input.expectedSpreadProxy) >= 8) sideLeanScore -= 0.7;
    if (input.expectedSpreadProxy >= 5.5) sideLeanScore -= 0.25;
  }
  if (input.unavailableTeammatePts >= 12) sideLeanScore += 0.7;
  if (input.continuityScore != null && input.continuityScore <= 3.2) sideLeanScore += 0.35;
  if (input.activeCoreAst >= 17) sideLeanScore -= 0.55;
  if (input.activeCorePts >= 48) sideLeanScore -= 0.3;
  if (input.opponentPositionAllowance != null && input.seasonAveragePts != null) {
    sideLeanScore += clamp((input.opponentPositionAllowance - input.seasonAveragePts) * 0.22, -0.65, 0.8);
  }
  if (input.defenderStocksPer36 != null) {
    sideLeanScore += clamp(-(input.defenderStocksPer36 - 2.8) * 0.22, -0.55, 0.35);
  }
  if (shotPressure.shotPressureIndex != null && last10ShotPressure.shotPressureIndex != null) {
    sideLeanScore += clamp((shotPressure.shotPressureIndex - last10ShotPressure.shotPressureIndex) * 4.4, -0.65, 0.8);
  }
  if (input.pointsShareLast10 != null && input.pointsShareSeason != null) {
    sideLeanScore += clamp((input.pointsShareLast10 - input.pointsShareSeason) * 15, -0.6, 0.7);
  }
  sideLeanScore += clamp(residualAdjustment * 0.18, -0.45, 0.45);
  if (input.bookLine != null) {
    sideLeanScore += clamp((baselineProjection - input.bookLine) * 0.3, -0.8, 0.8);
    if (volumeProjection != null) {
      sideLeanScore += clamp((volumeProjection - input.bookLine) * 0.16, -0.55, 0.55);
    }
  }

  const fairLineAnchor = input.bookLine ?? toHalfHookLineLocal(projection);
  const fairGap = projection - fairLineAnchor;
  if (Math.abs(fairGap) <= 0.42) {
    projection += clamp(sideLeanScore * 0.28, -0.48, 0.48);
  }

  projection =
    weightedBlend([
      { value: projection, weight: regime === "LATE" ? 0.76 : 0.8 },
      { value: similar.medianPts, weight: 0.16 },
      { value: median(stableLast10Logs.map((log) => log.points)), weight: 0.04 },
      { value: median(stableLast3Logs.map((log) => log.points)), weight: regime === "EARLY" ? 0.04 : 0 },
    ]) ?? projection;

  if (input.last10AveragePts != null && input.seasonAveragePts != null) {
    const center =
      weightedBlend([
        { value: average(stableLast10Logs.map((log) => log.points)), weight: 0.46 },
        { value: median(stableLast10Logs.map((log) => log.points)), weight: 0.18 },
        { value: input.last10AveragePts, weight: 0.18 },
        { value: input.seasonAveragePts, weight: 0.18 },
      ]) ?? input.seasonAveragePts;
    const cap = Math.max(4.5, (standardDeviation(stableLast10Logs.map((log) => log.points)) ?? 5) * 1.7);
    projection = clamp(projection, Math.max(0, center - cap), center + cap);
  }

  const sideDecision = buildPtsSideDecision({
    regime,
    isHome: input.isHome,
    expectedMinutes,
    line: input.bookLine,
    projection,
    baselineProjection,
    volumeProjection,
    teamShareProjection,
    shotPressure,
    minutesRisk,
    lineupTimingConfidence: input.lineupTimingConfidence ?? input.lineupCertainty,
    expectedGameTotalProxy: input.expectedGameTotalProxy,
    expectedSpreadProxy: input.expectedSpreadProxy,
    closeRate10: input.closeRate10,
    blowoutRate10: input.blowoutRate10,
    unavailableTeammatePts: input.unavailableTeammatePts,
    activeCorePts: input.activeCorePts,
    activeCoreAst: input.activeCoreAst,
    continuityScore: input.continuityScore,
    opponentPositionAllowance: input.opponentPositionAllowance,
    opponentPositionAst: input.opponentPositionAst,
    defenderStocksPer36: input.defenderStocksPer36,
    seasonAveragePts: input.seasonAveragePts,
    opponentShotVolume: input.opponentShotVolume,
    recentResiduals: input.recentResiduals,
    residualCalibrationRows: input.residualCalibrationRows,
  });
  const marketAwareSideDecision = applyPtsMarketSideOverride({
    sideDecision,
    marketSignal,
    openingTeamSpread: input.expectedSpreadProxy,
    openingTotal: input.expectedGameTotalProxy,
    projection,
    line: input.bookLine,
    minutesRisk,
  });

  return {
    projection: round(Math.max(0, projection), 2),
    baselineProjection: round(Math.max(0, baselineProjection), 2),
    regime,
    shotPressure,
    teamShareProjection: teamShareProjection == null ? null : round(teamShareProjection, 2),
    volumeProjection: volumeProjection == null ? null : round(volumeProjection, 2),
    residualAdjustment,
    sideDecision: marketAwareSideDecision,
    minutesRisk,
    lineupTimingConfidence: input.lineupTimingConfidence ?? input.lineupCertainty,
  };
}

function marketRecordFromTarget(log: PlayerLog): SnapshotMetricRecord {
  return metricsFromBase(log.points, log.rebounds, log.assists, log.threes);
}

async function resolvePlayer(playerSearch: string): Promise<LookupPlayer> {
  const search = normalizeSearchText(playerSearch);
  const candidates = await prisma.player.findMany({
    where: {
      OR: [{ isActive: true }, { teamId: { not: null } }],
    },
    select: {
      id: true,
      externalId: true,
      fullName: true,
      firstName: true,
      lastName: true,
      position: true,
      teamId: true,
    },
  });

  const tokens = search.split(" ");
  const ranked = candidates
    .map((candidate) => {
      const fullName = normalizeSearchText(candidate.fullName);
      const firstName = normalizeSearchText(candidate.firstName ?? "");
      const lastName = normalizeSearchText(candidate.lastName ?? "");
      const fullWithParts = normalizeSearchText(`${candidate.firstName ?? ""} ${candidate.lastName ?? ""}`);

      let score = 0;
      if (fullName === search || fullWithParts === search) score += 500;
      if (lastName === search) score += 360;
      if (fullName.startsWith(search) || fullWithParts.startsWith(search)) score += 260;
      if (lastName.startsWith(search)) score += 220;
      if (firstName.startsWith(search)) score += 160;
      if (tokens.length > 1 && tokens.every((token) => fullName.includes(token))) score += 180;
      if (tokens.length > 1 && tokens.every((token) => fullWithParts.includes(token))) score += 180;
      if (fullName.includes(search) || fullWithParts.includes(search)) score += 100;
      if (tokens.some((token) => token.length >= 3 && lastName.includes(token))) score += 80;
      if (tokens.some((token) => token.length >= 3 && firstName.includes(token))) score += 50;

      return { score, candidate };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.candidate.fullName.localeCompare(right.candidate.fullName);
    });

  const best = ranked[0]?.candidate;
  if (!best) {
    throw new Error(`Player not found for search: ${playerSearch}`);
  }

  return best;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const player = await resolvePlayer(args.playerSearch);
  const seasonStartDateEt = getSeasonStartDateEt(args.to);
  const seasonLabel = seasonLabelFromDateEt(args.to);

  const [playerLogsRaw, allSeasonLogsRaw, allGamesRaw, allPlayersRaw, playerVolumeLogsRaw, seasonVolumeLogs] = await Promise.all([
    prisma.playerGameLog.findMany({
      where: {
        playerId: player.id,
        gameDateEt: { gte: seasonStartDateEt, lte: args.to },
        minutes: { gt: 0 },
      },
      include: {
        team: { select: { abbreviation: true } },
        opponentTeam: { select: { abbreviation: true } },
      },
      orderBy: [{ gameDateEt: "asc" }, { externalGameId: "asc" }],
    }),
    prisma.playerGameLog.findMany({
      where: {
        gameDateEt: { gte: seasonStartDateEt, lte: args.to },
        minutes: { gt: 0 },
      },
      include: {
        team: { select: { abbreviation: true } },
        opponentTeam: { select: { abbreviation: true } },
      },
      orderBy: [{ gameDateEt: "asc" }, { externalGameId: "asc" }],
    }),
    prisma.game.findMany({
      where: {
        gameDateEt: { gte: seasonStartDateEt, lte: args.to },
      },
      include: {
        homeTeam: { select: { abbreviation: true } },
        awayTeam: { select: { abbreviation: true } },
      },
    }),
    prisma.player.findMany({
      select: {
        id: true,
        externalId: true,
        fullName: true,
        position: true,
      },
    }),
    fetchPlayerVolumeLogs(seasonLabel, player.externalId),
    fetchSeasonVolumeLogs(seasonLabel),
  ]);

  const playerLogs: PlayerLog[] = playerLogsRaw
    .map((log) => ({
      playerId: log.playerId,
      externalGameId: log.externalGameId,
      gameDateEt: log.gameDateEt,
      teamCode: log.team?.abbreviation ?? null,
      opponent: log.opponentTeam?.abbreviation ?? null,
      isHome: log.isHome,
      starter: log.starter,
      played: log.played,
      minutes: toStat(log.minutes),
      points: toStat(log.points),
      rebounds: toStat(log.rebounds),
      assists: toStat(log.assists),
      threes: toStat(log.threes),
      steals: toStat(log.steals),
      blocks: toStat(log.blocks),
      teamId: log.teamId,
      opponentTeamId: log.opponentTeamId,
    }))
    .filter((log) => log.gameDateEt >= args.from && log.gameDateEt <= args.to)
    .filter((log) => log.minutes >= args.minActualMinutes)
    .filter((log) => isRegularSeasonGameId(log.externalGameId))
    .filter((log) => log.teamCode !== "WLD" && log.opponent !== "STR");

  if (playerLogs.length === 0) {
    throw new Error(`No regular-season completed games found for ${player.fullName} between ${args.from} and ${args.to}.`);
  }

  const playerVolumeLogs = playerVolumeLogsRaw.filter((log) => log.gameDateEt >= args.from && log.gameDateEt <= args.to);
  const playerLogByGameId = new Map(playerLogs.map((log) => [log.externalGameId, log]));
  const alignedVolumeLogs = playerVolumeLogs
    .filter((log) => playerLogByGameId.has(log.externalGameId))
    .sort((left, right) => {
      if (left.gameDateEt !== right.gameDateEt) return left.gameDateEt.localeCompare(right.gameDateEt);
      return left.externalGameId.localeCompare(right.externalGameId);
    });

  const gameByExternalId = new Map(
    allGamesRaw.map((game) => [
      game.externalId,
      {
        gameDateEt: game.gameDateEt,
        commenceTimeUtc: game.commenceTimeUtc,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeTeamCode: game.homeTeam.abbreviation,
        awayTeamCode: game.awayTeam.abbreviation,
      },
    ]),
  );

  const playerMetaById = new Map<string, PlayerMeta>(allPlayersRaw.map((row) => [row.id, row]));
  const playerMetaByExternalId = new Map<string, PlayerMeta>(
    allPlayersRaw
      .filter((row) => Boolean(row.externalId))
      .map((row) => [row.externalId as string, row]),
  );
  const externalLineByDateMarket = await loadHistoricalLineFileForPlayer(args.lineFile, player);

  const regularLogs: PlayerLog[] = allSeasonLogsRaw
    .map((log) => ({
      playerId: log.playerId,
      externalGameId: log.externalGameId,
      gameDateEt: log.gameDateEt,
      teamCode: log.team?.abbreviation ?? null,
      opponent: log.opponentTeam?.abbreviation ?? null,
      isHome: log.isHome,
      starter: log.starter,
      played: log.played,
      minutes: toStat(log.minutes),
      points: toStat(log.points),
      rebounds: toStat(log.rebounds),
      assists: toStat(log.assists),
      threes: toStat(log.threes),
      steals: toStat(log.steals),
      blocks: toStat(log.blocks),
      teamId: log.teamId,
      opponentTeamId: log.opponentTeamId,
    }))
    .filter((log) => isRegularSeasonGameId(log.externalGameId))
    .filter((log) => log.teamCode !== "WLD" && log.opponent !== "STR");

  const regularLogsByPlayerId = new Map<string, PlayerLog[]>();
  regularLogs.forEach((log) => {
    const list = regularLogsByPlayerId.get(log.playerId) ?? [];
    list.push(log);
    regularLogsByPlayerId.set(log.playerId, list);
  });
  const gameParticipantsByTeam = buildGameParticipantsByTeam(regularLogs);
  const gameStartersByTeam = buildGameStartersByTeam(regularLogs);
  const teamPointsByGameTeam = buildTeamPointsByGameTeam(regularLogs);

  const teamMarginsByTeamId = buildTeamMargins(
    regularLogs,
    new Map(Array.from(gameByExternalId.entries()).map(([key, value]) => [key, {
      gameDateEt: value.gameDateEt,
      homeTeamId: value.homeTeamId,
      awayTeamId: value.awayTeamId,
    }])),
  );
  const teamEnvironmentsByTeamId = buildTeamEnvironments(
    regularLogs,
    new Map(
      Array.from(gameByExternalId.entries()).map(([key, value]) => [
        key,
        {
          gameDateEt: value.gameDateEt,
          homeTeamId: value.homeTeamId,
          awayTeamId: value.awayTeamId,
        },
      ]),
    ),
  );

  const seasonLogsSorted = allSeasonLogsRaw
    .map((log) => ({
      gameDateEt: log.gameDateEt,
      opponentTeamId: log.opponentTeamId,
      externalGameId: log.externalGameId,
      metrics: metricsFromBase(
        toStat(log.points),
        toStat(log.rebounds),
        toStat(log.assists),
        toStat(log.threes),
      ),
    }))
    .filter((log) => isRegularSeasonGameId(log.externalGameId))
    .sort((left, right) => {
      if (left.gameDateEt !== right.gameDateEt) return left.gameDateEt.localeCompare(right.gameDateEt);
      return left.externalGameId.localeCompare(right.externalGameId);
    });

  const gamesByTeamId = new Map<string, Array<{ gameDateEt: string; externalId: string }>>();
  allGamesRaw
    .filter((game) => isRegularSeasonGameId(game.externalId))
    .forEach((game) => {
    const homeList = gamesByTeamId.get(game.homeTeamId) ?? [];
    homeList.push({ gameDateEt: game.gameDateEt, externalId: game.externalId });
    gamesByTeamId.set(game.homeTeamId, homeList);

    const awayList = gamesByTeamId.get(game.awayTeamId) ?? [];
    awayList.push({ gameDateEt: game.gameDateEt, externalId: game.externalId });
    gamesByTeamId.set(game.awayTeamId, awayList);
    });
  gamesByTeamId.forEach((games) => {
    games.sort((left, right) => {
      if (left.gameDateEt !== right.gameDateEt) return left.gameDateEt.localeCompare(right.gameDateEt);
      return left.externalId.localeCompare(right.externalId);
    });
  });

  const gamesByTeamCode = new Map<string, Array<{ gameDateEt: string; externalId: string }>>();
  allGamesRaw
    .filter((game) => isRegularSeasonGameId(game.externalId))
    .forEach((game) => {
      const awayList = gamesByTeamCode.get(game.awayTeam.abbreviation) ?? [];
      awayList.push({ gameDateEt: game.gameDateEt, externalId: game.externalId });
      gamesByTeamCode.set(game.awayTeam.abbreviation, awayList);

      const homeList = gamesByTeamCode.get(game.homeTeam.abbreviation) ?? [];
      homeList.push({ gameDateEt: game.gameDateEt, externalId: game.externalId });
      gamesByTeamCode.set(game.homeTeam.abbreviation, homeList);
    });
  gamesByTeamCode.forEach((games) => {
    games.sort((left, right) => {
      if (left.gameDateEt !== right.gameDateEt) return left.gameDateEt.localeCompare(right.gameDateEt);
      return left.externalId.localeCompare(right.externalId);
    });
  });

  const opponentGameStats = new Map<string, OpponentGameAggregate>();
  seasonLogsSorted.forEach((entry) => {
    if (!entry.opponentTeamId) return;
    const key = `${entry.opponentTeamId}|${entry.externalGameId}`;
    const existing = opponentGameStats.get(key) ?? {
      count: 0,
      sums: {
        PTS: 0,
        REB: 0,
        AST: 0,
        THREES: 0,
        PRA: 0,
        PA: 0,
        PR: 0,
        RA: 0,
      },
    };
    SNAPSHOT_MARKETS.forEach((market) => {
      existing.sums[market] = (existing.sums[market] ?? 0) + (entry.metrics[market] ?? 0);
    });
    existing.count += 1;
    opponentGameStats.set(key, existing);
  });

  const leagueSums: Record<SnapshotMarket, number> = {
    PTS: 0,
    REB: 0,
    AST: 0,
    THREES: 0,
    PRA: 0,
    PA: 0,
    PR: 0,
    RA: 0,
  };
  let leagueCount = 0;
  let leaguePointer = 0;

  const targetGames = Array.from(
    new Map(
      playerLogs.map((log) => {
        const game = gameByExternalId.get(log.externalGameId);
        return [
          log.externalGameId,
          game
            ? {
                externalGameId: log.externalGameId,
                gameDateEt: log.gameDateEt,
                awayCode: game.awayTeamCode,
                homeCode: game.homeTeamCode,
              }
            : null,
        ];
      }),
    ).values(),
  ).filter((game): game is { externalGameId: string; gameDateEt: string; awayCode: string; homeCode: string } => Boolean(game));

  const historicalPregameByExternalGameId = new Map<string, HistoricalPregameOdds | null>();
  const historicalStartersByExternalGameId = new Map<string, HistoricalStartingLineup | null>();
  const historicalPtsLineByExternalGameId = new Map<string, HistoricalPlayerPropLine | null>();
  const historicalRotowireByDateEt = new Map<string, HistoricalRotowireSnapshot | null>();

  await mapLimit(targetGames, 4, async (game) => {
    const pregameOdds = await fetchHistoricalPregameOdds(game.gameDateEt, game.awayCode, game.homeCode).catch(() => null);
    historicalPregameByExternalGameId.set(game.externalGameId, pregameOdds);
  });

  await mapLimit(targetGames, 1, async (game) => {
    const starters = await fetchHistoricalStartingLineup(
      game.externalGameId,
      game.gameDateEt,
      game.awayCode,
      game.homeCode,
    ).catch(() => null);
    historicalStartersByExternalGameId.set(game.externalGameId, starters);
  });

  const uniqueDates = Array.from(new Set(targetGames.map((game) => game.gameDateEt)));
  await mapLimit(uniqueDates, 2, async (dateEt) => {
    const snapshot = await fetchHistoricalRotowireSnapshot(dateEt).catch(() => null);
    historicalRotowireByDateEt.set(dateEt, snapshot);
  });

  await mapLimit(targetGames, 3, async (game) => {
    const gameMeta = gameByExternalId.get(game.externalGameId);
    const ptsLine = await resolveHistoricalPlayerPropLine({
      dateEt: game.gameDateEt,
      awayCode: game.awayCode,
      homeCode: game.homeCode,
      playerName: player.fullName,
      market: "PTS",
      commenceTimeUtc: gameMeta?.commenceTimeUtc ?? null,
    }).catch(() => null);
    historicalPtsLineByExternalGameId.set(game.externalGameId, ptsLine);
  });

  const aggregates = Object.fromEntries(SNAPSHOT_MARKETS.map((market) => [market, emptyAggregate()])) as Record<
    SnapshotMarket,
    MarketAggregate
  >;

  const results: TargetGameResult[] = [];
  const recentPtsResiduals: number[] = [];
  const ptsCalibrationRows: PtsResidualCalibrationRow[] = [];
  let ptsBookLineCoverage = 0;
  let ptsExternalLineCoverage = 0;
  let pregameLineupCoverage = 0;
  let opponentShotVolumeCoverage = 0;
  const ptsConfidenceBuckets = {
    HIGH: { correct: 0, wrong: 0 },
    MEDIUM: { correct: 0, wrong: 0 },
    LOW: { correct: 0, wrong: 0 },
  };
  const ptsQualifiedStats = { qualified: 0, correct: 0, wrong: 0 };

  for (let index = 0; index < playerLogs.length; index += 1) {
    const target = playerLogs[index];
    const priorLogs = playerLogs.slice(0, index);
    const priorVolumeLogs = alignedVolumeLogs.filter((log) => {
      if (log.gameDateEt !== target.gameDateEt) return log.gameDateEt < target.gameDateEt;
      return log.externalGameId < target.externalGameId;
    });
    if (priorLogs.length === 0) {
      continue;
    }

    while (
      leaguePointer < seasonLogsSorted.length &&
      seasonLogsSorted[leaguePointer].gameDateEt < target.gameDateEt
    ) {
      const current = seasonLogsSorted[leaguePointer];
      SNAPSHOT_MARKETS.forEach((market) => {
        leagueSums[market] += current.metrics[market] ?? 0;
      });
      leagueCount += 1;
      leaguePointer += 1;
    }

    const last10Logs = priorLogs.slice(-10).reverse();
    const last3Logs = priorLogs.slice(-3).reverse();
    const homeAwayLogs = priorLogs.filter((log) => log.isHome === target.isHome).reverse();
    const sameTeamLogs = priorLogs.filter((log) => log.teamCode === target.teamCode).reverse();
    const last10VolumeLogs = priorVolumeLogs.slice(-10).reverse();
    const last3VolumeLogs = priorVolumeLogs.slice(-3).reverse();
    const homeAwayVolumeLogs = priorVolumeLogs.filter((log) => log.isHome === target.isHome).reverse();
    const sameTeamVolumeLogs = priorVolumeLogs
      .filter((log) => playerLogByGameId.get(log.externalGameId)?.teamCode === target.teamCode)
      .reverse();
    const statusLast10 = last10Logs.map((log) => ({ starter: log.starter, played: log.played }));
    const seasonAverage = averagesByMarket(priorLogs);
    const last3Average = averagesByMarket(last3Logs);
    const last10Average = averagesByMarket(last10Logs);
    const homeAwayAverage = averagesByMarket(homeAwayLogs);
    const last10ByMarket = arraysByMarket(last10Logs);
    const historyByMarket = arraysByMarket(priorLogs);
    const historyMinutes = priorLogs.map((log) => log.minutes);
    const minutesSeasonAvg = average(priorLogs.map((log) => log.minutes));
    const minutesLast3Avg = average(last3Logs.map((log) => log.minutes));
    const minutesLast10Avg = average(last10Logs.map((log) => log.minutes));
    const minutesHomeAwayAvg = average(homeAwayLogs.map((log) => log.minutes));
    const minutesCurrentTeamLast5Avg = average(sameTeamLogs.slice(0, 5).map((log) => log.minutes));
    const minutesVolatility = standardDeviation(last10Logs.map((log) => log.minutes));
    const startsLast10 = statusLast10.reduce((count, log) => count + (log.starter === true ? 1 : 0), 0);
    const starterRateLast10 = statusLast10.length > 0 ? round(startsLast10 / statusLast10.length, 2) : null;

    const leagueAverage =
      leagueCount > 0
        ? ({
            PTS: round(leagueSums.PTS / leagueCount, 2),
            REB: round(leagueSums.REB / leagueCount, 2),
            AST: round(leagueSums.AST / leagueCount, 2),
            THREES: round(leagueSums.THREES / leagueCount, 2),
            PRA: round(leagueSums.PRA / leagueCount, 2),
            PA: round(leagueSums.PA / leagueCount, 2),
            PR: round(leagueSums.PR / leagueCount, 2),
            RA: round(leagueSums.RA / leagueCount, 2),
          } satisfies SnapshotMetricRecord)
        : blankMetricRecord();

    const opponentRecentGames = (gamesByTeamId.get(target.opponentTeamId ?? "") ?? [])
      .filter((game) => game.gameDateEt < target.gameDateEt)
      .slice(-10);
    const opponentSums: Record<SnapshotMarket, number> = {
      PTS: 0,
      REB: 0,
      AST: 0,
      THREES: 0,
      PRA: 0,
      PA: 0,
      PR: 0,
      RA: 0,
    };
    let opponentCount = 0;
    opponentRecentGames.forEach((game) => {
      const aggregate = opponentGameStats.get(`${target.opponentTeamId}|${game.externalId}`);
      if (!aggregate || aggregate.count === 0) return;
      SNAPSHOT_MARKETS.forEach((market) => {
        opponentSums[market] += aggregate.sums[market] ?? 0;
      });
      opponentCount += aggregate.count;
    });
    const opponentAllowance =
      opponentCount > 0
        ? ({
            PTS: round(opponentSums.PTS / opponentCount, 2),
            REB: round(opponentSums.REB / opponentCount, 2),
            AST: round(opponentSums.AST / opponentCount, 2),
            THREES: round(opponentSums.THREES / opponentCount, 2),
            PRA: round(opponentSums.PRA / opponentCount, 2),
            PA: round(opponentSums.PA / opponentCount, 2),
            PR: round(opponentSums.PR / opponentCount, 2),
            RA: round(opponentSums.RA / opponentCount, 2),
          } satisfies SnapshotMetricRecord)
        : blankMetricRecord();
    const opponentAllowanceDelta = deltaFromLeague(opponentAllowance, leagueAverage);
    const completeness = computeCompleteness({
      last10Logs,
      statusLast10,
      opponentAllowance,
      minutesVolatility,
    });
    const historicalPregame = historicalPregameByExternalGameId.get(target.externalGameId) ?? null;
    const historicalStarters = historicalStartersByExternalGameId.get(target.externalGameId) ?? null;
    const csvPtsLine = externalLineByDateMarket.get(`${target.gameDateEt}|PTS`) ?? null;
    const historicalPtsLine = csvPtsLine ?? historicalPtsLineByExternalGameId.get(target.externalGameId) ?? null;
    const historicalRotowire = historicalRotowireByDateEt.get(target.gameDateEt) ?? null;
    const rotowireTeamSignal = getHistoricalRotowireTeamSignal(historicalRotowire, target.teamCode);
    const rotowireOpponentSignal = getHistoricalRotowireTeamSignal(historicalRotowire, target.opponent);
    const teamParticipantIds = target.teamId ? gameParticipantsByTeam.get(`${target.externalGameId}|${target.teamId}`) ?? null : null;
    const opponentParticipantIds = target.opponentTeamId
      ? gameParticipantsByTeam.get(`${target.externalGameId}|${target.opponentTeamId}`) ?? null
      : null;
    const rotowireResolvedTeamStarterIds = resolveStarterIds(
      rotowireTeamSignal?.starters ?? [],
      teamParticipantIds,
      playerMetaById,
    );
    const rotowireResolvedOpponentStarterIds = resolveStarterIds(
      rotowireOpponentSignal?.starters ?? [],
      opponentParticipantIds,
      playerMetaById,
    );
    const resolvedTeamStarterIds = resolveStarterIds(
      getStarterNamesForTeam(historicalStarters, target.teamCode),
      teamParticipantIds,
      playerMetaById,
    );
    const resolvedTeamStarterIdsByExternal = resolveStarterIdsFromExternalIds(
      getStarterExternalIdsForTeam(historicalStarters, target.teamCode),
      teamParticipantIds,
      playerMetaById,
    );
    const resolvedOpponentStarterIds = resolveStarterIds(
      getStarterNamesForTeam(historicalStarters, target.opponent),
      opponentParticipantIds,
      playerMetaById,
    );
    const resolvedOpponentStarterIdsByExternal = resolveStarterIdsFromExternalIds(
      getStarterExternalIdsForTeam(historicalStarters, target.opponent),
      opponentParticipantIds,
      playerMetaById,
    );
    const teamStarterIds =
      rotowireResolvedTeamStarterIds.size > 0
        ? rotowireResolvedTeamStarterIds
        : resolvedTeamStarterIdsByExternal.size > 0
        ? resolvedTeamStarterIdsByExternal
        : resolvedTeamStarterIds.size > 0
          ? resolvedTeamStarterIds
          : (target.teamId
              ? gameStartersByTeam.get(`${target.externalGameId}|${target.teamId}`) ?? new Set<string>()
              : new Set<string>());
    const opponentStarterIds =
      rotowireResolvedOpponentStarterIds.size > 0
        ? rotowireResolvedOpponentStarterIds
        : resolvedOpponentStarterIdsByExternal.size > 0
        ? resolvedOpponentStarterIdsByExternal
        : resolvedOpponentStarterIds.size > 0
          ? resolvedOpponentStarterIds
          : (target.opponentTeamId
              ? gameStartersByTeam.get(`${target.externalGameId}|${target.opponentTeamId}`) ?? new Set<string>()
              : new Set<string>());
    const historicalLineupShift = computeHistoricalTeammateLineupLoad({
      teamId: target.teamId,
      dateEt: target.gameDateEt,
      externalGameId: target.externalGameId,
      excludePlayerId: target.playerId,
      logsByPlayerId: regularLogsByPlayerId,
      playerMetaById,
      participantIds: teamParticipantIds,
      starterIds: teamStarterIds,
    });
    const rotowireLineupShift =
      rotowireTeamSignal == null
        ? null
        : computeRotowireTeammateLineupLoad({
            teamId: target.teamId,
            dateEt: target.gameDateEt,
            excludePlayerId: target.playerId,
            logsByPlayerId: regularLogsByPlayerId,
            playerMetaById,
            teamSignal: rotowireTeamSignal,
          });
    const lineupCertainty = rotowireTeamSignal ? lineupStatusWeight(rotowireTeamSignal.status) : null;
    const lineupTimingConfidence = computeLineupTimingConfidence(rotowireTeamSignal);
    const lineupBlendWeight =
      rotowireTeamSignal == null
        ? 0
        : (lineupCertainty ?? 0) * (rotowireTeamSignal.unavailablePlayers.length > 0 ? 1 : 0.55);
    const blendedLineupShift = mergeHistoricalLineupContexts(rotowireLineupShift, historicalLineupShift, lineupBlendWeight);
    const playerStartedFromRotowire =
      rotowireTeamSignal == null
        ? null
        : rotowireTeamSignal.starters.some((name) => normalizePersonName(name) === normalizePersonName(player.fullName))
          ? true
          : rotowireTeamSignal.unavailablePlayers.some(
              (entry) => normalizePersonName(entry.playerName) === normalizePersonName(player.fullName),
            )
            ? false
            : null;
    const playerStarted = playerStartedFromRotowire ?? (teamStarterIds.size > 0 ? teamStarterIds.has(target.playerId) : (target.starter ?? null));
    const starterResolved = playerStarted != null;
    const starterSource =
      playerStartedFromRotowire != null
        ? `rotowire-${rotowireTeamSignal?.status.toLowerCase()}`
        : historicalStarters?.source ?? null;
    const historicalAvailability = rotowireTeamSignal?.unavailablePlayers.find(
      (entry) => normalizePersonName(entry.playerName) === normalizePersonName(player.fullName),
    );
    const availabilitySeverity = deriveRotowireAvailabilityImpact(
      historicalAvailability?.status ?? null,
      historicalAvailability?.percentPlay ?? null,
    ).severity;
    const personalModels = buildPlayerPersonalModels({
      historyByMarket,
      minutesSeasonAvg,
    });
    const minutesProfile = projectMinutesProfile({
      minutesLast3Avg,
      minutesLast10Avg,
      minutesHomeAwayAvg,
      minutesCurrentTeamLast5Avg,
      minutesCurrentTeamGames: sameTeamLogs.length,
      lineupStarter: playerStarted,
      starterRateLast10,
    });
    const scheduleLoad = recentGameLoad(priorLogs, target.gameDateEt);
    const projectedTonight = projectTonightMetrics({
      last3Average,
      last10Average,
      seasonAverage,
      homeAwayAverage,
      opponentAllowance,
      opponentAllowanceDelta,
      last10ByMarket,
      historyByMarket,
      historyMinutes,
      sampleSize: priorLogs.length,
      personalModels,
      minutesSeasonAvg,
      minutesLast3Avg,
      minutesLast10Avg,
      minutesVolatility,
      minutesHomeAwayAvg,
      minutesCurrentTeamLast5Avg,
      minutesCurrentTeamGames: sameTeamLogs.length,
      lineupStarter: playerStarted,
      starterRateLast10,
      playerPosition: player.position,
      restDays: scheduleLoad.restDays,
      openingTeamSpread:
        historicalPregame?.openingHomeSpread == null
          ? null
          : target.isHome === true
            ? historicalPregame.openingHomeSpread
            : round(-historicalPregame.openingHomeSpread, 2),
      openingTotal: historicalPregame?.openingTotal ?? null,
      availabilitySeverity,
    });
    const heuristicUnavailableTeammatePts = computeTeammateUnavailablePtsLoad(
      target.teamId,
      target.gameDateEt,
      target.playerId,
      regularLogsByPlayerId,
      playerMetaById,
    );
    const unavailableTeammatePts =
      blendedLineupShift.missingPts + blendedLineupShift.benchedPts > 0
        ? round(blendedLineupShift.missingPts + blendedLineupShift.benchedPts, 2)
        : heuristicUnavailableTeammatePts;
    const defenderStocksPer36 =
      chooseHistoricalPrimaryDefenderStocks({
        playerPosition: player.position,
        opponentTeamId: target.opponentTeamId,
        dateEt: target.gameDateEt,
        logsByPlayerId: regularLogsByPlayerId,
        playerMetaById,
        participantIds: opponentParticipantIds,
        starterIds: opponentStarterIds,
      }) ??
      choosePrimaryDefenderStocks(
        player.position,
        target.opponentTeamId,
        target.gameDateEt,
        regularLogsByPlayerId,
        playerMetaById,
      );
    const opponentPositionAllowance = resolvePositionAllowance(
      target.opponentTeamId,
      target.gameDateEt,
      positionTokens(player.position),
      regularLogs,
      gamesByTeamId,
      playerMetaById,
    );
    const opponentPositionMetrics = resolvePositionAllowanceMetrics(
      target.opponentTeamId,
      target.gameDateEt,
      positionTokens(player.position),
      regularLogs,
      gamesByTeamId,
      playerMetaById,
    );
    const opponentShotVolume = resolveOpponentShotVolumeMetrics({
      opponentCode: target.opponent,
      dateEt: target.gameDateEt,
      playerPosTokens: positionTokens(player.position),
      seasonVolumeLogs,
      gamesByTeamCode,
      playerMetaByExternalId,
    });
    const marginRates = recentMarginRates(target.teamId, target.gameDateEt, teamMarginsByTeamId);
    const expectedEnvironment = expectedMatchupEnvironment(
      target.teamId,
      target.opponentTeamId,
      target.gameDateEt,
      teamEnvironmentsByTeamId,
    );
    const openingTeamSpread =
      historicalPregame?.openingHomeSpread == null
        ? null
        : target.isHome === true
          ? historicalPregame.openingHomeSpread
          : round(-historicalPregame.openingHomeSpread, 2);
    const openingTotal = historicalPregame?.openingTotal ?? null;
    const effectiveTotal = openingTotal ?? expectedEnvironment.totalProxy;
    const effectiveSpread = openingTeamSpread ?? expectedEnvironment.spreadProxy;
    const expectedTeamPointsProxy =
      effectiveTotal == null || effectiveSpread == null
        ? null
        : round(effectiveTotal / 2 - effectiveSpread / 2, 2);
    const pointsShareLast10 = averagePlayerPointsShare(last10Logs, teamPointsByGameTeam);
    const pointsShareSeason = averagePlayerPointsShare(priorLogs, teamPointsByGameTeam);
    const pointsShareCurrentTeam = averagePlayerPointsShare(sameTeamLogs, teamPointsByGameTeam);

    const ptsProjection = buildEnhancedPtsProjection({
      baseProjection: projectedTonight.PTS ?? 0,
      isHome: target.isHome,
      priorLogs: priorLogs.slice().reverse(),
      priorVolumeLogs: priorVolumeLogs.slice().reverse(),
      last3VolumeLogs,
      last10VolumeLogs,
      homeAwayVolumeLogs,
      sameTeamVolumeLogs,
      sameTeamLogs,
      homeAwayLogs,
      last3Logs,
      last10Logs,
      minutesProfileExpected: minutesProfile.expected,
      seasonAveragePts: seasonAverage.PTS,
      last10AveragePts: last10Average.PTS,
      seasonAverageAst: seasonAverage.AST,
      last3AverageAst: last3Average.AST,
      currentTeamGames: sameTeamLogs.length,
      expectedTeamPointsProxy,
      pointsShareLast10,
      pointsShareSeason,
      pointsShareCurrentTeam,
      restDays: scheduleLoad.restDays,
      gamesIn4Days: scheduleLoad.gamesIn4Days,
      unavailableTeammatePts,
      activeCorePts: blendedLineupShift.activePts,
      activeCoreAst: blendedLineupShift.activeAst,
      continuityScore: blendedLineupShift.continuityScore,
      defenderStocksPer36,
      opponentPositionAllowance,
      opponentPositionAst: opponentPositionMetrics.ast,
      opponentPositionReb: opponentPositionMetrics.reb,
      opponentAllowancePts: opponentAllowance.PTS,
      closeRate10: marginRates.closeRate10,
      blowoutRate10: marginRates.blowoutRate10,
      expectedGameTotalProxy: effectiveTotal,
      expectedSpreadProxy: effectiveSpread,
      bookLine: historicalPtsLine?.line ?? null,
      bookOverPrice: historicalPtsLine?.overPrice ?? null,
      bookUnderPrice: historicalPtsLine?.underPrice ?? null,
      lineupCertainty,
      lineupTimingConfidence,
      opponentShotVolume,
      recentResiduals: recentPtsResiduals,
      residualCalibrationRows: ptsCalibrationRows,
    });
    if (historicalPtsLine?.line != null) ptsBookLineCoverage += 1;
    if (csvPtsLine?.line != null) ptsExternalLineCoverage += 1;
    if (rotowireTeamSignal) pregameLineupCoverage += 1;
    if (opponentShotVolume.sample > 0) opponentShotVolumeCoverage += 1;
    projectedTonight.PTS = ptsProjection.projection;
    projectedTonight.PRA =
      projectedTonight.PTS == null || projectedTonight.REB == null || projectedTonight.AST == null
        ? projectedTonight.PRA
        : round(projectedTonight.PTS + projectedTonight.REB + projectedTonight.AST, 2);
    projectedTonight.PA =
      projectedTonight.PTS == null || projectedTonight.AST == null
        ? projectedTonight.PA
        : round(projectedTonight.PTS + projectedTonight.AST, 2);
    projectedTonight.PR =
      projectedTonight.PTS == null || projectedTonight.REB == null
        ? projectedTonight.PR
        : round(projectedTonight.PTS + projectedTonight.REB, 2);
    const modelLines = buildModelLineRecord({
      projectedTonight,
      last10ByMarket,
      dataCompletenessScore: completeness.score,
    });
    if (historicalPtsLine?.line != null) {
      const projectionGap = projectedTonight.PTS == null ? null : round(projectedTonight.PTS - historicalPtsLine.line, 2);
      const confidenceBuffer =
        ptsProjection.sideDecision.confidence >= 78 ? 0.45 : ptsProjection.sideDecision.confidence >= 66 ? 0.65 : 0.85;
      const actionBuffer = confidenceBuffer;
      modelLines.PTS = {
        ...modelLines.PTS,
        fairLine: historicalPtsLine.line,
        projectionGap,
        modelSide: ptsProjection.sideDecision.side === "NEUTRAL" ? "NEUTRAL" : ptsProjection.sideDecision.side,
        actionOverLine: round(Math.max(0.5, historicalPtsLine.line - actionBuffer), 1),
        actionUnderLine: round(historicalPtsLine.line + actionBuffer, 1),
      };
    }
    const ptsQualifiedBet = qualifiesPtsBet({
      predictionGap: modelLines.PTS.projectionGap,
      predictedSide: ptsProjection.sideDecision.side,
      confidence: ptsProjection.sideDecision.confidence,
      minutesRisk: ptsProjection.minutesRisk.riskScore,
      openingTeamSpread,
    });
    const actuals = marketRecordFromTarget(target);

    const predictedSides = {} as Record<SnapshotMarket, "OVER" | "UNDER" | "PUSH" | "NO_LINE">;
    const actualSides = {} as Record<SnapshotMarket, "OVER" | "UNDER" | "PUSH" | "NO_LINE">;
    const sideCorrect = {} as Record<SnapshotMarket, boolean | null>;
    const fairLines = {} as Record<SnapshotMarket, number | null>;

    SNAPSHOT_MARKETS.forEach((market) => {
      const projection = projectedTonight[market];
      const actual = actuals[market];
      const externalLine =
        market === "PTS"
          ? historicalPtsLine
          : externalLineByDateMarket.get(`${target.gameDateEt}|${market}`) ?? null;
      const fairLine = externalLine?.line ?? modelLines[market].fairLine;
      fairLines[market] = fairLine;

      if (projection == null || actual == null) {
        predictedSides[market] = "NO_LINE";
        actualSides[market] = "NO_LINE";
        sideCorrect[market] = null;
        return;
      }

      const error = projection - actual;
      const aggregate = aggregates[market];
      aggregate.samples += 1;
      aggregate.absErrorSum += Math.abs(error);
      aggregate.squaredErrorSum += error * error;
      aggregate.errorSum += error;

      const jokicRebSide =
        market === "REB"
          ? applyJokicRebSideOverride({
              playerName: player.fullName,
              projection,
              line: fairLine,
              openingTeamSpread: effectiveSpread,
              openingTotal: effectiveTotal,
            })
          : "NEUTRAL";
      const jokicAstSide =
        market === "AST"
          ? applyJokicAstSideOverride({
              playerName: player.fullName,
              projection,
              line: fairLine,
              openingTeamSpread: effectiveSpread,
              openingTotal: effectiveTotal,
              overPrice: externalLine?.overPrice ?? null,
              underPrice: externalLine?.underPrice ?? null,
            })
          : "NEUTRAL";
      const jokicThreesSide =
        market === "THREES"
          ? applyJokicThreesSideOverride({
              playerName: player.fullName,
              projection,
              line: fairLine,
              overPrice: externalLine?.overPrice ?? null,
              underPrice: externalLine?.underPrice ?? null,
              openingTotal: effectiveTotal,
              projectedMinutes: minutesProfile.expected,
              completenessScore: completeness.score,
            })
          : "NEUTRAL";
      const jokicPraSide =
        market === "PRA"
          ? applyJokicPraSideOverride({
              playerName: player.fullName,
              projection,
              line: fairLine,
              projectedPoints: projectedTonight.PTS,
              completenessScore: completeness.score,
            })
          : "NEUTRAL";
      const jokicPaSide =
        market === "PA"
          ? applyJokicPaSideOverride({
              playerName: player.fullName,
              projection,
              line: fairLine,
              openingTotal: effectiveTotal,
              projectedPoints: projectedTonight.PTS,
            })
          : "NEUTRAL";
      const jokicPrSide =
        market === "PR"
          ? applyJokicPrSideOverride({
              playerName: player.fullName,
              projection,
              line: fairLine,
              openingTotal: effectiveTotal,
              projectedAssists: projectedTonight.AST,
            })
          : "NEUTRAL";
      const jokicRaSide =
        market === "RA"
          ? applyJokicRaSideOverride({
              playerName: player.fullName,
              projection,
              line: fairLine,
              projectedRebounds: projectedTonight.REB,
              completenessScore: completeness.score,
              openingTotal: effectiveTotal,
            })
          : "NEUTRAL";
      const predictedSide =
        market === "PTS" && fairLine != null && ptsProjection.sideDecision.side !== "NEUTRAL"
          ? ptsProjection.sideDecision.side
          : market === "REB" && fairLine != null && jokicRebSide !== "NEUTRAL"
            ? jokicRebSide
            : market === "AST" && fairLine != null && jokicAstSide !== "NEUTRAL"
              ? jokicAstSide
              : market === "THREES" && fairLine != null && jokicThreesSide !== "NEUTRAL"
                ? jokicThreesSide
                : market === "PRA" && fairLine != null && jokicPraSide !== "NEUTRAL"
                  ? jokicPraSide
                  : market === "PA" && fairLine != null && jokicPaSide !== "NEUTRAL"
                    ? jokicPaSide
                    : market === "PR" && fairLine != null && jokicPrSide !== "NEUTRAL"
                      ? jokicPrSide
                      : market === "RA" && fairLine != null && jokicRaSide !== "NEUTRAL"
                        ? jokicRaSide
                : sideFromValue(projection, fairLine);
      const actualSide = sideFromValue(actual, fairLine);
      predictedSides[market] = predictedSide;
      actualSides[market] = actualSide;

      if (predictedSide === "OVER") aggregate.overCalls += 1;
      if (predictedSide === "UNDER") aggregate.underCalls += 1;

      if (predictedSide === "PUSH" || actualSide === "PUSH") {
        aggregate.pushes += 1;
        sideCorrect[market] = null;
      } else if (predictedSide !== "NO_LINE" && actualSide !== "NO_LINE" && predictedSide === actualSide) {
        aggregate.correctSide += 1;
        sideCorrect[market] = true;
      } else if (predictedSide !== "NO_LINE" && actualSide !== "NO_LINE") {
        aggregate.wrongSide += 1;
        sideCorrect[market] = false;
      } else {
        sideCorrect[market] = null;
      }

      if (market === "PTS" && actualSide !== "NO_LINE" && actualSide !== "PUSH") {
        const tier = ptsConfidenceTier(ptsProjection.sideDecision.confidence);
        if (predictedSide === actualSide) ptsConfidenceBuckets[tier].correct += 1;
        if (predictedSide !== actualSide && predictedSide !== "PUSH" && predictedSide !== "NO_LINE") {
          ptsConfidenceBuckets[tier].wrong += 1;
        }
        if (ptsQualifiedBet) {
          ptsQualifiedStats.qualified += 1;
          if (predictedSide === actualSide) ptsQualifiedStats.correct += 1;
          if (predictedSide !== actualSide && predictedSide !== "PUSH" && predictedSide !== "NO_LINE") {
            ptsQualifiedStats.wrong += 1;
          }
        }
      }
    });

    if (projectedTonight.PTS != null && actuals.PTS != null) {
      recentPtsResiduals.push(actuals.PTS - projectedTonight.PTS);
      ptsCalibrationRows.push({
        gameDateEt: target.gameDateEt,
        regime: ptsProjection.regime,
        isHome: target.isHome,
        expectedMinutes: minutesProfile.expected,
        openingTotal: effectiveTotal,
        openingSpread: effectiveSpread,
        unavailableTeammatePts,
        activeCorePts: blendedLineupShift.activePts,
        activeCoreAst: blendedLineupShift.activeAst,
        continuityScore: blendedLineupShift.continuityScore,
        opponentPositionPts: opponentPositionAllowance,
        opponentPositionAst: opponentPositionMetrics.ast,
        defenderStocksPer36,
        shotPressureIndex: ptsProjection.shotPressure.shotPressureIndex,
        threeShare: ptsProjection.shotPressure.threeShare,
        freeThrowPressure: ptsProjection.shotPressure.freeThrowPressure,
        baselineProjection: ptsProjection.baselineProjection,
        lineAnchor: historicalPtsLine?.line ?? toHalfHookLineLocal(projectedTonight.PTS),
        actualPoints: actuals.PTS,
      });
    }

    const targetGame = gameByExternalId.get(target.externalGameId);
    const matchupKey = targetGame ? `${targetGame.awayTeamCode}@${targetGame.homeTeamCode}` : `${target.teamCode ?? "UNK"}@${target.opponent ?? "UNK"}`;

    results.push({
      gameDateEt: target.gameDateEt,
      matchupKey,
      teamCode: target.teamCode,
      opponentCode: target.opponent,
      projectedMinutes: minutesProfile.expected,
      actualMinutes: target.minutes,
      completenessScore: completeness.score,
      projections: projectedTonight,
      fairLines,
      predictedSides,
      actuals,
      actualSides,
      sideCorrect,
      historicalContext: {
        openingTeamSpread,
        openingTotal,
        playerStarted,
        starterResolved,
        starterSource,
        starterStatus: rotowireTeamSignal?.status ?? null,
        missingKeyTeammatePts: blendedLineupShift.missingPts,
        benchedKeyTeammatePts: blendedLineupShift.benchedPts,
        defenderStocksPer36,
        spreadResolved: openingTotal != null || openingTeamSpread != null,
        spreadSource: historicalPregame?.source ?? null,
        bookPtsLine: historicalPtsLine?.line ?? null,
        bookPtsLineSource: historicalPtsLine?.source ?? null,
        opponentShotVolumeSample: opponentShotVolume.sample,
        ptsSideConfidence: ptsProjection.sideDecision.confidence,
        ptsOverScore: ptsProjection.sideDecision.overScore,
        ptsUnderScore: ptsProjection.sideDecision.underScore,
        ptsMinutesRisk: ptsProjection.minutesRisk.riskScore,
        lineupTimingConfidence,
        ptsQualifiedBet,
      },
    });
  }

  const perMarket = Object.fromEntries(
    SNAPSHOT_MARKETS.map((market) => {
      const aggregate = aggregates[market];
      const resolvedSides = aggregate.correctSide + aggregate.wrongSide;
      return [
        market,
        {
          samples: aggregate.samples,
          mae: aggregate.samples > 0 ? round(aggregate.absErrorSum / aggregate.samples, 3) : null,
          rmse: aggregate.samples > 0 ? round(Math.sqrt(aggregate.squaredErrorSum / aggregate.samples), 3) : null,
          bias: aggregate.samples > 0 ? round(aggregate.errorSum / aggregate.samples, 3) : null,
          correctSide: aggregate.correctSide,
          wrongSide: aggregate.wrongSide,
          pushes: aggregate.pushes,
          sideAccuracyPct: resolvedSides > 0 ? round((aggregate.correctSide / resolvedSides) * 100, 2) : null,
          overCalls: aggregate.overCalls,
          underCalls: aggregate.underCalls,
        },
      ];
    }),
  ) as Record<
    SnapshotMarket,
    {
      samples: number;
      mae: number | null;
      rmse: number | null;
      bias: number | null;
      correctSide: number;
      wrongSide: number;
      pushes: number;
      sideAccuracyPct: number | null;
      overCalls: number;
      underCalls: number;
    }
  >;

  const overallSamples = Object.values(aggregates).reduce((sum, market) => sum + market.samples, 0);
  const overallAbsError = Object.values(aggregates).reduce((sum, market) => sum + market.absErrorSum, 0);
  const overallCorrect = Object.values(aggregates).reduce((sum, market) => sum + market.correctSide, 0);
  const overallWrong = Object.values(aggregates).reduce((sum, market) => sum + market.wrongSide, 0);
  const overallPushes = Object.values(aggregates).reduce((sum, market) => sum + market.pushes, 0);

  const output = {
    player: {
      id: player.id,
      name: player.fullName,
      position: player.position,
    },
    range: {
      from: args.from,
      to: args.to,
      seasonStartDateEt,
      minActualMinutes: args.minActualMinutes,
    },
    coverage: {
      ptsBookLinesResolved: ptsBookLineCoverage,
      ptsExternalLinesResolved: ptsExternalLineCoverage,
      pregameLineupSignalsResolved: pregameLineupCoverage,
      opponentShotVolumeResolved: opponentShotVolumeCoverage,
      totalGames: results.length,
    },
    gameCount: results.length,
    overall: {
      samples: overallSamples,
      blendedMae: overallSamples > 0 ? round(overallAbsError / overallSamples, 3) : null,
      correctSide: overallCorrect,
      wrongSide: overallWrong,
      pushes: overallPushes,
      sideAccuracyPct: overallCorrect + overallWrong > 0 ? round((overallCorrect / (overallCorrect + overallWrong)) * 100, 2) : null,
    },
    ptsSideConfidenceBuckets: Object.fromEntries(
      Object.entries(ptsConfidenceBuckets).map(([tier, stats]) => {
        const resolved = stats.correct + stats.wrong;
        return [
          tier,
          {
            correct: stats.correct,
            wrong: stats.wrong,
            sideAccuracyPct: resolved > 0 ? round((stats.correct / resolved) * 100, 2) : null,
          },
        ];
      }),
    ),
    ptsQualifiedBetRule: {
      minConfidence: 60,
      maxMinutesRisk: 0.65,
      minProjectionGap: 1.5,
      blockOverWhenFavoriteBy: -6.5,
    },
    ptsQualifiedBetResults: {
      qualifiedBets: ptsQualifiedStats.qualified,
      correct: ptsQualifiedStats.correct,
      wrong: ptsQualifiedStats.wrong,
      sideAccuracyPct:
        ptsQualifiedStats.correct + ptsQualifiedStats.wrong > 0
          ? round((ptsQualifiedStats.correct / (ptsQualifiedStats.correct + ptsQualifiedStats.wrong)) * 100, 2)
          : null,
    },
    perMarket,
    games: results,
  };

  if (args.out) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const resolved = path.resolve(args.out);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(`Saved player season backtest to ${resolved}`);
  }

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

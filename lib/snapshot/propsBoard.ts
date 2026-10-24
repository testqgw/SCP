import type {
  SnapshotBoardViewData,
  SnapshotDashboardRow,
  SnapshotDashboardSignal,
  SnapshotMarket,
  SnapshotModelSide,
  SnapshotStatLog,
} from "@/lib/types/snapshot";

// Every live sportsbook line on the slate, one entry per player and market. Rows with only a
// model fair line (no book is quoting the prop) are left out.

export const PROPS_BOARD_MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PR", "PA", "RA", "PRA"];

export const PROPS_BOARD_MARKET_LABELS: Record<SnapshotMarket, string> = {
  PTS: "PTS",
  REB: "REB",
  AST: "AST",
  THREES: "3PM",
  PRA: "PRA",
  PA: "PA",
  PR: "PR",
  RA: "RA",
};

const SIGNAL_KEY: Record<SnapshotMarket, keyof SnapshotDashboardRow> = {
  PTS: "ptsSignal",
  REB: "rebSignal",
  AST: "astSignal",
  THREES: "threesSignal",
  PRA: "praSignal",
  PA: "paSignal",
  PR: "prSignal",
  RA: "raSignal",
};

export type PropsBoardGame = {
  key: string;
  awayTeam: string;
  homeTeam: string;
  gameTimeEt: string;
  startMs: number | null;
  propCount: number;
};

export type PropsBoardEntry = {
  key: string;
  playerId: string;
  playerName: string;
  position: string | null;
  teamCode: string;
  opponentCode: string;
  isHome: boolean;
  matchupKey: string;
  gameTimeEt: string;
  market: SnapshotMarket;
  line: number;
  books: number;
  overPrice: number | null;
  underPrice: number | null;
  overProbability: number | null;
  projection: number | null;
  edge: number | null;
  lean: SnapshotModelSide;
  // Newest game first.
  last5: number[];
  last5Over: number;
  last10Average: number | null;
  // The board's "seasonAverage" covers every game it loaded for the player (several seasons).
  allGamesAverage: number | null;
  opponentDelta: number | null;
  projectedMinutes: number | null;
  minutesFloor: number | null;
  minutesCeiling: number | null;
  starter: boolean | null;
  roleLabel: string | null;
  availabilityStatus: string | null;
  availabilityPercentPlay: number | null;
  primaryDefender: string | null;
  grade: { grade: string; summary: string; reasons: string[] } | null;
  passReasons: string[];
};

export type PropsBoardData = {
  dateEt: string;
  lastUpdatedAt: string | null;
  games: PropsBoardGame[];
  props: PropsBoardEntry[];
};

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number | null, digits: number): number | null {
  if (value == null) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

// American odds live outside (-100, +100). Consensus prices that fall inside that band come from
// averaging a minus and a plus price across books, so they are not real quotes.
export function validAmericanPrice(value: number | null | undefined): number | null {
  const price = finite(value);
  if (price == null || Math.abs(price) < 100) return null;
  return price;
}

export function impliedProbability(price: number | null): number | null {
  if (price == null) return null;
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

export function noVigOverProbability(overPrice: number | null, underPrice: number | null): number | null {
  const over = impliedProbability(validAmericanPrice(overPrice));
  const under = impliedProbability(validAmericanPrice(underPrice));
  if (over == null || under == null) return null;
  return over / (over + under);
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function newYorkOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - utcMs) / 60000);
}

// "Oct 23, 9:30 PM" (Eastern) on the board's season year -> epoch ms.
export function gameStartMs(dateEt: string, gameTimeEt: string | null | undefined): number | null {
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{1,2}):(\d{2}) (AM|PM)$/.exec((gameTimeEt ?? "").trim());
  const year = Number(dateEt.slice(0, 4));
  if (!match || !Number.isFinite(year) || MONTHS[match[1]] == null) return null;
  const hour = (Number(match[3]) % 12) + (match[5] === "PM" ? 12 : 0);
  const wallClockAsUtc = Date.UTC(year, MONTHS[match[1]], Number(match[2]), hour, Number(match[4]));
  const offset = newYorkOffsetMinutes(wallClockAsUtc + 5 * 3600000);
  return wallClockAsUtc - offset * 60000;
}

function signalFor(row: SnapshotDashboardRow, market: SnapshotMarket): SnapshotDashboardSignal | null {
  return (row[SIGNAL_KEY[market]] as SnapshotDashboardSignal | null | undefined) ?? null;
}

function toEntry(row: SnapshotDashboardRow, market: SnapshotMarket): PropsBoardEntry | null {
  const signal = signalFor(row, market);
  const line = finite(signal?.marketLine);
  if (!signal || line == null) return null;

  const projection = finite(row.projectedTonight?.[market]);
  const last5 = (row.last5?.[market] ?? []).filter((value): value is number => finite(value) != null);
  const overPrice = validAmericanPrice(signal.overPrice);
  const underPrice = validAmericanPrice(signal.underPrice);
  const context = row.playerContext;
  const grade = row.marketRuntime?.[market]?.signalGrade ?? null;
  const homeTeam = row.matchupKey.split("@")[1] ?? "";

  return {
    key: `${row.playerId}:${market}`,
    playerId: row.playerId,
    playerName: row.playerName,
    position: row.position ?? null,
    teamCode: row.teamCode,
    opponentCode: row.opponentCode,
    isHome: row.teamCode === homeTeam,
    matchupKey: row.matchupKey,
    gameTimeEt: row.gameTimeEt,
    market,
    line,
    books: signal.sportsbookCount ?? 0,
    overPrice,
    underPrice,
    overProbability: round(noVigOverProbability(overPrice, underPrice), 4),
    projection: round(projection, 1),
    edge: projection == null ? null : round(projection - line, 1),
    lean: signal.side ?? "NEUTRAL",
    last5,
    last5Over: last5.filter((value) => value > line).length,
    last10Average: round(finite(row.last10Average?.[market]), 1),
    allGamesAverage: round(finite(row.seasonAverage?.[market]), 1),
    opponentDelta: round(finite(row.opponentAllowanceDelta?.[market]), 1),
    projectedMinutes: round(finite(context?.projectedMinutes), 1),
    minutesFloor: round(finite(context?.projectedMinutesFloor), 1),
    minutesCeiling: round(finite(context?.projectedMinutesCeiling), 1),
    starter: context?.lineupStarter ?? null,
    roleLabel: context?.projectedStarter ?? null,
    availabilityStatus: context?.availabilityStatus ?? null,
    availabilityPercentPlay: finite(context?.availabilityPercentPlay),
    primaryDefender: context?.primaryDefender?.playerName ?? null,
    grade: grade ? { grade: grade.grade, summary: grade.summary, reasons: grade.reasons.slice(0, 4) } : null,
    passReasons: (signal.passReasons ?? []).slice(0, 2),
  };
}

export function buildPropsBoardData(data: SnapshotBoardViewData): PropsBoardData {
  const props: PropsBoardEntry[] = [];
  for (const row of data.rows) {
    for (const market of PROPS_BOARD_MARKETS) {
      const entry = toEntry(row, market);
      if (entry) props.push(entry);
    }
  }

  const counts = new Map<string, number>();
  for (const entry of props) counts.set(entry.matchupKey, (counts.get(entry.matchupKey) ?? 0) + 1);

  const games: PropsBoardGame[] = data.matchups
    .map((matchup) => ({
      key: matchup.key,
      awayTeam: matchup.awayTeam,
      homeTeam: matchup.homeTeam,
      gameTimeEt: matchup.gameTimeEt,
      startMs: gameStartMs(data.dateEt, matchup.gameTimeEt),
      propCount: counts.get(matchup.key) ?? 0,
    }))
    .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity) || a.key.localeCompare(b.key));

  return { dateEt: data.dateEt, lastUpdatedAt: data.lastUpdatedAt ?? null, games, props };
}

export function statForMarket(log: SnapshotStatLog, market: SnapshotMarket): number {
  switch (market) {
    case "PTS":
      return log.points;
    case "REB":
      return log.rebounds;
    case "AST":
      return log.assists;
    case "THREES":
      return log.threes;
    case "PRA":
      return log.points + log.rebounds + log.assists;
    case "PA":
      return log.points + log.assists;
    case "PR":
      return log.points + log.rebounds;
    case "RA":
      return log.rebounds + log.assists;
  }
}

export type LineHitSummary = { over: number; under: number; push: number; games: number };

export function lineHitSummary(values: number[], line: number): LineHitSummary {
  const summary = { over: 0, under: 0, push: 0, games: values.length };
  for (const value of values) {
    if (value > line) summary.over += 1;
    else if (value < line) summary.under += 1;
    else summary.push += 1;
  }
  return summary;
}

// NBA seasons start in October; anything from August on belongs to the season that starts that fall.
export function seasonStartDate(dateEt: string): string {
  const year = Number(dateEt.slice(0, 4));
  const month = Number(dateEt.slice(5, 7));
  return `${month >= 8 ? year : year - 1}-08-01`;
}

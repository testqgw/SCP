// Pure ESPN NBA payload parsers. No runtime imports so `node --test` can load this file directly.
//
// IDs produced here are ESPN-native: externalGameId is the ESPN event id and externalPlayerId is the
// ESPN athlete id. They must be translated to NBA game/person ids before anything is written to the DB.
import type { NormalizedNbaScheduleGame } from "@/lib/nba/client";
import type { NormalizedPlayerGameStat, NormalizedPlayerSeason } from "@/lib/sportsdata/types";

export type EspnBoxScorePayload = {
  players: NormalizedPlayerSeason[];
  logs: NormalizedPlayerGameStat[];
};

type UnknownRecord = Record<string, unknown>;

// Mirrors toCanonicalTeamCode in lib/sportsdata/normalize.ts (not imported to keep this file dependency-free).
const ESPN_TEAM_CODE_MAP: Record<string, string> = {
  GS: "GSW",
  NO: "NOP",
  NY: "NYK",
  SA: "SAS",
  UTAH: "UTA",
  WSH: "WAS",
  PHO: "PHX",
};

export function toCanonicalEspnTeamCode(abbreviation: string | null): string | null {
  if (!abbreviation) return null;
  const upper = abbreviation.trim().toUpperCase();
  return ESPN_TEAM_CODE_MAP[upper] ?? upper;
}

function asRecord(input: unknown): UnknownRecord | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as UnknownRecord;
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim().replace(/^\+/, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatEtDate(reference: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

/** Inclusive list of YYYY-MM-DD dates between from and to. */
export function listDatesInclusive(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Invalid ESPN date range: ${from}..${to}`);
  }
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** "2026-10-22" -> "20261022" for the ESPN `dates` query param. */
export function toEspnDateParam(dateEt: string): string {
  return dateEt.replace(/-/g, "");
}

/**
 * Maps ESPN status to the NBA CDN `gameStatus` convention used by refresh.ts:
 * 1 = scheduled, 2 = in progress, 3 = final. Postponed/canceled games report state "post" with
 * completed=false, so only `completed` can mark a game final.
 */
export function espnStatusNumber(statusType: UnknownRecord | null): number {
  if (!statusType) return 0;
  if (statusType.completed === true) return 3;
  if (toStringOrNull(statusType.state) === "in") return 2;
  return 1;
}

function teamName(team: UnknownRecord | null): string | null {
  return toStringOrNull(team?.displayName) ?? toStringOrNull(team?.name);
}

function parseCompetitionGame(
  eventId: string,
  competition: UnknownRecord,
  statusType: UnknownRecord | null,
  dateValue: string | null,
  inferSeason: (dateEt: string) => string,
): NormalizedNbaScheduleGame | null {
  const competitors = asArray(competition.competitors).map(asRecord);
  const home = competitors.find((entry) => toStringOrNull(entry?.homeAway) === "home") ?? null;
  const away = competitors.find((entry) => toStringOrNull(entry?.homeAway) === "away") ?? null;
  const homeTeam = asRecord(home?.team);
  const awayTeam = asRecord(away?.team);
  const homeAbbr = toCanonicalEspnTeamCode(toStringOrNull(homeTeam?.abbreviation));
  const awayAbbr = toCanonicalEspnTeamCode(toStringOrNull(awayTeam?.abbreviation));
  const commenceTimeUtc = toDate(dateValue);
  if (!homeAbbr || !awayAbbr || !commenceTimeUtc) {
    return null;
  }

  const gameDateEt = formatEtDate(commenceTimeUtc);
  return {
    externalGameId: eventId,
    gameDateEt,
    commenceTimeUtc,
    status: toStringOrNull(statusType?.shortDetail) ?? toStringOrNull(statusType?.description),
    statusNumber: espnStatusNumber(statusType),
    homeTeamAbbr: homeAbbr,
    awayTeamAbbr: awayAbbr,
    homeTeamName: teamName(homeTeam),
    awayTeamName: teamName(awayTeam),
    season: inferSeason(gameDateEt),
  };
}

/** Parses `/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD`. */
export function parseEspnScoreboard(
  payload: unknown,
  inferSeason: (dateEt: string) => string,
): NormalizedNbaScheduleGame[] {
  const games: NormalizedNbaScheduleGame[] = [];
  for (const rawEvent of asArray(asRecord(payload)?.events)) {
    const event = asRecord(rawEvent);
    const eventId = toStringOrNull(event?.id);
    const competition = asRecord(asArray(event?.competitions)[0]);
    if (!event || !eventId || !competition) {
      continue;
    }
    const statusType = asRecord(asRecord(competition.status)?.type) ?? asRecord(asRecord(event.status)?.type);
    const game = parseCompetitionGame(
      eventId,
      competition,
      statusType,
      toStringOrNull(competition.date) ?? toStringOrNull(event.date),
      inferSeason,
    );
    if (game) {
      games.push(game);
    }
  }
  return games;
}

export type EspnTeam = { espnTeamId: string; teamAbbr: string };
export type EspnRosterPlayer = { espnId: string; fullName: string; teamAbbr: string; jersey: string | null };

/** Parses `/apis/site/v2/sports/basketball/nba/teams`. */
export function parseEspnTeams(payload: unknown): EspnTeam[] {
  const league = asRecord(asArray(asRecord(asArray(asRecord(payload)?.sports)[0])?.leagues)[0]);
  const teams: EspnTeam[] = [];
  for (const entry of asArray(league?.teams)) {
    const team = asRecord(asRecord(entry)?.team);
    const espnTeamId = toStringOrNull(team?.id);
    const teamAbbr = toCanonicalEspnTeamCode(toStringOrNull(team?.abbreviation));
    if (espnTeamId && teamAbbr) {
      teams.push({ espnTeamId, teamAbbr });
    }
  }
  return teams;
}

/** Parses `/apis/site/v2/sports/basketball/nba/teams/{id}/roster`. */
export function parseEspnRoster(payload: unknown, teamAbbr: string): EspnRosterPlayer[] {
  const players: EspnRosterPlayer[] = [];
  for (const entry of asArray(asRecord(payload)?.athletes)) {
    const athlete = asRecord(entry);
    const espnId = toStringOrNull(athlete?.id);
    const fullName = toStringOrNull(athlete?.fullName) ?? toStringOrNull(athlete?.displayName);
    if (espnId && fullName) {
      players.push({ espnId, fullName, teamAbbr, jersey: toStringOrNull(athlete?.jersey) });
    }
  }
  return players;
}

function splitDisplayName(displayName: string): { firstName: string | null; lastName: string | null } {
  const [first, ...rest] = displayName.split(/\s+/);
  return {
    firstName: first || null,
    lastName: rest.length > 0 ? rest.join(" ") : null,
  };
}

/** "3-8" -> 3 (made half of a made-attempted pair). */
function madeFromPair(value: unknown): number | null {
  const text = toStringOrNull(value);
  if (!text) return null;
  const match = text.match(/^(\d+)-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function statReader(keys: string[], stats: unknown[]) {
  return (key: string): unknown => {
    const index = keys.indexOf(key);
    return index >= 0 ? stats[index] : undefined;
  };
}

/**
 * Parses `/apis/site/v2/sports/basketball/nba/summary?event=ID`.
 * ESPN only reports whole minutes, unlike the NBA CDN's ISO durations.
 */
export function parseEspnBoxScore(payload: unknown, fallbackGame: NormalizedNbaScheduleGame): EspnBoxScorePayload {
  const root = asRecord(payload);
  const headerCompetition = asRecord(asArray(asRecord(root?.header)?.competitions)[0]);
  const competitors = asArray(headerCompetition?.competitors).map(asRecord);
  const homeTeamId = toStringOrNull(
    asRecord(competitors.find((entry) => toStringOrNull(entry?.homeAway) === "home")?.team)?.id,
  );
  const headerDate = toDate(toStringOrNull(headerCompetition?.date));
  const gameDateEt = headerDate ? formatEtDate(headerDate) : fallbackGame.gameDateEt;

  const players: NormalizedPlayerSeason[] = [];
  const logs: NormalizedPlayerGameStat[] = [];
  const sides = asArray(asRecord(root?.boxscore)?.players).map(asRecord);

  for (const side of sides) {
    const team = asRecord(side?.team);
    const teamAbbr = toCanonicalEspnTeamCode(toStringOrNull(team?.abbreviation));
    if (!side || !teamAbbr) {
      continue;
    }
    const isHome = homeTeamId
      ? toStringOrNull(team?.id) === homeTeamId
      : teamAbbr === fallbackGame.homeTeamAbbr;
    const opponentAbbr = isHome ? fallbackGame.awayTeamAbbr : fallbackGame.homeTeamAbbr;

    const group = asRecord(asArray(side.statistics)[0]);
    const keys = asArray(group?.keys).map((key) => toStringOrNull(key) ?? "");

    for (const rawEntry of asArray(group?.athletes)) {
      const entry = asRecord(rawEntry);
      const athlete = asRecord(entry?.athlete);
      const athleteId = toStringOrNull(athlete?.id);
      const fullName = toStringOrNull(athlete?.displayName);
      if (!entry || !athleteId || !fullName) {
        continue;
      }

      const { firstName, lastName } = splitDisplayName(fullName);
      const position = toStringOrNull(asRecord(athlete?.position)?.abbreviation);
      const didNotPlay = entry.didNotPlay === true;
      const read = statReader(keys, asArray(entry.stats));
      // NBA CDN box scores report zeroed stat lines for DNPs; ESPN sends an empty array. Match the NBA shape.
      const stat = (value: number | null): number | null => (didNotPlay ? 0 : value);
      const minutes = stat(toNumberOrNull(read("minutes")));

      players.push({
        externalPlayerId: athleteId,
        fullName,
        firstName,
        lastName,
        teamAbbr,
        position,
        usageRate: null,
        // ESPN's `active` flag means "on the floor", not roster status; box-score presence implies active.
        isActive: true,
      });
      logs.push({
        externalPlayerId: athleteId,
        externalGameId: fallbackGame.externalGameId,
        gameDateEt,
        fullName,
        firstName,
        lastName,
        position,
        teamAbbr,
        opponentAbbr,
        isHome,
        starter: typeof entry.starter === "boolean" ? entry.starter : null,
        played: !didNotPlay && (minutes ?? 0) > 0,
        minutes,
        points: stat(toNumberOrNull(read("points"))),
        rebounds: stat(toNumberOrNull(read("rebounds"))),
        assists: stat(toNumberOrNull(read("assists"))),
        threes: stat(madeFromPair(read("threePointFieldGoalsMade-threePointFieldGoalsAttempted"))),
        steals: stat(toNumberOrNull(read("steals"))),
        blocks: stat(toNumberOrNull(read("blocks"))),
        turnovers: stat(toNumberOrNull(read("turnovers"))),
        pace: null,
        total: null,
      });
    }
  }

  return { players, logs };
}

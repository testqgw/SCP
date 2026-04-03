import { getTodayEtDateString } from "@/lib/snapshot/time";
import { toNumber, toStringOrNull } from "@/lib/utils";
import type {
  NormalizedGame,
  NormalizedInjury,
  NormalizedPlayerGameStat,
  NormalizedPlayerSeason,
} from "@/lib/sportsdata/types";

export function toCanonicalTeamCode(providerAbbr: string | null): string | null {
  if (!providerAbbr) return null;
  const upper = providerAbbr.trim().toUpperCase();
  const map: Record<string, string> = {
    NO: "NOP",
    NY: "NYK",
    SA: "SAS",
    GS: "GSW",
    UTAH: "UTA",
    WSH: "WAS",
    PHO: "PHX",
  };
  return map[upper] ?? upper;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(input: unknown): UnknownRecord | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as UnknownRecord;
}

function readString(record: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = toStringOrNull(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function readNumber(record: UnknownRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value != null) {
      return value;
    }
  }
  return null;
}

function parseBooleanLike(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") {
    if (raw === 1) return true;
    if (raw === 0) return false;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "y", "active"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "inactive"].includes(normalized)) return false;
  }
  return null;
}

function readBoolean(record: UnknownRecord, keys: string[]): boolean | null {
  for (const key of keys) {
    const parsed = parseBooleanLike(record[key]);
    if (parsed != null) return parsed;
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

function toEtDateString(date: Date | null): string {
  if (!date) {
    return getTodayEtDateString();
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}


export function normalizeGames(rawRows: unknown[]): NormalizedGame[] {
  const result: NormalizedGame[] = [];

  rawRows.forEach((item) => {
    const row = asRecord(item);
    if (!row) {
      return;
    }
    const externalGameId = readString(row, ["GameID", "GameId", "gameId", "Id", "ID"]);
    const homeTeamRaw = readString(row, ["HomeTeam", "homeTeam", "Home"]);
    const awayTeamRaw = readString(row, ["AwayTeam", "awayTeam", "Away"]);
    const homeTeamAbbr = toCanonicalTeamCode(homeTeamRaw);
    const awayTeamAbbr = toCanonicalTeamCode(awayTeamRaw);
    if (!externalGameId || !homeTeamAbbr || !awayTeamAbbr) {
      return;
    }

    const dateValue = readString(row, ["DateTime", "Day", "Date", "StartTime", "GameDate"]);
    const commenceTimeUtc = toDate(dateValue);

    result.push({
      externalGameId,
      gameDateEt: toEtDateString(commenceTimeUtc),
      commenceTimeUtc,
      status: readString(row, ["Status", "GameStatus", "StatusDescription"]),
      homeTeamAbbr,
      awayTeamAbbr,
      homeTeamName: readString(row, ["HomeTeamName", "HomeTeamFullName", "HomeName"]),
      awayTeamName: readString(row, ["AwayTeamName", "AwayTeamFullName", "AwayName"]),
      season: readString(row, ["Season", "SeasonName"]),
    });
  });

  return result;
}

export function normalizeSeasonPlayers(rawRows: unknown[]): NormalizedPlayerSeason[] {
  const players: NormalizedPlayerSeason[] = [];

  rawRows.forEach((item) => {
    const row = asRecord(item);
    if (!row) {
      return;
    }
    const externalPlayerId = readString(row, ["PlayerID", "PlayerId", "playerId", "Id", "ID"]);
    if (!externalPlayerId) {
      return;
    }
    const firstName = readString(row, ["FirstName", "firstName"]);
    const lastName = readString(row, ["LastName", "lastName"]);
    const fullName =
      readString(row, ["Name", "FullName", "fullName"]) ??
      [firstName, lastName].filter(Boolean).join(" ").trim();

    if (!fullName) {
      return;
    }

    const teamRaw = readString(row, ["Team", "TeamAbbr", "team"]);

    players.push({
      externalPlayerId,
      fullName,
      firstName,
      lastName,
      teamAbbr: toCanonicalTeamCode(teamRaw),
      position: readString(row, ["Position", "position"]),
      usageRate: readNumber(row, ["UsageRate", "UsagePercentage", "UsgPct"]),
      isActive: !["false", "0", "inactive"].includes(
        (readString(row, ["Active", "IsActive", "Status"]) ?? "true").toLowerCase(),
      ),
    });
  });

  return players;
}

export function normalizeBoxScorePlayerLogs(rawRows: unknown[]): NormalizedPlayerGameStat[] {
  const stats: NormalizedPlayerGameStat[] = [];

  rawRows.forEach((item) => {
    const box = asRecord(item);
    if (!box) {
      return;
    }
    const game = asRecord(box.Game);
    const playerGames = Array.isArray(box.PlayerGames) ? box.PlayerGames : [];
    const gameDate = toDate(readString(game ?? {}, ["DateTime", "Day", "Date", "GameDate"]));
    const gameDateEt = toEtDateString(gameDate);
    const gameTotal = readNumber(game ?? {}, ["OverUnder", "Total"]);

    playerGames.forEach((playerGameRaw) => {
      const row = asRecord(playerGameRaw);
      if (!row) {
        return;
      }
      const externalPlayerId = readString(row, ["PlayerID", "PlayerId", "playerId"]);
      if (!externalPlayerId) {
        return;
      }

      const teamProvider = readString(row, ["Team", "TeamAbbr", "team"]);
      const opponentProvider = readString(row, ["Opponent", "OpponentTeam", "opponent"]);
      const homeOrAway = readString(row, ["HomeOrAway", "Venue"]);
      const normalizedHomeAway = (homeOrAway ?? "").toLowerCase();

      stats.push({
        externalPlayerId,
        externalGameId: readString(row, ["GameID", "GameId", "gameId"]),
        gameDateEt,
        fullName: readString(row, ["Name", "FullName", "PlayerName"]),
        firstName: readString(row, ["FirstName", "firstName"]),
        lastName: readString(row, ["LastName", "lastName"]),
        position: readString(row, ["Position", "position"]),
        teamAbbr: toCanonicalTeamCode(teamProvider),
        opponentAbbr: toCanonicalTeamCode(opponentProvider),
        isHome: normalizedHomeAway.includes("home") ? true : normalizedHomeAway.includes("away") ? false : null,
        starter: readBoolean(row, ["Starter", "IsStarter", "Started"]),
        played: readBoolean(row, ["Played", "DidPlay"]),
        minutes: readNumber(row, ["Minutes", "Min", "minutes"]),
        points: readNumber(row, ["Points", "Pts", "points"]),
        rebounds: readNumber(row, ["Rebounds", "Reb", "rebounds"]),
        assists: readNumber(row, ["Assists", "Ast", "assists"]),
        threes: readNumber(row, ["ThreePointersMade", "ThreePointers", "Threes", "3PM"]),
        steals: readNumber(row, ["Steals", "stl"]),
        blocks: readNumber(row, ["BlockedShots", "Blocks", "blk"]),
        turnovers: readNumber(row, ["Turnovers", "Tov"]),
        pace: readNumber(row, ["Pace", "TeamPace"]),
        total: gameTotal,
      });
    });
  });

  return stats;
}

export function normalizeInjuries(rawRows: unknown[]): NormalizedInjury[] {
  const injuries: NormalizedInjury[] = [];

  rawRows.forEach((item) => {
    const row = asRecord(item);
    if (!row) {
      return;
    }
    const externalPlayerId = readString(row, ["PlayerID", "PlayerId", "playerId"]);
    const status = readString(row, ["Status", "InjuryStatus", "Injury"]);
    if (!externalPlayerId || !status) {
      return;
    }

    injuries.push({
      externalPlayerId,
      teamAbbr: toCanonicalTeamCode(readString(row, ["Team", "TeamAbbr", "team"])),
      status,
    });
  });

  return injuries;
}

import { normalizeMarketFromBetType, toCanonicalTeamCode } from "@/lib/snapshot/markets";
import { getTodayEtDateString } from "@/lib/snapshot/time";
import { toNumber, toStringOrNull } from "@/lib/utils";
import type {
  BettingMetadata,
  NormalizedBettingEvent,
  NormalizedGame,
  NormalizedInjury,
  NormalizedPlayerGameStat,
  NormalizedPlayerProp,
  NormalizedPlayerSeason,
  NormalizedSportsbook,
} from "@/lib/sportsdata/types";

type UnknownRecord = Record<string, unknown>;

type NormalizePropsInput = {
  metadata: BettingMetadata;
  externalGameId: string;
  capturedAt: Date;
  homeTeamProvider: string | null;
  awayTeamProvider: string | null;
};

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

function sportsbookKey(providerSportsbookId: number | null, displayName: string): string {
  if (providerSportsbookId != null) {
    return `sdio_${providerSportsbookId}`;
  }
  const slug = displayName.trim().toLowerCase().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");
  return `sdio_${slug || "unknown"}`;
}

function detectOutcomeSide(
  outcomeTypeId: number | null,
  outcomeTypeName: string | null,
  participant: string | null,
): "OVER" | "UNDER" | null {
  const normalizedType = (outcomeTypeName ?? "").toUpperCase();
  const normalizedParticipant = (participant ?? "").toUpperCase();

  if (normalizedType.includes("OVER") || normalizedParticipant.includes("OVER")) {
    return "OVER";
  }
  if (normalizedType.includes("UNDER") || normalizedParticipant.includes("UNDER")) {
    return "UNDER";
  }
  if (normalizedType.includes("YES") || normalizedParticipant === "YES") {
    return "OVER";
  }
  if (normalizedType.includes("NO") || normalizedParticipant === "NO") {
    return "UNDER";
  }

  if (outcomeTypeId === 3 || outcomeTypeId === 5) {
    return "OVER";
  }
  if (outcomeTypeId === 4 || outcomeTypeId === 6) {
    return "UNDER";
  }

  return null;
}

function isAlternate(outcome: UnknownRecord): boolean {
  const value = outcome.IsAlternate;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
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

export function normalizeActiveSportsbooks(rawRows: unknown[]): NormalizedSportsbook[] {
  const books: NormalizedSportsbook[] = [];

  rawRows.forEach((item) => {
    const row = asRecord(item);
    if (!row) return;
    const providerSportsbookId = readNumber(row, ["SportsbookID", "SportsBookID", "SportsbookId"]);
    const providerNameRaw = readString(row, ["Name", "SportsbookName", "DisplayName"]);
    if (!providerNameRaw) return;
    books.push({
      key: sportsbookKey(providerSportsbookId, providerNameRaw),
      displayName: providerNameRaw,
      providerSportsbookId,
      providerNameRaw,
    });
  });

  return books;
}

export function normalizeBettingMetadata(raw: unknown): BettingMetadata {
  const payload = asRecord(raw) ?? {};

  const toMap = (key: string): Map<number, string> => {
    const list = Array.isArray(payload[key]) ? payload[key] : [];
    const map = new Map<number, string>();
    list.forEach((item) => {
      const row = asRecord(item);
      if (!row) return;
      const id = readNumber(row, ["RecordId", "ID", "Id"]);
      const name = readString(row, ["Name", "Description"]);
      if (id != null && name) {
        map.set(id, name);
      }
    });
    return map;
  };

  return {
    betTypeById: toMap("BettingBetTypes"),
    outcomeTypeById: toMap("BettingOutcomeTypes"),
    periodTypeById: toMap("BettingPeriodTypes"),
    marketTypeById: toMap("BettingMarketTypes"),
  };
}

export function normalizeBettingEvents(rawRows: unknown[]): NormalizedBettingEvent[] {
  const events: NormalizedBettingEvent[] = [];
  rawRows.forEach((item) => {
    const row = asRecord(item);
    if (!row) return;
    const bettingEventId = readString(row, ["BettingEventID", "BettingEventId", "EventId"]);
    const gameId = readString(row, ["GameID", "GameId", "gameId"]);
    if (!bettingEventId || !gameId) return;
    events.push({ bettingEventId, gameId });
  });
  return events;
}

export function normalizeBettingPlayerProps(rawRows: unknown[], input: NormalizePropsInput): NormalizedPlayerProp[] {
  const grouped = new Map<string, NormalizedPlayerProp>();
  const homeCanonical = toCanonicalTeamCode(input.homeTeamProvider);
  const awayCanonical = toCanonicalTeamCode(input.awayTeamProvider);

  rawRows.forEach((item) => {
    const marketRow = asRecord(item);
    if (!marketRow) return;

    const providerMarketId = readString(marketRow, ["BettingMarketID", "BettingMarketId"]);
    const providerBetTypeId = readNumber(marketRow, ["BettingBetTypeID", "BettingBetTypeId"]);
    const providerPeriodTypeId = readNumber(marketRow, ["BettingPeriodTypeID", "BettingPeriodTypeId"]);
    const marketTypeId = readNumber(marketRow, ["BettingMarketTypeID", "BettingMarketTypeId"]);
    const playerId = readString(marketRow, ["PlayerID", "PlayerId"]);
    const teamProvider = readString(marketRow, ["TeamKey", "Team", "TeamAbbr"]);
    const teamCanonical = toCanonicalTeamCode(teamProvider);
    const opponentCanonical =
      teamCanonical && homeCanonical && awayCanonical
        ? teamCanonical === homeCanonical
          ? awayCanonical
          : homeCanonical
        : null;
    const opponentProvider =
      teamCanonical && homeCanonical && awayCanonical && input.homeTeamProvider && input.awayTeamProvider
        ? teamCanonical === homeCanonical
          ? input.awayTeamProvider
          : input.homeTeamProvider
        : null;

    const marketTypeName = marketTypeId != null ? input.metadata.marketTypeById.get(marketTypeId) ?? null : null;
    if (marketTypeName && marketTypeName.toUpperCase() !== "PLAYER PROP") {
      return;
    }

    const periodTypeName =
      providerPeriodTypeId != null ? input.metadata.periodTypeById.get(providerPeriodTypeId) ?? null : null;
    if (periodTypeName && !periodTypeName.toUpperCase().includes("FULL")) {
      return;
    }

    const betTypeName =
      providerBetTypeId != null
        ? input.metadata.betTypeById.get(providerBetTypeId) ??
          readString(marketRow, ["BettingBetType", "Name", "Description"])
        : readString(marketRow, ["BettingBetType", "Name", "Description"]);
    const market = normalizeMarketFromBetType(betTypeName);
    if (!playerId || !market) {
      return;
    }

    const outcomes = Array.isArray(marketRow.BettingOutcomes) ? marketRow.BettingOutcomes : [];
    outcomes.forEach((outcomeRaw) => {
      const outcome = asRecord(outcomeRaw);
      if (!outcome) return;
      if (isAlternate(outcome)) return;

      const sportsbook = asRecord(outcome.SportsBook);
      const providerSportsbookId = readNumber(sportsbook ?? {}, ["SportsbookID", "SportsbookId"]);
      const sportsbookName = readString(sportsbook ?? {}, ["Name"]) ?? "Unknown";
      const key = sportsbookKey(providerSportsbookId, sportsbookName);

      const lineRaw = readNumber(outcome, ["Value", "Line"]);
      const line = lineRaw ?? (market === "DOUBLE_DOUBLE" || market === "TRIPLE_DOUBLE" ? 0.5 : null);
      const price = readNumber(outcome, ["PayoutAmerican", "Odds", "Price"]);
      if (line == null || price == null) {
        return;
      }

      const outcomeTypeId = readNumber(outcome, ["BettingOutcomeTypeID", "BettingOutcomeTypeId"]);
      const outcomeTypeName =
        outcomeTypeId != null
          ? input.metadata.outcomeTypeById.get(outcomeTypeId) ?? readString(outcome, ["BettingOutcomeType"])
          : readString(outcome, ["BettingOutcomeType"]);
      const participant = readString(outcome, ["Participant"]);
      const side = detectOutcomeSide(outcomeTypeId, outcomeTypeName, participant);
      if (!side) return;

      const groupKey = [
        input.externalGameId,
        playerId,
        key,
        market,
        line.toString(),
        providerMarketId ?? "unknown",
      ].join("|");

      const existing = grouped.get(groupKey) ?? {
        externalGameId: input.externalGameId,
        externalPlayerId: playerId,
        sportsbookKey: key,
        sportsbookDisplayName: sportsbookName,
        providerSportsbookId,
        market,
        rawMarketName: betTypeName ?? "Unknown",
        line,
        overPrice: null,
        underPrice: null,
        providerMarketId,
        providerBetTypeId,
        providerPeriodTypeId,
        providerOutcomeType: outcomeTypeName ?? null,
        teamCodeProvider: teamProvider ? teamProvider.toUpperCase() : null,
        opponentCodeProvider: opponentProvider ? opponentProvider.toUpperCase() : null,
        teamCodeCanonical: teamCanonical,
        opponentCodeCanonical: opponentCanonical,
        sourceFeed: "BETTING_PLAYER_PROPS_BY_GAME",
        capturedAt: input.capturedAt,
      };

      if (side === "OVER") {
        existing.overPrice = Math.round(price);
      }
      if (side === "UNDER") {
        existing.underPrice = Math.round(price);
      }

      grouped.set(groupKey, existing);
    });
  });

  return Array.from(grouped.values()).filter((entry) => entry.overPrice != null || entry.underPrice != null);
}

export function normalizeLegacyPlayerPropsByDate(rawRows: unknown[], capturedAt: Date): NormalizedPlayerProp[] {
  const grouped = new Map<string, NormalizedPlayerProp>();

  // Diagnostic: log the field names from the first raw row so we can verify
  // which keys the SportsData.io legacy endpoint actually returns.
  if (rawRows.length > 0) {
    const firstRow = asRecord(rawRows[0]);
    if (firstRow) {
      const keys = Object.keys(firstRow);
      console.log("[LEGACY_PROPS_DIAG] First row keys:", JSON.stringify(keys));
      // Also log a sample of numeric values to help identify field mapping
      const sampleValues: Record<string, unknown> = {};
      for (const k of keys) {
        const v = firstRow[k];
        if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()))) {
          sampleValues[k] = v;
        }
      }
      console.log("[LEGACY_PROPS_DIAG] Numeric fields sample:", JSON.stringify(sampleValues));
    }
  }

  rawRows.forEach((item) => {
    const row = asRecord(item);
    if (!row) return;

    const externalGameId = readString(row, ["GameID", "GameId", "gameId"]);
    const externalPlayerId = readString(row, ["PlayerID", "PlayerId", "playerId"]);
    const rawMarketName = readString(row, [
      "Description", "Market", "MarketName", "BettingMarketType",
      "Name", "BetType", "StatType", "Category",
    ]);
    const market = normalizeMarketFromBetType(rawMarketName);

    // Expanded field list: SportsData.io may use different field names across versions
    const line = readNumber(row, [
      "OverUnder", "Line", "Value", "Line_Value",
      "PlayerLine", "PropLine", "Total", "Spread",
      "Handicap", "Points", "Threshold",
    ]);
    if (!externalGameId || !externalPlayerId || !rawMarketName || !market || line == null) {
      return;
    }

    const sportsbookRaw = readString(row, [
      "Sportsbook", "SportsbookName", "Bookmaker", "Book", "Site",
      "SportsBook", "BookName", "Provider",
    ]);
    const sportsbookDisplayName = sportsbookRaw ?? "Consensus";
    const key = sportsbookRaw ? sportsbookKey(null, sportsbookRaw) : "sdio_consensus";

    const teamProvider = readString(row, ["Team", "TeamAbbr", "TeamKey"]);
    const opponentProvider = readString(row, ["Opponent", "OpponentTeam", "OpponentKey"]);
    const teamCanonical = toCanonicalTeamCode(teamProvider);
    const opponentCanonical = toCanonicalTeamCode(opponentProvider);

    const groupKey = [externalGameId, externalPlayerId, key, market, line.toString()].join("|");
    const current = grouped.get(groupKey) ?? {
      externalGameId,
      externalPlayerId,
      sportsbookKey: key,
      sportsbookDisplayName,
      providerSportsbookId: null,
      market,
      rawMarketName,
      line,
      overPrice: null,
      underPrice: null,
      providerMarketId: null,
      providerBetTypeId: null,
      providerPeriodTypeId: null,
      providerOutcomeType: null,
      teamCodeProvider: teamProvider ? teamProvider.toUpperCase() : null,
      opponentCodeProvider: opponentProvider ? opponentProvider.toUpperCase() : null,
      teamCodeCanonical: teamCanonical,
      opponentCodeCanonical: opponentCanonical,
      sourceFeed: "PLAYER_PROPS_BY_DATE_LEGACY",
      capturedAt,
    };

    // Expanded field candidates for over/under prices
    const over = readNumber(row, [
      "OverPayout", "OverOdds", "OverPrice",
      "OverPayoutAmerican", "OverAmerican", "OverLine",
      "PayoutOver", "OddsOver",
    ]);
    const under = readNumber(row, [
      "UnderPayout", "UnderOdds", "UnderPrice",
      "UnderPayoutAmerican", "UnderAmerican", "UnderLine",
      "PayoutUnder", "OddsUnder",
    ]);
    if (over != null) current.overPrice = Math.round(over);
    if (under != null) current.underPrice = Math.round(under);

    grouped.set(groupKey, current);
  });

  return Array.from(grouped.values()).filter((entry) => entry.overPrice != null || entry.underPrice != null);
}

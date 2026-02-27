import type { Market } from "@/lib/types/snapshot";

export type NormalizedGame = {
  externalGameId: string;
  gameDateEt: string;
  commenceTimeUtc: Date | null;
  status: string | null;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  homeTeamName: string | null;
  awayTeamName: string | null;
  season: string | null;
};

export type NormalizedPlayerSeason = {
  externalPlayerId: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  teamAbbr: string | null;
  position: string | null;
  usageRate: number | null;
  isActive: boolean;
};

export type NormalizedPlayerGameStat = {
  externalPlayerId: string;
  externalGameId: string | null;
  gameDateEt: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  teamAbbr: string | null;
  opponentAbbr: string | null;
  isHome: boolean | null;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threes: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  pace: number | null;
  total: number | null;
};

export type NormalizedInjury = {
  externalPlayerId: string;
  teamAbbr: string | null;
  status: string;
};

export type NormalizedSportsbook = {
  key: string;
  displayName: string;
  providerSportsbookId: number | null;
  providerNameRaw: string | null;
};

export type BettingMetadata = {
  betTypeById: Map<number, string>;
  outcomeTypeById: Map<number, string>;
  periodTypeById: Map<number, string>;
  marketTypeById: Map<number, string>;
};

export type NormalizedBettingEvent = {
  bettingEventId: string;
  gameId: string;
};

export type NormalizedPlayerProp = {
  externalGameId: string;
  externalPlayerId: string;
  sportsbookKey: string;
  sportsbookDisplayName: string;
  providerSportsbookId: number | null;
  market: Market;
  rawMarketName: string;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  providerMarketId: string | null;
  providerBetTypeId: number | null;
  providerPeriodTypeId: number | null;
  providerOutcomeType: string | null;
  teamCodeProvider: string | null;
  opponentCodeProvider: string | null;
  teamCodeCanonical: string | null;
  opponentCodeCanonical: string | null;
  sourceFeed: string;
  capturedAt: Date;
};

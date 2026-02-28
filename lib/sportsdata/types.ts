
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
  starter: boolean | null;
  played: boolean | null;
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

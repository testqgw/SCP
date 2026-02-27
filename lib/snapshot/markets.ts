import type { Market } from "@/lib/types/snapshot";

const MARKET_ALIASES: Array<[Market, string[]]> = [
  ["PTS", ["PTS", "POINTS", "PLAYER_POINTS", "POINTS_SCORED", "TOTAL_POINTS", "POINTS OVER UNDER"]],
  ["REB", ["REB", "REBOUNDS", "PLAYER_REBOUNDS", "TOTAL_REBOUNDS"]],
  ["AST", ["AST", "ASSISTS", "PLAYER_ASSISTS", "TOTAL_ASSISTS"]],
  [
    "THREES",
    ["THREES", "3PM", "THREE_POINTERS_MADE", "THREES_MADE", "3PT_MADE", "3-POINTERS MADE", "TOTAL_3_POINTERS_MADE"],
  ],
  [
    "PRA",
    [
      "PRA",
      "POINTS_REBOUNDS_ASSISTS",
      "POINTS+REBOUNDS+ASSISTS",
      "POINTS + REBOUNDS + ASSISTS",
      "PTS+REB+AST",
      "Pts + Rebs + Asts",
    ],
  ],
  ["PA", ["PA", "POINTS_ASSISTS", "POINTS+ASSISTS", "POINTS + ASSISTS", "PTS+AST", "TOTAL_POINTS_ASSISTS", "Pts + Asts"]],
  ["PR", ["PR", "POINTS_REBOUNDS", "POINTS+REBOUNDS", "POINTS + REBOUNDS", "PTS+REB", "TOTAL_POINTS_REBOUNDS", "Pts + Rebs"]],
  ["RA", ["RA", "REBOUNDS_ASSISTS", "REBOUNDS+ASSISTS", "REBOUNDS + ASSISTS", "REB+AST", "TOTAL_REBOUNDS_ASSISTS", "Rebs + Asts"]],
  ["STL", ["STL", "STEALS", "PLAYER_STEALS", "TOTAL_STEALS"]],
  ["BLK", ["BLK", "BLOCKS", "PLAYER_BLOCKS", "BLOCKED_SHOTS", "TOTAL_BLOCKED_SHOTS"]],
  ["TOV", ["TOV", "TURNOVERS", "PLAYER_TURNOVERS", "TOTAL_TURNOVERS"]],
  ["DOUBLE_DOUBLE", ["DOUBLE_DOUBLE", "DOUBLE DOUBLE", "DOUBLE-DOUBLE", "TO_RECORD_A_DOUBLE_DOUBLE"]],
  ["TRIPLE_DOUBLE", ["TRIPLE_DOUBLE", "TRIPLE DOUBLE", "TRIPLE-DOUBLE", "TO_RECORD_A_TRIPLE_DOUBLE"]],
];

const PROVIDER_TO_CANONICAL_TEAM: Record<string, string> = {
  ATL: "ATL",
  BKN: "BKN",
  BOS: "BOS",
  CHA: "CHA",
  CHI: "CHI",
  CLE: "CLE",
  DAL: "DAL",
  DEN: "DEN",
  DET: "DET",
  GS: "GSW",
  GSW: "GSW",
  HOU: "HOU",
  IND: "IND",
  LAC: "LAC",
  LAL: "LAL",
  MEM: "MEM",
  MIA: "MIA",
  MIL: "MIL",
  MIN: "MIN",
  NO: "NOP",
  NOP: "NOP",
  NY: "NYK",
  NYK: "NYK",
  OKC: "OKC",
  ORL: "ORL",
  PHI: "PHI",
  PHO: "PHX",
  PHX: "PHX",
  POR: "POR",
  SA: "SAS",
  SAS: "SAS",
  SAC: "SAC",
  TOR: "TOR",
  UTA: "UTA",
  WAS: "WAS",
};

const LINE_RANGE: Record<Market, { min: number; max: number }> = {
  PTS: { min: 5, max: 50 },
  REB: { min: 1, max: 20 },
  AST: { min: 1, max: 16 },
  THREES: { min: 0.5, max: 9 },
  PRA: { min: 10, max: 70 },
  PA: { min: 8, max: 50 },
  PR: { min: 8, max: 50 },
  RA: { min: 4, max: 35 },
  STL: { min: 0.5, max: 4.5 },
  BLK: { min: 0.5, max: 4.5 },
  TOV: { min: 0.5, max: 7.5 },
  DOUBLE_DOUBLE: { min: 0.5, max: 1.5 },
  TRIPLE_DOUBLE: { min: 0.5, max: 1.5 },
};

export const ALL_MARKETS: Market[] = MARKET_ALIASES.map(([market]) => market);
export const ALL_CANONICAL_TEAMS = Object.values(PROVIDER_TO_CANONICAL_TEAM).filter(
  (value, index, array) => array.indexOf(value) === index,
);

function normalize(input: string): string {
  return input.trim().toUpperCase().replace(/[^\w+]/g, "_");
}

export function normalizeMarket(raw: string | null | undefined): Market | null {
  if (!raw) {
    return null;
  }
  const normalized = normalize(raw);

  for (const [market, aliases] of MARKET_ALIASES) {
    if (aliases.some((alias) => normalize(alias) === normalized)) {
      return market;
    }
  }

  return null;
}

export function normalizeMarketFromBetType(raw: string | null | undefined): Market | null {
  return normalizeMarket(raw);
}

export function toCanonicalTeamCode(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const key = raw.trim().toUpperCase();
  return PROVIDER_TO_CANONICAL_TEAM[key] ?? null;
}

export function isLineReasonableForMarket(market: Market, line: number): boolean {
  const range = LINE_RANGE[market];
  return line >= range.min && line <= range.max;
}

export function marketValueFromLog(
  market: Market,
  stats: {
    points: number | null;
    rebounds: number | null;
    assists: number | null;
    threes: number | null;
    steals: number | null;
    blocks: number | null;
    turnovers: number | null;
  },
): number | null {
  const { points, rebounds, assists, threes, steals, blocks, turnovers } = stats;

  switch (market) {
    case "PTS":
      return points;
    case "REB":
      return rebounds;
    case "AST":
      return assists;
    case "THREES":
      return threes;
    case "PRA":
      if (points == null || rebounds == null || assists == null) return null;
      return points + rebounds + assists;
    case "PA":
      if (points == null || assists == null) return null;
      return points + assists;
    case "PR":
      if (points == null || rebounds == null) return null;
      return points + rebounds;
    case "RA":
      if (rebounds == null || assists == null) return null;
      return rebounds + assists;
    case "STL":
      return steals;
    case "BLK":
      return blocks;
    case "TOV":
      return turnovers;
    case "DOUBLE_DOUBLE": {
      const categories = [points, rebounds, assists, steals, blocks].filter(
        (value): value is number => value != null && value >= 10,
      );
      return categories.length >= 2 ? 1 : 0;
    }
    case "TRIPLE_DOUBLE": {
      const categories = [points, rebounds, assists, steals, blocks].filter(
        (value): value is number => value != null && value >= 10,
      );
      return categories.length >= 3 ? 1 : 0;
    }
    default:
      return null;
  }
}

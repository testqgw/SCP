import type { Market, Player, PlayerGameLog } from "@prisma/client";
import { marketValueFromLog } from "@/lib/snapshot/markets";
import { clamp, round } from "@/lib/utils";

type StatLog = Pick<
  PlayerGameLog,
  | "gameDateEt"
  | "minutes"
  | "points"
  | "rebounds"
  | "assists"
  | "threes"
  | "steals"
  | "blocks"
  | "turnovers"
  | "pace"
  | "total"
>;

export function computeHitRate(logs: StatLog[], market: Market, line: number, side: "OVER" | "UNDER"): number {
  const values = logs
    .map((log) =>
      marketValueFromLog(market, {
        points: log.points,
        rebounds: log.rebounds,
        assists: log.assists,
        threes: log.threes,
        steals: log.steals,
        blocks: log.blocks,
        turnovers: log.turnovers,
      }),
    )
    .filter((value): value is number => value != null);

  if (values.length === 0) {
    return 0.5;
  }

  const hits = values.filter((value) => (side === "OVER" ? value > line : value < line)).length;
  return hits / values.length;
}

export function computeBounceBack(lastGame: StatLog | null, market: Market, line: number): {
  bounceBackFlag: boolean;
  bounceBackScore: number;
} {
  if (!lastGame) {
    return { bounceBackFlag: false, bounceBackScore: 40 };
  }

  const value = marketValueFromLog(market, {
    points: lastGame.points,
    rebounds: lastGame.rebounds,
    assists: lastGame.assists,
    threes: lastGame.threes,
    steals: lastGame.steals,
    blocks: lastGame.blocks,
    turnovers: lastGame.turnovers,
  });

  if (value == null) {
    return { bounceBackFlag: false, bounceBackScore: 40 };
  }

  const threshold = Math.max(2, line * 0.15);
  const missedBy = line - value;
  const flag = missedBy >= threshold;
  return {
    bounceBackFlag: flag,
    bounceBackScore: flag ? 74 : 42,
  };
}

export function buildArchetypeKey(player: Pick<Player, "position" | "usageRate">): string {
  const position = (player.position ?? "").toUpperCase();
  const usage = player.usageRate ?? 20;

  const positionGroup = position.includes("C")
    ? "B"
    : position.includes("F")
      ? "W"
      : "G";

  const usageTier = usage < 18 ? "LOW" : usage <= 26 ? "MID" : "HIGH";
  return `${positionGroup}_${usageTier}`;
}

export function computeMinutesTrend(logs: StatLog[]): number {
  const recent = logs.slice(0, 5).map((log) => log.minutes).filter((value): value is number => value != null);
  if (recent.length < 2) {
    return 50;
  }
  const latest = recent[0];
  const oldest = recent[recent.length - 1];
  const delta = latest - oldest;
  return clamp(round(50 + delta * 4, 2), 0, 100);
}

export function computePaceTotal(logs: StatLog[]): number {
  const paceValues = logs.map((log) => log.pace).filter((value): value is number => value != null);
  const totalValues = logs.map((log) => log.total).filter((value): value is number => value != null);

  const avgPace = paceValues.length ? paceValues.reduce((sum, value) => sum + value, 0) / paceValues.length : 99;
  const avgTotal = totalValues.length
    ? totalValues.reduce((sum, value) => sum + value, 0) / totalValues.length
    : 224;

  const paceScore = clamp(50 + (avgPace - 99) * 4, 0, 100);
  const totalScore = clamp(50 + (avgTotal - 224) * 2, 0, 100);
  return round((paceScore + totalScore) / 2, 2);
}

export function computeOpponentAllowanceScore(opponentDelta: number, line: number): {
  overScore: number;
  underScore: number;
} {
  if (line <= 0) {
    return { overScore: 50, underScore: 50 };
  }
  const normalized = clamp(50 + (opponentDelta / line) * 100, 0, 100);
  return {
    overScore: round(normalized, 2),
    underScore: round(100 - normalized, 2),
  };
}

export function computeLineValueScores(
  currentLine: number,
  consensusLine: number,
  overPrice: number | null,
  underPrice: number | null,
): {
  overScore: number;
  underScore: number;
} {
  const lineEdgeForOver = (consensusLine - currentLine) * 8;
  const lineEdgeForUnder = (currentLine - consensusLine) * 8;

  const overPriceEdge = overPrice == null ? 0 : clamp((-overPrice - 100) / 3, -15, 15);
  const underPriceEdge = underPrice == null ? 0 : clamp((-underPrice - 100) / 3, -15, 15);

  return {
    overScore: round(clamp(50 + lineEdgeForOver + overPriceEdge, 0, 100), 2),
    underScore: round(clamp(50 + lineEdgeForUnder + underPriceEdge, 0, 100), 2),
  };
}

export function computeInjuryContext(statuses: string[]): number {
  if (statuses.length === 0) {
    return 50;
  }

  const total = statuses.reduce((score, raw) => {
    const status = raw.toUpperCase();
    if (status.includes("OUT")) return score + 12;
    if (status.includes("DOUBTFUL")) return score + 8;
    if (status.includes("QUESTIONABLE")) return score + 4;
    return score;
  }, 40);

  return clamp(total, 0, 100);
}

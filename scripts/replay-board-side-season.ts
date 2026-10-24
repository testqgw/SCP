// Offline season replay of the live board projection for fitting the board-side calibration.
//
// For every date in the line file, each player with a played game that day is projected with the live
// projectTonightMetrics from their last 280 played logs before the date (across seasons, as the board
// loads them), then residual-corrected exactly as the board does: bins hold only earlier settled days,
// fed by every 15+ minute game, not only lined rows. Lineup, game odds, availability, synergy, opponent
// allowance and the PTS enhancement are not replayed, so raw projections run slightly below live.
//
// Inputs are read-only files: player logs as returned by /api/snapshot/player/logs (analysisLogs, keyed
// by playerId), the historical line file, and an optional playerId -> position map.
//
// npx tsx scripts/replay-board-side-season.ts --logs logs-by-player.json --lines historical-lines.csv \
//   --out board-side-replay.csv [--positions positions.json]
import { readFileSync, writeFileSync } from "node:fs";
import { buildPlayerPersonalModels, projectTonightMetrics } from "@/lib/snapshot/projection";
import {
  addResidualDay,
  correctProjection,
  RESIDUAL_MIN_ACTUAL_MINUTES,
  type ResidualBins,
  type ResidualLedgerEntry,
} from "@/lib/snapshot/residualCorrection";
import type { SnapshotMarket, SnapshotMetricRecord } from "@/lib/types/snapshot";

type Log = {
  gameDateEt: string;
  teamCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
  starter: boolean | null;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
};

const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const HISTORY_LIMIT = 280;

function arg(name: string, required = true): string | null {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value && required) throw new Error(`Missing --${name}`);
  return value ?? null;
}

function stat(log: Log, market: SnapshotMarket): number {
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

const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

function standardDeviation(values: number[]): number | null {
  const mean = average(values);
  if (mean == null) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

const averages = (logs: Log[]) =>
  Object.fromEntries(MARKETS.map((market) => [market, average(logs.map((log) => stat(log, market)))])) as SnapshotMetricRecord;
const arrays = (logs: Log[]) =>
  Object.fromEntries(MARKETS.map((market) => [market, logs.map((log) => stat(log, market))])) as Record<SnapshotMarket, number[]>;
const nullRecord = () => Object.fromEntries(MARKETS.map((market) => [market, null])) as SnapshotMetricRecord;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function projectRaw(history: Log[], game: Log, position: string | null): SnapshotMetricRecord {
  const chronological = history.slice().reverse();
  const last3 = history.slice(0, 3);
  const last10 = history.slice(0, 10);
  const sameTeam = history.filter((log) => log.teamCode === game.teamCode);
  const homeAway = history.filter((log) => log.isHome === game.isHome);
  const sameOpponent = history.filter((log) => log.opponent === game.opponent);
  const minutesSeasonAvg = average(chronological.map((log) => log.minutes));
  const projected = projectTonightMetrics({
    last3Average: averages(last3),
    last10Average: averages(last10),
    seasonAverage: averages(history),
    homeAwayAverage: averages(homeAway),
    opponentAllowance: nullRecord(),
    opponentAllowanceDelta: nullRecord(),
    last10ByMarket: arrays(last10),
    historyByMarket: arrays(history),
    historyMinutes: history.map((log) => log.minutes),
    sameOpponentByMarket: arrays(sameOpponent),
    sameOpponentMinutes: sameOpponent.map((log) => log.minutes),
    sampleSize: history.length,
    personalModels: buildPlayerPersonalModels({ historyByMarket: arrays(chronological), minutesSeasonAvg }),
    minutesSeasonAvg,
    minutesLast3Avg: average(last3.map((log) => log.minutes)),
    minutesLast10Avg: average(last10.map((log) => log.minutes)),
    minutesVolatility: standardDeviation(last10.map((log) => log.minutes)),
    minutesHomeAwayAvg: average(homeAway.map((log) => log.minutes)),
    minutesCurrentTeamLast5Avg: average(sameTeam.slice(0, 5).map((log) => log.minutes)),
    minutesCurrentTeamGames: sameTeam.length,
    lineupStarter: null,
    starterRateLast10: last10.length ? last10.filter((log) => log.starter === true).length / last10.length : null,
    isHome: game.isHome,
    playerPosition: position,
    restDays: daysBetween(history[0].gameDateEt, game.gameDateEt),
    openingTeamSpread: null,
    openingTotal: null,
    availabilitySeverity: null,
    teammateSynergy: null,
    pairwiseTeammateSynergy: null,
    opponentAvailability: null,
  });
  // The board derives combo projections from the core stats before correcting each market.
  if (projected.PTS != null && projected.REB != null && projected.AST != null) {
    projected.PRA = projected.PTS + projected.REB + projected.AST;
    projected.PA = projected.PTS + projected.AST;
    projected.PR = projected.PTS + projected.REB;
    projected.RA = projected.REB + projected.AST;
  }
  return projected;
}

function main() {
  const logsByPlayer = JSON.parse(readFileSync(arg("logs")!, "utf8")) as Record<string, Log[]>;
  const positionsPath = arg("positions", false);
  const positions = positionsPath ? (JSON.parse(readFileSync(positionsPath, "utf8")) as Record<string, string | null>) : {};
  for (const logs of Object.values(logsByPlayer)) logs.sort((left, right) => right.gameDateEt.localeCompare(left.gameDateEt));

  const [header, ...lineRows] = readFileSync(arg("lines")!, "utf8").trim().split(/\r?\n/);
  const columns = header.split(",");
  const column = (name: string) => {
    const index = columns.indexOf(name);
    if (index < 0) throw new Error(`Line file has no ${name} column`);
    return index;
  };
  const [dateCol, playerCol, marketCol] = [column("gameDateEt"), column("playerId"), column("market")];
  const priceCols = ["line", "overLine", "underLine", "overPrice", "underPrice"].map(column);
  const linesByDate = new Map<string, Map<string, Map<SnapshotMarket, string[]>>>();
  for (const raw of lineRows) {
    const cells = raw.split(",");
    const byPlayer = linesByDate.get(cells[dateCol]) ?? new Map<string, Map<SnapshotMarket, string[]>>();
    const byMarket = byPlayer.get(cells[playerCol]) ?? new Map<SnapshotMarket, string[]>();
    const market = cells[marketCol] as SnapshotMarket;
    if (!byMarket.has(market)) byMarket.set(market, priceCols.map((index) => cells[index]));
    byPlayer.set(cells[playerCol], byMarket);
    linesByDate.set(cells[dateCol], byPlayer);
  }

  const gamesByDate = new Map<string, Array<{ playerId: string; game: Log }>>();
  for (const [playerId, logs] of Object.entries(logsByPlayer)) {
    for (const game of logs) {
      if (!(game.minutes > 0)) continue;
      const games = gamesByDate.get(game.gameDateEt) ?? [];
      games.push({ playerId, game });
      gamesByDate.set(game.gameDateEt, games);
    }
  }

  const dates = [...linesByDate.keys()].sort();
  const bins: ResidualBins = new Map();
  const fmt = (value: number | null) => (value == null || !Number.isFinite(value) ? "" : String(Math.round(value * 1000) / 1000));
  const out = ["dateEt,playerId,market,line,overLine,underLine,overPrice,underPrice,rawProjection,projection,actual,actualMinutes"];
  let projectedGames = 0;
  for (const dateEt of dates) {
    const entries: ResidualLedgerEntry[] = [];
    for (const { playerId, game } of gamesByDate.get(dateEt) ?? []) {
      const history = logsByPlayer[playerId].filter((log) => log.gameDateEt < dateEt && log.minutes > 0).slice(0, HISTORY_LIMIT);
      if (history.length === 0) continue;
      projectedGames += 1;
      const raw = projectRaw(history, game, positions[playerId] ?? null);
      const lined = linesByDate.get(dateEt)?.get(playerId);
      for (const market of MARKETS) {
        const rawValue = raw[market];
        if (rawValue == null) continue;
        if (game.minutes >= RESIDUAL_MIN_ACTUAL_MINUTES) entries.push({ market, rawProjection: rawValue, actual: stat(game, market) });
        const prices = lined?.get(market);
        if (!prices) continue;
        out.push([
          dateEt, playerId, market, ...prices, fmt(rawValue), fmt(correctProjection(bins, market, rawValue)),
          fmt(stat(game, market)), fmt(game.minutes),
        ].join(","));
      }
    }
    addResidualDay(bins, { dateEt, entries });
  }
  writeFileSync(arg("out")!, `${out.join("\n")}\n`);
  console.log(`dates=${dates.length} projectedGames=${projectedGames} linedRows=${out.length - 1}`);
}

main();

import { prisma } from "@/lib/prisma";
import {
  BOARD_SIDE_CALIBRATION,
  refitBoardSideMarkets,
  type BoardSideMarkets,
  type BoardSideOutcome,
} from "@/lib/snapshot/boardSideCalibration";
import {
  addResidualDay,
  correctProjection,
  RESIDUAL_MIN_ACTUAL_MINUTES,
  type ResidualBins,
  type ResidualLedgerDay,
  type ResidualLedgerEntry,
} from "@/lib/snapshot/residualCorrection";
import type { SnapshotMarket, SnapshotMetricRecord } from "@/lib/types/snapshot";

// Must match SNAPSHOT_BOARD_SETTING_KEY_PREFIX in query.ts.
const BOARD_KEY_PREFIX = "snapshot_board:";
// v2 adds the lined rows the board-side refit grades; v1 ledgers are ignored and rebuilt.
const LEDGER_KEY_PREFIX = "snapshot_projection_residuals_v2:";
const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A lined prop on a settled board, before residual correction. Any played minutes count. */
type LinedLedgerEntry = {
  market: SnapshotMarket;
  rawProjection: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  actual: number;
};

type LedgerDay = ResidualLedgerDay & { lined: LinedLedgerEntry[] };

type StoredLedger = {
  dateEt: string;
  entries: Array<[SnapshotMarket, number, number]>;
  lined: Array<[SnapshotMarket, number, number, number | null, number | null, number]>;
};

export type ProjectionCalibration = {
  residualBins: ResidualBins;
  boardSideMarkets: BoardSideMarkets;
};

export const UNCORRECTED_PROJECTION_CALIBRATION: ProjectionCalibration = {
  residualBins: new Map(),
  boardSideMarkets: BOARD_SIDE_CALIBRATION.markets,
};

function isMarket(value: unknown): value is SnapshotMarket {
  return typeof value === "string" && (MARKETS as string[]).includes(value);
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const priceOrNull = (value: unknown): number | null => (isFiniteNumber(value) ? value : null);

function readStoredLedger(value: unknown): LedgerDay | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Partial<StoredLedger>;
  if (typeof stored.dateEt !== "string" || !Array.isArray(stored.entries) || !Array.isArray(stored.lined)) return null;
  const entries = stored.entries
    .filter(
      (entry): entry is [SnapshotMarket, number, number] =>
        Array.isArray(entry) && isMarket(entry[0]) && Number.isFinite(entry[1]) && Number.isFinite(entry[2]),
    )
    .map(([market, rawProjection, actual]) => ({ market, rawProjection, actual }));
  const lined = stored.lined
    .filter(
      (entry) =>
        Array.isArray(entry) && isMarket(entry[0]) && isFiniteNumber(entry[1]) && isFiniteNumber(entry[2]) && isFiniteNumber(entry[5]),
    )
    .map(([market, rawProjection, line, overPrice, underPrice, actual]) => ({
      market,
      rawProjection,
      line,
      overPrice: priceOrNull(overPrice),
      underPrice: priceOrNull(underPrice),
      actual,
    }));
  return { dateEt: stored.dateEt, entries, lined };
}

function statForMarket(
  log: { points: number | null; rebounds: number | null; assists: number | null; threes: number | null },
  market: SnapshotMarket,
): number {
  const points = log.points ?? 0;
  const rebounds = log.rebounds ?? 0;
  const assists = log.assists ?? 0;
  switch (market) {
    case "PTS":
      return points;
    case "REB":
      return rebounds;
    case "AST":
      return assists;
    case "THREES":
      return log.threes ?? 0;
    case "PRA":
      return points + rebounds + assists;
    case "PA":
      return points + assists;
    case "PR":
      return points + rebounds;
    case "RA":
      return rebounds + assists;
  }
}

type StoredBoardRow = {
  playerId?: unknown;
  projectedTonight?: unknown;
  rawProjectedTonight?: unknown;
} & Record<string, unknown>;

/** Builds a settled day's ledger from its stored pregame board and box scores, or null if not settled. */
async function buildLedgerDay(dateEt: string): Promise<LedgerDay | null> {
  const games = await prisma.game.findMany({ where: { gameDateEt: dateEt }, select: { status: true } });
  if (games.length === 0 || games.some((game) => !game.status || !/final/i.test(game.status))) return null;

  const setting = await prisma.systemSetting.findUnique({
    where: { key: `${BOARD_KEY_PREFIX}${dateEt}` },
    select: { value: true },
  });
  const rows = (setting?.value as { data?: { rows?: unknown } } | null)?.data?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const rowByPlayerId = new Map<string, { raw: SnapshotMetricRecord; row: StoredBoardRow }>();
  for (const row of rows as StoredBoardRow[]) {
    // Boards stored before this correction shipped only have the raw projection.
    const raw = (row.rawProjectedTonight ?? row.projectedTonight) as SnapshotMetricRecord | undefined;
    if (typeof row.playerId === "string" && raw && typeof raw === "object") rowByPlayerId.set(row.playerId, { raw, row });
  }

  const logs = await prisma.playerGameLog.findMany({
    where: {
      gameDateEt: dateEt,
      playerId: { in: Array.from(rowByPlayerId.keys()) },
      minutes: { gt: 0 },
    },
    select: { playerId: true, minutes: true, points: true, rebounds: true, assists: true, threes: true },
  });
  if (logs.length === 0) return null;

  const entries: ResidualLedgerEntry[] = [];
  const lined: LinedLedgerEntry[] = [];
  for (const log of logs) {
    const stored = rowByPlayerId.get(log.playerId);
    if (!stored) continue;
    for (const market of MARKETS) {
      const rawProjection = stored.raw[market];
      if (!isFiniteNumber(rawProjection)) continue;
      const actual = statForMarket(log, market);
      if ((log.minutes ?? 0) >= RESIDUAL_MIN_ACTUAL_MINUTES) entries.push({ market, rawProjection, actual });
      const signal = stored.row[`${market.toLowerCase()}Signal`] as
        | { marketLine?: unknown; overPrice?: unknown; underPrice?: unknown }
        | null
        | undefined;
      if (signal && isFiniteNumber(signal.marketLine)) {
        lined.push({
          market,
          rawProjection,
          line: signal.marketLine,
          overPrice: priceOrNull(signal.overPrice),
          underPrice: priceOrNull(signal.underPrice),
          actual,
        });
      }
    }
  }
  return { dateEt, entries, lined };
}

/**
 * Residual bins and the board-side refit from every settled slate this season before dateEt.
 * Days replay in order, so each lined row is graded at the corrected projection the board would
 * have shown that day. Missing ledgers are rebuilt from the stored board; they are saved only when
 * persist is true (today's board build).
 */
export async function loadProjectionCalibration(input: {
  dateEt: string;
  seasonStartDateEt: string;
  persist: boolean;
}): Promise<ProjectionCalibration> {
  const boardKeys = await prisma.systemSetting.findMany({
    where: { key: { startsWith: BOARD_KEY_PREFIX } },
    select: { key: true },
  });
  const dates = boardKeys
    .map(({ key }) => key.slice(BOARD_KEY_PREFIX.length))
    .filter((date) => DATE_PATTERN.test(date) && date >= input.seasonStartDateEt && date < input.dateEt)
    .sort();
  if (dates.length === 0) return UNCORRECTED_PROJECTION_CALIBRATION;

  const stored = await prisma.systemSetting.findMany({
    where: { key: { in: dates.map((date) => `${LEDGER_KEY_PREFIX}${date}`) } },
    select: { key: true, value: true },
  });
  const days = new Map<string, LedgerDay>();
  for (const setting of stored) {
    const day = readStoredLedger(setting.value);
    if (day) days.set(day.dateEt, day);
  }

  for (const date of dates) {
    if (days.has(date)) continue;
    const day = await buildLedgerDay(date);
    if (!day) continue;
    days.set(date, day);
    if (input.persist) {
      const value: StoredLedger = {
        dateEt: date,
        entries: day.entries.map((entry) => [entry.market, entry.rawProjection, entry.actual]),
        lined: day.lined.map((entry) => [
          entry.market,
          entry.rawProjection,
          entry.line,
          entry.overPrice,
          entry.underPrice,
          entry.actual,
        ]),
      };
      await prisma.systemSetting.upsert({
        where: { key: `${LEDGER_KEY_PREFIX}${date}` },
        update: { value },
        create: { key: `${LEDGER_KEY_PREFIX}${date}`, value },
      });
    }
  }

  const residualBins: ResidualBins = new Map();
  const outcomes: BoardSideOutcome[] = [];
  for (const day of [...days.values()].sort((left, right) => left.dateEt.localeCompare(right.dateEt))) {
    for (const entry of day.lined) {
      outcomes.push({
        market: entry.market,
        projection: correctProjection(residualBins, entry.market, entry.rawProjection) ?? entry.rawProjection,
        line: entry.line,
        overPrice: entry.overPrice,
        underPrice: entry.underPrice,
        actual: entry.actual,
      });
    }
    addResidualDay(residualBins, day);
  }
  return { residualBins, boardSideMarkets: refitBoardSideMarkets(outcomes) };
}

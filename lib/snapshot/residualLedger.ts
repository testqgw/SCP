import { prisma } from "@/lib/prisma";
import {
  buildResidualBins,
  RESIDUAL_MIN_ACTUAL_MINUTES,
  type ResidualBins,
  type ResidualLedgerDay,
  type ResidualLedgerEntry,
} from "@/lib/snapshot/residualCorrection";
import type { SnapshotMarket, SnapshotMetricRecord } from "@/lib/types/snapshot";

// Must match SNAPSHOT_BOARD_SETTING_KEY_PREFIX in query.ts.
const BOARD_KEY_PREFIX = "snapshot_board:";
const LEDGER_KEY_PREFIX = "snapshot_projection_residuals_v1:";
const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type StoredLedger = { dateEt: string; entries: Array<[SnapshotMarket, number, number]> };

function isMarket(value: unknown): value is SnapshotMarket {
  return typeof value === "string" && (MARKETS as string[]).includes(value);
}

function readStoredLedger(value: unknown): ResidualLedgerDay | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Partial<StoredLedger>;
  if (typeof stored.dateEt !== "string" || !Array.isArray(stored.entries)) return null;
  const entries = stored.entries
    .filter(
      (entry): entry is [SnapshotMarket, number, number] =>
        Array.isArray(entry) && isMarket(entry[0]) && Number.isFinite(entry[1]) && Number.isFinite(entry[2]),
    )
    .map(([market, rawProjection, actual]) => ({ market, rawProjection, actual }));
  return { dateEt: stored.dateEt, entries };
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

/** Builds a settled day's ledger from its stored pregame board and box scores, or null if not settled. */
async function buildLedgerDay(dateEt: string): Promise<ResidualLedgerDay | null> {
  const games = await prisma.game.findMany({ where: { gameDateEt: dateEt }, select: { status: true } });
  if (games.length === 0 || games.some((game) => !game.status || !/final/i.test(game.status))) return null;

  const setting = await prisma.systemSetting.findUnique({
    where: { key: `${BOARD_KEY_PREFIX}${dateEt}` },
    select: { value: true },
  });
  const rows = (setting?.value as { data?: { rows?: unknown } } | null)?.data?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const rawByPlayerId = new Map<string, SnapshotMetricRecord>();
  for (const row of rows as Array<{ playerId?: unknown; projectedTonight?: unknown; rawProjectedTonight?: unknown }>) {
    // Boards stored before this correction shipped only have the raw projection.
    const raw = (row.rawProjectedTonight ?? row.projectedTonight) as SnapshotMetricRecord | undefined;
    if (typeof row.playerId === "string" && raw && typeof raw === "object") rawByPlayerId.set(row.playerId, raw);
  }

  const logs = await prisma.playerGameLog.findMany({
    where: {
      gameDateEt: dateEt,
      playerId: { in: Array.from(rawByPlayerId.keys()) },
      minutes: { gte: RESIDUAL_MIN_ACTUAL_MINUTES },
    },
    select: { playerId: true, points: true, rebounds: true, assists: true, threes: true },
  });
  if (logs.length === 0) return null;

  const entries: ResidualLedgerEntry[] = [];
  for (const log of logs) {
    const raw = rawByPlayerId.get(log.playerId);
    if (!raw) continue;
    for (const market of MARKETS) {
      const rawProjection = raw[market];
      if (typeof rawProjection === "number" && Number.isFinite(rawProjection)) {
        entries.push({ market, rawProjection, actual: statForMarket(log, market) });
      }
    }
  }
  return { dateEt, entries };
}

/**
 * Residual bins from every settled slate this season before dateEt. Missing ledgers are rebuilt
 * from the stored board; they are saved only when persist is true (today's board build).
 */
export async function loadProjectionResidualBins(input: {
  dateEt: string;
  seasonStartDateEt: string;
  persist: boolean;
}): Promise<ResidualBins> {
  const boardKeys = await prisma.systemSetting.findMany({
    where: { key: { startsWith: BOARD_KEY_PREFIX } },
    select: { key: true },
  });
  const dates = boardKeys
    .map(({ key }) => key.slice(BOARD_KEY_PREFIX.length))
    .filter((date) => DATE_PATTERN.test(date) && date >= input.seasonStartDateEt && date < input.dateEt)
    .sort();
  if (dates.length === 0) return new Map();

  const stored = await prisma.systemSetting.findMany({
    where: { key: { in: dates.map((date) => `${LEDGER_KEY_PREFIX}${date}`) } },
    select: { key: true, value: true },
  });
  const days = new Map<string, ResidualLedgerDay>();
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
      };
      await prisma.systemSetting.upsert({
        where: { key: `${LEDGER_KEY_PREFIX}${date}` },
        update: { value },
        create: { key: `${LEDGER_KEY_PREFIX}${date}`, value },
      });
    }
  }

  return buildResidualBins(Array.from(days.values()));
}

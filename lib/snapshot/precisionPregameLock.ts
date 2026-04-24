import type {
  SnapshotBoardData,
  SnapshotMarket,
  SnapshotPrecisionCardEntry,
  SnapshotPrecisionCardSummary,
  SnapshotPtsSignal,
  SnapshotRow,
} from "@/lib/types/snapshot";

export const PRECISION_PREGAME_LOCK_VERSION = "snapshot-precision-pregame-lock-v1";
export const PRECISION_PREGAME_LOCK_SETTING_KEY_PREFIX = "snapshot_precision_pregame_lock:";

export type PrecisionPregameLockDecision =
  | { eligible: true; reason: "ready" }
  | { eligible: false; reason: string };

export type SnapshotPrecisionPregameLock = {
  version: typeof PRECISION_PREGAME_LOCK_VERSION;
  dateEt: string;
  lockedAt: string;
  lockReason: "pre_first_game_window";
  firstGameTimeUtc: string;
  sourceUpdatedAt: string | null;
  targetCardCount: number;
  precisionCard: SnapshotPrecisionCardEntry[];
  precisionCardSummary: SnapshotPrecisionCardSummary;
};

const DEFAULT_LOCK_LEAD_MINUTES = 15;
const MAX_LOCK_LEAD_MINUTES = 240;

function parseBoundedNonNegativeInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export function getPrecisionPregameLockSettingKey(dateEt: string): string {
  return `${PRECISION_PREGAME_LOCK_SETTING_KEY_PREFIX}${dateEt}`;
}

export function getPrecisionPregameLockLeadMinutes(): number {
  return parseBoundedNonNegativeInteger(
    process.env.SNAPSHOT_PRECISION_PREGAME_LOCK_LEAD_MINUTES,
    DEFAULT_LOCK_LEAD_MINUTES,
    MAX_LOCK_LEAD_MINUTES,
  );
}

export function shouldCreatePrecisionPregameLock(input: {
  isTodayEt: boolean;
  nowMs: number;
  firstGameStartMs: number | null;
  precisionCardCount: number;
  targetCardCount: number;
}): PrecisionPregameLockDecision {
  if (!input.isTodayEt) {
    return { eligible: false, reason: "Only today's slate can create a new pregame lock." };
  }
  if (input.firstGameStartMs == null || !Number.isFinite(input.firstGameStartMs)) {
    return { eligible: false, reason: "No first-game start time is available for this slate." };
  }
  if (input.nowMs >= input.firstGameStartMs) {
    return { eligible: false, reason: "The first game has already started, so no pregame lock can be created." };
  }
  const leadMs = getPrecisionPregameLockLeadMinutes() * 60_000;
  if (input.nowMs < input.firstGameStartMs - leadMs) {
    return { eligible: false, reason: "The slate is not inside the configured pregame lock window yet." };
  }
  if (input.targetCardCount > 0 && input.precisionCardCount < input.targetCardCount) {
    return {
      eligible: false,
      reason: `The Precision card has ${input.precisionCardCount} picks, below the ${input.targetCardCount}-pick lock target.`,
    };
  }
  return { eligible: true, reason: "ready" };
}

function getRowSignal(row: SnapshotRow, market: SnapshotMarket): SnapshotPtsSignal | null {
  switch (market) {
    case "PTS":
      return row.ptsSignal;
    case "REB":
      return row.rebSignal;
    case "AST":
      return row.astSignal;
    case "THREES":
      return row.threesSignal;
    case "PRA":
      return row.praSignal;
    case "PA":
      return row.paSignal;
    case "PR":
      return row.prSignal;
    case "RA":
      return row.raSignal;
    default:
      return null;
  }
}

export function summarizePrecisionPregameCard(
  card: SnapshotPrecisionCardEntry[],
  targetCardCount: number,
): SnapshotPrecisionCardSummary {
  const fillCount = card.filter((entry) => {
    const selectorFamily = entry.precisionSignal?.selectorFamily;
    return selectorFamily === "qualified_fill" || selectorFamily === "model_fill";
  }).length;
  return {
    targetCardCount,
    truePickCount: Math.max(0, card.length - fillCount),
    fillCount,
    selectedCount: card.length,
  };
}

export function freezePrecisionPregameCardLines(
  card: SnapshotPrecisionCardEntry[],
  rows: SnapshotRow[],
): SnapshotPrecisionCardEntry[] {
  const rowByPlayerId = new Map(rows.map((row) => [row.playerId, row] as const));
  return card.map((entry, index) => {
    const row = rowByPlayerId.get(entry.playerId) ?? null;
    const lockedLine = entry.lockedLine ?? (row ? getRowSignal(row, entry.market)?.marketLine ?? null : null);
    return {
      ...entry,
      rank: index + 1,
      lockedLine,
    };
  });
}

export function buildPrecisionPregameLock(input: {
  dateEt: string;
  lockedAt: string;
  firstGameTimeUtc: string;
  sourceUpdatedAt: string | null;
  targetCardCount: number;
  data: Pick<SnapshotBoardData, "rows" | "precisionCard" | "precisionCardSummary">;
}): SnapshotPrecisionPregameLock {
  const precisionCard = freezePrecisionPregameCardLines(input.data.precisionCard ?? [], input.data.rows);
  return {
    version: PRECISION_PREGAME_LOCK_VERSION,
    dateEt: input.dateEt,
    lockedAt: input.lockedAt,
    lockReason: "pre_first_game_window",
    firstGameTimeUtc: input.firstGameTimeUtc,
    sourceUpdatedAt: input.sourceUpdatedAt,
    targetCardCount: input.targetCardCount,
    precisionCard,
    precisionCardSummary:
      input.data.precisionCardSummary ?? summarizePrecisionPregameCard(precisionCard, input.targetCardCount),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readCardEntry(value: unknown): SnapshotPrecisionCardEntry | null {
  if (!isRecord(value)) return null;
  const playerId = typeof value.playerId === "string" ? value.playerId : null;
  const market = typeof value.market === "string" ? value.market : null;
  if (!playerId || !market) return null;
  return value as unknown as SnapshotPrecisionCardEntry;
}

function readSummary(value: unknown, cardLength: number, targetCardCount: number): SnapshotPrecisionCardSummary {
  if (!isRecord(value)) {
    return {
      targetCardCount,
      truePickCount: cardLength,
      fillCount: 0,
      selectedCount: cardLength,
    };
  }
  const readNumber = (key: "targetCardCount" | "truePickCount" | "fillCount" | "selectedCount", fallback: number): number => {
    const next = value[key];
    return typeof next === "number" && Number.isFinite(next) ? next : fallback;
  };
  return {
    targetCardCount: readNumber("targetCardCount", targetCardCount),
    truePickCount: readNumber("truePickCount", cardLength),
    fillCount: readNumber("fillCount", 0),
    selectedCount: readNumber("selectedCount", cardLength),
  };
}

export function readPrecisionPregameLock(value: unknown): SnapshotPrecisionPregameLock | null {
  if (!isRecord(value) || value.version !== PRECISION_PREGAME_LOCK_VERSION) return null;
  const dateEt = typeof value.dateEt === "string" ? value.dateEt : null;
  const lockedAt = typeof value.lockedAt === "string" ? value.lockedAt : null;
  const firstGameTimeUtc = typeof value.firstGameTimeUtc === "string" ? value.firstGameTimeUtc : null;
  if (!dateEt || !lockedAt || !firstGameTimeUtc) return null;
  const targetCardCount =
    typeof value.targetCardCount === "number" && Number.isFinite(value.targetCardCount)
      ? value.targetCardCount
      : 6;
  const precisionCard = Array.isArray(value.precisionCard)
    ? value.precisionCard.flatMap((entry) => {
        const parsed = readCardEntry(entry);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    version: PRECISION_PREGAME_LOCK_VERSION,
    dateEt,
    lockedAt,
    lockReason: "pre_first_game_window",
    firstGameTimeUtc,
    sourceUpdatedAt: typeof value.sourceUpdatedAt === "string" ? value.sourceUpdatedAt : null,
    targetCardCount,
    precisionCard,
    precisionCardSummary: readSummary(value.precisionCardSummary, precisionCard.length, targetCardCount),
  };
}

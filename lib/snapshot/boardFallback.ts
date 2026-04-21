import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SnapshotBoardViewData } from "@/lib/types/snapshot";

const SNAPSHOT_BOARD_FALLBACK_RELATIVE_PATH = path.join("exports", "snapshot-board-fallback-2026-04-20.json");

type SnapshotBoardFallbackArtifact = {
  version?: string;
  generatedAt?: string;
  result?: unknown;
};

let cachedBundledSnapshotBoardFallback: SnapshotBoardViewData | null | undefined;

function isSnapshotBoardViewData(value: unknown): value is SnapshotBoardViewData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SnapshotBoardViewData>;
  return (
    typeof candidate.dateEt === "string" &&
    Array.isArray(candidate.matchups) &&
    Array.isArray(candidate.teamMatchups) &&
    Array.isArray(candidate.rows)
  );
}

function readBundledSnapshotBoardFallback(): SnapshotBoardViewData | null {
  if (cachedBundledSnapshotBoardFallback !== undefined) {
    return cachedBundledSnapshotBoardFallback;
  }

  const fallbackPath = path.join(process.cwd(), SNAPSHOT_BOARD_FALLBACK_RELATIVE_PATH);
  if (!existsSync(fallbackPath)) {
    cachedBundledSnapshotBoardFallback = null;
    return cachedBundledSnapshotBoardFallback;
  }

  try {
    const payload = JSON.parse(readFileSync(fallbackPath, "utf8")) as SnapshotBoardFallbackArtifact | SnapshotBoardViewData;
    const candidate =
      "result" in payload && payload.result !== undefined
        ? payload.result
        : payload;
    cachedBundledSnapshotBoardFallback = isSnapshotBoardViewData(candidate) ? candidate : null;
  } catch {
    cachedBundledSnapshotBoardFallback = null;
  }

  return cachedBundledSnapshotBoardFallback;
}

export function isSnapshotBoardDatabaseUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  const hasPrismaSignal = message.includes("prisma.") || message.includes("PrismaClient");
  if (!hasPrismaSignal) return false;

  return [
    "Error querying the database",
    "Can't reach database server",
    "No space left on device",
    "could not write init file",
    "Timed out fetching a new connection",
  ].some((fragment) => message.includes(fragment));
}

export function loadBundledSnapshotBoardViewFallback(dateEt: string): SnapshotBoardViewData | null {
  const fallback = readBundledSnapshotBoardFallback();
  if (!fallback) return null;

  const cloned = structuredClone(fallback);
  const snapshotDateLabel = cloned.dateEt === dateEt ? cloned.dateEt : `${cloned.dateEt} for ${dateEt}`;
  const staleNote = `Showing the last published board snapshot (${snapshotDateLabel}) while the live database recovers. Precision picks remain locked after tipoff.`;

  cloned.boardFeed = {
    label: cloned.boardFeed?.label ?? "Board feed",
    note: staleNote,
    events: cloned.boardFeed?.events ?? [],
  };

  return cloned;
}

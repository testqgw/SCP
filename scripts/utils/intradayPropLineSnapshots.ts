import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SnapshotMarket, SnapshotModelSide } from "../../lib/types/snapshot";

export const PROP_LINE_SNAPSHOT_DIR = path.join("exports", "line-movement-snapshots");

export const PROP_LINE_SNAPSHOT_MARKETS: SnapshotMarket[] = [
  "PTS",
  "REB",
  "AST",
  "THREES",
  "PRA",
  "PA",
  "PR",
  "RA",
];

export type IntradayPropLineSnapshot = {
  capturedAt: string;
  captureBatchId: string;
  dateEt: string;
  market: SnapshotMarket;
  matchupKey: string;
  playerName: string;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  sportsbookCount: number;
  source: "sportsdata" | "scoresandodds" | "covers" | "derived";
};

export type IntradayPropLineMovementEntry = {
  id: string;
  dateEt: string;
  market: SnapshotMarket;
  matchupKey: string;
  playerName: string;
  snapshotCount: number;
  firstCapturedAt: string;
  lastCapturedAt: string;
  firstLine: number;
  lastLine: number;
  minLine: number;
  maxLine: number;
  lineDelta: number;
  maxAbsLineMove: number;
  lineMovePressureSide: SnapshotModelSide;
  firstOverPrice: number | null;
  lastOverPrice: number | null;
  overPriceDelta: number | null;
  firstUnderPrice: number | null;
  lastUnderPrice: number | null;
  underPriceDelta: number | null;
  maxSportsbookCount: number;
  sources: string[];
};

export type IntradayPropLineMovementSummary = {
  generatedAt: string;
  dateEt: string;
  snapshotRows: number;
  uniqueProps: number;
  propsWithMultipleSnapshots: number;
  propsWithLineMove: number;
  byMarket: Record<
    SnapshotMarket,
    {
      snapshotRows: number;
      uniqueProps: number;
      propsWithMultipleSnapshots: number;
      propsWithLineMove: number;
    }
  >;
  entries: IntradayPropLineMovementEntry[];
};

export function snapshotJsonlPath(outDir: string, dateEt: string): string {
  return path.join(outDir, `prop-line-snapshots-${dateEt}.jsonl`);
}

export function movementSummaryPath(outDir: string, dateEt: string): string {
  return path.join(outDir, `prop-line-movement-${dateEt}.json`);
}

export function latestMovementSummaryPath(outDir: string): string {
  return path.join(outDir, "prop-line-movement-latest.json");
}

export async function ensureSnapshotDir(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
}

export function parseSnapshotKey(key: string): { matchupKey: string; playerName: string } {
  const [matchupKey, ...nameParts] = key.split("|");
  return {
    matchupKey: matchupKey || "UNKNOWN",
    playerName: nameParts.join("|") || "unknown player",
  };
}

export function roundNumber(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function lineMovePressureSide(lineDelta: number): SnapshotModelSide {
  if (lineDelta > 0) return "OVER";
  if (lineDelta < 0) return "UNDER";
  return "NEUTRAL";
}

export async function readSnapshotRowsForDate(outDir: string, dateEt: string): Promise<IntradayPropLineSnapshot[]> {
  const filePath = snapshotJsonlPath(outDir, dateEt);
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as IntradayPropLineSnapshot;
      } catch (error) {
        throw new Error(`Could not parse ${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
    .filter((row) => row.dateEt === dateEt);
}

export async function listSnapshotDates(outDir: string): Promise<string[]> {
  let files: string[] = [];
  try {
    files = await readdir(outDir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  return files
    .map((fileName) => /^prop-line-snapshots-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(fileName)?.[1] ?? null)
    .filter((dateEt): dateEt is string => Boolean(dateEt))
    .sort((left, right) => left.localeCompare(right));
}

export function summarizeSnapshotRows(
  rows: IntradayPropLineSnapshot[],
  dateEt: string,
  generatedAt = new Date().toISOString(),
): IntradayPropLineMovementSummary {
  const byId = new Map<string, IntradayPropLineSnapshot[]>();
  for (const row of rows) {
    const id = `${row.dateEt}|${row.market}|${row.matchupKey}|${row.playerName}`;
    const bucket = byId.get(id) ?? [];
    bucket.push(row);
    byId.set(id, bucket);
  }

  const entries = Array.from(byId.entries()).map(([id, bucket]) => {
    const ordered = [...bucket].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const lines = ordered.map((row) => row.line);
    const minLine = Math.min(...lines);
    const maxLine = Math.max(...lines);
    const lineDelta = roundNumber(last.line - first.line);
    const firstOverPrice = first.overPrice;
    const lastOverPrice = last.overPrice;
    const firstUnderPrice = first.underPrice;
    const lastUnderPrice = last.underPrice;
    const overPriceDelta =
      firstOverPrice == null || lastOverPrice == null ? null : roundNumber(lastOverPrice - firstOverPrice);
    const underPriceDelta =
      firstUnderPrice == null || lastUnderPrice == null ? null : roundNumber(lastUnderPrice - firstUnderPrice);

    return {
      id,
      dateEt: first.dateEt,
      market: first.market,
      matchupKey: first.matchupKey,
      playerName: first.playerName,
      snapshotCount: ordered.length,
      firstCapturedAt: first.capturedAt,
      lastCapturedAt: last.capturedAt,
      firstLine: first.line,
      lastLine: last.line,
      minLine,
      maxLine,
      lineDelta,
      maxAbsLineMove: roundNumber(Math.max(Math.abs(maxLine - first.line), Math.abs(minLine - first.line))),
      lineMovePressureSide: lineMovePressureSide(lineDelta),
      firstOverPrice,
      lastOverPrice,
      overPriceDelta,
      firstUnderPrice,
      lastUnderPrice,
      underPriceDelta,
      maxSportsbookCount: Math.max(...ordered.map((row) => row.sportsbookCount)),
      sources: Array.from(new Set(ordered.map((row) => row.source))).sort(),
    };
  });

  entries.sort((left, right) => {
    if (left.market !== right.market) {
      return PROP_LINE_SNAPSHOT_MARKETS.indexOf(left.market) - PROP_LINE_SNAPSHOT_MARKETS.indexOf(right.market);
    }
    if (left.matchupKey !== right.matchupKey) return left.matchupKey.localeCompare(right.matchupKey);
    return left.playerName.localeCompare(right.playerName);
  });

  const byMarket = Object.fromEntries(
    PROP_LINE_SNAPSHOT_MARKETS.map((market) => {
      const marketRows = rows.filter((row) => row.market === market);
      const marketEntries = entries.filter((entry) => entry.market === market);
      return [
        market,
        {
          snapshotRows: marketRows.length,
          uniqueProps: marketEntries.length,
          propsWithMultipleSnapshots: marketEntries.filter((entry) => entry.snapshotCount >= 2).length,
          propsWithLineMove: marketEntries.filter((entry) => entry.maxLine !== entry.minLine).length,
        },
      ];
    }),
  ) as IntradayPropLineMovementSummary["byMarket"];

  return {
    generatedAt,
    dateEt,
    snapshotRows: rows.length,
    uniqueProps: entries.length,
    propsWithMultipleSnapshots: entries.filter((entry) => entry.snapshotCount >= 2).length,
    propsWithLineMove: entries.filter((entry) => entry.maxLine !== entry.minLine).length,
    byMarket,
    entries,
  };
}

export async function writeMovementSummary(
  outDir: string,
  summary: IntradayPropLineMovementSummary,
  updateLatest: boolean,
): Promise<void> {
  await ensureSnapshotDir(outDir);
  const payload = `${JSON.stringify(summary, null, 2)}\n`;
  await writeFile(movementSummaryPath(outDir, summary.dateEt), payload, "utf8");
  if (updateLatest) {
    await writeFile(latestMovementSummaryPath(outDir), payload, "utf8");
  }
}


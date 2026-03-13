import fs from "node:fs/promises";
import path from "node:path";
import type {
  SnapshotModelSide,
  SnapshotPlayerBacktestGameRow,
  SnapshotPlayerBacktestReport,
  SnapshotPlayerBacktestSampleSummary,
} from "@/lib/types/snapshot";

const REPORT_DIR = path.join(process.cwd(), "exports", "player-backtests");

type HoldoutSummaryFile = {
  player?: {
    name?: string;
  };
  holdoutRatio?: number;
  fullSample?: SnapshotPlayerBacktestSampleSummary;
  trainingSample?: SnapshotPlayerBacktestSampleSummary;
  holdoutSample?: SnapshotPlayerBacktestSampleSummary;
};

function slugifyPlayerName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function toSide(value: string): SnapshotModelSide | "PUSH" | null {
  if (value === "OVER" || value === "UNDER" || value === "NEUTRAL" || value === "PUSH") {
    return value;
  }
  return null;
}

function parseCsvRow(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    const next = row[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

async function parseGameSheet(filePath: string): Promise<SnapshotPlayerBacktestGameRow[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];

  const header = parseCsvRow(lines[0]);
  const getIndex = (name: string): number => header.indexOf(name);

  return lines.slice(1).map((line) => {
    const cells = parseCsvRow(line);
    const value = (name: string): string => {
      const index = getIndex(name);
      return index >= 0 ? (cells[index] ?? "") : "";
    };

    return {
      gameDateEt: value("gameDateEt"),
      matchupKey: value("matchupKey"),
      bookPtsLine: toNumber(value("bookPtsLine")),
      lineSource: value("lineSource") || null,
      projectedPts: toNumber(value("projectedPts")),
      predictedSide: toSide(value("predictedSide")) as SnapshotModelSide | null,
      actualPts: toNumber(value("actualPts")),
      actualSide: toSide(value("actualSide")),
      correct: toBoolean(value("correct")),
      openingTeamSpread: toNumber(value("openingTeamSpread")),
      openingTotal: toNumber(value("openingTotal")),
      ptsSideConfidence: toNumber(value("ptsSideConfidence")),
      ptsOverScore: toNumber(value("ptsOverScore")),
      ptsUnderScore: toNumber(value("ptsUnderScore")),
      ptsMinutesRisk: toNumber(value("ptsMinutesRisk")),
      lineupTimingConfidence: toNumber(value("lineupTimingConfidence")),
      ptsQualifiedBet: toBoolean(value("ptsQualifiedBet")),
    };
  });
}

function scoreFileName(fileName: string): number {
  const vMatch = fileName.match(/-v(\d+)-/i);
  const version = vMatch ? Number(vMatch[1]) : 0;
  const over80Boost = fileName.includes("over-80") ? 1000 : 0;
  const holdoutBoost = fileName.includes("holdout") ? 500 : 0;
  return over80Boost + holdoutBoost + version;
}

export async function getPlayerBacktestReport(playerName: string): Promise<SnapshotPlayerBacktestReport | null> {
  const playerSlug = slugifyPlayerName(playerName);
  let entries: string[];
  try {
    entries = await fs.readdir(REPORT_DIR);
  } catch {
    return null;
  }

  const holdoutFile = entries
    .filter((entry) => entry.includes(playerSlug) && entry.endsWith("-holdout.json"))
    .sort((left, right) => scoreFileName(right) - scoreFileName(left))[0];

  if (!holdoutFile) return null;

  const reportPath = path.join(REPORT_DIR, holdoutFile);
  const baseStem = holdoutFile.replace(/-holdout\.json$/i, "");
  const sheetFile = entries.find((entry) => entry === `${baseStem.replace(/-holdout$/i, "")}-game-sheet.csv`)
    ?? entries.find((entry) => entry.includes(playerSlug) && entry.endsWith("-game-sheet.csv"))
    ?? null;
  const sheetPath = sheetFile ? path.join(REPORT_DIR, sheetFile) : null;

  const summary = JSON.parse(await fs.readFile(reportPath, "utf8")) as HoldoutSummaryFile;
  const games = sheetPath ? await parseGameSheet(sheetPath) : [];

  if (!summary.fullSample || !summary.trainingSample || !summary.holdoutSample) {
    return null;
  }

  return {
    playerName,
    reportPath,
    sheetPath,
    holdoutRatio: summary.holdoutRatio ?? 0.3,
    fullSample: summary.fullSample,
    trainingSample: summary.trainingSample,
    holdoutSample: summary.holdoutSample,
    games,
  };
}

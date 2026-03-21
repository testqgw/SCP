import fs from "node:fs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";

type Side = "OVER" | "UNDER";

type TrainingRow = {
  playerId: string;
  playerName: string;
  market: string;
  gameDateEt: string;
  projectedValue: number;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  projectionSide: Side;
  finalSide: Side;
  actualSide: Side;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
};

type BacktestRowsFile = {
  from: string;
  to: string;
  playerMarketRows: TrainingRow[];
};

type Args = {
  input: string;
  out: string;
  threshold: number;
  limit: number;
  player: string | null;
};

type AstOutlierEntry = {
  playerName: string;
  playerId: string;
  gameDateEt: string;
  projectedAST: number;
  line: number;
  actualAST: number;
  lineGap: number;
  absLineGap: number;
  projectionSide: Side;
  finalSide: Side;
  actualSide: Side;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  overPrice: number | null;
  underPrice: number | null;
  priceLean: number | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  lineupTimingConfidence: number | null;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  completenessScore: number | null;
};

type PlayerAstSummary = {
  playerName: string;
  playerId: string;
  samples: number;
  outlierCount: number;
  meanGap: number;
  meanAbsGap: number;
  avgExpectedMinutes: number | null;
  avgStarterRateLast10: number | null;
  avgLineupTimingConfidence: number | null;
  outliers: AstOutlierEntry[];
};

type AstOutlierReport = {
  generatedAt: string;
  input: string;
  from: string;
  to: string;
  threshold: number;
  rows: number;
  filteredPlayer: string | null;
  astRows: number;
  outlierCount: number;
  byPlayer: PlayerAstSummary[];
  outliers: AstOutlierEntry[];
};

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "ast-outlier-report.json");
  let threshold = 4;
  let limit = 25;
  let player: string | null = null;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];

    if ((token === "--input" || token === "-i") && next) {
      input = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      input = token.slice("--input=".length);
      continue;
    }
    if ((token === "--out" || token === "-o") && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if (token === "--threshold" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) threshold = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--threshold=")) {
      const parsed = Number(token.slice("--threshold=".length));
      if (Number.isFinite(parsed) && parsed > 0) threshold = parsed;
      continue;
    }
    if ((token === "--limit" || token === "-n") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) limit = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--limit=")) {
      const parsed = Number(token.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) limit = Math.floor(parsed);
      continue;
    }
    if (token === "--player" && next) {
      player = next.trim().toLowerCase();
      index += 1;
      continue;
    }
    if (token.startsWith("--player=")) {
      player = token.slice("--player=".length).trim().toLowerCase();
    }
  }

  return { input, out, threshold, limit, player };
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function toOutlierEntry(row: TrainingRow): AstOutlierEntry {
  return {
    playerName: row.playerName,
    playerId: row.playerId,
    gameDateEt: row.gameDateEt,
    projectedAST: row.projectedValue,
    line: row.line,
    actualAST: row.actualValue,
    lineGap: round(row.projectedValue - row.line),
    absLineGap: round(Math.abs(row.projectedValue - row.line)),
    projectionSide: row.projectionSide,
    finalSide: row.finalSide,
    actualSide: row.actualSide,
    favoredSide: row.favoredSide,
    overPrice: row.overPrice,
    underPrice: row.underPrice,
    priceLean: row.priceLean,
    expectedMinutes: row.expectedMinutes,
    minutesVolatility: row.minutesVolatility,
    starterRateLast10: row.starterRateLast10,
    lineupTimingConfidence: row.lineupTimingConfidence,
    openingTeamSpread: row.openingTeamSpread,
    openingTotal: row.openingTotal,
    completenessScore: row.completenessScore,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const astRows = payload.playerMarketRows.filter((row) => row.market === "AST");
  const filteredAstRows =
    args.player == null
      ? astRows
      : astRows.filter(
          (row) => normalize(row.playerName).includes(args.player ?? "") || normalize(row.playerId).includes(args.player ?? ""),
        );

  const outlierRows = filteredAstRows
    .filter((row) => Math.abs(row.projectedValue - row.line) >= args.threshold)
    .sort((left, right) => Math.abs(right.projectedValue - right.line) - Math.abs(left.projectedValue - left.line));

  const grouped = new Map<string, TrainingRow[]>();
  for (const row of filteredAstRows) {
    const bucket = grouped.get(row.playerId) ?? [];
    bucket.push(row);
    grouped.set(row.playerId, bucket);
  }

  const byPlayer = Array.from(grouped.entries())
    .map<PlayerAstSummary>(([playerId, rows]) => {
      const outliers = rows
        .filter((row) => Math.abs(row.projectedValue - row.line) >= args.threshold)
        .sort((left, right) => Math.abs(right.projectedValue - right.line) - Math.abs(left.projectedValue - left.line))
        .slice(0, args.limit)
        .map(toOutlierEntry);
      return {
        playerName: rows[0]?.playerName ?? playerId,
        playerId,
        samples: rows.length,
        outlierCount: rows.filter((row) => Math.abs(row.projectedValue - row.line) >= args.threshold).length,
        meanGap: round(mean(rows.map((row) => row.projectedValue - row.line)) ?? 0),
        meanAbsGap: round(mean(rows.map((row) => Math.abs(row.projectedValue - row.line))) ?? 0),
        avgExpectedMinutes: mean(rows.map((row) => row.expectedMinutes).filter((value): value is number => value != null)),
        avgStarterRateLast10: mean(rows.map((row) => row.starterRateLast10).filter((value): value is number => value != null)),
        avgLineupTimingConfidence: mean(
          rows.map((row) => row.lineupTimingConfidence).filter((value): value is number => value != null),
        ),
        outliers,
      };
    })
    .filter((entry) => entry.outlierCount > 0)
    .sort((left, right) => right.outlierCount - left.outlierCount || right.meanAbsGap - left.meanAbsGap)
    .slice(0, args.limit);

  const report: AstOutlierReport = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    from: payload.from,
    to: payload.to,
    threshold: args.threshold,
    rows: payload.playerMarketRows.length,
    filteredPlayer: args.player,
    astRows: filteredAstRows.length,
    outlierCount: outlierRows.length,
    byPlayer,
    outliers: outlierRows.slice(0, args.limit).map(toOutlierEntry),
  };

  await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
  await writeFile(path.resolve(args.out), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

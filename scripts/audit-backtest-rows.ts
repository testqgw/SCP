import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";

type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";
type Side = "OVER" | "UNDER";

type TrainingRow = {
  playerId: string;
  playerName: string;
  market: Market;
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
  benchBigRoleStability?: number | null;
  actualMinutes: number;
  lineGap: number;
  absLineGap: number;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  spreadResolved: boolean;
};

type BacktestRowsFile = {
  from: string;
  to: string;
  playerMarketRows: TrainingRow[];
};

type Args = {
  input: string;
  out: string;
  limit: number;
  astGapThreshold: number;
  comboDriftThreshold: number;
};

type NumericFieldSummary = {
  field: keyof TrainingRow;
  rows: number;
  nullCount: number;
  nullPct: number;
  nanCount: number;
  zeroCount: number;
  min: number | null;
  max: number | null;
  mean: number | null;
};

type AstOutlier = {
  playerName: string;
  playerId: string;
  gameDateEt: string;
  projectedAST: number;
  line: number;
  actualAST: number;
  lineGap: number;
  absLineGap: number;
  overPrice: number | null;
  underPrice: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  openingTeamSpread: number | null;
  openingTotal: number | null;
};

type ComboDriftRow = {
  playerName: string;
  playerId: string;
  gameDateEt: string;
  market: "PRA" | "PA" | "PR" | "RA";
  comboProjection: number;
  expectedFromSingles: number;
  drift: number;
  absDrift: number;
  pts: number | null;
  reb: number | null;
  ast: number | null;
};

type AuditReport = {
  generatedAt: string;
  input: string;
  from: string;
  to: string;
  rows: number;
  markets: Record<Market, number>;
  fieldIntegrity: NumericFieldSummary[];
  astAudit: {
    threshold: number;
    rows: number;
    meanGap: number;
    meanAbsGap: number;
    outlierCount: number;
    outliers: AstOutlier[];
  };
  comboAudit: {
    threshold: number;
    comparableGames: number;
    outlierCount: number;
    byMarket: Record<"PRA" | "PA" | "PR" | "RA", { count: number; meanAbsDrift: number; maxAbsDrift: number }>;
    outliers: ComboDriftRow[];
  };
};

const NUMERIC_FIELDS: Array<keyof TrainingRow> = [
  "projectedValue",
  "actualValue",
  "line",
  "overPrice",
  "underPrice",
  "priceLean",
  "expectedMinutes",
  "minutesVolatility",
  "starterRateLast10",
  "benchBigRoleStability",
  "actualMinutes",
  "lineGap",
  "absLineGap",
  "openingTeamSpread",
  "openingTotal",
  "lineupTimingConfidence",
  "completenessScore",
];

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "backtest-row-audit.json");
  let limit = 25;
  let astGapThreshold = 4;
  let comboDriftThreshold = 0.2;

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
    if (token === "--ast-gap-threshold" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) astGapThreshold = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--ast-gap-threshold=")) {
      const parsed = Number(token.slice("--ast-gap-threshold=".length));
      if (Number.isFinite(parsed) && parsed > 0) astGapThreshold = parsed;
      continue;
    }
    if (token === "--combo-drift-threshold" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) comboDriftThreshold = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--combo-drift-threshold=")) {
      const parsed = Number(token.slice("--combo-drift-threshold=".length));
      if (Number.isFinite(parsed) && parsed >= 0) comboDriftThreshold = parsed;
    }
  }

  return { input, out, limit, astGapThreshold, comboDriftThreshold };
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeNumericField(rows: TrainingRow[], field: keyof TrainingRow): NumericFieldSummary {
  let nullCount = 0;
  let nanCount = 0;
  let zeroCount = 0;
  const values: number[] = [];

  for (const row of rows) {
    const value = row[field];
    if (value == null) {
      nullCount += 1;
      continue;
    }
    if (typeof value !== "number" || Number.isNaN(value)) {
      nanCount += 1;
      continue;
    }
    if (value === 0) zeroCount += 1;
    values.push(value);
  }

  return {
    field,
    rows: rows.length,
    nullCount,
    nullPct: round((nullCount / rows.length) * 100, 2),
    nanCount,
    zeroCount,
    min: values.length ? round(Math.min(...values), 4) : null,
    max: values.length ? round(Math.max(...values), 4) : null,
    mean: values.length ? round(mean(values) ?? 0, 4) : null,
  };
}

function buildAstOutliers(rows: TrainingRow[], threshold: number, limit: number): AuditReport["astAudit"] {
  const astRows = rows.filter((row) => row.market === "AST");
  const outliers = astRows
    .filter((row) => Math.abs(row.projectedValue - row.line) >= threshold)
    .sort((left, right) => Math.abs(right.projectedValue - right.line) - Math.abs(left.projectedValue - left.line))
    .slice(0, limit)
    .map<AstOutlier>((row) => ({
      playerName: row.playerName,
      playerId: row.playerId,
      gameDateEt: row.gameDateEt,
      projectedAST: row.projectedValue,
      line: row.line,
      actualAST: row.actualValue,
      lineGap: round(row.projectedValue - row.line, 4),
      absLineGap: round(Math.abs(row.projectedValue - row.line), 4),
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      favoredSide: row.favoredSide,
      expectedMinutes: row.expectedMinutes,
      minutesVolatility: row.minutesVolatility,
      openingTeamSpread: row.openingTeamSpread,
      openingTotal: row.openingTotal,
    }));

  return {
    threshold,
    rows: astRows.length,
    meanGap: round(mean(astRows.map((row) => row.projectedValue - row.line)) ?? 0, 4),
    meanAbsGap: round(mean(astRows.map((row) => Math.abs(row.projectedValue - row.line))) ?? 0, 4),
    outlierCount: astRows.filter((row) => Math.abs(row.projectedValue - row.line) >= threshold).length,
    outliers,
  };
}

function buildComboAudit(rows: TrainingRow[], threshold: number, limit: number): AuditReport["comboAudit"] {
  const grouped = new Map<
    string,
    {
      playerName: string;
      playerId: string;
      gameDateEt: string;
      projections: Partial<Record<Market, number>>;
    }
  >();

  for (const row of rows) {
    const key = `${row.playerId}|${row.gameDateEt}`;
    const existing =
      grouped.get(key) ??
      {
        playerName: row.playerName,
        playerId: row.playerId,
        gameDateEt: row.gameDateEt,
        projections: {},
      };
    existing.projections[row.market] = row.projectedValue;
    grouped.set(key, existing);
  }

  const outliers: ComboDriftRow[] = [];
  const driftsByMarket: Record<"PRA" | "PA" | "PR" | "RA", number[]> = {
    PRA: [],
    PA: [],
    PR: [],
    RA: [],
  };
  let comparableGames = 0;

  for (const group of grouped.values()) {
    const pts = group.projections.PTS;
    const reb = group.projections.REB;
    const ast = group.projections.AST;
    if (pts == null || reb == null || ast == null) continue;
    comparableGames += 1;

    const expectations: Array<{ market: "PRA" | "PA" | "PR" | "RA"; expected: number; actual: number | undefined }> = [
      { market: "PRA", expected: pts + reb + ast, actual: group.projections.PRA },
      { market: "PA", expected: pts + ast, actual: group.projections.PA },
      { market: "PR", expected: pts + reb, actual: group.projections.PR },
      { market: "RA", expected: reb + ast, actual: group.projections.RA },
    ];

    for (const entry of expectations) {
      if (entry.actual == null) continue;
      const drift = round(entry.actual - entry.expected, 4);
      driftsByMarket[entry.market].push(Math.abs(drift));
      if (Math.abs(drift) >= threshold) {
        outliers.push({
          playerName: group.playerName,
          playerId: group.playerId,
          gameDateEt: group.gameDateEt,
          market: entry.market,
          comboProjection: round(entry.actual, 4),
          expectedFromSingles: round(entry.expected, 4),
          drift,
          absDrift: Math.abs(drift),
          pts: round(pts, 4),
          reb: round(reb, 4),
          ast: round(ast, 4),
        });
      }
    }
  }

  outliers.sort((left, right) => right.absDrift - left.absDrift);

  return {
    threshold,
    comparableGames,
    outlierCount: outliers.length,
    byMarket: {
      PRA: {
        count: driftsByMarket.PRA.length,
        meanAbsDrift: round(mean(driftsByMarket.PRA) ?? 0, 4),
        maxAbsDrift: round(Math.max(0, ...driftsByMarket.PRA), 4),
      },
      PA: {
        count: driftsByMarket.PA.length,
        meanAbsDrift: round(mean(driftsByMarket.PA) ?? 0, 4),
        maxAbsDrift: round(Math.max(0, ...driftsByMarket.PA), 4),
      },
      PR: {
        count: driftsByMarket.PR.length,
        meanAbsDrift: round(mean(driftsByMarket.PR) ?? 0, 4),
        maxAbsDrift: round(Math.max(0, ...driftsByMarket.PR), 4),
      },
      RA: {
        count: driftsByMarket.RA.length,
        meanAbsDrift: round(mean(driftsByMarket.RA) ?? 0, 4),
        maxAbsDrift: round(Math.max(0, ...driftsByMarket.RA), 4),
      },
    },
    outliers: outliers.slice(0, limit),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.out);
  const payload = JSON.parse(await readFile(inputPath, "utf8")) as BacktestRowsFile;
  const rows = payload.playerMarketRows ?? [];

  const markets = rows.reduce<Record<Market, number>>(
    (accumulator, row) => {
      accumulator[row.market] += 1;
      return accumulator;
    },
    { PTS: 0, REB: 0, AST: 0, THREES: 0, PRA: 0, PA: 0, PR: 0, RA: 0 },
  );

  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    input: inputPath,
    from: payload.from,
    to: payload.to,
    rows: rows.length,
    markets,
    fieldIntegrity: NUMERIC_FIELDS.map((field) => summarizeNumericField(rows, field)),
    astAudit: buildAstOutliers(rows, args.astGapThreshold, args.limit),
    comboAudit: buildComboAudit(rows, args.comboDriftThreshold, args.limit),
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    output: outputPath,
    rows: report.rows,
    window: `${report.from} -> ${report.to}`,
    astOutliers: report.astAudit.outlierCount,
    topAstOutlier: report.astAudit.outliers[0] ?? null,
    comboOutliers: report.comboAudit.outlierCount,
    comboByMarket: report.comboAudit.byMarket,
    nullFieldLeaders: report.fieldIntegrity
      .filter((field) => field.nullCount > 0)
      .sort((left, right) => right.nullCount - left.nullCount)
      .slice(0, 8),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

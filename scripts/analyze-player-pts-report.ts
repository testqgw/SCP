import fs from "node:fs/promises";
import path from "node:path";

type Args = {
  report: string;
  holdoutRatio: number;
  out: string | null;
  sheetOut: string | null;
};

type Side = "OVER" | "UNDER" | "NEUTRAL";

type ReportGame = {
  gameDateEt: string;
  matchupKey: string;
  projections?: Record<string, number | null>;
  actuals?: Record<string, number | null>;
  predictedSides?: Record<string, Side>;
  actualSides?: Record<string, Side>;
  sideCorrect?: Record<string, boolean>;
  historicalContext?: {
    openingTeamSpread?: number | null;
    openingTotal?: number | null;
    bookPtsLine?: number | null;
    bookPtsLineSource?: string | null;
    ptsSideConfidence?: number | null;
    ptsOverScore?: number | null;
    ptsUnderScore?: number | null;
    ptsMinutesRisk?: number | null;
    lineupTimingConfidence?: number | null;
    ptsQualifiedBet?: boolean | null;
  };
};

type ReportPayload = {
  player?: {
    id?: string;
    name?: string;
    position?: string | null;
  };
  range?: {
    from?: string;
    to?: string;
  };
  games?: ReportGame[];
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let report = "";
  let holdoutRatio = 0.3;
  let out: string | null = null;
  let sheetOut: string | null = null;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];

    if (token === "--report" && next) {
      report = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--report=")) {
      report = token.slice("--report=".length);
      continue;
    }
    if (token === "--holdout-ratio" && next) {
      holdoutRatio = Number(next);
      index += 1;
      continue;
    }
    if (token.startsWith("--holdout-ratio=")) {
      holdoutRatio = Number(token.slice("--holdout-ratio=".length));
      continue;
    }
    if (token === "--out" && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if (token === "--sheet-out" && next) {
      sheetOut = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--sheet-out=")) {
      sheetOut = token.slice("--sheet-out=".length);
      continue;
    }
  }

  if (!report.trim()) {
    throw new Error("Missing required --report argument.");
  }
  if (!Number.isFinite(holdoutRatio) || holdoutRatio <= 0 || holdoutRatio >= 1) {
    throw new Error("--holdout-ratio must be between 0 and 1.");
  }

  return {
    report: report.trim(),
    holdoutRatio,
    out,
    sheetOut,
  };
}

function toCsvValue(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function buildCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

function summarizeGames(games: ReportGame[]): {
  games: number;
  correct: number;
  wrong: number;
  accuracyPct: number | null;
  averageLine: number | null;
  averageProjection: number | null;
  from: string | null;
  to: string | null;
} {
  let correct = 0;
  let wrong = 0;
  let lineSum = 0;
  let lineCount = 0;
  let projectionSum = 0;
  let projectionCount = 0;

  for (const game of games) {
    if (game.sideCorrect?.PTS === true) correct += 1;
    if (game.sideCorrect?.PTS === false) wrong += 1;
    const line = game.historicalContext?.bookPtsLine;
    if (line != null && Number.isFinite(line)) {
      lineSum += line;
      lineCount += 1;
    }
    const projection = game.projections?.PTS;
    if (projection != null && Number.isFinite(projection)) {
      projectionSum += projection;
      projectionCount += 1;
    }
  }

  const resolved = correct + wrong;
  return {
    games: games.length,
    correct,
    wrong,
    accuracyPct: resolved > 0 ? Number(((correct / resolved) * 100).toFixed(2)) : null,
    averageLine: lineCount > 0 ? Number((lineSum / lineCount).toFixed(2)) : null,
    averageProjection: projectionCount > 0 ? Number((projectionSum / projectionCount).toFixed(2)) : null,
    from: games[0]?.gameDateEt ?? null,
    to: games[games.length - 1]?.gameDateEt ?? null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const resolvedReport = path.resolve(args.report);
  const payload = JSON.parse(await fs.readFile(resolvedReport, "utf8")) as ReportPayload;
  const games = [...(payload.games ?? [])].sort((left, right) => {
    const dateCompare = left.gameDateEt.localeCompare(right.gameDateEt);
    if (dateCompare !== 0) return dateCompare;
    return left.matchupKey.localeCompare(right.matchupKey);
  });

  if (games.length < 2) {
    throw new Error("Report must contain at least two games for holdout analysis.");
  }

  const splitIndex = Math.min(games.length - 1, Math.max(1, Math.floor(games.length * (1 - args.holdoutRatio))));
  const trainGames = games.slice(0, splitIndex);
  const holdoutGames = games.slice(splitIndex);

  const summary = {
    player: payload.player ?? null,
    range: payload.range ?? null,
    holdoutRatio: args.holdoutRatio,
    splitIndex,
    fullSample: summarizeGames(games),
    trainingSample: summarizeGames(trainGames),
    holdoutSample: summarizeGames(holdoutGames),
  };

  if (args.out) {
    const resolvedOut = path.resolve(args.out);
    await fs.mkdir(path.dirname(resolvedOut), { recursive: true });
    await fs.writeFile(resolvedOut, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  if (args.sheetOut) {
    const resolvedSheetOut = path.resolve(args.sheetOut);
    await fs.mkdir(path.dirname(resolvedSheetOut), { recursive: true });
    const rows = games.map((game) => ({
      gameDateEt: game.gameDateEt,
      matchupKey: game.matchupKey,
      bookPtsLine: game.historicalContext?.bookPtsLine ?? null,
      lineSource: game.historicalContext?.bookPtsLineSource ?? null,
      projectedPts: game.projections?.PTS ?? null,
      predictedSide: game.predictedSides?.PTS ?? null,
      actualPts: game.actuals?.PTS ?? null,
      actualSide: game.actualSides?.PTS ?? null,
      correct: game.sideCorrect?.PTS ?? null,
      openingTeamSpread: game.historicalContext?.openingTeamSpread ?? null,
      openingTotal: game.historicalContext?.openingTotal ?? null,
      ptsSideConfidence: game.historicalContext?.ptsSideConfidence ?? null,
      ptsOverScore: game.historicalContext?.ptsOverScore ?? null,
      ptsUnderScore: game.historicalContext?.ptsUnderScore ?? null,
      ptsMinutesRisk: game.historicalContext?.ptsMinutesRisk ?? null,
      lineupTimingConfidence: game.historicalContext?.lineupTimingConfidence ?? null,
      ptsQualifiedBet: game.historicalContext?.ptsQualifiedBet ?? null,
    }));
    await fs.writeFile(resolvedSheetOut, buildCsv(rows), "utf8");
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

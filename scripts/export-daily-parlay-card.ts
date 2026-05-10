import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { ensureNbaScheduleGamesForDate } from "../lib/snapshot/nbaScheduleSync";
import {
  buildSnapshotParlayCard,
  summarizeLockedPrecisionParlayHistory,
  type SnapshotParlayCard,
  type SnapshotParlayHistorySummary,
} from "../lib/snapshot/parlayModel";
import { getSnapshotBoardData } from "../lib/snapshot/query";
import { getSnapshotBoardDateString } from "../lib/snapshot/time";

type Args = {
  dateEt: string;
  targetLegs: number | null;
  maxLegs: number | null;
  minLegProbability: number | null;
  outPrefix: string;
  historyInput: string | null;
  refresh: boolean;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let dateEt = getSnapshotBoardDateString();
  let targetLegs: number | null = null;
  let maxLegs: number | null = null;
  let minLegProbability: number | null = null;
  let outPrefix: string | null = null;
  let historyInput: string | null = path.join("exports", "precision-locked-pregame-results.json");
  let refresh = false;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if ((token === "--date" || token === "-d") && next) {
      dateEt = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--date=")) {
      dateEt = token.slice("--date=".length);
      continue;
    }
    if ((token === "--legs" || token === "--target-legs") && next) {
      targetLegs = Number(next);
      index += 1;
      continue;
    }
    if (token.startsWith("--legs=") || token.startsWith("--target-legs=")) {
      targetLegs = Number(token.includes("--target-legs=") ? token.slice("--target-legs=".length) : token.slice("--legs=".length));
      continue;
    }
    if (token === "--max-legs" && next) {
      maxLegs = Number(next);
      index += 1;
      continue;
    }
    if (token.startsWith("--max-legs=")) {
      maxLegs = Number(token.slice("--max-legs=".length));
      continue;
    }
    if (token === "--min-prob" && next) {
      minLegProbability = Number(next);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-prob=")) {
      minLegProbability = Number(token.slice("--min-prob=".length));
      continue;
    }
    if ((token === "--out-prefix" || token === "-o") && next) {
      outPrefix = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out-prefix=")) {
      outPrefix = token.slice("--out-prefix=".length);
      continue;
    }
    if (token === "--history-input" && next) {
      historyInput = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--history-input=")) {
      historyInput = token.slice("--history-input=".length);
      continue;
    }
    if (token === "--no-history") {
      historyInput = null;
      continue;
    }
    if (token === "--refresh" || token === "--rebuild") {
      refresh = true;
      continue;
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEt)) {
    throw new Error(`Invalid --date value "${dateEt}". Expected YYYY-MM-DD.`);
  }

  return {
    dateEt,
    targetLegs: Number.isFinite(targetLegs) ? targetLegs : null,
    maxLegs: Number.isFinite(maxLegs) ? maxLegs : null,
    minLegProbability: Number.isFinite(minLegProbability) ? minLegProbability : null,
    outPrefix: outPrefix ?? path.join("exports", `daily-parlay-card-${dateEt}`),
    historyInput,
    refresh,
  };
}

function pct(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(decimals)}%`;
}

function pctAlready(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(decimals)}%`;
}

function n(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(card: SnapshotParlayCard): string {
  const columns = [
    "rank",
    "playerName",
    "teamCode",
    "opponentCode",
    "matchupKey",
    "gameTimeEt",
    "market",
    "side",
    "line",
    "projectedValue",
    "legProbability",
    "selectionScore",
    "modelScore",
    "sportsbookCount",
    "selectorFamily",
    "riskFlags",
  ];
  const lines = [columns.join(",")];
  for (const leg of card.legs) {
    lines.push(
      columns
        .map((column) => {
          const value = column === "riskFlags" ? leg.riskFlags.join("; ") : leg[column as keyof typeof leg];
          return csvCell(value);
        })
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function toMarkdown(
  card: SnapshotParlayCard,
  history: SnapshotParlayHistorySummary | null,
  scheduleSync: Awaited<ReturnType<typeof ensureNbaScheduleGamesForDate>>,
): string {
  const lines: string[] = [];
  lines.push("# Daily Precision Parlay Card");
  lines.push("");
  lines.push(`Generated: ${card.generatedAt}`);
  lines.push(`Date ET: ${card.dateEt}`);
  lines.push(`Status: ${card.status}`);
  lines.push(
    `Schedule sync: ${scheduleSync.scheduleGames} official game${scheduleSync.scheduleGames === 1 ? "" : "s"}, ${scheduleSync.upsertedGames} upserted`,
  );
  lines.push("");
  lines.push("## Model Read");
  lines.push("");
  lines.push(`- Legs: ${card.summary.legCount}/${card.summary.targetLegs}`);
  lines.push(`- Candidate pool: ${card.summary.candidateCount}`);
  lines.push(`- Average leg probability: ${pct(card.summary.averageLegProbability, 1)}`);
  lines.push(`- Independent hit estimate: ${pct(card.summary.independentHitProbability, 1)}`);
  lines.push(`- Correlation-adjusted hit estimate: ${pct(card.summary.adjustedHitProbability, 1)}`);
  lines.push(`- Assumed odds: ${card.summary.assumedAmericanOdds > 0 ? `+${card.summary.assumedAmericanOdds}` : card.summary.assumedAmericanOdds}`);
  lines.push(`- Expected value per 1u at default odds: ${n(card.summary.expectedValuePerUnit, 4)}u`);
  lines.push("");
  if (history) {
    lines.push("## Locked History Baseline");
    lines.push("");
    lines.push(`- Range: ${history.range.from ?? "-"} through ${history.range.to ?? "-"} (${history.range.days} slates)`);
    lines.push(`- Individual leg accuracy: ${pctAlready(history.legAccuracyPct)}`);
    lines.push(`- Full ${history.minLegs}-leg hits: ${history.allLegHitDays}/${history.daysWithMinLegs} (${pctAlready(history.allLegHitRatePct)})`);
    lines.push(`- 5+ wins on six-leg cards: ${history.fivePlusHitDays}/${history.daysWithMinLegs} (${pctAlready(history.fivePlusHitRatePct)})`);
    lines.push(`- Average wins per card: ${n(history.averageWinsPerCard)}`);
    lines.push("");
  }
  lines.push("## Legs");
  lines.push("");
  if (card.legs.length === 0) {
    lines.push("No playable parlay legs cleared the model.");
  } else {
    lines.push("| Rank | Player | Team | Matchup | Market | Side | Line | Prob | Books | Score | Risk |");
    lines.push("|---:|---|---|---|---|---|---:|---:|---:|---:|---|");
    for (const leg of card.legs) {
      lines.push(
        `| ${leg.rank} | ${leg.playerName} | ${leg.teamCode} | ${leg.matchupKey} | ${leg.market} | ${leg.side} | ${n(leg.line)} | ${pct(leg.legProbability, 1)} | ${leg.sportsbookCount} | ${n(leg.modelScore, 4)} | ${leg.riskFlags.join(", ") || "-"} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Warnings");
  lines.push("");
  card.warnings.forEach((warning) => lines.push(`- ${warning}`));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function maybeLoadHistory(historyInput: string | null, minLegs: number): Promise<SnapshotParlayHistorySummary | null> {
  if (!historyInput) return null;
  const inputPath = path.resolve(historyInput);
  if (!existsSync(inputPath)) return null;
  const payload = JSON.parse(await readFile(inputPath, "utf8")) as Parameters<
    typeof summarizeLockedPrecisionParlayHistory
  >[0];
  return summarizeLockedPrecisionParlayHistory(payload, minLegs);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const scheduleSync = await ensureNbaScheduleGamesForDate(args.dateEt);
  const board = await getSnapshotBoardData(args.dateEt, args.refresh || scheduleSync.upsertedGames > 0);
  const card = buildSnapshotParlayCard(board, {
    ...(args.targetLegs == null ? {} : { targetLegs: args.targetLegs, minLegs: args.targetLegs }),
    ...(args.maxLegs == null ? {} : { maxLegs: args.maxLegs }),
    ...(args.minLegProbability == null ? {} : { minLegProbability: args.minLegProbability }),
  });
  const history = await maybeLoadHistory(args.historyInput, card.config.minLegs);
  const outPrefix = path.resolve(args.outPrefix);
  await mkdir(path.dirname(outPrefix), { recursive: true });

  const jsonPath = `${outPrefix}.json`;
  const mdPath = `${outPrefix}.md`;
  const csvPath = `${outPrefix}.csv`;

  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify({ card, history, scheduleSync }, null, 2)}\n`, "utf8"),
    writeFile(mdPath, toMarkdown(card, history, scheduleSync), "utf8"),
    writeFile(csvPath, toCsv(card), "utf8"),
  ]);

  process.stdout.write(
    `${JSON.stringify(
      {
        status: card.status,
        dateEt: card.dateEt,
        legs: card.summary.legCount,
        candidateCount: card.summary.candidateCount,
        adjustedHitProbability: card.summary.adjustedHitProbability,
        historyAllLegHitRatePct: history?.allLegHitRatePct ?? null,
        scheduleSync,
        outputs: { jsonPath, mdPath, csvPath },
      },
      null,
      2,
    )}\n`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

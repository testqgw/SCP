import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

type Args = {
  from: string;
  to: string;
  out: string;
  doc: string;
  maxRows: number;
};

type TeamTotals = {
  points: number;
  rebounds: number;
  assists: number;
};

type SuspiciousRow = {
  playerName: string;
  teamCode: string | null;
  gameDateEt: string;
  externalGameId: string;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  minutes: number | null;
  teamPoints: number | null;
  teamRebounds: number | null;
  teamAssists: number | null;
  pointSharePct: number | null;
  reboundSharePct: number | null;
  assistSharePct: number | null;
  flags: string[];
};

const prisma = new PrismaClient();

const HARD_LIMITS = {
  points: 70,
  rebounds: 25,
  assists: 20,
  minutes: 53,
} as const;

const SHARE_LIMITS = {
  pointsMin: 45,
  pointsSharePct: 55,
  reboundsMin: 18,
  reboundsSharePct: 45,
  assistsMin: 15,
  assistsSharePct: 55,
} as const;

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let from = "2025-10-23";
  let to = "2026-04-14";
  let out = path.join("exports", "actual-value-integrity-audit-2025-10-23-to-2026-04-14.json");
  let doc = path.join("docs", "actual-value-integrity-audit-2026-04-15.md");
  let maxRows = 25;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if ((token === "--from" || token === "-f") && next) {
      from = next;
      index += 1;
      continue;
    }
    if ((token === "--to" || token === "-t") && next) {
      to = next;
      index += 1;
      continue;
    }
    if ((token === "--out" || token === "-o") && next) {
      out = next;
      index += 1;
      continue;
    }
    if ((token === "--doc" || token === "-d") && next) {
      doc = next;
      index += 1;
      continue;
    }
    if ((token === "--max-rows" || token === "-m") && next) {
      maxRows = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (token.startsWith("--from=")) from = token.slice("--from=".length);
    if (token.startsWith("--to=")) to = token.slice("--to=".length);
    if (token.startsWith("--out=")) out = token.slice("--out=".length);
    if (token.startsWith("--doc=")) doc = token.slice("--doc=".length);
    if (token.startsWith("--max-rows=")) maxRows = Number.parseInt(token.slice("--max-rows=".length), 10);
  }

  return {
    from,
    to,
    out: path.resolve(out),
    doc: path.resolve(doc),
    maxRows: Number.isFinite(maxRows) && maxRows > 0 ? maxRows : 25,
  };
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(part: number | null | undefined, total: number | null | undefined) {
  if (part == null || total == null || total <= 0) return null;
  return round((part / total) * 100, 2);
}

async function main(): Promise<void> {
  const args = parseArgs();

  const logs = await prisma.playerGameLog.findMany({
    where: {
      played: true,
      gameDateEt: {
        gte: args.from,
        lte: args.to,
      },
    },
    select: {
      gameDateEt: true,
      externalGameId: true,
      teamId: true,
      minutes: true,
      points: true,
      rebounds: true,
      assists: true,
      player: {
        select: {
          fullName: true,
        },
      },
      team: {
        select: {
          abbreviation: true,
        },
      },
    },
  });

  const teamTotals = new Map<string, TeamTotals>();
  for (const log of logs) {
    const key = `${log.externalGameId}|${log.teamId ?? "na"}`;
    const current = teamTotals.get(key) ?? { points: 0, rebounds: 0, assists: 0 };
    current.points += log.points ?? 0;
    current.rebounds += log.rebounds ?? 0;
    current.assists += log.assists ?? 0;
    teamTotals.set(key, current);
  }

  const hardAnomalyRows: SuspiciousRow[] = [];
  const shareWatchRows: SuspiciousRow[] = [];
  let pointsAbove70 = 0;
  let reboundsAbove25 = 0;
  let assistsAbove20 = 0;
  let minutesAbove53 = 0;
  let highPointShareRows = 0;
  let highReboundShareRows = 0;
  let highAssistShareRows = 0;

  for (const log of logs) {
    const totals = teamTotals.get(`${log.externalGameId}|${log.teamId ?? "na"}`) ?? null;
    const pointSharePct = pct(log.points, totals?.points ?? null);
    const reboundSharePct = pct(log.rebounds, totals?.rebounds ?? null);
    const assistSharePct = pct(log.assists, totals?.assists ?? null);
    const hardFlags: string[] = [];
    const watchFlags: string[] = [];

    if ((log.points ?? 0) > HARD_LIMITS.points) {
      pointsAbove70 += 1;
      hardFlags.push(`points>${HARD_LIMITS.points}`);
    }
    if ((log.rebounds ?? 0) > HARD_LIMITS.rebounds) {
      reboundsAbove25 += 1;
      hardFlags.push(`rebounds>${HARD_LIMITS.rebounds}`);
    }
    if ((log.assists ?? 0) > HARD_LIMITS.assists) {
      assistsAbove20 += 1;
      hardFlags.push(`assists>${HARD_LIMITS.assists}`);
    }
    if ((log.minutes ?? 0) > HARD_LIMITS.minutes) {
      minutesAbove53 += 1;
      hardFlags.push(`minutes>${HARD_LIMITS.minutes}`);
    }
    if ((log.points ?? 0) >= SHARE_LIMITS.pointsMin && (pointSharePct ?? 0) >= SHARE_LIMITS.pointsSharePct) {
      highPointShareRows += 1;
      watchFlags.push(`pointShare>=${SHARE_LIMITS.pointsSharePct}%`);
    }
    if ((log.rebounds ?? 0) >= SHARE_LIMITS.reboundsMin && (reboundSharePct ?? 0) >= SHARE_LIMITS.reboundsSharePct) {
      highReboundShareRows += 1;
      watchFlags.push(`reboundShare>=${SHARE_LIMITS.reboundsSharePct}%`);
    }
    if ((log.assists ?? 0) >= SHARE_LIMITS.assistsMin && (assistSharePct ?? 0) >= SHARE_LIMITS.assistsSharePct) {
      highAssistShareRows += 1;
      watchFlags.push(`assistShare>=${SHARE_LIMITS.assistsSharePct}%`);
    }

    if (hardFlags.length === 0 && watchFlags.length === 0) continue;
    const row: SuspiciousRow = {
      playerName: log.player.fullName,
      teamCode: log.team?.abbreviation ?? null,
      gameDateEt: log.gameDateEt,
      externalGameId: log.externalGameId,
      points: log.points ?? null,
      rebounds: log.rebounds ?? null,
      assists: log.assists ?? null,
      minutes: log.minutes ?? null,
      teamPoints: totals ? round(totals.points, 2) : null,
      teamRebounds: totals ? round(totals.rebounds, 2) : null,
      teamAssists: totals ? round(totals.assists, 2) : null,
      pointSharePct,
      reboundSharePct,
      assistSharePct,
      flags: [...hardFlags, ...watchFlags],
    };
    if (hardFlags.length > 0) {
      hardAnomalyRows.push(row);
    } else {
      shareWatchRows.push(row);
    }
  }

  const rowSorter = (a: SuspiciousRow, b: SuspiciousRow) => {
    if (b.flags.length !== a.flags.length) return b.flags.length - a.flags.length;
    if ((b.points ?? 0) !== (a.points ?? 0)) return (b.points ?? 0) - (a.points ?? 0);
    if ((b.assists ?? 0) !== (a.assists ?? 0)) return (b.assists ?? 0) - (a.assists ?? 0);
    return (b.rebounds ?? 0) - (a.rebounds ?? 0);
  };

  hardAnomalyRows.sort(rowSorter);
  shareWatchRows.sort(rowSorter);

  const hardFlagCount = pointsAbove70 + reboundsAbove25 + assistsAbove20 + minutesAbove53;
  const summary = {
    generatedAt: new Date().toISOString(),
    sourceTable: "player_game_logs",
    downstreamNote:
      "Projection/backtest actualValue is derived from PlayerGameLog points, rebounds, and assists, so this audit covers the source that feeds those actualValue fields.",
    from: args.from,
    to: args.to,
    totalPlayedRows: logs.length,
    hardThresholds: {
      pointsAbove70,
      reboundsAbove25,
      assistsAbove20,
      minutesAbove53,
    },
    shareThresholds: {
      highPointShareRows,
      highReboundShareRows,
      highAssistShareRows,
    },
    hardAnomalyRowCount: hardAnomalyRows.length,
    hardAnomalyRows: hardAnomalyRows.slice(0, args.maxRows),
    shareWatchRowCount: shareWatchRows.length,
    shareWatchRows: shareWatchRows.slice(0, args.maxRows),
    verdict:
      hardFlagCount <= 2
        ? "Integrity risk looks narrow and isolated. The source table is not broadly poisoned, but the few hard-anomaly rows should be corrected or excluded before using great-game examples as literal box-score evidence."
        : "Integrity risk is broader than expected. Review the suspicious rows before trusting downstream actualValue-based reporting.",
  };

  const docLines = [
    "# ActualValue Integrity Audit",
    "",
    `- Generated: ${summary.generatedAt}`,
    `- Range: ${args.from} to ${args.to}`,
    `- Played rows audited: ${summary.totalPlayedRows}`,
    `- Source: \`player_game_logs\``,
    "",
    "## Hard Threshold Flags",
    "",
    `- Points above ${HARD_LIMITS.points}: ${pointsAbove70}`,
    `- Rebounds above ${HARD_LIMITS.rebounds}: ${reboundsAbove25}`,
    `- Assists above ${HARD_LIMITS.assists}: ${assistsAbove20}`,
    `- Minutes above ${HARD_LIMITS.minutes}: ${minutesAbove53}`,
    "",
    "## Share Flags",
    "",
    `- High point-share rows: ${highPointShareRows}`,
    `- High rebound-share rows: ${highReboundShareRows}`,
    `- High assist-share rows: ${highAssistShareRows}`,
    "",
    "## Verdict",
    "",
    `- ${summary.verdict}`,
    `- ${summary.downstreamNote}`,
    "",
    "## Hard Anomaly Rows",
    "",
  ];

  if (summary.hardAnomalyRows.length === 0) {
    docLines.push("- No hard-anomaly rows were flagged by the configured audit rules.");
  } else {
    for (const row of summary.hardAnomalyRows) {
      docLines.push(
        `- ${row.gameDateEt} ${row.playerName} (${row.teamCode ?? "N/A"}): ` +
          `PTS ${row.points ?? "-"}, REB ${row.rebounds ?? "-"}, AST ${row.assists ?? "-"}, MIN ${row.minutes ?? "-"}; ` +
          `team totals ${row.teamPoints ?? "-"} pts / ${row.teamRebounds ?? "-"} reb / ${row.teamAssists ?? "-"} ast; ` +
          `shares ${row.pointSharePct ?? "-"}% pts / ${row.reboundSharePct ?? "-"}% reb / ${row.assistSharePct ?? "-"}% ast; ` +
          `flags ${row.flags.join(", ")}.`,
      );
    }
  }

  docLines.push("", "## Share Watchlist", "");
  if (summary.shareWatchRows.length === 0) {
    docLines.push("- No share-watch rows were flagged.");
  } else {
    docLines.push("- These rows are extreme but can still be legitimate star outcomes, so they are a watchlist rather than hard data-integrity failures.");
    for (const row of summary.shareWatchRows) {
      docLines.push(
        `- ${row.gameDateEt} ${row.playerName} (${row.teamCode ?? "N/A"}): ` +
          `PTS ${row.points ?? "-"}, REB ${row.rebounds ?? "-"}, AST ${row.assists ?? "-"}; ` +
          `shares ${row.pointSharePct ?? "-"}% pts / ${row.reboundSharePct ?? "-"}% reb / ${row.assistSharePct ?? "-"}% ast; ` +
          `flags ${row.flags.join(", ")}.`,
      );
    }
  }

  await mkdir(path.dirname(args.out), { recursive: true });
  await mkdir(path.dirname(args.doc), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(args.doc, `${docLines.join("\n")}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

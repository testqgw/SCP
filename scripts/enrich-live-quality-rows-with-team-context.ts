import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

type Args = {
  input: string | null;
  out: string | null;
};

type PlayerMarketRow = {
  playerId: string;
  gameDateEt: string;
  teamId?: string | null;
  teamCode?: string | null;
  externalGameId?: string | null;
  [key: string]: unknown;
};

type RowsPayload = {
  playerMarketRows?: PlayerMarketRow[];
  [key: string]: unknown;
};

const prisma = new PrismaClient();

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input: string | null = null;
  let out: string | null = null;

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
  }

  return { input, out };
}

function rowLogKey(row: Pick<PlayerMarketRow, "playerId" | "gameDateEt">) {
  return `${row.playerId}|${row.gameDateEt}`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args.input || !args.out) {
    throw new Error("Usage: tsx scripts/enrich-live-quality-rows-with-team-context.ts --input <rows.json> --out <rows.json>");
  }

  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.out);
  const payload = JSON.parse(await readFile(inputPath, "utf8")) as RowsPayload;
  const rows = payload.playerMarketRows ?? [];
  const playerIds = [...new Set(rows.map((row) => row.playerId).filter(Boolean))];
  const dates = [...new Set(rows.map((row) => row.gameDateEt).filter(Boolean))];

  const logs = await prisma.playerGameLog.findMany({
    where: {
      playerId: { in: playerIds },
      gameDateEt: { in: dates },
    },
    select: {
      playerId: true,
      gameDateEt: true,
      externalGameId: true,
      teamId: true,
      team: { select: { abbreviation: true } },
    },
  });
  const logsByKey = new Map(logs.map((log) => [`${log.playerId}|${log.gameDateEt}`, log]));

  let enriched = 0;
  const playerMarketRows = rows.map((row) => {
    const log = logsByKey.get(rowLogKey(row));
    if (!log) return row;
    enriched += 1;
    return {
      ...row,
      teamId: row.teamId ?? log.teamId ?? null,
      teamCode: row.teamCode ?? log.team?.abbreviation ?? null,
      externalGameId: row.externalGameId ?? log.externalGameId ?? null,
    };
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ ...payload, playerMarketRows }, null, 2)}\n`, "utf8");
  process.stdout.write(
    JSON.stringify(
      {
        input: inputPath,
        out: outputPath,
        rows: rows.length,
        enriched,
        logs: logs.length,
        playerIds: playerIds.length,
        dates: dates.length,
      },
      null,
      2,
    ) + "\n",
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


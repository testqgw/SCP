import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import type { SnapshotMarket } from "../lib/types/snapshot";

type Args = {
  playerName: string;
  pageUrl: string;
  seasonStartYear: number;
  markets: SnapshotMarket[];
  out: string;
};

type ExportRow = {
  gameDateEt: string;
  market: SnapshotMarket;
  line: number;
  overLine: number;
  underLine: number;
  overPrice: number | null;
  underPrice: number | null;
  playerName: string;
  matchup: string | null;
  source: string;
  sourceUrl: string;
  actualValue: number | null;
};

const MARKET_LABEL_MAP: Record<string, SnapshotMarket> = {
  Points: "PTS",
  Rebounds: "REB",
  Assists: "AST",
  "3 Pointers": "THREES",
  "3 Pointers Made": "THREES",
  "Points & Rebounds": "PR",
  "Points & Assists": "PA",
  "Points, Rebounds, & Assists": "PRA",
  "Rebounds & Assists": "RA",
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let playerName = "";
  let pageUrl = "";
  let seasonStartYear = 2025;
  let markets: SnapshotMarket[] = ["THREES"];
  let out = "";

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];

    if (token === "--player" && next) {
      playerName = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--player=")) {
      playerName = token.slice("--player=".length);
      continue;
    }
    if (token === "--url" && next) {
      pageUrl = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--url=")) {
      pageUrl = token.slice("--url=".length);
      continue;
    }
    if (token === "--season-start-year" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) seasonStartYear = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--season-start-year=")) {
      const parsed = Number(token.slice("--season-start-year=".length));
      if (Number.isFinite(parsed)) seasonStartYear = parsed;
      continue;
    }
    if (token === "--markets" && next) {
      markets = parseMarkets(next);
      index += 1;
      continue;
    }
    if (token.startsWith("--markets=")) {
      markets = parseMarkets(token.slice("--markets=".length));
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
  }

  if (!playerName.trim()) throw new Error("Missing --player.");
  if (!pageUrl.trim()) throw new Error("Missing --url.");

  return {
    playerName: playerName.trim(),
    pageUrl: pageUrl.trim(),
    seasonStartYear,
    markets,
    out:
      out ||
      path.join(
        "exports",
        "historical-lines",
        `${slugify(playerName)}-${markets.join("-").toLowerCase()}-player-page.csv`,
      ),
  };
}

function parseMarkets(value: string): SnapshotMarket[] {
  const tokens = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean) as SnapshotMarket[];
  return Array.from(new Set(tokens));
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function inferDateEt(dateLabel: string, seasonStartYear: number): string | null {
  const match = dateLabel.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  const year = month >= 10 ? seasonStartYear : seasonStartYear + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseNumber(value: string): number | null {
  const normalized = value.replace(/[^\d.+-]/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function csvCell(value: string | number | null): string {
  if (value == null) return "";
  const text = String(value).replace(/\r?\n/g, " ").trim();
  return text.includes(",") ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const html = await fetch(args.pageUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch page (${response.status})`);
    }
    return response.text();
  });

  const $ = load(html);
  const moduleBody = $("div.module")
    .filter((_, element) => normalizeSpaces($(element).find("h3").first().text()) === "Historical Props")
    .find("div.module-body")
    .first();

  if (moduleBody.length === 0) {
    throw new Error("Historical Props module not found.");
  }

  const rows: ExportRow[] = [];
  let currentHeaderText: string | null = null;

  moduleBody.children().each((_, element) => {
    const node = $(element);
    if (node.is("header.module-header.meta")) {
      currentHeaderText = normalizeSpaces(node.text());
      return;
    }

    if (!node.is("table.sticky") || !currentHeaderText) {
      return;
    }

    const gameDateEt = inferDateEt(currentHeaderText, args.seasonStartYear);
    const matchup = currentHeaderText;
    if (!gameDateEt) return;

    node.find("tbody tr").each((__, rowElement) => {
      const cells = $(rowElement)
        .find("td")
        .toArray()
        .map((cell) => normalizeSpaces($(cell).text()));

      if (cells.length < 5) return;
      const market = MARKET_LABEL_MAP[cells[0]];
      if (!market || !args.markets.includes(market)) return;

      const line = parseNumber(cells[1]);
      if (line == null) return;

      rows.push({
        gameDateEt,
        market,
        line,
        overLine: line,
        underLine: line,
        overPrice: parseNumber(cells[2]),
        underPrice: parseNumber(cells[3]),
        playerName: args.playerName,
        matchup,
        source: "scoresandodds-player-page",
        sourceUrl: args.pageUrl,
        actualValue: parseNumber(cells[4]),
      });
    });
  });

  rows.sort((left, right) => {
    if (left.gameDateEt !== right.gameDateEt) return left.gameDateEt.localeCompare(right.gameDateEt);
    return left.market.localeCompare(right.market);
  });

  const outputPath = path.isAbsolute(args.out) ? args.out : path.join(process.cwd(), args.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const csv = [
    [
      "gameDateEt",
      "market",
      "line",
      "overLine",
      "underLine",
      "overPrice",
      "underPrice",
      "playerName",
      "matchup",
      "source",
      "sourceUrl",
      "actualValue",
    ].join(","),
    ...rows.map((row) =>
      [
        csvCell(row.gameDateEt),
        csvCell(row.market),
        csvCell(row.line),
        csvCell(row.overLine),
        csvCell(row.underLine),
        csvCell(row.overPrice),
        csvCell(row.underPrice),
        csvCell(row.playerName),
        csvCell(row.matchup),
        csvCell(row.source),
        csvCell(row.sourceUrl),
        csvCell(row.actualValue),
      ].join(","),
    ),
  ].join("\n");

  await writeFile(outputPath, `${csv}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        player: args.playerName,
        pageUrl: args.pageUrl,
        seasonStartYear: args.seasonStartYear,
        markets: args.markets,
        rowsExported: rows.length,
        earliestDate: rows[0]?.gameDateEt ?? null,
        latestDate: rows.at(-1)?.gameDateEt ?? null,
        out: outputPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error("Player page historical export failed:", error);
  process.exitCode = 1;
});

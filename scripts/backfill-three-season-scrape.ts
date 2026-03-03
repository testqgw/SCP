import { load, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import { prisma } from "../lib/prisma";
import { getTodayEtDateString, inferSeasonFromEtDate } from "../lib/snapshot/time";
import { logger } from "../lib/snapshot/log";

type Args = {
  seasonsBack: number;
  concurrency: number;
  maxPlayers: number | null;
  dryRun: boolean;
  yearsOverride: number[] | null;
  todayOnly: boolean;
};

type PlayerRow = {
  id: string;
  fullName: string;
  teamAbbr: string | null;
};

type SlugProfile = {
  slugPath: string;
  names: Set<string>;
  teamCodes: Set<string>;
  seasons: Set<number>;
};

type MappedPlayer = {
  playerId: string;
  playerName: string;
  teamAbbr: string | null;
  slugPath: string;
};

type ScrapedGameLog = {
  playerId: string;
  gameDateEt: string;
  externalGameId: string;
  teamCode: string;
  opponentCode: string;
  isHome: boolean;
  starter: boolean;
  played: boolean;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  steals: number;
  blocks: number;
  turnovers: number;
};

const BR_BASE_URL = "https://www.basketball-reference.com";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const BR_TO_NBA: Record<string, string> = {
  BRK: "BKN",
  CHO: "CHA",
  PHO: "PHX",
  NOH: "NOP",
  NOK: "NOP",
  NJN: "BKN",
  SEA: "OKC",
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let seasonsBack = 2;
  let concurrency = 6;
  let maxPlayers: number | null = null;
  let dryRun = false;
  let yearsOverride: number[] | null = null;
  let todayOnly = false;

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    const next = raw[i + 1];

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--today-only") {
      todayOnly = true;
      continue;
    }
    if (token === "--seasons-back" && next) {
      seasonsBack = Number(next);
      i += 1;
      continue;
    }
    if (token.startsWith("--seasons-back=")) {
      seasonsBack = Number(token.slice("--seasons-back=".length));
      continue;
    }
    if (token === "--concurrency" && next) {
      concurrency = Number(next);
      i += 1;
      continue;
    }
    if (token.startsWith("--concurrency=")) {
      concurrency = Number(token.slice("--concurrency=".length));
      continue;
    }
    if (token === "--max-players" && next) {
      maxPlayers = Number(next);
      i += 1;
      continue;
    }
    if (token.startsWith("--max-players=")) {
      maxPlayers = Number(token.slice("--max-players=".length));
      continue;
    }
    if (token === "--years" && next) {
      yearsOverride = next
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isInteger(value) && value > 1900);
      i += 1;
      continue;
    }
    if (token.startsWith("--years=")) {
      yearsOverride = token
        .slice("--years=".length)
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isInteger(value) && value > 1900);
      continue;
    }
  }

  seasonsBack = Number.isFinite(seasonsBack) ? Math.max(1, Math.min(6, Math.floor(seasonsBack))) : 2;
  concurrency = Number.isFinite(concurrency) ? Math.max(1, Math.min(12, Math.floor(concurrency))) : 6;
  if (maxPlayers != null && (!Number.isFinite(maxPlayers) || maxPlayers <= 0)) {
    maxPlayers = null;
  } else if (maxPlayers != null) {
    maxPlayers = Math.floor(maxPlayers);
  }

  return { seasonsBack, concurrency, maxPlayers, dryRun, yearsOverride, todayOnly };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !SUFFIX.has(token))
    .join(" ");
}

function canonicalTeamCode(code: string): string {
  const upper = code.trim().toUpperCase();
  return BR_TO_NBA[upper] ?? upper;
}

function toNumber(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMinutes(value: string): number {
  const raw = value.trim();
  if (!raw) return 0;
  if (/^\d+:\d+$/.test(raw)) {
    const [min, sec] = raw.split(":").map((part) => Number(part));
    if (Number.isFinite(min) && Number.isFinite(sec)) {
      return Math.round((min + sec / 60) * 100) / 100;
    }
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) return parsed;
  return 0;
}

function parseEtDate(raw: string): string | null {
  const text = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const yyyy = parsed.getUTCFullYear();
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchHtml(url: string): Promise<string> {
  const delays = [0, 800, 2400, 6000, 12000];
  let lastError: Error | null = null;

  for (const delayMs of delays) {
    if (delayMs > 0) await sleep(delayMs);
    await sleep(120 + Math.floor(Math.random() * 120));

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        if (RETRYABLE.has(response.status)) {
          lastError = new Error(`HTTP ${response.status} for ${url}`);
          continue;
        }
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown scrape failure");
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

function expandCommentTables(html: string): string {
  return html.replace(/<!--([\s\S]*?)-->/g, (_match, inner: string) => {
    return inner.includes("<table") ? inner : "";
  });
}

function seasonYearsToScrape(args: Args): number[] {
  if (args.yearsOverride && args.yearsOverride.length > 0) {
    return Array.from(new Set(args.yearsOverride)).sort((a, b) => b - a);
  }
  const currentSeasonStartYear = Number(inferSeasonFromEtDate(getTodayEtDateString()));
  const currentEndYear = currentSeasonStartYear + 1;
  return Array.from({ length: args.seasonsBack }, (_, i) => currentEndYear - 1 - i);
}

async function getActivePlayers(maxPlayers: number | null, todayOnly: boolean): Promise<PlayerRow[]> {
  let teamFilter: { in: string[] } | undefined;
  if (todayOnly) {
    const todayEt = getTodayEtDateString();
    const games = await prisma.game.findMany({
      where: { gameDateEt: todayEt },
      select: { homeTeamId: true, awayTeamId: true },
    });
    const teamIds = Array.from(new Set(games.flatMap((game) => [game.homeTeamId, game.awayTeamId])));
    if (teamIds.length === 0) {
      return [];
    }
    teamFilter = { in: teamIds };
  }

  const players = await prisma.player.findMany({
    where: { teamId: teamFilter ?? { not: null }, isActive: true },
    include: {
      team: { select: { abbreviation: true } },
    },
    orderBy: { fullName: "asc" },
  });

  const rows = players.map((player) => ({
    id: player.id,
    fullName: player.fullName,
    teamAbbr: player.team?.abbreviation ?? null,
  }));

  if (maxPlayers == null) return rows;
  return rows.slice(0, maxPlayers);
}

async function loadSeasonSlugDirectory(seasonYears: number[]): Promise<Map<string, SlugProfile[]>> {
  const byNormalizedName = new Map<string, SlugProfile[]>();
  const bySlug = new Map<string, SlugProfile>();

  for (const year of seasonYears) {
    const url = `${BR_BASE_URL}/leagues/NBA_${year}_per_game.html`;
    const html = expandCommentTables(await fetchHtml(url));
    const $ = load(html);

    $("#per_game_stats tbody tr").each((_, row) => {
      const tr = $(row);
      if (tr.hasClass("thead")) return;

      const playerAnchor = tr.find("td[data-stat='name_display'] a").first();
      const playerName = playerAnchor.text().trim();
      const href = playerAnchor.attr("href")?.trim() ?? "";
      if (!playerName || !href || !href.startsWith("/players/")) return;

      const slugPath = href.replace(/\.html$/i, "");
      const teamRaw = tr.find("td[data-stat='team_name_abbr']").text().trim().toUpperCase();
      const teamCode = teamRaw === "TOT" ? null : canonicalTeamCode(teamRaw);

      const existing = bySlug.get(slugPath) ?? {
        slugPath,
        names: new Set<string>(),
        teamCodes: new Set<string>(),
        seasons: new Set<number>(),
      };
      existing.names.add(playerName);
      if (teamCode) existing.teamCodes.add(teamCode);
      existing.seasons.add(year);
      bySlug.set(slugPath, existing);
    });
  }

  bySlug.forEach((profile) => {
    profile.names.forEach((name) => {
      const key = normalizeName(name);
      const existing = byNormalizedName.get(key) ?? [];
      if (!existing.some((item) => item.slugPath === profile.slugPath)) {
        existing.push(profile);
      }
      byNormalizedName.set(key, existing);
    });
  });

  return byNormalizedName;
}

function chooseSlug(player: PlayerRow, candidates: SlugProfile[]): SlugProfile | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  if (player.teamAbbr) {
    const teamMatched = candidates.filter((candidate) => candidate.teamCodes.has(player.teamAbbr as string));
    if (teamMatched.length === 1) {
      return teamMatched[0];
    }
    if (teamMatched.length > 1) {
      candidates = teamMatched;
    }
  }

  const bestSeasonCoverage = Math.max(...candidates.map((candidate) => candidate.seasons.size));
  const bestCoverage = candidates.filter((candidate) => candidate.seasons.size === bestSeasonCoverage);
  if (bestCoverage.length === 1) {
    return bestCoverage[0];
  }

  return null;
}

function mapPlayersToSlugs(players: PlayerRow[], directory: Map<string, SlugProfile[]>): {
  mapped: MappedPlayer[];
  unmatched: PlayerRow[];
  ambiguous: PlayerRow[];
} {
  const mapped: MappedPlayer[] = [];
  const unmatched: PlayerRow[] = [];
  const ambiguous: PlayerRow[] = [];

  players.forEach((player) => {
    const key = normalizeName(player.fullName);
    const candidates = directory.get(key) ?? [];
    if (candidates.length === 0) {
      unmatched.push(player);
      return;
    }

    const chosen = chooseSlug(player, candidates);
    if (!chosen) {
      ambiguous.push(player);
      return;
    }

    mapped.push({
      playerId: player.id,
      playerName: player.fullName,
      teamAbbr: player.teamAbbr,
      slugPath: chosen.slugPath,
    });
  });

  return { mapped, unmatched, ambiguous };
}

function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

async function withConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(runners);
  return results;
}

async function scrapePlayerSeasonLogs(mappedPlayer: MappedPlayer, seasonYear: number): Promise<ScrapedGameLog[]> {
  const url = `${BR_BASE_URL}${mappedPlayer.slugPath}/gamelog/${seasonYear}`;
  const html = expandCommentTables(await fetchHtml(url));
  const $ = load(html);
  const rows: ScrapedGameLog[] = [];

  let sourceTable: Cheerio<AnyNode> | null = null;
  let maxRows = 0;
  $("table").each((_, table) => {
    const candidate = $(table);
    if (candidate.find("td[data-stat='date']").length === 0) return;
    const rowCount = candidate.find("tbody tr").length;
    if (rowCount > maxRows) {
      maxRows = rowCount;
      sourceTable = candidate;
    }
  });

  if (!sourceTable) {
    return rows;
  }

  const selectedTable = sourceTable as Cheerio<AnyNode>;
  selectedTable.find("tbody tr").each((index, row) => {
    const tr = $(row);
    if (tr.hasClass("thead")) return;

    const reason = tr.find("td[data-stat='reason']").text().trim();
    if (reason) return;

    const dateRaw = tr.find("td[data-stat='date']").text().trim();
    const dateEt = parseEtDate(dateRaw);
    if (!dateEt) return;

    const teamRaw = tr.find("td[data-stat='team_name_abbr']").text().trim().toUpperCase();
    const oppRaw = tr.find("td[data-stat='opp_name_abbr']").text().trim().toUpperCase();
    if (!teamRaw || !oppRaw || teamRaw === "TOT") return;
    const teamCode = canonicalTeamCode(teamRaw);
    const opponentCode = canonicalTeamCode(oppRaw);

    const minutesRaw = tr.find("td[data-stat='mp']").text().trim();
    const minutes = parseMinutes(minutesRaw);
    if (minutes <= 0) return;

    const gameNumber = tr.find("td[data-stat='team_game_num_season']").text().trim();
    if (!gameNumber || !/^\d+$/.test(gameNumber)) return;
    if (Number(gameNumber) > 82) return;

    const startRaw = tr.find("td[data-stat='is_starter']").text().trim();
    const ranker = tr.find("th[data-stat='ranker']").text().trim();
    const location = tr.find("td[data-stat='game_location']").text().trim();

    rows.push({
      playerId: mappedPlayer.playerId,
      gameDateEt: dateEt,
      externalGameId: `br:${dateEt}:${teamCode}:${opponentCode}:${gameNumber || ranker || String(index + 1)}`,
      teamCode,
      opponentCode,
      isHome: location !== "@",
      starter: startRaw === "*" || startRaw === "1" || startRaw.toUpperCase() === "Y",
      played: true,
      minutes,
      points: toNumber(tr.find("td[data-stat='pts']").text()),
      rebounds: toNumber(tr.find("td[data-stat='trb']").text()),
      assists: toNumber(tr.find("td[data-stat='ast']").text()),
      threes: toNumber(tr.find("td[data-stat='fg3']").text()),
      steals: toNumber(tr.find("td[data-stat='stl']").text()),
      blocks: toNumber(tr.find("td[data-stat='blk']").text()),
      turnovers: toNumber(tr.find("td[data-stat='tov']").text()),
    });
  });

  return rows;
}

async function ensureTeams(teamCodes: Set<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const teams = Array.from(teamCodes).sort();

  for (const abbreviation of teams) {
    const row = await prisma.team.upsert({
      where: { abbreviation },
      update: { name: abbreviation },
      create: { abbreviation, name: abbreviation },
      select: { id: true, abbreviation: true },
    });
    map.set(row.abbreviation, row.id);
  }

  return map;
}

async function writeLogs(logs: ScrapedGameLog[], teamMap: Map<string, string>): Promise<number> {
  if (logs.length === 0) return 0;

  const payload = logs
    .map((log) => {
      const teamId = teamMap.get(log.teamCode) ?? null;
      const opponentTeamId = teamMap.get(log.opponentCode) ?? null;
      return {
        playerId: log.playerId,
        externalGameId: log.externalGameId,
        gameDateEt: log.gameDateEt,
        teamId,
        opponentTeamId,
        isHome: log.isHome,
        starter: log.starter,
        played: log.played,
        minutes: log.minutes,
        points: log.points,
        rebounds: log.rebounds,
        assists: log.assists,
        threes: log.threes,
        steals: log.steals,
        blocks: log.blocks,
        turnovers: log.turnovers,
        pace: null,
        total: null,
      };
    })
    .sort((a, b) => {
      if (a.playerId !== b.playerId) return a.playerId.localeCompare(b.playerId);
      if (a.gameDateEt !== b.gameDateEt) return a.gameDateEt.localeCompare(b.gameDateEt);
      return a.externalGameId.localeCompare(b.externalGameId);
    });

  let inserted = 0;
  const batches = chunk(payload, 1000);
  for (const batch of batches) {
    const result = await prisma.playerGameLog.createMany({
      data: batch,
      skipDuplicates: true,
    });
    inserted += result.count;
  }
  return inserted;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const targetSeasonYears = seasonYearsToScrape(args);
  const players = await getActivePlayers(args.maxPlayers, args.todayOnly);
  const directory = await loadSeasonSlugDirectory(targetSeasonYears);
  const { mapped, unmatched, ambiguous } = mapPlayersToSlugs(players, directory);

  // eslint-disable-next-line no-console
  console.log(
    `Scrape setup | seasons=${targetSeasonYears.join(",")} | players=${players.length} | mapped=${mapped.length} | unmatched=${unmatched.length} | ambiguous=${ambiguous.length}`,
  );
  if (unmatched.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`Unmatched sample: ${unmatched.slice(0, 10).map((item) => item.fullName).join(", ")}`);
  }
  if (ambiguous.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`Ambiguous sample: ${ambiguous.slice(0, 10).map((item) => item.fullName).join(", ")}`);
  }

  const jobs = mapped.flatMap((player) => targetSeasonYears.map((seasonYear) => ({ player, seasonYear })));
  const failures: string[] = [];

  const scrapedSets = await withConcurrency(jobs, args.concurrency, async (job, index) => {
    try {
      const rows = await scrapePlayerSeasonLogs(job.player, job.seasonYear);
      if ((index + 1) % 120 === 0 || index === jobs.length - 1) {
        // eslint-disable-next-line no-console
        console.log(`Progress ${index + 1}/${jobs.length} | accumulated rows pending...`);
      }
      return rows;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      failures.push(`${job.player.playerName} (${job.seasonYear}): ${reason}`);
      return [] as ScrapedGameLog[];
    }
  });

  const allLogs = scrapedSets.flat();
  const dedupe = new Map<string, ScrapedGameLog>();
  allLogs.forEach((log) => {
    dedupe.set(`${log.playerId}:${log.externalGameId}`, log);
  });
  const uniqueLogs = Array.from(dedupe.values());

  const teamCodes = new Set<string>();
  uniqueLogs.forEach((log) => {
    teamCodes.add(log.teamCode);
    teamCodes.add(log.opponentCode);
  });

  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          seasons: targetSeasonYears,
          playersInput: players.length,
          playersMapped: mapped.length,
          unmatched: unmatched.length,
          ambiguous: ambiguous.length,
          jobs: jobs.length,
          scrapedRows: allLogs.length,
          uniqueRows: uniqueLogs.length,
          teamCodes: Array.from(teamCodes).sort(),
          failures: failures.slice(0, 20),
        },
        null,
        2,
      ),
    );
    return;
  }

  const teamMap = await ensureTeams(teamCodes);
  const inserted = await writeLogs(uniqueLogs, teamMap);

  await prisma.systemSetting.upsert({
    where: { key: "snapshot_scrape_backfill_last3" },
    update: {
      value: {
        source: "basketball_reference_scrape",
        seasonYears: targetSeasonYears,
        completedAt: new Date().toISOString(),
        playersInput: players.length,
        playersMapped: mapped.length,
        unmatchedPlayers: unmatched.length,
        ambiguousPlayers: ambiguous.length,
        jobs: jobs.length,
        logsParsed: allLogs.length,
        logsUnique: uniqueLogs.length,
        logsInserted: inserted,
        failureCount: failures.length,
      },
    },
    create: {
      key: "snapshot_scrape_backfill_last3",
      value: {
        source: "basketball_reference_scrape",
        seasonYears: targetSeasonYears,
        completedAt: new Date().toISOString(),
        playersInput: players.length,
        playersMapped: mapped.length,
        unmatchedPlayers: unmatched.length,
        ambiguousPlayers: ambiguous.length,
        jobs: jobs.length,
        logsParsed: allLogs.length,
        logsUnique: uniqueLogs.length,
        logsInserted: inserted,
        failureCount: failures.length,
      },
    },
  });

  logger.info("Three-season scrape backfill complete", {
    seasonYears: targetSeasonYears,
    playersInput: players.length,
    playersMapped: mapped.length,
    logsParsed: allLogs.length,
    logsUnique: uniqueLogs.length,
    logsInserted: inserted,
    failureCount: failures.length,
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        source: "basketball_reference_scrape",
        seasonYears: targetSeasonYears,
        playersInput: players.length,
        playersMapped: mapped.length,
        unmatchedPlayers: unmatched.length,
        ambiguousPlayers: ambiguous.length,
        jobs: jobs.length,
        logsParsed: allLogs.length,
        logsUnique: uniqueLogs.length,
        logsInserted: inserted,
        failureCount: failures.length,
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`Failures (first 25):\n- ${failures.slice(0, 25).join("\n- ")}`);
  }
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Three-season scrape backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

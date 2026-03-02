import { load } from "cheerio";

export type LineupStatus = "CONFIRMED" | "EXPECTED" | "UNKNOWN";

export type RotowireTeamLineup = {
  teamCode: string;
  status: LineupStatus;
  starters: string[];
};

export type RotowireLineupSnapshot = {
  source: "rotowire";
  sourceUrl: string;
  fetchedAt: string;
  pageDateLabel: string | null;
  teams: RotowireTeamLineup[];
};

const SOURCE_URL = "https://www.rotowire.com/basketball/nba-lineups.php";

const TEAM_CODE_CANONICAL: Record<string, string> = {
  NY: "NYK",
  NO: "NOP",
  GS: "GSW",
  SA: "SAS",
};

const SUFFIX_TOKENS = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "v",
]);

export function canonicalTeamCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  return TEAM_CODE_CANONICAL[normalized] ?? normalized;
}

export function normalizePlayerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !SUFFIX_TOKENS.has(token))
    .join(" ");
}

function parseStatus(raw: string): LineupStatus {
  const text = raw.toLowerCase();
  if (text.includes("confirmed")) return "CONFIRMED";
  if (text.includes("expected")) return "EXPECTED";
  return "UNKNOWN";
}

function statusRank(status: LineupStatus): number {
  if (status === "CONFIRMED") return 3;
  if (status === "EXPECTED") return 2;
  return 1;
}

function bestOf(a: RotowireTeamLineup, b: RotowireTeamLineup): RotowireTeamLineup {
  const rankDiff = statusRank(b.status) - statusRank(a.status);
  if (rankDiff !== 0) return rankDiff > 0 ? b : a;
  if (b.starters.length !== a.starters.length) return b.starters.length > a.starters.length ? b : a;
  return a;
}

function parseListTeam(
  $: ReturnType<typeof load>,
  root: ReturnType<ReturnType<typeof load>>,
  teamCode: string,
): RotowireTeamLineup | null {
  if (!teamCode) return null;
  const statusText = root.find("li.lineup__status").first().text().trim();
  const status = parseStatus(statusText);

  const starters = root
    .find("li.lineup__player a[title]")
    .slice(0, 5)
    .toArray()
    .map((node) => {
      const title = $(node).attr("title")?.trim();
      const text = $(node).text().trim();
      return title || text;
    })
    .filter((name): name is string => Boolean(name));

  if (starters.length === 0) {
    return null;
  }

  return {
    teamCode: canonicalTeamCode(teamCode),
    status,
    starters,
  };
}

export async function fetchRotowireLineups(): Promise<RotowireLineupSnapshot> {
  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Rotowire request failed (${response.status})`);
  }

  const html = await response.text();
  const $ = load(html);
  const map = new Map<string, RotowireTeamLineup>();
  const pageDateLabel = $(".page-title__secondary").first().text().trim() || null;

  $(".lineups .lineup.is-nba").each((_, card) => {
    const awayCode = $(card).find(".lineup__team.is-visit .lineup__abbr").first().text().trim().toUpperCase();
    const homeCode = $(card).find(".lineup__team.is-home .lineup__abbr").first().text().trim().toUpperCase();

    const awayList = $(card).find("ul.lineup__list.is-visit").first();
    const homeList = $(card).find("ul.lineup__list.is-home").first();

    const away = parseListTeam($, awayList, awayCode);
    const home = parseListTeam($, homeList, homeCode);

    if (away) {
      const existing = map.get(away.teamCode);
      map.set(away.teamCode, existing ? bestOf(existing, away) : away);
    }
    if (home) {
      const existing = map.get(home.teamCode);
      map.set(home.teamCode, existing ? bestOf(existing, home) : home);
    }
  });

  const teams = Array.from(map.values()).sort((a, b) => a.teamCode.localeCompare(b.teamCode));
  if (teams.length === 0) {
    throw new Error("No lineup teams parsed from Rotowire response");
  }

  return {
    source: "rotowire",
    sourceUrl: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    pageDateLabel,
    teams,
  };
}

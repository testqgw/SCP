import { load } from "cheerio";

export type LineupStatus = "CONFIRMED" | "EXPECTED" | "UNKNOWN";
export type RotowireAvailabilityStatus =
  | "OUT"
  | "DOUBTFUL"
  | "QUESTIONABLE"
  | "PROBABLE"
  | "ACTIVE"
  | "UNKNOWN";

export type RotowireAvailabilityPlayer = {
  playerName: string;
  status: RotowireAvailabilityStatus;
  percentPlay: number | null;
  title: string | null;
};

export type RotowireTeamLineup = {
  teamCode: string;
  status: LineupStatus;
  starters: string[];
  availabilityPlayers: RotowireAvailabilityPlayer[];
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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !SUFFIX_TOKENS.has(token))
    .join(" ");
}

export function isLineupStatus(value: string): value is LineupStatus {
  return value === "CONFIRMED" || value === "EXPECTED" || value === "UNKNOWN";
}

export function isRotowireAvailabilityStatus(value: string): value is RotowireAvailabilityStatus {
  return (
    value === "OUT" ||
    value === "DOUBTFUL" ||
    value === "QUESTIONABLE" ||
    value === "PROBABLE" ||
    value === "ACTIVE" ||
    value === "UNKNOWN"
  );
}

function parseStatus(raw: string): LineupStatus {
  const text = raw.toLowerCase();
  if (text.includes("confirmed")) return "CONFIRMED";
  if (text.includes("expected")) return "EXPECTED";
  return "UNKNOWN";
}

export function parseRotowireAvailabilityStatus(raw: string | null): RotowireAvailabilityStatus {
  const normalized = (raw ?? "").trim().toUpperCase();
  if (!normalized) return "UNKNOWN";
  if (["OUT", "OFS", "INJ", "SUSP", "NWT"].includes(normalized)) return "OUT";
  if (["DOUBTFUL", "D", "DTD"].includes(normalized)) return "DOUBTFUL";
  if (["QUESTIONABLE", "QUES", "Q", "GTD"].includes(normalized)) return "QUESTIONABLE";
  if (["PROBABLE", "PROB", "P"].includes(normalized)) return "PROBABLE";
  if (["ACTIVE", "OK"].includes(normalized)) return "ACTIVE";
  return "UNKNOWN";
}

export function parseRotowirePercentPlay(className: string): number | null {
  const match = className.match(/is-pct-play-(\d{1,3})/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(parsed, 100));
}

function normalizePercentPlay(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(value, 100));
}

export function formatRotowireAvailabilityLabel(
  status: RotowireAvailabilityStatus | null,
  percentPlay: number | null,
): string | null {
  if (status == null || status === "ACTIVE") return percentPlay != null ? `${percentPlay}% to play` : null;
  if (percentPlay != null && status !== "OUT") {
    return `${status} (${percentPlay}% to play)`;
  }
  return status;
}

export type RotowireAvailabilityImpact = {
  severity: number;
  minutesMultiplier: number;
  projectionMultiplier: number;
  lineupConfidencePenalty: number;
  minutesRiskBoost: number;
  hardBlock: boolean;
  likelyOut: boolean;
};

export function deriveRotowireAvailabilityImpact(
  status: RotowireAvailabilityStatus | null,
  percentPlay: number | null,
): RotowireAvailabilityImpact {
  const fallbackSeverity =
    percentPlay == null ? 0 : Math.max(0, Math.min(1, Math.round(((100 - percentPlay) / 100) * 100) / 100));

  if (status === "OUT") {
    return {
      severity: 1,
      minutesMultiplier: 0.04,
      projectionMultiplier: 0.08,
      lineupConfidencePenalty: 0.42,
      minutesRiskBoost: 0.48,
      hardBlock: true,
      likelyOut: true,
    };
  }
  if (status === "DOUBTFUL") {
    return {
      severity: 0.82,
      minutesMultiplier: 0.38,
      projectionMultiplier: 0.48,
      lineupConfidencePenalty: 0.24,
      minutesRiskBoost: 0.3,
      hardBlock: true,
      likelyOut: true,
    };
  }
  if (status === "QUESTIONABLE") {
    const severity = percentPlay == null ? 0.58 : Math.max(0.4, fallbackSeverity);
    return {
      severity,
      minutesMultiplier: Math.max(0.56, 1 - severity * 0.46),
      projectionMultiplier: Math.max(0.7, 1 - severity * 0.28),
      lineupConfidencePenalty: Math.min(0.18, severity * 0.28),
      minutesRiskBoost: Math.min(0.22, severity * 0.28),
      hardBlock: false,
      likelyOut: percentPlay != null ? percentPlay <= 35 : false,
    };
  }
  if (status === "PROBABLE") {
    const severity = percentPlay == null ? 0.16 : Math.min(0.24, fallbackSeverity);
    return {
      severity,
      minutesMultiplier: Math.max(0.88, 1 - severity * 0.35),
      projectionMultiplier: Math.max(0.92, 1 - severity * 0.18),
      lineupConfidencePenalty: Math.min(0.06, severity * 0.14),
      minutesRiskBoost: Math.min(0.08, severity * 0.18),
      hardBlock: false,
      likelyOut: false,
    };
  }
  if (status === "ACTIVE") {
    return {
      severity: percentPlay != null && percentPlay < 100 ? Math.min(0.08, fallbackSeverity) : 0,
      minutesMultiplier: 1,
      projectionMultiplier: 1,
      lineupConfidencePenalty: 0,
      minutesRiskBoost: 0,
      hardBlock: false,
      likelyOut: false,
    };
  }

  const severity = percentPlay == null ? 0 : fallbackSeverity;
  return {
    severity,
    minutesMultiplier: Math.max(0.72, 1 - severity * 0.42),
    projectionMultiplier: Math.max(0.82, 1 - severity * 0.24),
    lineupConfidencePenalty: Math.min(0.12, severity * 0.2),
    minutesRiskBoost: Math.min(0.14, severity * 0.22),
    hardBlock: false,
    likelyOut: percentPlay != null ? percentPlay <= 25 : false,
  };
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
  if (b.availabilityPlayers.length !== a.availabilityPlayers.length) {
    return b.availabilityPlayers.length > a.availabilityPlayers.length ? b : a;
  }
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

  const availabilityPlayers = root
    .find("li.lineup__player.has-injury-status")
    .toArray()
    .map((node) => {
      const row = $(node);
      const playerName = row.find("a[title]").attr("title")?.trim() || row.find("a").first().text().trim();
      if (!playerName) return null;
      const injuryText = row.find(".lineup__inj").first().text().trim() || null;
      return {
        playerName,
        status: parseRotowireAvailabilityStatus(injuryText),
        percentPlay: parseRotowirePercentPlay(row.attr("class") ?? ""),
        title: row.attr("title")?.trim() || null,
      } satisfies RotowireAvailabilityPlayer;
    })
    .filter((player): player is RotowireAvailabilityPlayer => Boolean(player));

  if (starters.length === 0 && availabilityPlayers.length === 0) {
    return null;
  }

  return {
    teamCode: canonicalTeamCode(teamCode),
    status,
    starters,
    availabilityPlayers,
  };
}

export function parseStoredRotowireLineupSnapshot(value: unknown, dateEt: string): RotowireLineupSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.dateEt === "string" && record.dateEt !== dateEt) return null;
  if (!Array.isArray(record.teams)) return null;

  const teams: RotowireTeamLineup[] = [];
  record.teams.forEach((team) => {
    if (!team || typeof team !== "object" || Array.isArray(team)) return;
    const row = team as Record<string, unknown>;
    const teamCode = typeof row.teamCode === "string" ? canonicalTeamCode(row.teamCode) : null;
    if (!teamCode) return;
    const status = typeof row.status === "string" && isLineupStatus(row.status) ? row.status : "UNKNOWN";
    const starters = Array.isArray(row.starters)
      ? row.starters
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.trim())
          .filter(Boolean)
      : [];
    const availabilitySource = Array.isArray(row.availabilityPlayers)
      ? row.availabilityPlayers
      : Array.isArray(row.unavailablePlayers)
        ? row.unavailablePlayers
        : [];
    const availabilityPlayers = availabilitySource
      .map((player) => {
        if (!player || typeof player !== "object" || Array.isArray(player)) return null;
        const item = player as Record<string, unknown>;
        const playerName = typeof item.playerName === "string" ? item.playerName.trim() : "";
        if (!playerName) return null;
        const availabilityStatus =
          typeof item.status === "string" && isRotowireAvailabilityStatus(item.status) ? item.status : "UNKNOWN";
        return {
          playerName,
          status: availabilityStatus,
          percentPlay: normalizePercentPlay(item.percentPlay),
          title: typeof item.title === "string" ? item.title.trim() || null : null,
        } satisfies RotowireAvailabilityPlayer;
      })
      .filter((player): player is RotowireAvailabilityPlayer => Boolean(player));

    if (starters.length === 0 && availabilityPlayers.length === 0) return;

    teams.push({
      teamCode,
      status,
      starters,
      availabilityPlayers,
    });
  });

  if (teams.length === 0) return null;

  return {
    source: "rotowire",
    sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : "",
    fetchedAt: typeof record.fetchedAt === "string" ? record.fetchedAt : "",
    pageDateLabel: typeof record.pageDateLabel === "string" ? record.pageDateLabel : null,
    teams,
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

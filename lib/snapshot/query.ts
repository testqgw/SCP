import { prisma } from "@/lib/prisma";
import {
  canonicalTeamCode,
  normalizePlayerName,
  type LineupStatus,
  type RotowireLineupSnapshot,
  type RotowireTeamLineup,
} from "@/lib/lineups/rotowire";
import { SNAPSHOT_MARKETS, projectTonightMetrics } from "@/lib/snapshot/projection";
import { formatUtcToEt, getTodayEtDateString } from "@/lib/snapshot/time";
import type {
  SnapshotBoardData,
  SnapshotDataCompleteness,
  SnapshotGameIntel,
  SnapshotIntelItem,
  SnapshotIntelModule,
  SnapshotMarket,
  SnapshotMatchupOption,
  SnapshotMetricRecord,
  SnapshotPrimaryDefender,
  SnapshotRow,
  SnapshotStatLog,
  SnapshotTeammateCore,
  SnapshotTeamMatchupStats,
  SnapshotTeamRecord,
} from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

type TeamMatchup = {
  teamCode: string;
  opponentCode: string;
  opponentTeamId: string;
  matchupKey: string;
  gameTimeEt: string;
  gameTimeUtc: Date | null;
  isHome: boolean;
};

type MatchupMeta = {
  matchupKey: string;
  awayTeamId: string;
  homeTeamId: string;
  awayTeamCode: string;
  homeTeamCode: string;
  gameTimeEt: string;
};

type TeamAllowanceAgg = {
  count: number;
  sums: Record<SnapshotMarket, number>;
};

type TeamGameAggregate = {
  teamId: string;
  opponentTeamId: string | null;
  externalGameId: string;
  gameDateEt: string;
  metrics: SnapshotMetricRecord;
};

type TeamGameEnriched = TeamGameAggregate & {
  allowedMetrics: SnapshotMetricRecord | null;
  win: boolean | null;
};

type TeamSummary = {
  seasonFor: SnapshotMetricRecord;
  seasonAllowed: SnapshotMetricRecord;
  last10For: SnapshotMetricRecord;
  last10Allowed: SnapshotMetricRecord;
  seasonRecord: SnapshotTeamRecord;
  last10Record: SnapshotTeamRecord;
};

type PositionToken = "G" | "F" | "C";

type PlayerStatusLog = {
  gameDateEt: string;
  externalGameId: string;
  isHome: boolean | null;
  starter: boolean | null;
  played: boolean | null;
  teamId: string | null;
  opponentTeamId: string | null;
};

type PlayerProfile = {
  playerId: string;
  playerName: string;
  position: string | null;
  teamId: string | null;
  last10Average: SnapshotMetricRecord;
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesTrend: number | null;
  minutesVolatility: number | null;
  stocksPer36Last10: number | null;
  startsLast10: number;
  starterRateLast10: number | null;
  startedLastGame: boolean | null;
  archetype: string;
  positionTokens: Set<PositionToken>;
};

type LineupTeamSignal = {
  status: LineupStatus;
  starterNames: Set<string>;
};

type LineupPlayerSignal = {
  lineupStarter: boolean | null;
  status: LineupStatus;
};

const MARKETS: SnapshotMarket[] = SNAPSHOT_MARKETS;

function blankMetricRecord(): SnapshotMetricRecord {
  return {
    PTS: null,
    REB: null,
    AST: null,
    THREES: null,
    PRA: null,
    PA: null,
    PR: null,
    RA: null,
  };
}

function isLineupStatus(value: string): value is LineupStatus {
  return value === "CONFIRMED" || value === "EXPECTED" || value === "UNKNOWN";
}

function parseLineupSnapshot(value: unknown, dateEt: string): RotowireLineupSnapshot | null {
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
    if (starters.length === 0) return;
    teams.push({ teamCode, status, starters });
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

function buildLineupSignalMap(snapshot: RotowireLineupSnapshot | null): Map<string, LineupTeamSignal> {
  const map = new Map<string, LineupTeamSignal>();
  if (!snapshot) return map;

  snapshot.teams.forEach((team) => {
    const code = canonicalTeamCode(team.teamCode);
    map.set(code, {
      status: team.status,
      starterNames: new Set(team.starters.map((name) => normalizePlayerName(name))),
    });
  });

  return map;
}

function readLineupSignal(
  lineupMap: Map<string, LineupTeamSignal>,
  teamCode: string,
  playerName: string,
): LineupPlayerSignal | null {
  const teamSignal = lineupMap.get(canonicalTeamCode(teamCode));
  if (!teamSignal) return null;
  const normalized = normalizePlayerName(playerName);
  return {
    lineupStarter: teamSignal.starterNames.has(normalized),
    status: teamSignal.status,
  };
}

function applyLineupStarterLabel(baseLabel: string, signal: LineupPlayerSignal | null): string {
  if (!signal) return baseLabel;
  if (signal.lineupStarter === true) {
    return signal.status === "CONFIRMED" ? "Confirmed Starter (Lineup Feed)" : "Expected Starter (Lineup Feed)";
  }
  if (signal.lineupStarter === false) {
    return signal.status === "CONFIRMED" ? "Confirmed Bench (Lineup Feed)" : "Projected Bench (Lineup Feed)";
  }
  return baseLabel;
}

type CompletenessInput = {
  last10Logs: SnapshotStatLog[];
  statusLast10: PlayerStatusLog[];
  opponentAllowance: SnapshotMetricRecord;
  primaryDefender: SnapshotPrimaryDefender | null;
  teammateCore: SnapshotTeammateCore[];
  playerProfile: PlayerProfile | null;
};

function computeDataCompleteness(input: CompletenessInput): SnapshotDataCompleteness {
  const issues: string[] = [];

  const sampleCoverageRaw = Math.min(input.last10Logs.length / 10, 1);
  const sampleCoverage = round(sampleCoverageRaw * 100, 1);
  if (input.last10Logs.length < 8) {
    issues.push(`Only ${input.last10Logs.length} completed logs (need 10 for full confidence).`);
  }

  const statusDenominator = Math.max(1, input.statusLast10.length);
  const starterKnown = input.statusLast10.filter((log) => log.starter != null).length;
  const playedKnown = input.statusLast10.filter((log) => log.played != null).length;
  const statusCoverageRaw =
    input.statusLast10.length === 0 ? 0 : (starterKnown + playedKnown) / (2 * statusDenominator);
  const statusCoverage = round(statusCoverageRaw * 100, 1);
  if (input.statusLast10.length < 8) {
    issues.push(`Starter/availability logs only found for ${input.statusLast10.length} recent games.`);
  }
  if (statusCoverageRaw < 0.7) {
    issues.push("Starter/played status has partial null coverage.");
  }

  const contextSignals = [
    input.opponentAllowance.PTS != null,
    input.opponentAllowance.REB != null,
    input.opponentAllowance.AST != null,
    input.primaryDefender != null,
    input.teammateCore.length >= 2,
  ];
  const contextCoverageRaw = contextSignals.filter(Boolean).length / contextSignals.length;
  const contextCoverage = round(contextCoverageRaw * 100, 1);
  if (input.primaryDefender == null) {
    issues.push("Primary defender projection missing.");
  }
  if (input.teammateCore.length < 2) {
    issues.push("Limited teammate context.");
  }

  const stabilitySignals = [
    input.playerProfile?.minutesLast10Avg != null,
    input.playerProfile?.minutesVolatility != null,
    input.playerProfile?.starterRateLast10 != null,
    input.playerProfile?.stocksPer36Last10 != null,
  ];
  const stabilityCoverageRaw = stabilitySignals.filter(Boolean).length / stabilitySignals.length;
  const stabilityCoverage = round(stabilityCoverageRaw * 100, 1);
  if (input.playerProfile?.minutesLast10Avg == null) {
    issues.push("No minutes baseline.");
  }
  if (input.playerProfile?.minutesVolatility == null) {
    issues.push("No minutes volatility sample.");
  }

  const scoreRaw =
    sampleCoverageRaw * 0.35 +
    statusCoverageRaw * 0.25 +
    contextCoverageRaw * 0.25 +
    stabilityCoverageRaw * 0.15;
  const score = Math.max(0, Math.min(100, Math.round(scoreRaw * 100)));
  const tier: SnapshotDataCompleteness["tier"] = score >= 80 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW";

  return {
    score,
    tier,
    issues,
    components: {
      sampleCoverage,
      statusCoverage,
      contextCoverage,
      stabilityCoverage,
    },
  };
}

function toStat(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatSigned(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const text = formatNumber(value);
  return value > 0 ? `+${text}` : text;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(0)}%`;
}

function daysBetweenEt(fromEt: string, toEt: string): number | null {
  const from = new Date(`${fromEt}T00:00:00Z`).getTime();
  const to = new Date(`${toEt}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / (24 * 60 * 60 * 1000)));
}

function addIntelItem(items: SnapshotIntelItem[], label: string, value: string, hint?: string): void {
  items.push({ label, value, hint });
}

function metricsFromBase(points: number, rebounds: number, assists: number, threes: number): SnapshotMetricRecord {
  return {
    PTS: points,
    REB: rebounds,
    AST: assists,
    THREES: threes,
    PRA: points + rebounds + assists,
    PA: points + assists,
    PR: points + rebounds,
    RA: rebounds + assists,
  };
}

function valueByMarket(log: SnapshotStatLog, market: SnapshotMarket): number {
  if (market === "PTS") return log.points;
  if (market === "REB") return log.rebounds;
  if (market === "AST") return log.assists;
  if (market === "THREES") return log.threes;
  if (market === "PRA") return log.points + log.rebounds + log.assists;
  if (market === "PA") return log.points + log.assists;
  if (market === "PR") return log.points + log.rebounds;
  return log.rebounds + log.assists;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return round(total / values.length, 2);
}

function standardDeviation(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = average(values);
  if (avg == null) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
  return round(Math.sqrt(variance), 2);
}

function parsePositionTokens(position: string | null): Set<PositionToken> {
  const tokens = new Set<PositionToken>();
  const normalized = (position ?? "").toUpperCase();
  if (normalized.includes("G")) tokens.add("G");
  if (normalized.includes("F")) tokens.add("F");
  if (normalized.includes("C")) tokens.add("C");
  return tokens;
}

function isDefenderCompatible(offense: Set<PositionToken>, defense: Set<PositionToken>): boolean {
  if (offense.size === 0 || defense.size === 0) return true;
  if (offense.has("G")) {
    return defense.has("G") || defense.has("F");
  }
  if (offense.has("C")) {
    return defense.has("C") || defense.has("F");
  }
  return defense.has("F") || defense.has("G") || defense.has("C");
}

function determineArchetype(last10Average: SnapshotMetricRecord, minutesLast10Avg: number | null): string {
  const pts = last10Average.PTS ?? 0;
  const reb = last10Average.REB ?? 0;
  const ast = last10Average.AST ?? 0;
  const threes = last10Average.THREES ?? 0;
  const mins = minutesLast10Avg ?? 0;

  if (mins < 16) return "Bench Spark";
  if (ast >= 7 && pts >= 16) return "Primary Creator";
  if (pts >= 24 && ast < 6) return "High-Usage Scorer";
  if (reb >= 10 && ast < 5) return "Interior Big";
  if (threes >= 2.5 && ast < 5 && reb < 7) return "Perimeter Spacer";
  if (ast >= 5 && reb >= 6) return "Point Forward";
  if (pts >= 15 && reb >= 5 && ast >= 4) return "Two-Way Wing";
  return "Balanced Rotation";
}

function fallbackStarterLabel(rotationRank: number | null, minutesLast10Avg: number | null): string {
  if (rotationRank == null || minutesLast10Avg == null) return "Unknown";
  if (rotationRank <= 5 && minutesLast10Avg >= 20) return "Likely Starter";
  if (rotationRank <= 7 && minutesLast10Avg >= 16) return "Fringe Starter";
  return "Bench / Reserve";
}

function starterStatusLabel(input: {
  startedLastGame: boolean | null;
  starterRateLast10: number | null;
  rotationRank: number | null;
  minutesLast10Avg: number | null;
}): string {
  const { startedLastGame, starterRateLast10, rotationRank, minutesLast10Avg } = input;
  if (startedLastGame === true && starterRateLast10 != null && starterRateLast10 >= 0.6) return "Starter";
  if (startedLastGame === true && starterRateLast10 != null && starterRateLast10 >= 0.3) return "Spot Starter";
  if (startedLastGame === false && starterRateLast10 != null && starterRateLast10 >= 0.6) return "Starter (recent bench)";
  if (starterRateLast10 != null && starterRateLast10 >= 0.5) return "Likely Starter";
  if (starterRateLast10 != null && starterRateLast10 <= 0.2) return "Bench";
  return fallbackStarterLabel(rotationRank, minutesLast10Avg);
}

function choosePrimaryDefender(
  player: PlayerProfile,
  opponentProfiles: PlayerProfile[],
): SnapshotPrimaryDefender | null {
  if (opponentProfiles.length === 0) return null;

  const compatible = opponentProfiles.filter((candidate) =>
    isDefenderCompatible(player.positionTokens, candidate.positionTokens),
  );
  const ranked = (compatible.length > 0 ? compatible : opponentProfiles)
    .filter((candidate) => (candidate.minutesLast10Avg ?? 0) > 8)
    .sort((a, b) => (b.minutesLast10Avg ?? 0) - (a.minutesLast10Avg ?? 0));

  const defender = ranked[0] ?? null;
  if (!defender) return null;

  return {
    playerId: defender.playerId,
    playerName: defender.playerName,
    position: defender.position,
    avgMinutesLast10: defender.minutesLast10Avg,
    stocksPer36Last10: defender.stocksPer36Last10,
    matchupReason:
      compatible.length > 0
        ? "Position-matched highest-minute defender"
        : "Highest-minute defender available",
  };
}

type IntelBuildInput = {
  dateEt: string;
  teamCode: string;
  opponentCode: string;
  isHome: boolean;
  playerProfile: PlayerProfile | null;
  teamProfiles: PlayerProfile[];
  opponentProfiles: PlayerProfile[];
  primaryDefender: SnapshotPrimaryDefender | null;
  teammateCore: SnapshotTeammateCore[];
  last10Logs: SnapshotStatLog[];
  last5Logs: SnapshotStatLog[];
  statusLast10: PlayerStatusLog[];
  teammateUnavailableLastGame: number;
  teammateUnknownStatusLastGame: number;
  opponentStarterShareTop5: number | null;
  seasonAverage: SnapshotMetricRecord;
  last10Average: SnapshotMetricRecord;
  last3Average: SnapshotMetricRecord;
  opponentAllowance: SnapshotMetricRecord;
  opponentAllowanceDelta: SnapshotMetricRecord;
  teamSummary: TeamSummary;
  opponentSummary: TeamSummary;
};

function buildGameIntel(input: IntelBuildInput): SnapshotGameIntel {
  const modules: SnapshotIntelModule[] = [];
  const statusLogs = input.statusLast10;
  const playedLast10 = statusLogs.length
    ? statusLogs.filter((log) => log.played !== false).length
    : input.last10Logs.length;
  const startsLast10 = statusLogs.length
    ? statusLogs.filter((log) => log.starter === true).length
    : input.last10Logs.filter((log) => log.starter === true).length;
  const restDays = statusLogs[0]
    ? daysBetweenEt(statusLogs[0].gameDateEt, input.dateEt)
    : input.last10Logs[0]
      ? daysBetweenEt(input.last10Logs[0].gameDateEt, input.dateEt)
      : null;

  const minutes = input.playerProfile?.minutesLast10Avg;
  const pts = input.last10Average.PTS ?? 0;
  const reb = input.last10Average.REB ?? 0;
  const ast = input.last10Average.AST ?? 0;
  const threes = input.last10Average.THREES ?? 0;
  const usageProxy = minutes && minutes > 0 ? round(((pts + ast * 1.4) / minutes) * 36, 2) : null;
  const assistLoadPer36 = minutes && minutes > 0 ? round((ast / minutes) * 36, 2) : null;
  const reboundLoadPer36 = minutes && minutes > 0 ? round((reb / minutes) * 36, 2) : null;
  const threeRatePer36 = minutes && minutes > 0 ? round((threes / minutes) * 36, 2) : null;

  const rotationItems: SnapshotIntelItem[] = [];
  addIntelItem(rotationItems, "Expected Minutes", formatNumber(input.playerProfile?.minutesLast10Avg));
  addIntelItem(rotationItems, "Minutes Trend", formatSigned(input.playerProfile?.minutesTrend));
  addIntelItem(rotationItems, "Minutes Volatility", formatNumber(input.playerProfile?.minutesVolatility));
  addIntelItem(rotationItems, "Starter Rate L10", formatPercent(input.playerProfile?.starterRateLast10 ?? null));
  addIntelItem(
    rotationItems,
    "Closing Role Probability",
    minutes == null ? "-" : `${Math.max(10, Math.min(95, Math.round(((minutes - 16) / 18) * 100)))}%`,
  );
  addIntelItem(rotationItems, "Foul Risk Proxy", input.playerProfile?.stocksPer36Last10 != null && input.playerProfile.stocksPer36Last10 > 3.8 ? "HIGH" : "MED");
  modules.push({
    id: "rotation-tracker",
    title: "1. Live Rotation Tracker",
    description: "Minutes, starter role, and closing-time volatility.",
    status: "DERIVED",
    items: rotationItems,
  });

  const lineupItems: SnapshotIntelItem[] = [];
  addIntelItem(
    lineupItems,
    "Top 3 Core Teammates",
    input.teammateCore.length
      ? input.teammateCore.map((mate) => `${mate.playerName} (${formatNumber(mate.avgMinutesLast10)}m)`).join(" | ")
      : "-",
  );
  const topAstMate = input.teammateCore
    .filter((mate) => mate.avgAST10 != null)
    .sort((a, b) => (b.avgAST10 ?? 0) - (a.avgAST10 ?? 0))[0];
  addIntelItem(
    lineupItems,
    "Primary Teammate Creator",
    topAstMate ? `${topAstMate.playerName} (${formatNumber(topAstMate.avgAST10)} AST)` : "-",
  );
  addIntelItem(
    lineupItems,
    "Teammate Usage Pressure",
    input.teammateCore.length > 0
      ? formatNumber(
          round(
            input.teammateCore.reduce((sum, mate) => sum + (mate.avgPRA10 ?? 0), 0) /
              input.teammateCore.length,
            2,
          ),
        )
      : "-",
  );
  addIntelItem(
    lineupItems,
    "On/Off Proxy",
    input.teammateCore.length > 0 && (input.teammateCore[0]?.avgPRA10 ?? 0) > 35 ? "Star teammate heavy" : "Balanced",
  );
  modules.push({
    id: "lineup-context",
    title: "2. On-Court Lineup Context",
    description: "Teammate-driven environment and role competition.",
    status: "DERIVED",
    items: lineupItems,
  });

  const usageItems: SnapshotIntelItem[] = [];
  addIntelItem(usageItems, "Usage Proxy /36", formatNumber(usageProxy));
  addIntelItem(usageItems, "Assist Load /36", formatNumber(assistLoadPer36));
  addIntelItem(usageItems, "Rebound Load /36", formatNumber(reboundLoadPer36));
  addIntelItem(usageItems, "3PM Rate /36", formatNumber(threeRatePer36));
  addIntelItem(
    usageItems,
    "Opportunity Signal",
    usageProxy != null && usageProxy >= 34 ? "ELITE" : usageProxy != null && usageProxy >= 26 ? "STRONG" : "NORMAL",
  );
  modules.push({
    id: "usage-opportunity",
    title: "3. Usage + Opportunity Metrics",
    description: "Possession-level opportunity based on per-minute production proxies.",
    status: "DERIVED",
    items: usageItems,
  });

  const defenderItems: SnapshotIntelItem[] = [];
  if (input.primaryDefender) {
    addIntelItem(
      defenderItems,
      "Expected Primary Defender",
      `${input.primaryDefender.playerName} (${input.primaryDefender.position ?? "N/A"})`,
    );
    addIntelItem(defenderItems, "Defender Minutes L10", formatNumber(input.primaryDefender.avgMinutesLast10));
    addIntelItem(defenderItems, "Defender Stocks/36", formatNumber(input.primaryDefender.stocksPer36Last10));
    addIntelItem(defenderItems, "Assignment Logic", input.primaryDefender.matchupReason);
  } else {
    addIntelItem(defenderItems, "Expected Primary Defender", "Not enough matchup data");
  }
  const secondaryDefenders = input.opponentProfiles
    .filter((profile) => profile.playerId !== input.primaryDefender?.playerId)
    .sort((a, b) => (b.minutesLast10Avg ?? 0) - (a.minutesLast10Avg ?? 0))
    .slice(0, 2)
    .map((profile) => profile.playerName);
  addIntelItem(defenderItems, "Secondary Defenders", secondaryDefenders.length ? secondaryDefenders.join(", ") : "-");
  modules.push({
    id: "defender-timeline",
    title: "4. Primary Defender Timeline",
    description: "Likely direct and secondary defensive assignments.",
    status: "DERIVED",
    items: defenderItems,
  });

  const shotItems: SnapshotIntelItem[] = [];
  const nonThreePoints = pts - threes * 3;
  const threePointShare = pts > 0 ? round((threes * 3) / pts, 2) : null;
  addIntelItem(shotItems, "3PT Share of Points", formatPercent(threePointShare));
  addIntelItem(shotItems, "Non-3PT Scoring", formatNumber(nonThreePoints >= 0 ? nonThreePoints : null));
  addIntelItem(
    shotItems,
    "Rim Pressure Proxy",
    nonThreePoints >= 14 ? "HIGH" : nonThreePoints >= 8 ? "MED" : "LOW",
  );
  addIntelItem(
    shotItems,
    "Shot Profile",
    threePointShare != null && threePointShare >= 0.45
      ? "Perimeter Heavy"
      : nonThreePoints >= 16
        ? "Interior/Midrange Heavy"
        : "Balanced",
  );
  modules.push({
    id: "shot-quality",
    title: "5. Shot Quality + Zone Profile",
    description: "Scoring composition and floor profile proxies.",
    status: "DERIVED",
    items: shotItems,
  });

  const playTypeItems: SnapshotIntelItem[] = [];
  addIntelItem(playTypeItems, "Creator Index", formatNumber(assistLoadPer36));
  addIntelItem(
    playTypeItems,
    "Finisher Index",
    formatNumber(minutes && minutes > 0 ? round(((pts - ast * 0.6) / minutes) * 36, 2) : null),
  );
  addIntelItem(playTypeItems, "Board Impact /36", formatNumber(reboundLoadPer36));
  addIntelItem(
    playTypeItems,
    "Primary Play Type",
    assistLoadPer36 != null && assistLoadPer36 >= 9
      ? "Lead PnR Creator"
      : reboundLoadPer36 != null && reboundLoadPer36 >= 10
        ? "Interior Finisher"
        : threeRatePer36 != null && threeRatePer36 >= 3
          ? "Spot-up / Off-screen"
          : "Hybrid",
  );
  modules.push({
    id: "play-type",
    title: "6. Play-Type Profile",
    description: "How the player most likely generates stat volume.",
    status: "DERIVED",
    items: playTypeItems,
  });

  const scriptItems: SnapshotIntelItem[] = [];
  const teamPts = input.teamSummary.last10For.PTS ?? 0;
  const oppPts = input.opponentSummary.last10For.PTS ?? 0;
  const impliedTotalProxy = round(teamPts + oppPts, 1);
  const recordDiff =
    (input.teamSummary.last10Record.wins - input.teamSummary.last10Record.losses) -
    (input.opponentSummary.last10Record.wins - input.opponentSummary.last10Record.losses);
  addIntelItem(scriptItems, "Implied Total Proxy", formatNumber(impliedTotalProxy));
  addIntelItem(scriptItems, "Team Form Edge", formatSigned(recordDiff));
  addIntelItem(
    scriptItems,
    "Blowout Risk",
    Math.abs(recordDiff) >= 6 ? "HIGH" : Math.abs(recordDiff) >= 3 ? "MED" : "LOW",
  );
  addIntelItem(
    scriptItems,
    "Close-Game Minutes Boost",
    Math.abs(recordDiff) <= 2 ? "LIKELY" : "UNLIKELY",
  );
  addIntelItem(
    scriptItems,
    "OT Risk",
    Math.abs(recordDiff) <= 1 && impliedTotalProxy >= 225 ? "ELEVATED" : "NORMAL",
  );
  modules.push({
    id: "game-script",
    title: "7. Game Script Engine",
    description: "Projected game environment and volatility.",
    status: "DERIVED",
    items: scriptItems,
  });

  const schemeItems: SnapshotIntelItem[] = [];
  addIntelItem(schemeItems, "Opp Allow PTS", formatNumber(input.opponentAllowance.PTS));
  addIntelItem(schemeItems, "Opp Allow REB", formatNumber(input.opponentAllowance.REB));
  addIntelItem(schemeItems, "Opp Allow AST", formatNumber(input.opponentAllowance.AST));
  addIntelItem(schemeItems, "Opp Delta PTS", formatSigned(input.opponentAllowanceDelta.PTS));
  addIntelItem(schemeItems, "Opp Delta PRA", formatSigned(input.opponentAllowanceDelta.PRA));
  modules.push({
    id: "team-scheme",
    title: "8. Team Scheme Dashboard",
    description: "Opponent defensive allowance baseline by market.",
    status: "LIVE",
    items: schemeItems,
  });

  const newsItems: SnapshotIntelItem[] = [];
  const latestStatus = statusLogs[0] ?? null;
  const latestStatusLabel =
    latestStatus == null
      ? "Unknown"
      : latestStatus.played === false
        ? "DNP"
        : latestStatus.starter === true
          ? "Started"
          : "Active (bench)";
  const availabilitySignal =
    playedLast10 >= 9
      ? "Stable Available"
      : playedLast10 >= 7
        ? "Mostly Available"
        : "Volatile Availability";
  addIntelItem(newsItems, "Played Last 10", `${playedLast10}/10`);
  addIntelItem(newsItems, "Started Last 10", `${startsLast10}/10`);
  addIntelItem(newsItems, "Latest Status", latestStatusLabel);
  addIntelItem(newsItems, "Availability Signal", availabilitySignal);
  addIntelItem(
    newsItems,
    "Core Teammates Out (Last Game)",
    `${input.teammateUnavailableLastGame}/${input.teammateCore.length}`,
  );
  addIntelItem(
    newsItems,
    "Core Teammates Unknown",
    `${input.teammateUnknownStatusLastGame}/${input.teammateCore.length}`,
  );
  addIntelItem(
    newsItems,
    "Opponent Starter Continuity",
    input.opponentStarterShareTop5 == null ? "-" : formatPercent(input.opponentStarterShareTop5),
  );
  modules.push({
    id: "news-status",
    title: "10. News/Status Event Feed",
    description: "Availability and lineup status signals.",
    status: "LIVE",
    items: newsItems,
  });

  const scheduleLogs = statusLogs.length
    ? statusLogs.map((log) => ({ gameDateEt: log.gameDateEt, isHome: log.isHome }))
    : input.last10Logs.map((log) => ({ gameDateEt: log.gameDateEt, isHome: log.isHome }));
  const gamesLast4 = scheduleLogs.filter((log) => {
    const days = daysBetweenEt(log.gameDateEt, input.dateEt);
    return days != null && days <= 3;
  }).length;
  const gamesLast7 = scheduleLogs.filter((log) => {
    const days = daysBetweenEt(log.gameDateEt, input.dateEt);
    return days != null && days <= 6;
  }).length;
  const last5Sites = scheduleLogs.slice(0, 5).map((log) => log.isHome);
  let siteSwitchesLast5 = 0;
  for (let index = 1; index < last5Sites.length; index += 1) {
    const previous = last5Sites[index - 1];
    const current = last5Sites[index];
    if (previous != null && current != null && previous !== current) {
      siteSwitchesLast5 += 1;
    }
  }
  const firstSite = scheduleLogs[0]?.isHome ?? null;
  let siteStreak = 0;
  for (const log of scheduleLogs) {
    if (log.isHome == null || firstSite == null || log.isHome !== firstSite) break;
    siteStreak += 1;
  }
  const awayLast4 = scheduleLogs.filter((log) => {
    const days = daysBetweenEt(log.gameDateEt, input.dateEt);
    return days != null && days <= 3 && log.isHome === false;
  }).length;
  const travelStress =
    awayLast4 >= 2 || siteSwitchesLast5 >= 2
      ? "HIGH"
      : awayLast4 >= 1 || siteSwitchesLast5 >= 1
        ? "MED"
        : "LOW";

  const refItems: SnapshotIntelItem[] = [];
  addIntelItem(refItems, "Rest Days", restDays == null ? "-" : String(restDays));
  addIntelItem(refItems, "Back-to-Back", restDays === 0 ? "YES" : "NO");
  addIntelItem(refItems, "Games Last 4 Days", String(gamesLast4));
  addIntelItem(refItems, "Games Last 7 Days", String(gamesLast7));
  addIntelItem(refItems, "Tonight Venue", input.isHome ? "Home" : "Away");
  addIntelItem(
    refItems,
    "Site Streak",
    firstSite == null ? "-" : `${firstSite ? "Home" : "Away"} x${siteStreak}`,
  );
  addIntelItem(refItems, "Site Switches L5", String(siteSwitchesLast5));
  addIntelItem(
    refItems,
    "Travel Load Proxy",
    travelStress,
  );
  addIntelItem(refItems, "Ref Crew Published", "No cached pregame assignment");
  modules.push({
    id: "ref-rest-travel",
    title: "11. Ref/Rest/Travel Layer",
    description: "Schedule stress, site movement, and officiating availability context.",
    status: "DERIVED",
    items: refItems,
  });

  const feedbackItems: SnapshotIntelItem[] = [];
  const aboveSeasonLast5 = input.last5Logs.filter((log) => log.points > (input.seasonAverage.PTS ?? 0)).length;
  addIntelItem(feedbackItems, "Above Season Baseline (L5)", `${aboveSeasonLast5}/5`);
  addIntelItem(
    feedbackItems,
    "L3 vs L10 Momentum",
    formatSigned(
      input.last3Average.PTS == null || input.last10Average.PTS == null
        ? null
        : round(input.last3Average.PTS - input.last10Average.PTS, 2),
    ),
  );
  addIntelItem(
    feedbackItems,
    "Calibration State",
    input.playerProfile?.minutesVolatility != null && input.playerProfile.minutesVolatility < 4 ? "STABLE" : "VOLATILE",
  );
  addIntelItem(feedbackItems, "Manual Bet Tracker", "Pending user bet/result logging");
  modules.push({
    id: "postgame-feedback",
    title: "12. Postgame Feedback Loop",
    description: "Performance calibration and learning loop.",
    status: "DERIVED",
    items: feedbackItems,
  });

  return {
    generatedAt: new Date().toISOString(),
    modules,
  };
}

function averagesByMarket(logs: SnapshotStatLog[]): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    result[market] = average(logs.map((log) => valueByMarket(log, market)));
  });
  return result;
}

function arraysByMarket(logs: SnapshotStatLog[]): Record<SnapshotMarket, number[]> {
  return {
    PTS: logs.map((log) => log.points),
    REB: logs.map((log) => log.rebounds),
    AST: logs.map((log) => log.assists),
    THREES: logs.map((log) => log.threes),
    PRA: logs.map((log) => log.points + log.rebounds + log.assists),
    PA: logs.map((log) => log.points + log.assists),
    PR: logs.map((log) => log.points + log.rebounds),
    RA: logs.map((log) => log.rebounds + log.assists),
  };
}

function trendFrom(last3: SnapshotMetricRecord, season: SnapshotMetricRecord): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    const left = last3[market];
    const right = season[market];
    result[market] = left == null || right == null ? null : round(left - right, 2);
  });
  return result;
}

function createAllowanceAgg(): TeamAllowanceAgg {
  return {
    count: 0,
    sums: {
      PTS: 0,
      REB: 0,
      AST: 0,
      THREES: 0,
      PRA: 0,
      PA: 0,
      PR: 0,
      RA: 0,
    },
  };
}

function addToAllowance(agg: TeamAllowanceAgg, points: number, rebounds: number, assists: number, threes: number): void {
  const metrics = metricsFromBase(points, rebounds, assists, threes);
  agg.count += 1;
  MARKETS.forEach((market) => {
    agg.sums[market] += metrics[market] ?? 0;
  });
}

function averageFromAllowance(agg: TeamAllowanceAgg | null): SnapshotMetricRecord {
  if (!agg || agg.count === 0) {
    return blankMetricRecord();
  }
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    result[market] = round(agg.sums[market] / agg.count, 2);
  });
  return result;
}

function deltaFromLeague(teamAverage: SnapshotMetricRecord, leagueAverage: SnapshotMetricRecord): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    const teamValue = teamAverage[market];
    const leagueValue = leagueAverage[market];
    result[market] = teamValue == null || leagueValue == null ? null : round(teamValue - leagueValue, 2);
  });
  return result;
}

function averageFromMetrics(metricsList: SnapshotMetricRecord[]): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    const values = metricsList
      .map((metric) => metric[market])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    result[market] = average(values);
  });
  return result;
}

function recordFromGames(games: TeamGameEnriched[]): SnapshotTeamRecord {
  let wins = 0;
  let losses = 0;
  games.forEach((game) => {
    if (game.win === true) wins += 1;
    if (game.win === false) losses += 1;
  });
  return { wins, losses };
}

function emptyTeamSummary(): TeamSummary {
  return {
    seasonFor: blankMetricRecord(),
    seasonAllowed: blankMetricRecord(),
    last10For: blankMetricRecord(),
    last10Allowed: blankMetricRecord(),
    seasonRecord: { wins: 0, losses: 0 },
    last10Record: { wins: 0, losses: 0 },
  };
}

function toTimestamp(gameDateEt: string): number {
  return new Date(`${gameDateEt}T00:00:00Z`).getTime();
}

function teamSummaryFromGames(teamGames: TeamGameEnriched[]): TeamSummary {
  const sorted = teamGames.slice().sort((a, b) => {
    const dateDiff = toTimestamp(b.gameDateEt) - toTimestamp(a.gameDateEt);
    if (dateDiff !== 0) return dateDiff;
    return b.externalGameId.localeCompare(a.externalGameId);
  });

  const last10 = sorted.slice(0, 10);
  const seasonFor = averageFromMetrics(sorted.map((game) => game.metrics));
  const seasonAllowed = averageFromMetrics(
    sorted
      .map((game) => game.allowedMetrics)
      .filter((metrics): metrics is SnapshotMetricRecord => metrics != null),
  );
  const last10For = averageFromMetrics(last10.map((game) => game.metrics));
  const last10Allowed = averageFromMetrics(
    last10
      .map((game) => game.allowedMetrics)
      .filter((metrics): metrics is SnapshotMetricRecord => metrics != null),
  );

  return {
    seasonFor,
    seasonAllowed,
    last10For,
    last10Allowed,
    seasonRecord: recordFromGames(sorted),
    last10Record: recordFromGames(last10),
  };
}

export async function getSnapshotBoardData(dateEt: string): Promise<SnapshotBoardData> {
  const isTodayEt = dateEt === getTodayEtDateString();
  const [games, latestDataWrite, lineupSetting] = await Promise.all([
    prisma.game.findMany({
      where: { gameDateEt: dateEt },
      include: {
        homeTeam: true,
        awayTeam: true,
      },
      orderBy: [{ commenceTimeUtc: "asc" }],
    }),
    prisma.playerGameLog.aggregate({
      _max: { updatedAt: true },
    }),
    isTodayEt
      ? prisma.systemSetting.findUnique({
          where: { key: "snapshot_lineups_today" },
          select: { value: true },
        })
      : Promise.resolve(null),
  ]);

  const lineupSnapshot = parseLineupSnapshot(lineupSetting?.value ?? null, dateEt);
  const lineupMap = buildLineupSignalMap(lineupSnapshot);

  if (games.length === 0) {
    return {
      dateEt,
      lastUpdatedAt: latestDataWrite._max.updatedAt?.toISOString() ?? null,
      matchups: [],
      teamMatchups: [],
      rows: [],
    };
  }

  const matchupByTeamId = new Map<string, TeamMatchup>();
  const matchupOptionsByKey = new Map<string, SnapshotMatchupOption>();
  const matchupMetaByKey = new Map<string, MatchupMeta>();

  for (const game of games) {
    const homeCode = game.homeTeam.abbreviation;
    const awayCode = game.awayTeam.abbreviation;
    const gameTimeEt = formatUtcToEt(game.commenceTimeUtc);
    const matchupKey = `${awayCode}@${homeCode}`;

    matchupOptionsByKey.set(matchupKey, {
      key: matchupKey,
      awayTeam: awayCode,
      homeTeam: homeCode,
      gameTimeEt,
      label: `${awayCode} @ ${homeCode} - ${gameTimeEt}`,
    });

    matchupMetaByKey.set(matchupKey, {
      matchupKey,
      awayTeamId: game.awayTeamId,
      homeTeamId: game.homeTeamId,
      awayTeamCode: awayCode,
      homeTeamCode: homeCode,
      gameTimeEt,
    });

    if (!matchupByTeamId.has(game.homeTeamId)) {
      matchupByTeamId.set(game.homeTeamId, {
        teamCode: homeCode,
        opponentCode: awayCode,
        opponentTeamId: game.awayTeamId,
        matchupKey,
        gameTimeEt,
        gameTimeUtc: game.commenceTimeUtc,
        isHome: true,
      });
    }

    if (!matchupByTeamId.has(game.awayTeamId)) {
      matchupByTeamId.set(game.awayTeamId, {
        teamCode: awayCode,
        opponentCode: homeCode,
        opponentTeamId: game.homeTeamId,
        matchupKey,
        gameTimeEt,
        gameTimeUtc: game.commenceTimeUtc,
        isHome: false,
      });
    }
  }

  const relevantTeamIds = Array.from(
    new Set(
      Array.from(matchupMetaByKey.values()).flatMap((meta) => [meta.awayTeamId, meta.homeTeamId]),
    ),
  );

  const groupedTeamGames = await prisma.playerGameLog.groupBy({
    by: ["teamId", "opponentTeamId", "externalGameId", "gameDateEt"],
    where: {
      teamId: { in: relevantTeamIds },
      gameDateEt: { lt: dateEt },
      minutes: { gt: 0 },
    },
    _sum: {
      points: true,
      rebounds: true,
      assists: true,
      threes: true,
    },
  });

  const teamGameAggregates: TeamGameAggregate[] = groupedTeamGames
    .map((row) => {
      if (!row.teamId) return null;
      const points = toStat(row._sum.points);
      const rebounds = toStat(row._sum.rebounds);
      const assists = toStat(row._sum.assists);
      const threes = toStat(row._sum.threes);
      return {
        teamId: row.teamId,
        opponentTeamId: row.opponentTeamId,
        externalGameId: row.externalGameId,
        gameDateEt: row.gameDateEt,
        metrics: metricsFromBase(points, rebounds, assists, threes),
      };
    })
    .filter((row): row is TeamGameAggregate => row != null);

  const gameMetricsByGameTeam = new Map<string, SnapshotMetricRecord>();
  const teamGamesByTeamId = new Map<string, TeamGameAggregate[]>();
  teamGameAggregates.forEach((game) => {
    gameMetricsByGameTeam.set(`${game.externalGameId}:${game.teamId}`, game.metrics);
    const list = teamGamesByTeamId.get(game.teamId) ?? [];
    list.push(game);
    teamGamesByTeamId.set(game.teamId, list);
  });

  const teamSummaryByTeamId = new Map<string, TeamSummary>();
  teamGamesByTeamId.forEach((gamesForTeam, teamId) => {
    const enriched: TeamGameEnriched[] = gamesForTeam.map((game) => {
      const allowedMetrics =
        game.opponentTeamId != null
          ? gameMetricsByGameTeam.get(`${game.externalGameId}:${game.opponentTeamId}`) ?? null
          : null;
      const teamPoints = game.metrics.PTS;
      const opponentPoints = allowedMetrics?.PTS ?? null;
      const win =
        teamPoints == null || opponentPoints == null
          ? null
          : teamPoints > opponentPoints
            ? true
            : teamPoints < opponentPoints
              ? false
              : null;
      return {
        ...game,
        allowedMetrics,
        win,
      };
    });

    teamSummaryByTeamId.set(teamId, teamSummaryFromGames(enriched));
  });

  const teamMatchups: SnapshotTeamMatchupStats[] = Array.from(matchupMetaByKey.values())
    .map((meta) => {
      const awaySummary = teamSummaryByTeamId.get(meta.awayTeamId) ?? emptyTeamSummary();
      const homeSummary = teamSummaryByTeamId.get(meta.homeTeamId) ?? emptyTeamSummary();
      return {
        matchupKey: meta.matchupKey,
        awayTeam: meta.awayTeamCode,
        homeTeam: meta.homeTeamCode,
        gameTimeEt: meta.gameTimeEt,
        awaySeasonFor: awaySummary.seasonFor,
        awaySeasonAllowed: awaySummary.seasonAllowed,
        awayLast10For: awaySummary.last10For,
        awayLast10Allowed: awaySummary.last10Allowed,
        awaySeasonRecord: awaySummary.seasonRecord,
        awayLast10Record: awaySummary.last10Record,
        homeSeasonFor: homeSummary.seasonFor,
        homeSeasonAllowed: homeSummary.seasonAllowed,
        homeLast10For: homeSummary.last10For,
        homeLast10Allowed: homeSummary.last10Allowed,
        homeSeasonRecord: homeSummary.seasonRecord,
        homeLast10Record: homeSummary.last10Record,
      };
    })
    .sort((a, b) => a.matchupKey.localeCompare(b.matchupKey));

  const teamIds = Array.from(matchupByTeamId.keys());
  const players = await prisma.player.findMany({
    where: {
      teamId: { in: teamIds },
      isActive: true,
    },
    select: {
      id: true,
      fullName: true,
      position: true,
      teamId: true,
    },
    orderBy: [{ fullName: "asc" }],
  });

  if (players.length === 0) {
    return {
      dateEt,
      lastUpdatedAt: latestDataWrite._max.updatedAt?.toISOString() ?? null,
      matchups: Array.from(matchupOptionsByKey.values()).sort((a, b) => a.label.localeCompare(b.label)),
      teamMatchups,
      rows: [],
    };
  }

  const playerIds = players.map((player) => player.id);
  const logs = await prisma.playerGameLog.findMany({
    where: {
      playerId: { in: playerIds },
      gameDateEt: { lt: dateEt },
      minutes: { gt: 0 },
    },
    include: {
      opponentTeam: { select: { abbreviation: true } },
    },
    orderBy: [{ playerId: "asc" }, { gameDateEt: "desc" }],
  });

  const statusLogsRaw = await prisma.playerGameLog.findMany({
    where: {
      playerId: { in: playerIds },
      gameDateEt: { lt: dateEt },
    },
    select: {
      playerId: true,
      gameDateEt: true,
      externalGameId: true,
      isHome: true,
      starter: true,
      played: true,
      teamId: true,
      opponentTeamId: true,
    },
    orderBy: [{ playerId: "asc" }, { gameDateEt: "desc" }],
  });

  const logsByPlayerId = new Map<string, SnapshotStatLog[]>();
  for (const log of logs) {
    const existing = logsByPlayerId.get(log.playerId) ?? [];
    if (existing.length >= 80) {
      continue;
    }

    existing.push({
      gameDateEt: log.gameDateEt,
      opponent: log.opponentTeam?.abbreviation ?? null,
      isHome: log.isHome,
      starter: log.starter,
      played: log.played,
      minutes: toStat(log.minutes),
      points: toStat(log.points),
      rebounds: toStat(log.rebounds),
      assists: toStat(log.assists),
      threes: toStat(log.threes),
      steals: toStat(log.steals),
      blocks: toStat(log.blocks),
    });
    logsByPlayerId.set(log.playerId, existing);
  }

  const statusLogsByPlayerId = new Map<string, PlayerStatusLog[]>();
  for (const log of statusLogsRaw) {
    const existing = statusLogsByPlayerId.get(log.playerId) ?? [];
    if (existing.length >= 20) continue;
    existing.push({
      gameDateEt: log.gameDateEt,
      externalGameId: log.externalGameId,
      isHome: log.isHome,
      starter: log.starter,
      played: log.played,
      teamId: log.teamId,
      opponentTeamId: log.opponentTeamId,
    });
    statusLogsByPlayerId.set(log.playerId, existing);
  }

  const opponentTeamIds = Array.from(
    new Set(Array.from(matchupByTeamId.values()).map((matchup) => matchup.opponentTeamId)),
  );
  const opponentTeamIdSet = new Set(opponentTeamIds);

  const opponentGameRows = await prisma.game.findMany({
    where: {
      gameDateEt: { lt: dateEt },
      OR: [{ homeTeamId: { in: opponentTeamIds } }, { awayTeamId: { in: opponentTeamIds } }],
    },
    select: {
      externalId: true,
      gameDateEt: true,
      homeTeamId: true,
      awayTeamId: true,
    },
    orderBy: [{ gameDateEt: "desc" }, { externalId: "desc" }],
  });

  const gameIdsByOpponentTeamId = new Map<string, Set<string>>();
  for (const row of opponentGameRows) {
    const candidateTeamIds = [row.homeTeamId, row.awayTeamId];
    for (const teamId of candidateTeamIds) {
      if (!opponentTeamIdSet.has(teamId)) continue;
      const set = gameIdsByOpponentTeamId.get(teamId) ?? new Set<string>();
      if (set.size >= 10) continue;
      set.add(row.externalId);
      gameIdsByOpponentTeamId.set(teamId, set);
    }
  }

  const relevantGameIds = new Set<string>();
  gameIdsByOpponentTeamId.forEach((set) => {
    set.forEach((id) => relevantGameIds.add(id));
  });

  const opponentAllowanceLogs =
    relevantGameIds.size > 0
      ? await prisma.playerGameLog.findMany({
          where: {
            opponentTeamId: { in: opponentTeamIds },
            externalGameId: { in: Array.from(relevantGameIds) },
            minutes: { gt: 0 },
          },
          select: {
            opponentTeamId: true,
            externalGameId: true,
            points: true,
            rebounds: true,
            assists: true,
            threes: true,
          },
        })
      : [];

  const allowanceByOpponentTeamId = new Map<string, TeamAllowanceAgg>();
  const leagueAgg = createAllowanceAgg();

  for (const log of opponentAllowanceLogs) {
    if (!log.opponentTeamId) continue;
    const validGames = gameIdsByOpponentTeamId.get(log.opponentTeamId);
    if (!validGames || !validGames.has(log.externalGameId)) {
      continue;
    }

    const points = toStat(log.points);
    const rebounds = toStat(log.rebounds);
    const assists = toStat(log.assists);
    const threes = toStat(log.threes);

    const teamAgg = allowanceByOpponentTeamId.get(log.opponentTeamId) ?? createAllowanceAgg();
    addToAllowance(teamAgg, points, rebounds, assists, threes);
    allowanceByOpponentTeamId.set(log.opponentTeamId, teamAgg);
    addToAllowance(leagueAgg, points, rebounds, assists, threes);
  }

  const leagueAverage = averageFromAllowance(leagueAgg.count > 0 ? leagueAgg : null);

  const playerProfilesById = new Map<string, PlayerProfile>();
  const teamProfilesByTeamId = new Map<string, PlayerProfile[]>();

  for (const player of players) {
    const logsForPlayer = logsByPlayerId.get(player.id) ?? [];
    const statusForPlayer = statusLogsByPlayerId.get(player.id) ?? [];
    const statusLast10 = statusForPlayer.slice(0, 10);
    const last10Logs = logsForPlayer.slice(0, 10);
    const last3Logs = logsForPlayer.slice(0, 3);
    const last10Average = averagesByMarket(last10Logs);
    const minutesLast10Avg = average(last10Logs.map((log) => log.minutes));
    const minutesLast3Avg = average(last3Logs.map((log) => log.minutes));
    const minutesTrend =
      minutesLast3Avg == null || minutesLast10Avg == null ? null : round(minutesLast3Avg - minutesLast10Avg, 2);
    const minutesVolatility = standardDeviation(last10Logs.map((log) => log.minutes));
    const stealsLast10Avg = average(last10Logs.map((log) => log.steals));
    const blocksLast10Avg = average(last10Logs.map((log) => log.blocks));
    const startsLast10 = statusLast10.reduce((count, log) => count + (log.starter === true ? 1 : 0), 0);
    const starterRateLast10 = statusLast10.length > 0 ? round(startsLast10 / statusLast10.length, 2) : null;
    const startedLastGame = statusLast10[0]?.starter ?? null;
    const stocksPer36Last10 =
      minutesLast10Avg == null || minutesLast10Avg <= 0 || stealsLast10Avg == null || blocksLast10Avg == null
        ? null
        : round(((stealsLast10Avg + blocksLast10Avg) / minutesLast10Avg) * 36, 2);

    const profile: PlayerProfile = {
      playerId: player.id,
      playerName: player.fullName,
      position: player.position,
      teamId: player.teamId,
      last10Average,
      minutesLast3Avg,
      minutesLast10Avg,
      minutesTrend,
      minutesVolatility,
      stocksPer36Last10,
      startsLast10,
      starterRateLast10,
      startedLastGame,
      archetype: determineArchetype(last10Average, minutesLast10Avg),
      positionTokens: parsePositionTokens(player.position),
    };

    playerProfilesById.set(player.id, profile);
    if (player.teamId) {
      const existing = teamProfilesByTeamId.get(player.teamId) ?? [];
      existing.push(profile);
      teamProfilesByTeamId.set(player.teamId, existing);
    }
  }

  teamProfilesByTeamId.forEach((profiles, teamId) => {
    profiles.sort((a, b) => {
      const minDiff = (b.minutesLast10Avg ?? 0) - (a.minutesLast10Avg ?? 0);
      if (minDiff !== 0) return minDiff;
      return (b.last10Average.PTS ?? 0) - (a.last10Average.PTS ?? 0);
    });
    teamProfilesByTeamId.set(teamId, profiles);
  });

  const rowsWithSortKeys: Array<{ sortTime: number; row: SnapshotRow }> = [];

  for (const player of players) {
    if (!player.teamId) {
      continue;
    }
    const matchup = matchupByTeamId.get(player.teamId);
    if (!matchup) {
      continue;
    }

    const logsForPlayer = logsByPlayerId.get(player.id) ?? [];
    const statusForPlayer = statusLogsByPlayerId.get(player.id) ?? [];
    const statusLast10 = statusForPlayer.slice(0, 10);
    const last5Logs = logsForPlayer.slice(0, 5);
    const last10Logs = logsForPlayer.slice(0, 10);
    const last3Logs = logsForPlayer.slice(0, 3);
    const homeAwayLogs = logsForPlayer.filter((log) => log.isHome === matchup.isHome);

    const seasonAverage = averagesByMarket(logsForPlayer);
    const last3Average = averagesByMarket(last3Logs);
    const last10Average = averagesByMarket(last10Logs);
    const homeAwayAverage = averagesByMarket(homeAwayLogs);
    const last5ByMarket = arraysByMarket(last5Logs);
    const last10ByMarket = arraysByMarket(last10Logs);
    const trendVsSeason = trendFrom(last3Average, seasonAverage);

    const opponentAgg = allowanceByOpponentTeamId.get(matchup.opponentTeamId) ?? null;
    const opponentAllowance = averageFromAllowance(opponentAgg);
    const opponentAllowanceDelta = deltaFromLeague(opponentAllowance, leagueAverage);
    const playerProfile = playerProfilesById.get(player.id) ?? null;
    const teamProfiles = teamProfilesByTeamId.get(player.teamId) ?? [];
    const opponentProfiles = teamProfilesByTeamId.get(matchup.opponentTeamId) ?? [];
    const teamSummary = teamSummaryByTeamId.get(player.teamId) ?? emptyTeamSummary();
    const opponentSummary = teamSummaryByTeamId.get(matchup.opponentTeamId) ?? emptyTeamSummary();
    const rotationRankIndex = teamProfiles.findIndex((profile) => profile.playerId === player.id);
    const rotationRank = rotationRankIndex >= 0 ? rotationRankIndex + 1 : null;
    const primaryDefender = playerProfile ? choosePrimaryDefender(playerProfile, opponentProfiles) : null;
    const teammateCore: SnapshotTeammateCore[] = teamProfiles
      .filter((profile) => profile.playerId !== player.id)
      .slice(0, 3)
      .map((profile) => ({
        playerId: profile.playerId,
        playerName: profile.playerName,
        position: profile.position,
        avgMinutesLast10: profile.minutesLast10Avg,
        avgPRA10: profile.last10Average.PRA,
        avgAST10: profile.last10Average.AST,
      }));
    const teammateUnavailableLastGame = teammateCore.reduce((count, teammate) => {
      const latest = statusLogsByPlayerId.get(teammate.playerId)?.[0];
      return count + (latest?.played === false ? 1 : 0);
    }, 0);
    const teammateUnknownStatusLastGame = teammateCore.reduce((count, teammate) => {
      const latest = statusLogsByPlayerId.get(teammate.playerId)?.[0];
      return count + (latest == null || latest.played == null ? 1 : 0);
    }, 0);
    const opponentTop5 = opponentProfiles.slice(0, 5);
    const opponentStarterShareTop5 =
      opponentTop5.length > 0
        ? round(
            opponentTop5.reduce((sum, profile) => sum + (profile.starterRateLast10 ?? 0), 0) / opponentTop5.length,
            2,
          )
        : null;
    const computedStartsLast10 = statusLast10.reduce((count, log) => count + (log.starter === true ? 1 : 0), 0);
    const computedStarterRateLast10 =
      statusLast10.length > 0 ? round(computedStartsLast10 / statusLast10.length, 2) : null;
    const computedStartedLastGame = statusLast10[0]?.starter ?? null;
    const lineupSignal = readLineupSignal(lineupMap, matchup.teamCode, player.fullName);
    const minutesLast10Avg = playerProfile?.minutesLast10Avg ?? average(last10Logs.map((log) => log.minutes));
    const projectedTonight = projectTonightMetrics({
      last3Average,
      last10Average,
      seasonAverage,
      homeAwayAverage,
      opponentAllowance,
      opponentAllowanceDelta,
      last10ByMarket,
      sampleSize: logsForPlayer.length,
      minutesLast3Avg: playerProfile?.minutesLast3Avg ?? average(last3Logs.map((log) => log.minutes)),
      minutesLast10Avg,
      minutesHomeAwayAvg: average(homeAwayLogs.map((log) => log.minutes)),
      lineupStarter: lineupSignal?.lineupStarter ?? null,
      starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
    });
    const dataCompleteness = computeDataCompleteness({
      last10Logs,
      statusLast10,
      opponentAllowance,
      primaryDefender,
      teammateCore,
      playerProfile,
    });

    rowsWithSortKeys.push({
      sortTime: matchup.gameTimeUtc?.getTime() ?? Number.MAX_SAFE_INTEGER,
      row: {
        playerId: player.id,
        playerName: player.fullName,
        position: player.position,
        teamCode: matchup.teamCode,
        opponentCode: matchup.opponentCode,
        matchupKey: matchup.matchupKey,
        isHome: matchup.isHome,
        gameTimeEt: matchup.gameTimeEt,
        last5: last5ByMarket,
        last10: last10ByMarket,
        last3Average,
        last10Average,
        seasonAverage,
        homeAwayAverage,
        trendVsSeason,
        opponentAllowance,
        opponentAllowanceDelta,
        projectedTonight,
        recentLogs: last10Logs,
        dataCompleteness,
        playerContext: {
          archetype: playerProfile?.archetype ?? determineArchetype(last10Average, average(last10Logs.map((log) => log.minutes))),
          projectedStarter: applyLineupStarterLabel(
            starterStatusLabel({
              startedLastGame: playerProfile?.startedLastGame ?? computedStartedLastGame,
              starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
              rotationRank,
              minutesLast10Avg,
            }),
            lineupSignal,
          ),
          startedLastGame: playerProfile?.startedLastGame ?? computedStartedLastGame,
          startsLast10: playerProfile?.startsLast10 ?? computedStartsLast10,
          starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
          rotationRank,
          minutesLast3Avg: playerProfile?.minutesLast3Avg ?? average(last3Logs.map((log) => log.minutes)),
          minutesLast10Avg,
          minutesTrend: playerProfile?.minutesTrend ?? null,
          minutesVolatility: playerProfile?.minutesVolatility ?? standardDeviation(last10Logs.map((log) => log.minutes)),
          primaryDefender,
          teammateCore,
        },
        gameIntel: buildGameIntel({
          dateEt,
          teamCode: matchup.teamCode,
          opponentCode: matchup.opponentCode,
          isHome: matchup.isHome,
          playerProfile,
          teamProfiles,
          opponentProfiles,
          primaryDefender,
          teammateCore,
          last10Logs,
          last5Logs,
          statusLast10,
          teammateUnavailableLastGame,
          teammateUnknownStatusLastGame,
          opponentStarterShareTop5,
          seasonAverage,
          last10Average,
          last3Average,
          opponentAllowance,
          opponentAllowanceDelta,
          teamSummary,
          opponentSummary,
        }),
      },
    });
  }

  rowsWithSortKeys.sort((a, b) => {
    if (a.sortTime !== b.sortTime) {
      return a.sortTime - b.sortTime;
    }
    if (a.row.matchupKey !== b.row.matchupKey) {
      return a.row.matchupKey.localeCompare(b.row.matchupKey);
    }
    return a.row.playerName.localeCompare(b.row.playerName);
  });

  return {
    dateEt,
    lastUpdatedAt: latestDataWrite._max.updatedAt?.toISOString() ?? null,
    matchups: Array.from(matchupOptionsByKey.values()).sort((a, b) => a.label.localeCompare(b.label)),
    teamMatchups,
    rows: rowsWithSortKeys.map((item) => item.row),
  };
}

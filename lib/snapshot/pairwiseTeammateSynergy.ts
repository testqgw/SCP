import type {
  SnapshotMarket,
  SnapshotMetricRecord,
  SnapshotTeammateSynergy,
  SnapshotTeammateSynergyConfidence,
  SnapshotTeammateSynergyTriggerMetric,
} from "@/lib/types/snapshot";

export type PairwiseTeammateProfile = {
  playerId: string;
  playerName: string;
  teamId: string | null;
  last10Average: SnapshotMetricRecord;
  minutesLast10Avg: number | null;
};

export type PairwiseTeammateGameLog = {
  playerId: string;
  teamId: string | null;
  externalGameId: string;
  gameDateEt: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
};

export type PairwiseTeammateSynergyInput = {
  synergies: SnapshotTeammateSynergy[];
  adjustments: Partial<Record<SnapshotMarket, number>>;
};

type TriggerSpec = {
  metric: SnapshotTeammateSynergyTriggerMetric;
  threshold: number;
  label: string;
  likelyMargin: number;
};

const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const BASE_MARKETS = new Set<SnapshotMarket>(["PTS", "REB", "AST", "THREES"]);
const COMBO_MARKETS = new Set<SnapshotMarket>(["PRA", "PA", "PR", "RA"]);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricValue(log: PairwiseTeammateGameLog, metric: SnapshotTeammateSynergyTriggerMetric) {
  if (metric === "PTS") return log.points;
  if (metric === "REB") return log.rebounds;
  if (metric === "AST") return log.assists;
  if (metric === "THREES") return log.threes;
  return log.minutes;
}

function marketValue(log: PairwiseTeammateGameLog, market: SnapshotMarket) {
  if (market === "PTS") return log.points;
  if (market === "REB") return log.rebounds;
  if (market === "AST") return log.assists;
  if (market === "THREES") return log.threes;
  if (market === "PRA") return log.points + log.rebounds + log.assists;
  if (market === "PA") return log.points + log.assists;
  if (market === "PR") return log.points + log.rebounds;
  return log.rebounds + log.assists;
}

function recentMetricValue(profile: PairwiseTeammateProfile, metric: SnapshotTeammateSynergyTriggerMetric) {
  if (metric === "MIN") return profile.minutesLast10Avg;
  return profile.last10Average[metric] ?? null;
}

function marketMinDelta(market: SnapshotMarket) {
  if (market === "PTS" || market === "PRA") return 0.9;
  if (market === "PA" || market === "PR" || market === "RA") return 0.65;
  if (market === "THREES") return 0.22;
  return 0.4;
}

function marketScale(market: SnapshotMarket) {
  if (market === "PTS" || market === "PRA") return 4.2;
  if (market === "PA" || market === "PR" || market === "RA") return 3.2;
  if (market === "THREES") return 1.1;
  return 2.1;
}

function confidenceFor(input: { delta: number; withSample: number; withoutSample: number; score: number }) {
  if (input.withSample >= 10 && input.withoutSample >= 10 && input.score >= 1.2) return "HIGH";
  if (input.withSample >= 6 && input.withoutSample >= 6 && input.score >= 0.65) return "MEDIUM";
  return "LOW";
}

function triggerSpecs(profile: PairwiseTeammateProfile): TriggerSpec[] {
  const pts = profile.last10Average.PTS ?? 0;
  const reb = profile.last10Average.REB ?? 0;
  const ast = profile.last10Average.AST ?? 0;
  const threes = profile.last10Average.THREES ?? 0;
  const mins = profile.minutesLast10Avg ?? 0;

  const specs: TriggerSpec[] = [
    { metric: "PTS", threshold: 20, label: "20+ PTS", likelyMargin: 1.5 },
    { metric: "PTS", threshold: Math.max(14, round(pts + 2.5, 1)), label: "scoring spike", likelyMargin: 1.8 },
    { metric: "REB", threshold: Math.max(7, round(reb + 1.5, 1)), label: "rebound spike", likelyMargin: 1.2 },
    { metric: "AST", threshold: Math.max(5, round(ast + 1.3, 1)), label: "assist spike", likelyMargin: 1 },
    { metric: "THREES", threshold: Math.max(2, round(threes + 0.7, 1)), label: "3PM spike", likelyMargin: 0.6 },
    { metric: "MIN", threshold: Math.max(26, Math.min(34, round(mins + 2, 1))), label: "heavy minutes", likelyMargin: 1.5 },
  ];

  const seen = new Set<string>();
  return specs.filter((spec) => {
    const key = `${spec.metric}:${spec.threshold}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatTriggerLabel(spec: TriggerSpec) {
  if (spec.label === "20+ PTS") return spec.label;
  const value = Number.isInteger(spec.threshold) ? String(spec.threshold) : spec.threshold.toFixed(1);
  return `${spec.label} (${spec.metric} ${value}+)`;
}

function adjustmentCap(market: SnapshotMarket) {
  if (market === "PTS" || market === "PRA") return 0.9;
  if (market === "PA" || market === "PR" || market === "RA") return 0.75;
  if (market === "THREES") return 0.18;
  return 0.45;
}

function confidenceWeight(confidence: SnapshotTeammateSynergyConfidence) {
  if (confidence === "HIGH") return 0.28;
  if (confidence === "MEDIUM") return 0.2;
  return 0.11;
}

function buildSynergiesForPair(input: {
  player: PairwiseTeammateProfile;
  teammate: PairwiseTeammateProfile;
  playerLogs: PairwiseTeammateGameLog[];
  teammateLogs: PairwiseTeammateGameLog[];
}) {
  const playerByGame = new Map(
    input.playerLogs
      .filter((log) => log.teamId != null && log.teamId === input.player.teamId)
      .map((log) => [log.externalGameId, log]),
  );
  const coPlayed = input.teammateLogs
    .filter((teammateLog) => teammateLog.teamId != null && teammateLog.teamId === input.player.teamId)
    .map((teammateLog) => ({ teammateLog, playerLog: playerByGame.get(teammateLog.externalGameId) ?? null }))
    .filter((row): row is { teammateLog: PairwiseTeammateGameLog; playerLog: PairwiseTeammateGameLog } => {
      return row.playerLog != null && row.teammateLog.minutes > 0 && row.playerLog.minutes > 0;
    });

  if (coPlayed.length < 10) return [];

  const results: SnapshotTeammateSynergy[] = [];
  for (const spec of triggerSpecs(input.teammate)) {
    const withTrigger = coPlayed.filter((row) => metricValue(row.teammateLog, spec.metric) >= spec.threshold);
    const withoutTrigger = coPlayed.filter((row) => metricValue(row.teammateLog, spec.metric) < spec.threshold);
    if (withTrigger.length < 4 || withoutTrigger.length < 4) continue;

    const recentValue = recentMetricValue(input.teammate, spec.metric);
    const likelyActiveTrigger = recentValue != null && recentValue >= spec.threshold - spec.likelyMargin;

    for (const market of MARKETS) {
      const withAverage = average(withTrigger.map((row) => marketValue(row.playerLog, market)));
      const withoutAverage = average(withoutTrigger.map((row) => marketValue(row.playerLog, market)));
      if (withAverage == null || withoutAverage == null) continue;

      const delta = withAverage - withoutAverage;
      if (Math.abs(delta) < marketMinDelta(market)) continue;

      const sampleStrength =
        Math.min(1, Math.sqrt(withTrigger.length) / 4) * Math.min(1, Math.sqrt(withoutTrigger.length) / 4);
      const likelyBoost = likelyActiveTrigger ? 1.1 : 0.82;
      const score = (Math.abs(delta) / marketScale(market)) * sampleStrength * likelyBoost;
      if (score < 0.22) continue;

      const confidence = confidenceFor({
        delta,
        withSample: withTrigger.length,
        withoutSample: withoutTrigger.length,
        score,
      });

      results.push({
        teammateId: input.teammate.playerId,
        teammateName: input.teammate.playerName,
        triggerMetric: spec.metric,
        triggerLabel: formatTriggerLabel(spec),
        targetMarket: market,
        direction: delta >= 0 ? "BOOST" : "DRAG",
        delta: round(delta, 2),
        withAverage: round(withAverage, 2),
        withoutAverage: round(withoutAverage, 2),
        withSample: withTrigger.length,
        withoutSample: withoutTrigger.length,
        confidence,
        score: round(score, 4),
        likelyActiveTrigger,
        activeToday: true,
      });
    }
  }

  return results;
}

export function buildPairwiseTeammateSynergyMap(input: {
  profilesByTeamId: Map<string, PairwiseTeammateProfile[]>;
  logsByPlayerId: Map<string, PairwiseTeammateGameLog[]>;
  maxSynergiesPerPlayer?: number;
}) {
  const maxSynergiesPerPlayer = input.maxSynergiesPerPlayer ?? 4;
  const result = new Map<string, SnapshotTeammateSynergy[]>();

  for (const profiles of input.profilesByTeamId.values()) {
    const rotationProfiles = profiles.filter((profile) => (profile.minutesLast10Avg ?? 0) >= 14);
    for (const player of rotationProfiles) {
      const playerLogs = input.logsByPlayerId.get(player.playerId) ?? [];
      const playerSynergies = rotationProfiles
        .filter((teammate) => teammate.playerId !== player.playerId)
        .flatMap((teammate) =>
          buildSynergiesForPair({
            player,
            teammate,
            playerLogs,
            teammateLogs: input.logsByPlayerId.get(teammate.playerId) ?? [],
          }),
        )
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score;
          if (right.withSample !== left.withSample) return right.withSample - left.withSample;
          return Math.abs(right.delta) - Math.abs(left.delta);
        })
        .slice(0, maxSynergiesPerPlayer);

      result.set(player.playerId, playerSynergies);
    }
  }

  return result;
}

export function buildPairwiseTeammateSynergyInput(
  synergies: SnapshotTeammateSynergy[],
): PairwiseTeammateSynergyInput | null {
  const adjustments: Partial<Record<SnapshotMarket, number>> = {};

  for (const synergy of synergies) {
    if (!synergy.activeToday || !synergy.likelyActiveTrigger) continue;
    const rawAdjustment = synergy.delta * confidenceWeight(synergy.confidence);
    const cappedAdjustment = clamp(rawAdjustment, -adjustmentCap(synergy.targetMarket), adjustmentCap(synergy.targetMarket));
    adjustments[synergy.targetMarket] = (adjustments[synergy.targetMarket] ?? 0) + cappedAdjustment;
  }

  const roundedAdjustments = Object.fromEntries(
    Object.entries(adjustments).map(([market, value]) => [
      market,
      round(clamp(value, -adjustmentCap(market as SnapshotMarket), adjustmentCap(market as SnapshotMarket)), 2),
    ]),
  ) as Partial<Record<SnapshotMarket, number>>;

  if (Object.keys(roundedAdjustments).length === 0) return null;
  return { synergies, adjustments: roundedAdjustments };
}

export function applyPairwiseTeammateSynergyAdjustments(
  result: SnapshotMetricRecord,
  synergy: PairwiseTeammateSynergyInput | null | undefined,
  marketSet: "base" | "combo",
): void {
  if (!synergy) return;

  for (const [market, adjustment] of Object.entries(synergy.adjustments) as Array<[SnapshotMarket, number]>) {
    if (marketSet === "base" && !BASE_MARKETS.has(market)) continue;
    if (marketSet === "combo" && !COMBO_MARKETS.has(market)) continue;
    if (result[market] == null) continue;
    result[market] = round(Math.max(0, (result[market] ?? 0) + adjustment), 2);
  }
}

import { PrismaClient } from "@prisma/client";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildPrecisionPick,
  comparePrecisionSignals,
  DEFAULT_DAILY_6_RULES,
  type PrecisionRule,
  type PrecisionRuleSet,
} from "../lib/snapshot/precisionPickSystem";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { attachCurrentLineRecencyMetrics } from "../lib/snapshot/currentLineRecency";
import { round } from "../lib/utils";
import { loadPlayerMetaWithCache } from "./utils/playerMetaCache";

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";

type TrainingRow = {
  playerId: string;
  playerName: string;
  market: Market;
  gameDateEt: string;
  projectedValue: number;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  finalSide: Side;
  actualSide: Side;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability?: number | null;
  actualMinutes: number;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection?: number | null;
  threesProjection?: number | null;
  l5CurrentLineDeltaAvg?: number | null;
  l5CurrentLineOverRate?: number | null;
  l5MinutesAvg?: number | null;
};

type BacktestRowsFile = {
  from: string;
  to: string;
  playerMarketRows: TrainingRow[];
};

type PlayerMeta = {
  id: string;
  position: string | null;
};

type PlayerSummary = {
  position: string | null;
  avgExpectedMinutes: number | null;
  avgStarterRate: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistProjection: number | null;
  threesProjection: number | null;
};

type QualifiedPick = {
  row: TrainingRow;
  signal: ReturnType<typeof buildPrecisionPick>;
};

type EvalResult = {
  picks: number;
  correct: number;
  accuracyPct: number;
  picksPerDay: number;
  coveragePct: number;
  byMarket: Partial<Record<Market, { picks: number; correct: number; accuracyPct: number | null }>>;
};

const prisma = new PrismaClient();

function resolveDefaultInputPath(): string {
  try {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  } catch {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
  }
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

async function loadPlayerMetaMap(playerIds: string[]): Promise<Map<string, PlayerMeta>> {
  const cached = await loadPlayerMetaWithCache({
    rows: playerIds.map((playerId) => ({ playerId })),
    fetcher: async (ids) =>
      (
        await prisma.player.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            position: true,
          },
        })
      ).map((row) => ({ ...row, fullName: null })),
  });

  return new Map([...cached.entries()].map(([id, meta]) => [id, { id, position: meta.position }]));
}

function summarizeRows(rows: TrainingRow[], playerMetaMap: Map<string, PlayerMeta>): Map<string, PlayerSummary> {
  const byPlayer = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const bucket = byPlayer.get(row.playerId) ?? [];
    bucket.push(row);
    byPlayer.set(row.playerId, bucket);
  });

  const summaries = new Map<string, PlayerSummary>();
  byPlayer.forEach((playerRows, playerId) => {
    summaries.set(playerId, {
      position: playerMetaMap.get(playerId)?.position ?? null,
      avgExpectedMinutes: mean(playerRows.map((row) => row.expectedMinutes)),
      avgStarterRate: mean(playerRows.map((row) => row.starterRateLast10)),
      pointsProjection: mean(playerRows.map((row) => row.pointsProjection)),
      reboundsProjection: mean(playerRows.map((row) => row.reboundsProjection)),
      assistProjection: mean(playerRows.map((row) => row.assistProjection)),
      threesProjection: mean(playerRows.map((row) => row.threesProjection)),
    });
  });

  return summaries;
}

function cloneRules(): PrecisionRuleSet {
  return Object.fromEntries(
    Object.entries(DEFAULT_DAILY_6_RULES).map(([market, rule]) => [market, { ...(rule as PrecisionRule) }]),
  ) as PrecisionRuleSet;
}

function applyPreset(
  baseRules: PrecisionRuleSet,
  market: Market,
  preset: PrecisionRule,
): PrecisionRuleSet {
  return {
    ...baseRules,
    [market]: { ...preset },
  };
}

function evaluateRuleSet(
  rows: TrainingRow[],
  summaries: Map<string, PlayerSummary>,
  rules: PrecisionRuleSet,
): EvalResult {
  const qualifiedPicks: QualifiedPick[] = [];
  const byMarket = new Map<Market, { picks: number; correct: number }>();
  const uniqueDates = new Set(rows.map((row) => row.gameDateEt));

  rows.forEach((row) => {
    const summary = summaries.get(row.playerId);
    const signal = buildPrecisionPick(
      {
        market: row.market,
        projectedValue: row.projectedValue,
        line: row.line,
        overPrice: row.overPrice,
        underPrice: row.underPrice,
        finalSide: row.finalSide,
        l5CurrentLineDeltaAvg: row.l5CurrentLineDeltaAvg ?? null,
        l5CurrentLineOverRate: row.l5CurrentLineOverRate ?? null,
        l5MinutesAvg: row.l5MinutesAvg ?? null,
        expectedMinutes: row.expectedMinutes,
        minutesVolatility: row.minutesVolatility,
        benchBigRoleStability: row.benchBigRoleStability ?? null,
        starterRateLast10: row.starterRateLast10,
        archetypeExpectedMinutes: summary?.avgExpectedMinutes ?? null,
        archetypeStarterRateLast10: summary?.avgStarterRate ?? null,
        openingTeamSpread: row.openingTeamSpread,
        openingTotal: row.openingTotal,
        lineupTimingConfidence: row.lineupTimingConfidence,
        completenessScore: row.completenessScore,
        playerPosition: summary?.position ?? null,
        pointsProjection: row.pointsProjection ?? summary?.pointsProjection ?? null,
        reboundsProjection: row.reboundsProjection ?? summary?.reboundsProjection ?? null,
        assistProjection: row.assistProjection ?? summary?.assistProjection ?? null,
        threesProjection: row.threesProjection ?? summary?.threesProjection ?? null,
      },
      rules,
    );

    if (!signal?.qualified || signal.side === "NEUTRAL") return;
    qualifiedPicks.push({ row, signal });
  });

  qualifiedPicks.sort((left, right) => {
    const signalComparison = comparePrecisionSignals(left.signal!, right.signal!);
    if (signalComparison !== 0) return signalComparison;
    if (left.row.gameDateEt !== right.row.gameDateEt) return left.row.gameDateEt.localeCompare(right.row.gameDateEt);
    if (left.row.playerName !== right.row.playerName) return left.row.playerName.localeCompare(right.row.playerName);
    return left.row.market.localeCompare(right.row.market);
  });

  let picks = 0;
  let correct = 0;
  const selectedPlayerDates = new Set<string>();

  qualifiedPicks.forEach(({ row, signal }) => {
    const key = `${row.gameDateEt}:${row.playerId}`;
    if (selectedPlayerDates.has(key)) return;
    selectedPlayerDates.add(key);

    picks += 1;
    const marketBucket = byMarket.get(row.market) ?? { picks: 0, correct: 0 };
    marketBucket.picks += 1;
    if (signal?.side === row.actualSide) {
      correct += 1;
      marketBucket.correct += 1;
    }
    byMarket.set(row.market, marketBucket);
  });

  return {
    picks,
    correct,
    accuracyPct: picks > 0 ? round((correct / picks) * 100, 2) : 0,
    coveragePct: rows.length > 0 ? round((picks / rows.length) * 100, 2) : 0,
    picksPerDay: uniqueDates.size > 0 ? round(picks / uniqueDates.size, 2) : 0,
    byMarket: Object.fromEntries(
      [...byMarket.entries()].map(([market, stats]) => [
        market,
        {
          picks: stats.picks,
          correct: stats.correct,
          accuracyPct: stats.picks > 0 ? round((stats.correct / stats.picks) * 100, 2) : null,
        },
      ]),
    ),
  };
}

function* generateRuleSets(): Generator<{ name: string; rules: PrecisionRuleSet }> {
  const ptsPresets: Array<[string, PrecisionRule]> = [
    ["base", DEFAULT_DAILY_6_RULES.PTS as PrecisionRule],
    [
      "mild",
      {
        ...(DEFAULT_DAILY_6_RULES.PTS as PrecisionRule),
        minBucketLateAccuracy: 60,
        minLeafAccuracy: 80,
        minAbsLineGap: 0.5,
      },
    ],
    [
      "medium",
      {
        ...(DEFAULT_DAILY_6_RULES.PTS as PrecisionRule),
        minBucketLateAccuracy: 58,
        minLeafAccuracy: 76,
        minAbsLineGap: 0.5,
      },
    ],
  ];
  const rebPresets: Array<[string, PrecisionRule]> = [
    ["base", DEFAULT_DAILY_6_RULES.REB as PrecisionRule],
    [
      "mild",
      {
        ...(DEFAULT_DAILY_6_RULES.REB as PrecisionRule),
        minBucketLateAccuracy: 52,
        minLeafAccuracy: 80,
        minAbsLineGap: 0.5,
      },
    ],
  ];
  const astPresets: Array<[string, PrecisionRule]> = [
    ["base", DEFAULT_DAILY_6_RULES.AST as PrecisionRule],
    [
      "mild",
      {
        ...(DEFAULT_DAILY_6_RULES.AST as PrecisionRule),
        minBucketLateAccuracy: 64,
        minLeafAccuracy: 72,
        minAbsLineGap: 0.75,
      },
    ],
  ];
  const threesPresets: Array<[string, PrecisionRule]> = [
    ["base", DEFAULT_DAILY_6_RULES.THREES as PrecisionRule],
    [
      "mild",
      {
        ...(DEFAULT_DAILY_6_RULES.THREES as PrecisionRule),
        minBucketLateAccuracy: 62,
        minLeafAccuracy: 64,
        minAbsLineGap: 0.75,
      },
    ],
    [
      "prob50",
      {
        ...(DEFAULT_DAILY_6_RULES.THREES as PrecisionRule),
        minProjectionWinProbability: 0.5,
      },
    ],
    [
      "prob52",
      {
        ...(DEFAULT_DAILY_6_RULES.THREES as PrecisionRule),
        minProjectionWinProbability: 0.52,
      },
    ],
  ];
  const praPresets: Array<[string, PrecisionRule]> = [
    ["base", DEFAULT_DAILY_6_RULES.PRA as PrecisionRule],
    [
      "mild",
      {
        ...(DEFAULT_DAILY_6_RULES.PRA as PrecisionRule),
        minBucketLateAccuracy: 66,
        minLeafAccuracy: 72,
        minAbsLineGap: 2.5,
      },
    ],
  ];
  const paPresets: Array<[string, PrecisionRule]> = [
    ["base", DEFAULT_DAILY_6_RULES.PA as PrecisionRule],
    [
      "prob50",
      {
        ...(DEFAULT_DAILY_6_RULES.PA as PrecisionRule),
        minProjectionWinProbability: 0.5,
      },
    ],
    [
      "prob52",
      {
        ...(DEFAULT_DAILY_6_RULES.PA as PrecisionRule),
        minProjectionWinProbability: 0.52,
      },
    ],
  ];
  const raPresets: Array<[string, PrecisionRule]> = [
    ["base", DEFAULT_DAILY_6_RULES.RA as PrecisionRule],
    [
      "mild",
      {
        ...(DEFAULT_DAILY_6_RULES.RA as PrecisionRule),
        minBucketLateAccuracy: 52,
        minLeafAccuracy: 72,
        minAbsLineGap: 0.5,
      },
    ],
  ];

  for (const [ptsName, ptsRule] of ptsPresets) {
    for (const [rebName, rebRule] of rebPresets) {
      for (const [astName, astRule] of astPresets) {
        for (const [threesName, threesRule] of threesPresets) {
          for (const [praName, praRule] of praPresets) {
            for (const [paName, paRule] of paPresets) {
              for (const [raName, raRule] of raPresets) {
                let rules = cloneRules();
                rules = applyPreset(rules, "PTS", ptsRule);
                rules = applyPreset(rules, "REB", rebRule);
                rules = applyPreset(rules, "AST", astRule);
                rules = applyPreset(rules, "THREES", threesRule);
                rules = applyPreset(rules, "PRA", praRule);
                rules = applyPreset(rules, "PA", paRule);
                rules = applyPreset(rules, "RA", raRule);
                yield {
                  name: `pts-${ptsName}_reb-${rebName}_ast-${astName}_threes-${threesName}_pra-${praName}_pa-${paName}_ra-${raName}`,
                  rules,
                };
              }
            }
          }
        }
      }
    }
  }
}

async function main(): Promise<void> {
  const input = resolveDefaultInputPath();
  const payload = JSON.parse(await readFile(path.resolve(input), "utf8")) as BacktestRowsFile;
  const rows = attachCurrentLineRecencyMetrics(payload.playerMarketRows.filter((row) => row.actualMinutes >= 15));
  const playerMetaMap = await loadPlayerMetaMap([...new Set(rows.map((row) => row.playerId))]);
  const summaries = summarizeRows(rows, playerMetaMap);

  const results = [...generateRuleSets()].map(({ name, rules }) => ({
    name,
    rules,
    evaluation: evaluateRuleSet(rows, summaries, rules),
  }));

  const sorted = results.sort(
    (left, right) =>
      Number(right.evaluation.picksPerDay >= 6) - Number(left.evaluation.picksPerDay >= 6) ||
      right.evaluation.accuracyPct - left.evaluation.accuracyPct ||
      right.evaluation.picksPerDay - left.evaluation.picksPerDay,
  );

  const output = {
    generatedAt: new Date().toISOString(),
    input,
    totalCandidates: results.length,
    bestMeetingMinSix: sorted.filter((result) => result.evaluation.picksPerDay >= 6).slice(0, 10),
    bestOverall: sorted.slice(0, 10),
  };

  const outPath = path.resolve("exports", "daily6-one-pick-search.json");
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

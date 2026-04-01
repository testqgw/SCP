import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  buildAdaptivePrecisionFloorPick,
  buildPrecision80Pick,
  selectPrecisionCardWithTopOff,
  type PrecisionSlateCandidate,
} from "../lib/snapshot/precisionPickSystem";
import { attachCurrentLineRecencyMetrics } from "../lib/snapshot/currentLineRecency";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { round } from "../lib/utils";

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
  seasonMinutesAvg?: number | null;
  minutesLiftPct?: number | null;
  activeCorePts?: number | null;
  activeCoreAst?: number | null;
  missingCorePts?: number | null;
  missingCoreAst?: number | null;
  missingCoreShare?: number | null;
  stepUpRoleFlag?: number | null;
  sameOpponentDeltaVsSeason?: number | null;
  sameOpponentSample?: number | null;
};

type BacktestRowsFile = {
  from: string;
  to: string;
  playerMarketRows: TrainingRow[];
};

type EnrichedRow = TrainingRow & ReturnType<typeof attachCurrentLineRecencyMetrics<TrainingRow>>[number];

type CandidateRecord = PrecisionSlateCandidate & {
  correct: boolean;
};

const prisma = new PrismaClient();
const MIN_ACTUAL_MINUTES = 15;
const OUTPUT_PATH = path.join(process.cwd(), "exports", "precision-selector-v2-backtest.json");

async function loadPlayerPositions(playerIds: string[]): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const chunkSize = 400;

  for (let index = 0; index < playerIds.length; index += chunkSize) {
    const chunk = playerIds.slice(index, index + chunkSize);
    const players = await prisma.player.findMany({
      where: { id: { in: chunk } },
      select: { id: true, position: true },
    });
    players.forEach((player) => {
      results.set(player.id, player.position ?? null);
    });
  }

  return results;
}

function resolveInputPath(): string {
  try {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  } catch {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
  }
}

async function main(): Promise<void> {
  const inputPath = resolveInputPath();
  const payload = JSON.parse(readFileSync(inputPath, "utf8")) as BacktestRowsFile;
  const enrichedRows = attachCurrentLineRecencyMetrics(
    payload.playerMarketRows.filter((row) => row.actualMinutes >= MIN_ACTUAL_MINUTES),
  ) as EnrichedRow[];
  const playerPositions = await loadPlayerPositions([...new Set(enrichedRows.map((row) => row.playerId))]);

  const byDate = new Map<string, EnrichedRow[]>();
  enrichedRows.forEach((row) => {
    const bucket = byDate.get(row.gameDateEt) ?? [];
    bucket.push(row);
    byDate.set(row.gameDateEt, bucket);
  });

  const dates = [...byDate.keys()].sort((left, right) => left.localeCompare(right));
  const selected: CandidateRecord[] = [];
  const daily: Array<{ date: string; picks: number; correct: number; accuracy: number | null }> = [];

  dates.forEach((date) => {
    const rows = byDate.get(date) ?? [];
    const candidates: CandidateRecord[] = [];
    const adaptiveCandidates: CandidateRecord[] = [];

    rows.forEach((row) => {
      const playerPosition = playerPositions.get(row.playerId) ?? null;
      const input = {
        playerId: row.playerId,
        playerName: row.playerName,
        matchupKey: `${row.gameDateEt}:${row.playerId}`,
        market: row.market,
        projectedValue: row.projectedValue,
        line: row.line,
        overPrice: row.overPrice,
        underPrice: row.underPrice,
        finalSide: row.finalSide,
        l5CurrentLineDeltaAvg: row.l5CurrentLineDeltaAvg ?? null,
        l5CurrentLineOverRate: row.l5CurrentLineOverRate ?? null,
        l5MinutesAvg: row.l5MinutesAvg ?? null,
        l10CurrentLineOverRate: row.l10CurrentLineOverRate ?? null,
        l15CurrentLineOverRate: row.l15CurrentLineOverRate ?? null,
        weightedCurrentLineOverRate: row.weightedCurrentLineOverRate ?? null,
        emaCurrentLineDelta: row.emaCurrentLineDelta ?? null,
        emaCurrentLineOverRate: row.emaCurrentLineOverRate ?? null,
        emaMinutesAvg: row.emaMinutesAvg ?? null,
        l15ValueMean: row.l15ValueMean ?? null,
        l15ValueMedian: row.l15ValueMedian ?? null,
        l15ValueStdDev: row.l15ValueStdDev ?? null,
        l15ValueSkew: row.l15ValueSkew ?? null,
        sameOpponentDeltaVsAnchor: row.sameOpponentDeltaVsSeason ?? null,
        sameOpponentSample: row.sameOpponentSample ?? null,
        sameOpponentMinutesSimilarity: null,
        seasonMinutesAvg: row.seasonMinutesAvg ?? null,
        minutesLiftPct: row.minutesLiftPct ?? null,
        activeCorePts: row.activeCorePts ?? null,
        activeCoreAst: row.activeCoreAst ?? null,
        missingCorePts: row.missingCorePts ?? null,
        missingCoreAst: row.missingCoreAst ?? null,
        missingCoreShare: row.missingCoreShare ?? null,
        stepUpRoleFlag: row.stepUpRoleFlag ?? null,
        expectedMinutes: row.expectedMinutes,
        minutesVolatility: row.minutesVolatility,
        benchBigRoleStability: row.benchBigRoleStability ?? null,
        starterRateLast10: row.starterRateLast10,
        archetypeExpectedMinutes: row.seasonMinutesAvg ?? null,
        archetypeStarterRateLast10: row.starterRateLast10,
        openingTeamSpread: row.openingTeamSpread,
        openingTotal: row.openingTotal,
        lineupTimingConfidence: row.lineupTimingConfidence,
        completenessScore: row.completenessScore,
        playerPosition,
        pointsProjection: row.pointsProjection ?? null,
        reboundsProjection: row.reboundsProjection ?? null,
        assistProjection: row.assistProjection ?? null,
        threesProjection: row.threesProjection ?? null,
      };

      const strictSignal = buildPrecision80Pick(input);
      const strictQualified = strictSignal?.qualified ?? strictSignal?.side !== "NEUTRAL";

      if (strictSignal && strictQualified) {
        candidates.push({
          playerId: row.playerId,
          playerName: row.playerName,
          matchupKey: `${row.gameDateEt}:${row.playerId}`,
          market: row.market,
          signal: strictSignal,
          selectionScore: strictSignal.selectionScore ?? 0,
          source: "PRECISION",
          correct: row.actualSide === strictSignal.side,
        });
        return;
      }

      const adaptiveSignal = buildAdaptivePrecisionFloorPick(input);
      const adaptiveQualified = adaptiveSignal?.qualified ?? adaptiveSignal?.side !== "NEUTRAL";
      if (!adaptiveSignal || !adaptiveQualified) return;
      adaptiveCandidates.push({
        playerId: row.playerId,
        playerName: row.playerName,
        matchupKey: `${row.gameDateEt}:${row.playerId}`,
        market: row.market,
        signal: adaptiveSignal,
        selectionScore: adaptiveSignal.selectionScore ?? 0,
        source: "PRECISION",
        correct: row.actualSide === adaptiveSignal.side,
      });
    });

    const daySelections = selectPrecisionCardWithTopOff(candidates, adaptiveCandidates);
    const resolvedSelections = daySelections.flatMap((pick) => {
      const found = [...candidates, ...adaptiveCandidates].find(
        (candidate) => candidate.playerId === pick.playerId && candidate.market === pick.market,
      );
      return found ? [found] : [];
    });

    selected.push(...resolvedSelections);
    const correct = resolvedSelections.filter((entry) => entry.correct).length;
    daily.push({
      date,
      picks: resolvedSelections.length,
      correct,
      accuracy: resolvedSelections.length > 0 ? round((correct / resolvedSelections.length) * 100, 2) : null,
    });
  });

  const totalPicks = selected.length;
  const totalCorrect = selected.filter((entry) => entry.correct).length;
  const overallAccuracy = totalPicks > 0 ? round((totalCorrect / totalPicks) * 100, 2) : null;
  const picksPerDay = dates.length > 0 ? round(totalPicks / dates.length, 2) : 0;
  const bySource = {
    PRECISION: selected.filter((entry) => entry.source === "PRECISION").length,
  };
  const byMarket = Object.fromEntries(
    (["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"] as const)
      .map((market) => {
        const picks = selected.filter((entry) => entry.market === market);
        if (picks.length === 0) return null;
        const correct = picks.filter((entry) => entry.correct).length;
        return [
          market,
          {
            picks: picks.length,
            correct,
            accuracyPct: round((correct / picks.length) * 100, 2),
          },
        ] as const;
      })
      .filter((entry): entry is readonly [Market, { picks: number; correct: number; accuracyPct: number }] => entry !== null),
  );
  const recent14 = daily.slice(-14);
  const recent30 = daily.slice(-30);
  const summarizeWindow = (window: typeof daily) => {
    const picks = window.reduce((sum, day) => sum + day.picks, 0);
    const correct = window.reduce((sum, day) => sum + day.correct, 0);
    return {
      days: window.length,
      picks,
      correct,
      accuracyPct: picks > 0 ? round((correct / picks) * 100, 2) : null,
      picksPerDay: window.length > 0 ? round(picks / window.length, 2) : 0,
    };
  };

  const output = {
    generatedAt: new Date().toISOString(),
    inputPath,
    summary: {
      totalPicks,
      totalCorrect,
      overallAccuracy,
      picksPerDay,
      bySource,
      byMarket,
      last14: summarizeWindow(recent14),
      last30: summarizeWindow(recent30),
    },
    daily,
  };

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
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

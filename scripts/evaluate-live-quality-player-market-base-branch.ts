import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeLivePlayerOverrideKey } from "../lib/snapshot/livePlayerSideModels";
import {
  applyPromotedLivePraRawFeatureRows,
  buildFileSignature,
  buildLiveQualityRuntimeSnapshot,
  buildLiveQualityRowKey,
  disconnectLiveQualityBoardEvalPrisma,
  evaluateRows,
  filterAndAttachRows,
  loadLiveQualityQualificationSettings,
  loadRowsPayload,
  summarizeEvaluatedRows,
  summarizePlayers,
  type LiveQualityEvaluatedRow,
  type LiveQualityEvalSummary,
  type LiveQualityTrainingRow,
} from "./utils/liveQualityBoardEval";

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";

type Args = {
  input: string | null;
  models: string;
  out: string;
  minActualMinutes: number;
};

type FeatureName =
  | "lineGap"
  | "absLineGap"
  | "expectedMinutes"
  | "minutesVolatility"
  | "starterRateLast10"
  | "priceLean"
  | "priceAbsLean"
  | "line"
  | "projectedValue"
  | "favoredOver"
  | "overPrice"
  | "underPrice"
  | "overProbability"
  | "underProbability";

type LeafNode = {
  kind: "leaf";
  side: Side;
};

type SplitNode = {
  kind: "split";
  feature: FeatureName;
  threshold: number;
  left: TreeNode;
  right: TreeNode;
};

type TreeNode = LeafNode | SplitNode;

type ModelVariant =
  | { kind: "constant"; side: Side }
  | { kind: "projection" }
  | { kind: "finalOverride" }
  | { kind: "marketFavored" }
  | { kind: "gapThenProjection"; threshold: number }
  | { kind: "gapThenMarket"; threshold: number }
  | { kind: "tree"; tree: TreeNode; maxDepth: number; minLeaf: number };

type PlayerMarketModelRecord = {
  playerId: string;
  playerName: string;
  market: Market;
  samples: number;
  projectionBaselineAccuracy: number;
  finalBaselineAccuracy: number;
  modelAccuracy: number;
  holdoutAccuracy: number | null;
  targetHit: boolean;
  model: ModelVariant;
};

type PlayerMarketModelFile = {
  input?: string;
  from?: string;
  to?: string;
  modelCount?: number;
  playersRepresented?: number;
  playerMarketModels?: PlayerMarketModelRecord[];
};

type PlayerModelRow = {
  projectedValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  projectionSide: Side;
  finalSide: Side;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  lineGap: number;
  absLineGap: number;
};

type CandidateSpec = {
  label: string;
  overrideMode: "additive" | "replace";
  scopeMarkets: Set<Market>;
  minSamples: number;
  minHoldoutAccuracy: number;
  minEdgeVsProjection: number;
  minEdgeVsFinal: number;
};

type ApprovedModel = PlayerMarketModelRecord & {
  playerKey: string;
};

type CandidateResult = {
  label: string;
  overrideMode: CandidateSpec["overrideMode"];
  approvedModelCount: number;
  approvedPlayers: number;
  walkForward: LiveQualityEvalSummary["overall"];
  forward14d: LiveQualityEvalSummary["overall"];
  forward30d: LiveQualityEvalSummary["overall"];
  byMarketWalkForward: LiveQualityEvalSummary["byMarket"];
  changedRowsVsControl: {
    walkForwardRaw: number;
    walkForwardFinal: number;
    forward14dRaw: number;
    forward14dFinal: number;
    forward30dRaw: number;
    forward30dFinal: number;
  };
  netRowsVsControl: {
    walkForwardRaw: number;
    walkForwardFinal: number;
    forward14dRaw: number;
    forward14dFinal: number;
    forward30dRaw: number;
    forward30dFinal: number;
  };
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input: string | null = "exports/projection-backtest-allplayers-with-rows-runtime-context.json";
  let models = "exports/player-market-side-models-runtime-context-2025-10-23-to-2026-03-28.json";
  let out = path.join("exports", "live-quality-player-market-base-branch-summary.json");
  let minActualMinutes = 15;

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
    if ((token === "--models" || token === "-m") && next) {
      models = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--models=")) {
      models = token.slice("--models=".length);
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
    if (token === "--min-actual-minutes" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--min-actual-minutes=")) {
      const parsed = Number(token.slice("--min-actual-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      continue;
    }
  }

  return {
    input,
    models: path.resolve(models),
    out: path.resolve(out),
    minActualMinutes,
  };
}

function impliedProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function getFeature(row: PlayerModelRow, feature: FeatureName): number | null {
  switch (feature) {
    case "lineGap":
      return row.lineGap;
    case "absLineGap":
      return row.absLineGap;
    case "expectedMinutes":
      return row.expectedMinutes;
    case "minutesVolatility":
      return row.minutesVolatility;
    case "starterRateLast10":
      return row.starterRateLast10;
    case "priceLean":
      return row.priceLean;
    case "priceAbsLean":
      return row.priceLean == null ? null : Math.abs(row.priceLean);
    case "line":
      return row.line;
    case "projectedValue":
      return row.projectedValue;
    case "favoredOver":
      return row.favoredSide === "OVER" ? 1 : row.favoredSide === "UNDER" ? -1 : 0;
    case "overPrice":
      return row.overPrice;
    case "underPrice":
      return row.underPrice;
    case "overProbability":
      return impliedProbability(row.overPrice);
    case "underProbability":
      return impliedProbability(row.underPrice);
    default:
      return null;
  }
}

function predictTree(node: TreeNode, row: PlayerModelRow): Side {
  if (node.kind === "leaf") return node.side;
  const value = getFeature(row, node.feature);
  if (value == null) {
    return node.left.kind === "leaf" ? node.left.side : predictTree(node.left, row);
  }
  return value <= node.threshold ? predictTree(node.left, row) : predictTree(node.right, row);
}

function predictVariant(model: ModelVariant, row: PlayerModelRow): Side {
  switch (model.kind) {
    case "constant":
      return model.side;
    case "projection":
      return row.projectionSide;
    case "finalOverride":
      return row.finalSide;
    case "marketFavored":
      return row.favoredSide === "NEUTRAL" ? row.projectionSide : row.favoredSide;
    case "gapThenProjection":
      return row.absLineGap >= model.threshold
        ? row.projectionSide
        : row.favoredSide === "NEUTRAL"
          ? row.projectionSide
          : row.favoredSide;
    case "gapThenMarket":
      return row.absLineGap >= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.projectionSide
          : row.favoredSide
        : row.projectionSide;
    case "tree":
      return predictTree(model.tree, row);
    default:
      return row.projectionSide;
  }
}

function summarizeRows(rows: LiveQualityEvaluatedRow[], dateSet: Set<string>): LiveQualityEvalSummary {
  return summarizeEvaluatedRows(rows.filter((row) => dateSet.has(row.gameDateEt)));
}

function countChangedRows(
  controlRows: LiveQualityEvaluatedRow[],
  candidateRows: LiveQualityEvaluatedRow[],
  dateSet: Set<string>,
): { raw: number; final: number; netRaw: number; netFinal: number } {
  let raw = 0;
  let final = 0;
  let netRaw = 0;
  let netFinal = 0;
  const controlMap = new Map(controlRows.filter((row) => dateSet.has(row.gameDateEt)).map((row) => [row.rowKey, row]));
  candidateRows
    .filter((row) => dateSet.has(row.gameDateEt))
    .forEach((row) => {
      const control = controlMap.get(row.rowKey);
      if (!control) return;
      if (row.rawSide !== control.rawSide) {
        raw += 1;
        if (row.rawCorrect && !control.rawCorrect) netRaw += 1;
        else if (!row.rawCorrect && control.rawCorrect) netRaw -= 1;
      }
      if (row.finalSide !== control.finalSide) {
        final += 1;
        if (row.finalCorrect && !control.finalCorrect) netFinal += 1;
        else if (!row.finalCorrect && control.finalCorrect) netFinal -= 1;
      }
    });
  return { raw, final, netRaw, netFinal };
}

function buildApprovedModelMap(
  payload: PlayerMarketModelFile,
  candidate: CandidateSpec,
): Map<string, ApprovedModel> {
  const approved = new Map<string, ApprovedModel>();
  for (const model of payload.playerMarketModels ?? []) {
    if (!candidate.scopeMarkets.has(model.market)) continue;
    if (model.samples < candidate.minSamples) continue;
    if (model.holdoutAccuracy == null || model.holdoutAccuracy < candidate.minHoldoutAccuracy) continue;
    if (model.holdoutAccuracy < model.projectionBaselineAccuracy + candidate.minEdgeVsProjection) continue;
    if (model.holdoutAccuracy < model.finalBaselineAccuracy + candidate.minEdgeVsFinal) continue;
    const playerKey = normalizeLivePlayerOverrideKey(model.playerName);
    if (!playerKey) continue;
    approved.set(`${playerKey}|${model.market}`, { ...model, playerKey });
  }
  return approved;
}

function buildCandidateRows(
  controlRows: LiveQualityEvaluatedRow[],
  baseRowMap: Map<string, LiveQualityTrainingRow>,
  approvedModels: Map<string, ApprovedModel>,
  candidate: CandidateSpec,
): LiveQualityEvaluatedRow[] {
  return controlRows.map((row) => {
    if (candidate.overrideMode === "additive" && row.playerOverrideEngaged) {
      return row;
    }
    const approvedModel = approvedModels.get(`${row.normalizedPlayerKey}|${row.market}`);
    if (!approvedModel) return row;
    const baseRow = baseRowMap.get(row.rowKey);
    if (!baseRow) return row;
    const modelRow: PlayerModelRow = {
      projectedValue: baseRow.projectedValue,
      line: baseRow.line,
      overPrice: baseRow.overPrice,
      underPrice: baseRow.underPrice,
      projectionSide: baseRow.projectionSide,
      finalSide:
        row.liveDecision.side === "OVER" || row.liveDecision.side === "UNDER" ? row.liveDecision.side : row.baselineSide,
      priceLean: baseRow.priceLean,
      favoredSide: baseRow.favoredSide,
      expectedMinutes: baseRow.expectedMinutes,
      minutesVolatility: baseRow.minutesVolatility,
      starterRateLast10: baseRow.starterRateLast10,
      lineGap: baseRow.lineGap,
      absLineGap: baseRow.absLineGap,
    };
    const candidateSide = predictVariant(approvedModel.model, modelRow);
    if (candidateSide !== "OVER" && candidateSide !== "UNDER") return row;
    if (candidateSide === row.finalSide && candidateSide === row.rawSide) return row;
    return {
      ...row,
      rawSide: candidateSide,
      strictRawSide: candidateSide,
      finalSide: candidateSide,
      rawSource: "player_override",
      strictRawSource: "player_override",
      finalSource: "player_override",
      rawCorrect: candidateSide === row.actualSide,
      strictRawCorrect: candidateSide === row.actualSide,
      finalCorrect: candidateSide === row.actualSide,
      overrideEngaged: true,
      playerOverrideEngaged: true,
      playerOverrideSide: candidateSide,
    };
  });
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = await loadRowsPayload(args.input);
  const rows = filterAndAttachRows(payload.playerMarketRows, args.minActualMinutes);
  const playerSummaries = await summarizePlayers(rows);
  const qualification = await loadLiveQualityQualificationSettings();
  const baseRows = evaluateRows(rows, playerSummaries, qualification.settings);
  const liveRows = applyPromotedLivePraRawFeatureRows(rows, baseRows);
  const rowsByKey = new Map(rows.map((row) => [buildLiveQualityRowKey(row), row]));

  const dates = [...new Set(rows.map((row) => row.gameDateEt))].sort((left, right) => left.localeCompare(right));
  const latestDate = dates[dates.length - 1] ?? "";
  const walkForwardDateSet = new Set<string>();
  const minTrainDates = 56;
  const testDates = 14;
  for (let trainDateCount = minTrainDates; trainDateCount < dates.length; trainDateCount += testDates) {
    dates.slice(trainDateCount, trainDateCount + testDates).forEach((date) => walkForwardDateSet.add(date));
  }
  const forward14dStart = (() => {
    const date = new Date(`${latestDate}T12:00:00-05:00`);
    date.setUTCDate(date.getUTCDate() - 13);
    return date.toISOString().slice(0, 10);
  })();
  const forward30dStart = (() => {
    const date = new Date(`${latestDate}T12:00:00-05:00`);
    date.setUTCDate(date.getUTCDate() - 29);
    return date.toISOString().slice(0, 10);
  })();
  const forward14dDateSet = new Set(dates.filter((date) => date >= forward14dStart));
  const forward30dDateSet = new Set(dates.filter((date) => date >= forward30dStart));

  const modelPayload = JSON.parse(await readFile(args.models, "utf8")) as PlayerMarketModelFile;
  const allMarkets = new Set<Market>(["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"]);
  const headroomMarkets = new Set<Market>(["PTS", "REB", "PR", "PRA", "RA"]);
  const candidates: CandidateSpec[] = [
    {
      label: "player_market_additive_balanced_v1",
      overrideMode: "additive",
      scopeMarkets: allMarkets,
      minSamples: 20,
      minHoldoutAccuracy: 58,
      minEdgeVsProjection: 3,
      minEdgeVsFinal: 3,
    },
    {
      label: "player_market_additive_tight_v1",
      overrideMode: "additive",
      scopeMarkets: allMarkets,
      minSamples: 28,
      minHoldoutAccuracy: 60,
      minEdgeVsProjection: 4,
      minEdgeVsFinal: 4,
    },
    {
      label: "player_market_replace_headroom_tight_v1",
      overrideMode: "replace",
      scopeMarkets: headroomMarkets,
      minSamples: 24,
      minHoldoutAccuracy: 60,
      minEdgeVsProjection: 4,
      minEdgeVsFinal: 4,
    },
  ];

  const controlWalkForward = summarizeRows(liveRows, walkForwardDateSet).overall;
  const controlForward14d = summarizeRows(liveRows, forward14dDateSet).overall;
  const controlForward30d = summarizeRows(liveRows, forward30dDateSet).overall;

  const results: CandidateResult[] = candidates.map((candidate) => {
    const approvedModels = buildApprovedModelMap(modelPayload, candidate);
    const candidateRows = buildCandidateRows(liveRows, rowsByKey, approvedModels, candidate);
    const walkForward = summarizeRows(candidateRows, walkForwardDateSet);
    const forward14d = summarizeRows(candidateRows, forward14dDateSet);
    const forward30d = summarizeRows(candidateRows, forward30dDateSet);
    const walkForwardChanges = countChangedRows(liveRows, candidateRows, walkForwardDateSet);
    const forward14dChanges = countChangedRows(liveRows, candidateRows, forward14dDateSet);
    const forward30dChanges = countChangedRows(liveRows, candidateRows, forward30dDateSet);
    return {
      label: candidate.label,
      overrideMode: candidate.overrideMode,
      approvedModelCount: approvedModels.size,
      approvedPlayers: new Set(Array.from(approvedModels.values()).map((model) => model.playerKey)).size,
      walkForward: walkForward.overall,
      forward14d: forward14d.overall,
      forward30d: forward30d.overall,
      byMarketWalkForward: walkForward.byMarket,
      changedRowsVsControl: {
        walkForwardRaw: walkForwardChanges.raw,
        walkForwardFinal: walkForwardChanges.final,
        forward14dRaw: forward14dChanges.raw,
        forward14dFinal: forward14dChanges.final,
        forward30dRaw: forward30dChanges.raw,
        forward30dFinal: forward30dChanges.final,
      },
      netRowsVsControl: {
        walkForwardRaw: walkForwardChanges.netRaw,
        walkForwardFinal: walkForwardChanges.netFinal,
        forward14dRaw: forward14dChanges.netRaw,
        forward14dFinal: forward14dChanges.netFinal,
        forward30dRaw: forward30dChanges.netRaw,
        forward30dFinal: forward30dChanges.netFinal,
      },
    };
  });

  const bestCandidate =
    results
      .slice()
      .sort((left, right) => {
        if (right.walkForward.rawAccuracy !== left.walkForward.rawAccuracy) {
          return right.walkForward.rawAccuracy - left.walkForward.rawAccuracy;
        }
        if (right.forward30d.rawAccuracy !== left.forward30d.rawAccuracy) {
          return right.forward30d.rawAccuracy - left.forward30d.rawAccuracy;
        }
        return right.walkForward.blendedAccuracy - left.walkForward.blendedAccuracy;
      })[0] ?? null;

  const summary = {
    generatedAt: new Date().toISOString(),
    branch: "live_quality_player_market_base_branch_v1",
    input: path.resolve(args.input ?? ""),
    modelsFile: args.models,
    runtime: {
      ...buildLiveQualityRuntimeSnapshot({
        input: args.input,
        label: "live_quality_player_market_base_branch_v1",
        qualificationSettingsFile: qualification.sourceFile,
      }),
      modelsFile: args.models,
      modelsFileSignature: buildFileSignature(args.models),
    },
    trainedModelWindow: {
      from: modelPayload.from ?? null,
      to: modelPayload.to ?? null,
      modelCount: modelPayload.modelCount ?? (modelPayload.playerMarketModels ?? []).length,
      playersRepresented: modelPayload.playersRepresented ?? null,
    },
    control: {
      walkForward: controlWalkForward,
      forward14d: controlForward14d,
      forward30d: controlForward30d,
    },
    candidates: results,
    bestCandidate:
      bestCandidate == null
        ? null
        : {
            label: bestCandidate.label,
            walkForward: bestCandidate.walkForward,
            forward14d: bestCandidate.forward14d,
            forward30d: bestCandidate.forward30d,
            beatsControlWalkForwardRaw: bestCandidate.walkForward.rawAccuracy > controlWalkForward.rawAccuracy,
            beatsControlForward30dRaw: bestCandidate.forward30d.rawAccuracy > controlForward30d.rawAccuracy,
            beatsControlWalkForwardBlended: bestCandidate.walkForward.blendedAccuracy > controlWalkForward.blendedAccuracy,
            beatsControlWalkForwardCoverage: bestCandidate.walkForward.coveragePct > controlWalkForward.coveragePct,
          },
  };

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        out: args.out,
        control: {
          walkForwardRaw: controlWalkForward.rawAccuracy,
          forward14dRaw: controlForward14d.rawAccuracy,
          forward30dRaw: controlForward30d.rawAccuracy,
        },
        bestCandidate:
          bestCandidate == null
            ? null
            : {
                label: bestCandidate.label,
                walkForwardRaw: bestCandidate.walkForward.rawAccuracy,
                forward14dRaw: bestCandidate.forward14d.rawAccuracy,
                forward30dRaw: bestCandidate.forward30d.rawAccuracy,
                approvedModelCount: bestCandidate.approvedModelCount,
                approvedPlayers: bestCandidate.approvedPlayers,
              },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectLiveQualityBoardEvalPrisma();
  });

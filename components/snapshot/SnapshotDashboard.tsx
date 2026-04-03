"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatIsoToEtTime, getTodayEtDateString } from "@/lib/snapshot/time";
import type {
  SnapshotBoardData,
  SnapshotMarket,
  SnapshotModelSide,
  SnapshotPlayerBacktestReport,
  SnapshotPlayerLookupData,
  SnapshotPrecisionPickSignal,
  SnapshotPtsConfidenceTier,
  SnapshotPtsSignal,
  SnapshotRow,
} from "@/lib/types/snapshot";

type MarketFilter = SnapshotMarket | "ALL";

type SnapshotDashboardProps = {
  data: SnapshotBoardData;
  initialMarket: MarketFilter;
  initialMatchup: string;
  initialPlayerSearch: string;
};

type SnapshotBoardApiResponse = {
  ok?: boolean;
  result?: SnapshotBoardData;
  error?: string;
};

type SnapshotRefreshApiResponse = {
  result?: { status?: string; warnings?: string[] };
  error?: string;
};

type BoardLoadOptions = {
  bustCache?: boolean;
  background?: boolean;
};

type VisitRefreshOptions = {
  lastUpdatedAt?: string | null;
  minIntervalMs?: number;
};

type RefreshBoardForVisit = (targetDate: string, options?: VisitRefreshOptions) => void;

const AUTO_REFRESH_STALE_AFTER_MS = 900_000; // 15 minutes
const AUTO_REFRESH_ATTEMPT_COOLDOWN_MS = 30_000;
const VISIT_REFRESH_FOLLOW_UP_LOAD_MS = 5_000;
const MANUAL_REFRESH_MODE = "DELTA";
const MANUAL_FAST_REFRESH_WINDOW_MS = 20 * 60_000;

const MARKET_OPTIONS: Array<{ value: SnapshotMarket; label: string }> = [
  { value: "PTS", label: "Points (PTS)" },
  { value: "REB", label: "Rebounds (REB)" },
  { value: "AST", label: "Assists (AST)" },
  { value: "THREES", label: "3PT Made (THREES)" },
  { value: "PRA", label: "PRA" },
  { value: "PA", label: "PA" },
  { value: "PR", label: "PR" },
  { value: "RA", label: "RA" },
];

const MARKET_FILTER_OPTIONS: Array<{ value: MarketFilter; label: string }> = [
  { value: "ALL", label: "All Markets" },
  ...MARKET_OPTIONS,
];

const DAILY_CARD_TARGET_COUNT = 6;
const STRONG_PROJECTION_THRESHOLDS: Partial<Record<SnapshotMarket, number>> = {
  PTS: 5,
  REB: 2,
  AST: 2,
  THREES: 1,
};
const STRONG_PROJECTION_MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES"];
type ManualRefreshMode = "FAST" | typeof MANUAL_REFRESH_MODE;
type BoardRefreshSource = "manual" | "visit";

type DetailSectionKey = "context" | "intel" | "backtest" | "markets" | "logs" | "summary" | "team";

type DetailSectionMeta = {
  key: DetailSectionKey;
  id: string;
  title: string;
};

type ResearchTabKey = "trends" | "splits" | "matchup" | "recent" | "notes";

type ResearchTabMeta = {
  key: ResearchTabKey;
  label: string;
  description: string;
};

const DETAIL_SECTIONS: DetailSectionMeta[] = [
  { key: "context", id: "detail-context", title: "Player Context" },
  { key: "intel", id: "detail-intel", title: "Game Intelligence" },
  { key: "backtest", id: "detail-backtest", title: "PTS Backtest" },
  { key: "markets", id: "detail-markets", title: "All Markets Detail" },
  { key: "logs", id: "detail-logs", title: "Last 10 Completed Games" },
  { key: "summary", id: "detail-summary", title: "Quick Read" },
  { key: "team", id: "detail-team", title: "Team Context" },
];

const RESEARCH_TABS: ResearchTabMeta[] = [
  { key: "trends", label: "Trends", description: "System-level benchmarks and board coverage." },
  { key: "splits", label: "Splits", description: "How the slate is distributing by market and edge." },
  { key: "matchup", label: "Matchup", description: "Where tonight's game environments stand out." },
  { key: "recent", label: "Recent Form", description: "Current card and projection pockets worth reviewing." },
  { key: "notes", label: "Notes", description: "Product guidance and operator notes for the slate." },
];

function refreshStartMessage(source: BoardRefreshSource, manualRefreshMode: ManualRefreshMode | null): string {
  if (source === "visit") {
    return "Loading the freshest live board for this visit...";
  }
  return manualRefreshMode === "FAST"
    ? "Fast refresh started. Updating lineups and rebuilding the board with the newest live lines."
    : "Full refresh started. The page stays usable while the newest board finishes loading.";
}

function alreadyRunningRefreshMessage(refreshMode: ManualRefreshMode): string {
  return refreshMode === "FAST"
    ? "A fast refresh is already running. Loading the newest board shortly."
    : "Refresh is already running. Loading the newest board shortly.";
}

function recentlyCompletedRefreshMessage(refreshMode: ManualRefreshMode): string {
  return refreshMode === "FAST"
    ? "This slate was refreshed recently. Loading the latest live board."
    : "This slate was refreshed recently. Loading the latest board.";
}

function completedRefreshMessage(refreshMode: ManualRefreshMode, status: string | undefined): string {
  return refreshMode === "FAST"
    ? `Fast refresh complete (${status ?? "SUCCESS"}). Loading the latest live board...`
    : `Refresh complete (${status ?? "SUCCESS"}). Loading the latest board...`;
}

function defaultCollapsedSections(compact = false): Record<DetailSectionKey, boolean> {
  return {
    context: false,
    intel: compact,
    backtest: compact,
    markets: false,
    logs: compact,
    summary: compact,
    team: compact,
  };
}

function formatStat(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatAverage(value: number | null, withSign = false): string {
  if (value == null) return "-";
  const text = formatStat(value);
  return withSign && value > 0 ? `+${text}` : text;
}

function parseLine(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function modelSideClass(side: "OVER" | "UNDER" | "NEUTRAL"): string {
  if (side === "OVER") return "bg-emerald-500/15 text-emerald-200";
  if (side === "UNDER") return "bg-amber-500/15 text-amber-200";
  return "bg-slate-500/20 text-slate-200";
}

function ptsFilterClass(qualified: boolean): string {
  return qualified ? "bg-emerald-500/15 text-emerald-200" : "bg-rose-500/15 text-rose-200";
}

function cardStatusLabel(qualified: boolean): string {
  return qualified ? "PRECISION READY" : "RAW ONLY";
}

function ptsConfidenceClass(tier: "HIGH" | "MEDIUM" | "LOW" | null): string {
  if (tier === "HIGH") return "bg-emerald-500/15 text-emerald-200";
  if (tier === "MEDIUM") return "bg-amber-500/15 text-amber-200";
  return "bg-slate-500/20 text-slate-200";
}

function liveSignalForMarket(row: SnapshotRow, market: SnapshotMarket) {
  if (market === "PTS") return row.ptsSignal;
  if (market === "REB") return row.rebSignal;
  if (market === "AST") return row.astSignal;
  if (market === "THREES") return row.threesSignal;
  if (market === "PRA") return row.praSignal;
  if (market === "PA") return row.paSignal;
  if (market === "PR") return row.prSignal;
  if (market === "RA") return row.raSignal;
  return null;
}

function signalLabelForMarket(market: SnapshotMarket): string {
  return market === "THREES" ? "3PM" : market;
}

function precisionSignalForMarket(row: SnapshotRow, market: SnapshotMarket): SnapshotPrecisionPickSignal | null {
  return row.precisionSignals?.[market] ?? null;
}

type HitChanceMetric = "HIT_CHANCE" | "CONFIDENCE_SCORE";

type HitChanceDisplay = {
  value: number | null;
  subtitle: string | null;
  label: string;
  metric: HitChanceMetric;
};

const EMPTY_HIT_CHANCE: HitChanceDisplay = {
  value: null,
  subtitle: null,
  label: "Hit Chance",
  metric: "HIT_CHANCE",
};

function formatHitChanceDisplay(display: HitChanceDisplay): string {
  if (display.value == null) return "-";
  return display.metric === "CONFIDENCE_SCORE" ? formatStat(display.value) : formatChanceValue(display.value);
}

function resolvePrecisionHitChance(signal: SnapshotPrecisionPickSignal | null | undefined): HitChanceDisplay {
  if (!signal) {
    return EMPTY_HIT_CHANCE;
  }

  if (signal.projectionWinProbability != null) {
    return {
      value: roundNumber(signal.projectionWinProbability * 100, 1),
      subtitle: "Best available game hit chance for tonight's line.",
      label: "Hit Chance",
      metric: "HIT_CHANCE",
    };
  }

  return {
    value: signal.historicalAccuracy,
    subtitle: "Best available hit estimate from the precision replay.",
    label: "Hit Chance",
    metric: "HIT_CHANCE",
  };
}

function resolveMarketHitChance(
  row: SnapshotRow,
  market: SnapshotMarket,
  display: MarketSignalDisplay | null,
): HitChanceDisplay {
  const precisionSignal = precisionSignalForMarket(row, market);
  const canUsePrecisionChance =
    precisionSignal?.qualified === true &&
    precisionSignal.side !== "NEUTRAL" &&
    display?.lineOrigin === "LIVE" &&
    display.line != null;
  const precisionChance = canUsePrecisionChance ? resolvePrecisionHitChance(precisionSignal) : EMPTY_HIT_CHANCE;
  if (precisionChance.value != null) {
    return precisionChance;
  }

  if (display?.confidence != null && display.lineOrigin === "LIVE" && display.line != null) {
    return {
      value: display.confidence,
      subtitle: "Live model confidence score for the current sportsbook line.",
      label: "Live Score",
      metric: "CONFIDENCE_SCORE",
    };
  }

  return EMPTY_HIT_CHANCE;
}

function isUnavailableForDailyCard(row: SnapshotRow): boolean {
  const availabilityStatus = row.playerContext.availabilityStatus;
  if (availabilityStatus === "OUT" || availabilityStatus === "DOUBTFUL") return true;
  if (availabilityStatus === "QUESTIONABLE" && (row.playerContext.availabilityPercentPlay ?? 100) <= 55) return true;
  return false;
}

function hasBoardSnapshotData(data: SnapshotBoardData): boolean {
  return (
    data.lastUpdatedAt !== null ||
    data.matchups.length > 0 ||
    data.teamMatchups.length > 0 ||
    data.rows.length > 0 ||
    Boolean(data.precisionSystem)
  );
}

function isPrecisionCardUnderfilled(data: SnapshotBoardData): boolean {
  const hasSlateGames = data.matchups.length > 0 || data.teamMatchups.length > 0 || data.rows.length > 0;
  if (!hasSlateGames) return false;
  const targetCardCount = data.precisionSystem?.targetCardCount ?? DAILY_CARD_TARGET_COUNT;
  if (targetCardCount <= 0) return false;
  const selectedCount = data.precisionCardSummary?.selectedCount ?? data.precisionCard?.length ?? 0;
  return selectedCount < targetCardCount;
}

function shouldAutoRefreshBoard(targetDate: string, lastUpdatedAt: string | null): boolean {
  if (targetDate !== getTodayEtDateString(new Date())) return false;
  if (!lastUpdatedAt) return true;

  const lastUpdatedMs = Date.parse(lastUpdatedAt);
  if (!Number.isFinite(lastUpdatedMs)) return true;
  return Date.now() - lastUpdatedMs >= AUTO_REFRESH_STALE_AFTER_MS;
}

function wasBoardUpdatedRecently(lastUpdatedAt: string | null, maxAgeMs = MANUAL_FAST_REFRESH_WINDOW_MS): boolean {
  if (!lastUpdatedAt) return false;
  const lastUpdatedMs = Date.parse(lastUpdatedAt);
  if (!Number.isFinite(lastUpdatedMs)) return false;
  return Date.now() - lastUpdatedMs <= maxAgeMs;
}

type MarketSignalDisplay = {
  statusText: string;
  statusClass: string;
  side: SnapshotModelSide;
  baselineSide: SnapshotModelSide;
  hasOverrideConflict: boolean;
  confidence: number | null;
  confidenceTier: SnapshotPtsConfidenceTier | null;
  projectionGap: number | null;
  minutesRisk: number | null;
  line: number | null;
  lineOrigin: "LIVE" | "MODEL" | null;
  sportsbookCount: number | null;
};

type MarketRecommendationView = {
  display: MarketSignalDisplay | null;
  precision: SnapshotPrecisionPickSignal | null;
  finalSide: SnapshotModelSide;
  marketLine: number | null;
  marketLineLabel: string;
  hitChance: HitChanceDisplay;
  note: string | null;
};

type MarketRecommendationSource = "CUSTOM" | "PRECISION" | "LIVE_MODEL" | "MODEL_FALLBACK" | "UNAVAILABLE";

type FocusTier = "TOP" | "STRONG" | "WATCH" | "DEEP";

type FocusCandidate = {
  row: SnapshotRow;
  market: SnapshotMarket;
  display: MarketSignalDisplay | null;
  signal: SnapshotPtsSignal | null;
  currentLine: number | null;
  currentLineLabel: string;
  modelLine: SnapshotRow["modelLines"][SnapshotMarket];
  focusScore: number;
  focusTier: FocusTier;
  signalQualified: boolean;
  supportText: string;
  reasons: string[];
};

type DailyCardSource = "PRECISION";

type DailyCardCandidate = {
  candidate: FocusCandidate;
  precision: SnapshotPrecisionPickSignal | null;
  source: DailyCardSource;
};

const DAILY_CARD_SOURCE_META: Record<DailyCardSource, { label: string; className: string }> = {
  PRECISION: {
    label: "Precision Model",
    className: "border-teal-300/35 bg-teal-500/12 text-teal-100",
  },
};

function dailyCardSourceLabel(source: DailyCardSource): string {
  return DAILY_CARD_SOURCE_META[source].label;
}

function dailyCardSourceClass(source: DailyCardSource): string {
  return DAILY_CARD_SOURCE_META[source].className;
}

function resolveMarketSignalLineContext(
  signal: SnapshotPtsSignal | null,
  modelLine: SnapshotRow["modelLines"][SnapshotMarket],
): {
  usingModelFallback: boolean;
  line: number | null;
  projectionGap: number | null;
} {
  const usingModelFallback = (signal?.marketLine ?? null) == null && modelLine.fairLine != null;
  return {
    usingModelFallback,
    line: usingModelFallback ? modelLine.fairLine : signal?.marketLine ?? null,
    projectionGap: usingModelFallback ? modelLine.projectionGap : signal?.projectionGap ?? null,
  };
}

function hasLiveOverrideConflict(signal: SnapshotPtsSignal | null, usingModelFallback: boolean): boolean {
  return (
    !usingModelFallback &&
    signal?.baselineSide != null &&
    signal.baselineSide !== "NEUTRAL" &&
    signal.side !== "NEUTRAL" &&
    signal.side !== signal.baselineSide
  );
}

function resolveMarketSignalDisplay(
  marketLabel: string,
  signal: SnapshotPtsSignal | null,
  modelLine: SnapshotRow["modelLines"][SnapshotMarket],
): MarketSignalDisplay | null {
  const { usingModelFallback, line, projectionGap } = resolveMarketSignalLineContext(signal, modelLine);
  if (!signal && !usingModelFallback) return null;

  const qualified = signal?.qualified ?? false;

  return {
    statusText: usingModelFallback ? `${marketLabel} MODEL` : `${marketLabel} ${cardStatusLabel(qualified)}`,
    statusClass: usingModelFallback ? "bg-cyan-500/15 text-cyan-200" : ptsFilterClass(qualified),
    side: usingModelFallback ? modelLine.modelSide : signal?.side ?? "NEUTRAL",
    baselineSide: usingModelFallback ? modelLine.modelSide : signal?.baselineSide ?? "NEUTRAL",
    hasOverrideConflict: hasLiveOverrideConflict(signal, usingModelFallback),
    confidence: usingModelFallback ? null : signal?.confidence ?? null,
    confidenceTier: usingModelFallback ? null : signal?.confidenceTier ?? null,
    projectionGap,
    minutesRisk: signal?.minutesRisk ?? null,
    line,
    lineOrigin: line == null ? null : usingModelFallback ? "MODEL" : "LIVE",
    sportsbookCount: usingModelFallback ? null : signal?.sportsbookCount ?? null,
  };
}

function resolveDisplayedMarketLine(customLine: number | null, display: MarketSignalDisplay | null): {
  line: number | null;
  label: string;
} {
  if (customLine != null) {
    return {
      line: customLine,
      label: `Your ${formatStat(customLine)}`,
    };
  }
  if (display?.lineOrigin === "LIVE" && display.line != null) {
    return {
      line: display.line,
      label: `Live ${formatStat(display.line)}`,
    };
  }
  return {
    line: null,
    label: "Awaiting market line",
  };
}

function resolveMarketRecommendationView(
  row: SnapshotRow,
  market: SnapshotMarket,
  customLine: number | null = null,
): MarketRecommendationView {
  const modelLine = row.modelLines[market];
  const display = resolveMarketSignalDisplay(signalLabelForMarket(market), liveSignalForMarket(row, market), modelLine);
  const precision = precisionSignalForMarket(row, market);
  const hasPrecisionCall = precision?.qualified === true && precision.side !== "NEUTRAL";
  const displayedLine = resolveDisplayedMarketLine(customLine, display);
  const projection = row.projectedTonight[market];
  const hasDisplayConflict = customLine == null && !hasPrecisionCall && display?.hasOverrideConflict === true;
  const customLineSide =
    customLine == null || projection == null
      ? null
      : projection > customLine
        ? ("OVER" as const)
        : projection < customLine
          ? ("UNDER" as const)
          : ("NEUTRAL" as const);
  const finalSide = customLineSide ?? (hasPrecisionCall ? precision.side : hasDisplayConflict ? "NEUTRAL" : display?.side ?? modelLine.modelSide);
  const note = hasDisplayConflict
    ? "Live override conflicts with the projection gap. This market stays neutral unless it qualifies in Precision."
    : null;

  return {
    display,
    precision,
    finalSide,
    marketLine: displayedLine.line,
    marketLineLabel: displayedLine.label,
    hitChance:
      displayedLine.line != null && customLine == null && !hasDisplayConflict
        ? resolveMarketHitChance(row, market, display)
        : EMPTY_HIT_CHANCE,
    note,
  };
}

function resolveMarketRecommendationSource(
  marketView: MarketRecommendationView,
  customLine: number | null,
): {
  source: MarketRecommendationSource;
  label: string;
  detail: string;
  className: string;
} {
  if (customLine != null) {
    return {
      source: "CUSTOM",
      label: "Custom Scenario",
      detail: "Using your line for the side read below.",
      className: "border-blue-300/35 bg-blue-500/12 text-blue-100",
    };
  }

  if (marketView.precision?.qualified && marketView.precision.side !== "NEUTRAL") {
    return {
      source: "PRECISION",
      label: "Precision Call",
      detail: "Qualified precision selector result for this market.",
      className: "border-teal-300/35 bg-teal-500/12 text-teal-100",
    };
  }

  if (marketView.display?.lineOrigin === "LIVE") {
    if (marketView.note) {
      return {
        source: "LIVE_MODEL",
        label: "Conflicted Live Read",
        detail: marketView.note,
        className: "border-amber-300/35 bg-amber-500/12 text-amber-100",
      };
    }
    return {
      source: "LIVE_MODEL",
      label: "Live Model",
      detail: "Final live side-model lean for the current sportsbook line.",
      className: "border-slate-300/20 bg-white/5 text-slate-200",
    };
  }

  if (marketView.display?.lineOrigin === "MODEL") {
    return {
      source: "MODEL_FALLBACK",
      label: "Model Fallback",
      detail: "No confirmed game line yet, so this uses the model fallback.",
      className: "border-cyan-300/30 bg-cyan-500/10 text-cyan-100",
    };
  }

  return {
    source: "UNAVAILABLE",
    label: "No Active Line",
    detail: "Waiting on a confirmed game line.",
    className: "border-slate-300/20 bg-white/5 text-slate-300",
  };
}

function mergeHydratedPlayerRow(current: SnapshotRow, hydrated: SnapshotRow): SnapshotRow {
  return {
    ...current,
    ...hydrated,
    ptsSignal: hydrated.ptsSignal ?? current.ptsSignal,
    rebSignal: hydrated.rebSignal ?? current.rebSignal,
    astSignal: hydrated.astSignal ?? current.astSignal,
    threesSignal: hydrated.threesSignal ?? current.threesSignal,
    praSignal: hydrated.praSignal ?? current.praSignal,
    paSignal: hydrated.paSignal ?? current.paSignal,
    prSignal: hydrated.prSignal ?? current.prSignal,
    raSignal: hydrated.raSignal ?? current.raSignal,
    precisionSignals: hydrated.precisionSignals ?? current.precisionSignals,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundNumber(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function focusTierLabel(tier: FocusTier): string {
  if (tier === "TOP") return "Top Focus";
  if (tier === "STRONG") return "Strong Look";
  if (tier === "WATCH") return "Watchlist";
  return "Deep Read";
}

function focusTierClass(tier: FocusTier): string {
  if (tier === "TOP") return "border-emerald-300/45 bg-emerald-500/12 text-emerald-100";
  if (tier === "STRONG") return "border-amber-300/45 bg-amber-500/12 text-amber-100";
  if (tier === "WATCH") return "border-cyan-300/40 bg-cyan-500/10 text-cyan-100";
  return "border-slate-300/20 bg-slate-500/10 text-slate-200";
}

function focusRowAccentClass(tier: FocusTier): string {
  if (tier === "TOP") return "bg-emerald-400/[0.06]";
  if (tier === "STRONG") return "bg-amber-400/[0.05]";
  if (tier === "WATCH") return "bg-cyan-400/[0.04]";
  return "";
}

function qualityBonus(tier: "HIGH" | "MEDIUM" | "LOW"): number {
  if (tier === "HIGH") return 10;
  if (tier === "MEDIUM") return 6;
  return 2;
}

function directionalSupport(
  side: SnapshotModelSide,
  trendVsSeason: number | null,
  opponentAllowanceDelta: number | null,
): { score: number; text: string } {
  if (side !== "OVER" && side !== "UNDER") {
    return { score: 0, text: "No directional support" };
  }

  const signedTrend = trendVsSeason == null ? 0 : side === "OVER" ? trendVsSeason : -trendVsSeason;
  const signedOpponent = opponentAllowanceDelta == null ? 0 : side === "OVER" ? opponentAllowanceDelta : -opponentAllowanceDelta;
  const score = clampNumber(signedTrend * 4 + signedOpponent * 2.5, -8, 12);

  const trendLabel =
    trendVsSeason == null
      ? "Trend -"
      : `Trend ${formatAverage(side === "OVER" ? trendVsSeason : -trendVsSeason, true)}`;
  const oppLabel =
    opponentAllowanceDelta == null
      ? "Opp -"
      : `Opp ${formatAverage(side === "OVER" ? opponentAllowanceDelta : -opponentAllowanceDelta, true)}`;

  return {
    score,
    text: `${trendLabel} | ${oppLabel}`,
  };
}

function focusTierFromScore(score: number, signalQualified: boolean): FocusTier {
  if (signalQualified || score >= 78) return "TOP";
  if (score >= 64) return "STRONG";
  if (score >= 50) return "WATCH";
  return "DEEP";
}

function resolveFocusGap(
  projectionValue: number | null,
  currentLine: number | null,
  display: MarketSignalDisplay | null,
  modelLine: SnapshotRow["modelLines"][SnapshotMarket],
): { gapBase: number; gap: number } {
  const gapBase =
    currentLine != null && projectionValue != null
      ? projectionValue - currentLine
      : display?.projectionGap ?? modelLine.projectionGap ?? 0;
  return {
    gapBase,
    gap: Math.abs(gapBase),
  };
}

function resolveFocusScore(
  row: SnapshotRow,
  market: SnapshotMarket,
  side: SnapshotModelSide,
  display: MarketSignalDisplay | null,
  modelLine: SnapshotRow["modelLines"][SnapshotMarket],
  gap: number,
  signalQualified: boolean,
): { score: number; supportText: string } {
  const confidence = display?.confidence ?? null;
  const minutesRisk = display?.minutesRisk ?? null;
  const confidenceScore = confidence == null ? 0 : clampNumber((confidence - 50) * 0.7, 0, 24);
  const gapScore = clampNumber(gap * 10, 0, 24);
  const riskScore = minutesRisk == null ? 4 : clampNumber(12 - minutesRisk * 16, 0, 12);
  const support = directionalSupport(side, row.trendVsSeason[market], row.opponentAllowanceDelta[market]);
  const modelAgreementBonus = side !== "NEUTRAL" && side === modelLine.modelSide ? 6 : side === "NEUTRAL" ? 0 : -2;
  const lineAvailabilityBonus = display?.line != null ? 6 : modelLine.fairLine != null ? 3 : 0;
  const liveQualifiedBonus = signalQualified ? 34 : display != null ? 8 : 0;
  return {
    score: roundNumber(
      clampNumber(
        liveQualifiedBonus +
          confidenceScore +
          gapScore +
          riskScore +
          qualityBonus(row.dataCompleteness.tier) +
          support.score +
          modelAgreementBonus +
          lineAvailabilityBonus,
        0,
        100,
      ),
      1,
    ),
    supportText: support.text,
  };
}

function buildFocusReasons(
  row: SnapshotRow,
  display: MarketSignalDisplay | null,
  gapBase: number,
  currentLineLabel: string,
): string[] {
  const confidence = display?.confidence ?? null;
  const minutesRisk = display?.minutesRisk ?? null;
  const reasons: string[] = [
    display == null ? "No live signal; using model context." : `${display.statusText} ${display.side === "NEUTRAL" ? "" : display.side}`.trim(),
  ];
  if (display?.projectionGap != null) {
    reasons.push(`Gap ${formatAverage(gapBase, true)} vs ${currentLineLabel.toLowerCase()}.`);
  }
  if (confidence != null || minutesRisk != null) {
    reasons.push(
      `Score ${confidence == null ? "-" : formatStat(confidence)} | Risk ${minutesRisk == null ? "-" : formatStat(minutesRisk)}`,
    );
  }
  reasons.push(`Data ${row.dataCompleteness.score} ${row.dataCompleteness.tier}.`);
  return reasons;
}

function buildFocusCandidate(
  row: SnapshotRow,
  market: SnapshotMarket,
  customLineValue: string | undefined,
): FocusCandidate {
  const signal = liveSignalForMarket(row, market);
  const modelLine = row.modelLines[market];
  const display = resolveMarketSignalDisplay(signalLabelForMarket(market), signal, modelLine);
  const customLine = parseLine(customLineValue ?? "");
  const marketView = resolveMarketRecommendationView(row, market, customLine);
  const currentLine = marketView.marketLine;
  const currentLineLabel = marketView.marketLineLabel;
  const side = marketView.finalSide;
  const projectionValue = row.projectedTonight[market];
  const signalQualified = signal?.qualified ?? false;
  const { gapBase, gap } = resolveFocusGap(projectionValue, currentLine, display, modelLine);
  const { score, supportText } = resolveFocusScore(row, market, side, display, modelLine, gap, signalQualified);
  const focusTier = focusTierFromScore(score, signalQualified);
  const reasons = buildFocusReasons(row, display, gapBase, currentLineLabel);

  return {
    row,
    market,
    display,
    signal,
    currentLine,
    currentLineLabel,
    modelLine,
    focusScore: score,
    focusTier,
    signalQualified,
    supportText,
    reasons,
  };
}

function hitCounts(values: number[], line: number): { over: number; under: number; push: number } {
  let over = 0;
  let under = 0;
  let push = 0;
  values.forEach((value) => {
    if (value > line) over += 1;
    else if (value < line) under += 1;
    else push += 1;
  });
  return { over, under, push };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lineKey(dateEt: string, playerId: string, market: SnapshotMarket): string {
  return `${dateEt}:${playerId}:${market}`;
}

function minuteFloorKey(dateEt: string, playerId: string, market: SnapshotMarket): string {
  return `${dateEt}:${playerId}:${market}:minutes-floor`;
}

function parseMinutesFloor(value: string): number | null {
  const parsed = parseLine(value);
  if (parsed == null) return null;
  const clamped = Math.min(48, Math.max(0, parsed));
  return Math.round(clamped * 10) / 10;
}

function edge(offense: number | null, defenseAllowed: number | null): number | null {
  if (offense == null || defenseAllowed == null) return null;
  return offense - defenseAllowed;
}

function marketValueFromLog(
  log: SnapshotRow["recentLogs"][number],
  market: SnapshotMarket,
): number {
  if (market === "PTS") return log.points;
  if (market === "REB") return log.rebounds;
  if (market === "AST") return log.assists;
  if (market === "THREES") return log.threes;
  if (market === "PRA") return log.points + log.rebounds + log.assists;
  if (market === "PA") return log.points + log.assists;
  if (market === "PR") return log.points + log.rebounds;
  return log.rebounds + log.assists;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return "-";
  const pct = (numerator / denominator) * 100;
  return `${pct.toFixed(0)}%`;
}

function resultLabel(value: number, line: number): "OVER" | "UNDER" | "PUSH" {
  if (value > line) return "OVER";
  if (value < line) return "UNDER";
  return "PUSH";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function standardDeviation(values: number[]): number | null {
  const avg = average(values);
  if (avg == null || values.length === 0) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
  return Math.sqrt(variance);
}

function minValue(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.min(...values);
}

function maxValue(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.max(...values);
}

function consistencyPct(values: number[]): number | null {
  const avg = average(values);
  const sd = standardDeviation(values);
  if (avg == null || sd == null || values.length === 0) return null;
  if (sd === 0) return 100;
  const withinBand = values.filter((value) => Math.abs(value - avg) <= sd).length;
  return (withinBand / values.length) * 100;
}

function formatPercentValue(value: number | null): string {
  if (value == null) return "-";
  return `${value.toFixed(0)}%`;
}

function formatChanceValue(value: number | null): string {
  if (value == null) return "-";
  return `${formatStat(value)}%`;
}


function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  const weight = index - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

type InfoTipProps = {
  label: string;
  definition: string;
};

function InfoTip({ label, definition }: InfoTipProps): React.ReactElement {
  return (
    <span
      title={`${label}: ${definition}`}
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-cyan-200/40 bg-cyan-200/10 text-[10px] font-bold text-cyan-100"
      aria-label={`${label} help`}
    >
      ?
    </span>
  );
}

type HeaderWithTipProps = {
  label: string;
  definition: string;
};

function HeaderWithTip({ label, definition }: HeaderWithTipProps): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTip label={label} definition={definition} />
    </span>
  );
}

function intelStatusClass(status: "LIVE" | "DERIVED" | "PENDING"): string {
  if (status === "LIVE") return "bg-emerald-400/20 text-emerald-200";
  if (status === "DERIVED") return "bg-cyan-400/20 text-cyan-100";
  return "bg-amber-400/20 text-amber-200";
}

function completenessTierClass(tier: "HIGH" | "MEDIUM" | "LOW"): string {
  if (tier === "HIGH") return "bg-emerald-400/20 text-emerald-200";
  if (tier === "MEDIUM") return "bg-amber-400/20 text-amber-200";
  return "bg-rose-400/20 text-rose-200";
}

type CollapsibleSectionProps = {
  id: string;
  title: string;
  subtitle?: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

function CollapsibleSection({
  id,
  title,
  subtitle,
  collapsed,
  onToggle,
  children,
}: CollapsibleSectionProps): React.ReactElement {
  return (
    <section
      id={id}
      className="mt-4 overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(155deg,rgba(13,24,46,0.96),rgba(9,16,31,0.92))] shadow-[0_22px_52px_-40px_rgba(0,0,0,0.9)]"
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <h3 className="text-xs uppercase tracking-[0.16em] text-cyan-100">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p> : null}
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-200">
          {collapsed ? "Expand" : "Collapse"}
        </span>
      </button>
      {collapsed ? null : <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

export function SnapshotDashboard({
  data: initialData,
  initialMarket,
  initialMatchup,
  initialPlayerSearch,
}: SnapshotDashboardProps): React.ReactElement {
  const hasInitialBoardSnapshot = hasBoardSnapshotData(initialData);
  const router = useRouter();
  const boardLoadTargetRef = useRef<string | null>(hasInitialBoardSnapshot ? initialData.dateEt : null);
  const boardRequestRef = useRef(0);
  const boardLoadingRequestRef = useRef<number | null>(null);
  const playerDetailRequestRef = useRef(0);
  const lastVisitRefreshRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  const refreshInFlightRef = useRef(false);
  const refreshBoardForVisitRef = useRef<RefreshBoardForVisit | null>(null);
  const pendingBoardReloadTimeoutRef = useRef<number | null>(null);
  const underfilledSlateReloadRef = useRef<string | null>(null);
  const [boardData, setBoardData] = useState<SnapshotBoardData>(initialData);
  const activeData = boardData;
  const [matchup, setMatchup] = useState(
    initialMatchup && initialData.matchups.some((option) => option.key === initialMatchup) ? initialMatchup : "",
  );
  const [dateInput, setDateInput] = useState(initialData.dateEt);
  const [market, setMarket] = useState<MarketFilter>(initialMarket);
  const [playerSearch, setPlayerSearch] = useState(initialPlayerSearch);
  const [playerSuggestOpen, setPlayerSuggestOpen] = useState(false);
  const [playerSuggestIndex, setPlayerSuggestIndex] = useState(-1);
  const [lineMap, setLineMap] = useState<Record<string, string>>({});
  const [minutesFloorMap, setMinutesFloorMap] = useState<Record<string, string>>({});
  const [guideOpen, setGuideOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<SnapshotRow | null>(null);
  const [focusedMarket, setFocusedMarket] = useState<SnapshotMarket>(initialMarket === "ALL" ? "PTS" : initialMarket);
  const [compactDetail, setCompactDetail] = useState(true);
  const [showQualifiedOnly, setShowQualifiedOnly] = useState(true);
  const [showSecondarySignals, setShowSecondarySignals] = useState(false);

  const [showAdvancedView, setShowAdvancedView] = useState(false);
  const [activeResearchTab, setActiveResearchTab] = useState<ResearchTabKey>("trends");
  const [collapsedSections, setCollapsedSections] = useState<Record<DetailSectionKey, boolean>>(
    defaultCollapsedSections(true),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isDonationLoading, setIsDonationLoading] = useState(false);
  const [donationMessage, setDonationMessage] = useState<string | null>(null);
  const [donationError, setDonationError] = useState<string | null>(null);
  const [isBoardLoading, setIsBoardLoading] = useState(!hasInitialBoardSnapshot);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [isPlayerLookupLoading, setIsPlayerLookupLoading] = useState(false);
  const [playerLookupError, setPlayerLookupError] = useState<string | null>(null);
  const [playerLookupMeta, setPlayerLookupMeta] = useState<Omit<SnapshotPlayerLookupData, "row"> | null>(null);
  const [isPlayerDetailLoading, setIsPlayerDetailLoading] = useState(false);
  const [playerDetailError, setPlayerDetailError] = useState<string | null>(null);
  const [playerBacktest, setPlayerBacktest] = useState<SnapshotPlayerBacktestReport | null>(null);
  const [playerBacktestLoading, setPlayerBacktestLoading] = useState(false);
  const [playerBacktestError, setPlayerBacktestError] = useState<string | null>(null);
  const isAllMarketsView = market === "ALL";
  const hasActiveBoardSnapshot = hasBoardSnapshotData(activeData);
  const precisionCardTargetCount = activeData.precisionSystem?.targetCardCount ?? DAILY_CARD_TARGET_COUNT;
  const activePrecisionCardUnderfilled =
    activeData.dateEt === getTodayEtDateString(new Date()) && isPrecisionCardUnderfilled(activeData);
  const resolveManualRefreshMode = useCallback(
    (targetDate: string): "FAST" | "DELTA" => {
      const isTodaySlate = targetDate === getTodayEtDateString(new Date());
      if (!isTodaySlate) return MANUAL_REFRESH_MODE;
      if (activeData.dateEt !== targetDate) return MANUAL_REFRESH_MODE;
      if (!hasBoardSnapshotData(activeData)) return MANUAL_REFRESH_MODE;
      if (isPrecisionCardUnderfilled(activeData)) return MANUAL_REFRESH_MODE;
      return wasBoardUpdatedRecently(activeData.lastUpdatedAt) ? "FAST" : MANUAL_REFRESH_MODE;
    },
    [activeData],
  );
  const scopedLineKey = useCallback(
    (playerId: string, slateMarket: SnapshotMarket): string => lineKey(activeData.dateEt, playerId, slateMarket),
    [activeData.dateEt],
  );
  const scopedMinuteFloorKey = useCallback(
    (playerId: string, slateMarket: SnapshotMarket): string => minuteFloorKey(activeData.dateEt, playerId, slateMarket),
    [activeData.dateEt],
  );
  const selectedPlayerMarketSystemMix = useMemo(() => {
    if (!selectedPlayer) return null;
    let hasPrecisionCall = false;
    let hasNonPrecisionCall = false;
    for (const option of MARKET_OPTIONS) {
      const key = scopedLineKey(selectedPlayer.playerId, option.value);
      const customLine = parseLine(lineMap[key] ?? "");
      const marketView = resolveMarketRecommendationView(selectedPlayer, option.value, customLine);
      const source = resolveMarketRecommendationSource(marketView, customLine).source;
      if (source === "PRECISION") hasPrecisionCall = true;
      if (source === "LIVE_MODEL" || source === "MODEL_FALLBACK") hasNonPrecisionCall = true;
    }
    if (!hasPrecisionCall || !hasNonPrecisionCall) return null;
    return {
      title: "Mixed market systems",
      body:
        "Qualified markets use the precision selector. The rest show the live model lean or a model fallback. Combo props like PR can disagree with PTS and REB because they use their own line. If a live override conflicts with the projection gap, the market stays neutral here unless it qualifies in Precision.",
    };
  }, [lineMap, scopedLineKey, selectedPlayer]);

  const fetchBoardSnapshot = useCallback(async (targetDate: string, options?: BoardLoadOptions): Promise<SnapshotBoardData> => {
    const params = new URLSearchParams();
    params.set("date", targetDate);
    if (options?.bustCache) {
      params.set("refresh", "1");
      params.set("t", String(Date.now()));
    }

    const requestBoard = async (requestParams: URLSearchParams, useNoStore = false): Promise<SnapshotBoardData> => {
      const response = await fetch(
        `/api/snapshot/board?${requestParams.toString()}`,
        useNoStore ? { cache: "no-store" } : undefined,
      );
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        const body = await response.text();
        const normalizedBody = body.replace(/\s+/g, " ").trim();
        const bodyHint =
          normalizedBody.length === 0
            ? "The server returned an empty response."
            : normalizedBody.startsWith("<!DOCTYPE")
              ? "The server returned an HTML error page instead of the board JSON."
              : normalizedBody.slice(0, 180);
        throw new Error(`Board request failed (${response.status}). ${bodyHint}`);
      }

      const payload = (await response.json()) as SnapshotBoardApiResponse;
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error ?? `Board request failed (${response.status}).`);
      }
      return payload.result;
    };

    try {
      return await requestBoard(params, options?.bustCache);
    } catch (error) {
      if (!options?.bustCache) {
        throw error;
      }
      const fallbackParams = new URLSearchParams();
      fallbackParams.set("date", targetDate);
      return requestBoard(fallbackParams, false);
    }
  }, []);

  const loadBoardData = useCallback(async (targetDate: string, options?: BoardLoadOptions): Promise<void> => {
    const requestId = boardRequestRef.current + 1;
    boardRequestRef.current = requestId;
    boardLoadTargetRef.current = targetDate;
    const backgroundLoad = options?.background ?? false;
    if (!backgroundLoad) {
      boardLoadingRequestRef.current = requestId;
      setIsBoardLoading(true);
    }
    setBoardError(null);

    try {
      const result = await fetchBoardSnapshot(targetDate, options);
      if (requestId !== boardRequestRef.current) return;
      setBoardData(result);
    } catch (error) {
      if (requestId !== boardRequestRef.current) return;
      setBoardError(error instanceof Error ? error.message : "Board load failed.");
    } finally {
      if (boardLoadingRequestRef.current === requestId) {
        boardLoadingRequestRef.current = null;
        setIsBoardLoading(false);
      }
    }
  }, [fetchBoardSnapshot]);

  const scheduleBoardReload = useCallback((targetDate: string, delayMs = VISIT_REFRESH_FOLLOW_UP_LOAD_MS): void => {
    if (pendingBoardReloadTimeoutRef.current != null) {
      window.clearTimeout(pendingBoardReloadTimeoutRef.current);
    }

    pendingBoardReloadTimeoutRef.current = window.setTimeout(() => {
      pendingBoardReloadTimeoutRef.current = null;
      loadBoardData(targetDate, { bustCache: true, background: true });
    }, delayMs);
  }, [loadBoardData]);

  const clearPendingBoardReload = useCallback((): void => {
    if (pendingBoardReloadTimeoutRef.current != null) {
      window.clearTimeout(pendingBoardReloadTimeoutRef.current);
      pendingBoardReloadTimeoutRef.current = null;
    }
  }, []);

  const loadLatestBoard = useCallback(async (targetDate: string): Promise<void> => {
    await loadBoardData(targetDate, { background: true });
  }, [loadBoardData]);

  const handleVisitRefreshFailure = useCallback(async (targetDate: string, error: unknown): Promise<void> => {
    const message = error instanceof Error ? error.message : "Auto refresh failed.";
    setRefreshError(`Auto refresh failed: ${message}`);
    await loadLatestBoard(targetDate);
  }, [loadLatestBoard]);

  const handleManualRefreshWarnings = useCallback(async (
    targetDate: string,
    refreshMode: ManualRefreshMode,
    warnings: string[],
  ): Promise<boolean> => {
    if (warnings.some((item) => item.toLowerCase().includes("already running"))) {
      setRefreshMessage(alreadyRunningRefreshMessage(refreshMode));
      scheduleBoardReload(targetDate);
      return true;
    }

    if (warnings.some((item) => item.toLowerCase().includes("completed recently"))) {
      setRefreshMessage(recentlyCompletedRefreshMessage(refreshMode));
      await loadLatestBoard(targetDate);
      return true;
    }

    return false;
  }, [loadLatestBoard, scheduleBoardReload]);

  const runManualBoardRefresh = useCallback(async (
    targetDate: string,
    refreshMode: ManualRefreshMode,
  ): Promise<void> => {
    const response = await fetch("/api/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: refreshMode, source: "manual" }),
    });
    const payload = (await response.json()) as SnapshotRefreshApiResponse;
    if (!response.ok) {
      throw new Error(payload.error ?? "Refresh failed");
    }

    const warnings = payload.result?.warnings ?? [];
    if (await handleManualRefreshWarnings(targetDate, refreshMode, warnings)) {
      return;
    }

    setRefreshMessage(completedRefreshMessage(refreshMode, payload.result?.status));
    await loadLatestBoard(targetDate);
  }, [handleManualRefreshWarnings, loadLatestBoard]);

  const runBoardRefresh = useCallback(async (targetDate: string, source: BoardRefreshSource): Promise<void> => {
    const isTodaySlate = targetDate === getTodayEtDateString(new Date());
    if (!isTodaySlate) {
      await loadBoardData(targetDate, { bustCache: true, background: true });
      return;
    }

    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    setIsRefreshing(true);
    setRefreshError(null);
    const manualRefreshMode = source === "manual" ? resolveManualRefreshMode(targetDate) : null;
    clearPendingBoardReload();
    setRefreshMessage(refreshStartMessage(source, manualRefreshMode));

    try {
      if (source === "visit") {
        await loadLatestBoard(targetDate);
        setRefreshMessage("Live board updated for this visit.");
        return;
      }

      const refreshMode = manualRefreshMode ?? MANUAL_REFRESH_MODE;
      await runManualBoardRefresh(targetDate, refreshMode);
    } catch (error) {
      if (source === "visit") {
        await handleVisitRefreshFailure(targetDate, error);
        return;
      }

      setRefreshError(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [clearPendingBoardReload, handleVisitRefreshFailure, loadBoardData, loadLatestBoard, resolveManualRefreshMode, runManualBoardRefresh]);

  const refreshBoardForVisit = useCallback(
    (targetDate: string, options?: VisitRefreshOptions): void => {
      if (!shouldAutoRefreshBoard(targetDate, options?.lastUpdatedAt ?? null)) {
        return;
      }

      const now = Date.now();
      const visitKey = `live-refresh:${targetDate}`;
      const minIntervalMs = options?.minIntervalMs ?? AUTO_REFRESH_ATTEMPT_COOLDOWN_MS;
      if (lastVisitRefreshRef.current.key === visitKey && now - lastVisitRefreshRef.current.at < minIntervalMs) {
        return;
      }

      lastVisitRefreshRef.current = { key: visitKey, at: now };
      runBoardRefresh(targetDate, "visit");
    },
    [runBoardRefresh],
  );

  useEffect(() => {
    refreshBoardForVisitRef.current = refreshBoardForVisit;
  }, [refreshBoardForVisit]);

  useEffect(() => {
    return () => {
      if (pendingBoardReloadTimeoutRef.current != null) {
        window.clearTimeout(pendingBoardReloadTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedPlayer) {
      setFocusedMarket(market === "ALL" ? "PTS" : market);
    }
  }, [selectedPlayer, market]);

  useEffect(() => {
    if (!selectedPlayer) return;
    const refreshedRow = activeData.rows.find(
      (row) => row.playerId === selectedPlayer.playerId && row.matchupKey === selectedPlayer.matchupKey,
    );
    if (!refreshedRow || refreshedRow === selectedPlayer) return;
    setSelectedPlayer(refreshedRow);
  }, [activeData.rows, selectedPlayer]);

  useEffect(() => {
    setDateInput(initialData.dateEt);
  }, [initialData.dateEt]);

  useEffect(() => {
    setBoardData(initialData);
    setBoardError(null);
    boardLoadTargetRef.current = initialData.dateEt;
    if (!hasBoardSnapshotData(initialData)) {
      loadBoardData(initialData.dateEt);
      return;
    }
    setIsBoardLoading(false);
    refreshBoardForVisitRef.current?.(initialData.dateEt, { lastUpdatedAt: initialData.lastUpdatedAt });
  }, [initialData, loadBoardData]);

  useEffect(() => {
    if (!hasActiveBoardSnapshot) return;
    refreshBoardForVisit(activeData.dateEt, { lastUpdatedAt: activeData.lastUpdatedAt });
  }, [activeData.dateEt, activeData.lastUpdatedAt, hasActiveBoardSnapshot, refreshBoardForVisit]);

  useEffect(() => {
    if (!activePrecisionCardUnderfilled) {
      if (underfilledSlateReloadRef.current === activeData.dateEt) {
        underfilledSlateReloadRef.current = null;
      }
      return;
    }
    if (underfilledSlateReloadRef.current === activeData.dateEt || isBoardLoading) {
      return;
    }

    underfilledSlateReloadRef.current = activeData.dateEt;
    setRefreshMessage("Precision card loaded short. Pulling the freshest live slate now...");
    loadBoardData(activeData.dateEt, { bustCache: true, background: true });
  }, [activeData.dateEt, activePrecisionCardUnderfilled, isBoardLoading, loadBoardData]);

  useEffect(() => {
    const handlePageShow = (): void => {
      refreshBoardForVisit(activeData.dateEt, { lastUpdatedAt: activeData.lastUpdatedAt });
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [activeData.dateEt, activeData.lastUpdatedAt, refreshBoardForVisit]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const donationStatus = params.get("donation");
    if (!donationStatus) return;

    if (donationStatus === "success") {
      setDonationMessage("Thanks for supporting ULTOPS. Your donation came through.");
      setDonationError(null);
    }

    params.delete("donation");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, []);

  useEffect(() => {
    if (matchup && !activeData.matchups.some((option) => option.key === matchup)) {
      setMatchup("");
    }
  }, [activeData.matchups, matchup]);

  useEffect(() => {
    if (!selectedPlayer && !guideOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (selectedPlayer) {
          setSelectedPlayer(null);
          return;
        }
        setGuideOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedPlayer, guideOpen]);

  useEffect(() => {
    if (!selectedPlayer) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const previousStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflowY: body.style.overflowY,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflowY = "scroll";

    return () => {
      body.style.position = previousStyles.position;
      body.style.top = previousStyles.top;
      body.style.left = previousStyles.left;
      body.style.right = previousStyles.right;
      body.style.width = previousStyles.width;
      body.style.overflowY = previousStyles.overflowY;
      window.scrollTo(0, scrollY);
    };
  }, [selectedPlayer]);

  useEffect(() => {
    if (!selectedPlayer) return;
    setCollapsedSections(defaultCollapsedSections(compactDetail));
  }, [compactDetail, selectedPlayer]);

  useEffect(() => {
    if (!selectedPlayer) {
      setPlayerBacktest(null);
      setPlayerBacktestError(null);
      setPlayerBacktestLoading(false);
      return;
    }

    const controller = new AbortController();
    const playerName = selectedPlayer.playerName;
    setPlayerBacktestLoading(true);
    setPlayerBacktestError(null);

    fetch(`/api/snapshot/player/backtest?player=${encodeURIComponent(playerName)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok?: boolean;
          report?: SnapshotPlayerBacktestReport;
          error?: string;
        };
        if (!response.ok || !payload.ok || !payload.report) {
          throw new Error(payload.error ?? "Backtest lookup failed.");
        }
        setPlayerBacktest(payload.report);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setPlayerBacktest(null);
        setPlayerBacktestError(error instanceof Error ? error.message : "Backtest lookup failed.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPlayerBacktestLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedPlayer]);

  function closePlayerDetail(): void {
    playerDetailRequestRef.current += 1;
    setPlayerLookupMeta(null);
    setIsPlayerDetailLoading(false);
    setPlayerDetailError(null);
    setSelectedPlayer(null);
  }

  const hydratePlayerDetail = useCallback(async (
    row: SnapshotRow,
    existingLookupMeta: Omit<SnapshotPlayerLookupData, "row"> | null,
  ): Promise<void> => {
    if (row.detailLevel === "FULL") {
      setIsPlayerDetailLoading(false);
      setPlayerDetailError(null);
      return;
    }

    const requestId = playerDetailRequestRef.current + 1;
    playerDetailRequestRef.current = requestId;
    setIsPlayerDetailLoading(true);
    setPlayerDetailError(null);

    if (row.recentLogs.length === 0) {
      fetch(`/api/snapshot/player/logs?date=${encodeURIComponent(activeData.dateEt)}&playerId=${encodeURIComponent(row.playerId)}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            ok?: boolean;
            result?: {
              playerId?: string;
              recentLogs?: SnapshotRow["recentLogs"];
              analysisLogs?: SnapshotRow["analysisLogs"];
            };
            error?: string;
          };

          if (!response.ok || !payload.ok || !payload.result) {
            throw new Error(payload.error ?? "Player recent logs load failed.");
          }

          if (requestId !== playerDetailRequestRef.current) return;

          setSelectedPlayer((current) => {
            if (!current || current.playerId !== row.playerId) return current;
            return {
              ...current,
              recentLogs: payload.result?.recentLogs ?? current.recentLogs,
              analysisLogs: payload.result?.analysisLogs ?? current.analysisLogs,
            };
          });
        })
        .catch(() => {
          // Keep the heavier detail fetch as the fallback path if the lightweight log hydrate misses.
        });
    }

    try {
      const params = new URLSearchParams();
      params.set("date", activeData.dateEt);
      params.set("playerId", row.playerId);
      const response = await fetch(`/api/snapshot/player?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as {
        ok?: boolean;
        result?: SnapshotPlayerLookupData;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error ?? "Player detail load failed.");
      }

      if (requestId !== playerDetailRequestRef.current) return;

      setSelectedPlayer((current) => {
        if (!current || current.playerId !== payload.result?.row.playerId) {
          return payload.result!.row;
        }
        return mergeHydratedPlayerRow(current, payload.result!.row);
      });
      if (!existingLookupMeta) {
        setPlayerLookupMeta({
          requestedDateEt: payload.result.requestedDateEt,
          resolvedDateEt: payload.result.resolvedDateEt,
          note: payload.result.note,
        });
      }
    } catch (error) {
      if (requestId !== playerDetailRequestRef.current) return;
      setPlayerDetailError(error instanceof Error ? error.message : "Player detail load failed.");
    } finally {
      if (requestId === playerDetailRequestRef.current) {
        setIsPlayerDetailLoading(false);
      }
    }
  }, [activeData.dateEt]);

  const openPlayerDetail = useCallback((
    row: SnapshotRow,
    lookupMeta: Omit<SnapshotPlayerLookupData, "row"> | null = null,
    targetMarket: SnapshotMarket | null = null,
  ): void => {
    setFocusedMarket(targetMarket ?? (market === "ALL" ? "PTS" : market));
    setPlayerLookupMeta(lookupMeta);
    setPlayerDetailError(null);
    setSelectedPlayer(row);
    if (row.detailLevel !== "FULL") {
      hydratePlayerDetail(row, lookupMeta);
      return;
    }
    setIsPlayerDetailLoading(false);
  }, [hydratePlayerDetail, market]);

  function toggleSection(key: DetailSectionKey): void {
    setCollapsedSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function jumpToDetailSection(sectionId: string): void {
    const target = document.getElementById(sectionId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleLoadData(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const params = new URLSearchParams();
    const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? dateInput : activeData.dateEt;
    params.set("date", normalizedDate);
    if (market !== "ALL") params.set("market", market);
    if (matchup) params.set("matchup", matchup);
    const player = playerSearch.trim();
    if (player) params.set("player", player);
    params.sort();

    const targetQuery = params.toString();
    const targetUrl = targetQuery ? `/?${targetQuery}` : "/";

    const current = new URLSearchParams(window.location.search);
    current.sort();
    if (current.toString() === targetQuery) {
      setRefreshMessage(null);
      setRefreshError(null);
      loadBoardData(normalizedDate);
      return;
    }
    setBoardError(null);
    setRefreshError(null);
    setRefreshMessage(null);
    setIsBoardLoading(true);
    router.push(targetUrl);
  }

  async function handleRefresh(): Promise<void> {
    if (isRefreshing) return;
    await runBoardRefresh(/^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? dateInput : activeData.dateEt, "manual");
  }

  async function handlePlayerLookup(): Promise<void> {
    const search = playerSearch.trim();
    if (!search || isPlayerLookupLoading) {
      if (!search) {
        setPlayerLookupError("Enter a player name first.");
      }
      return;
    }

    const directMatch = activeData.rows.find((row) => row.playerName.toLowerCase() === search.toLowerCase());
    if (directMatch) {
      setPlayerLookupError(null);
      openPlayerDetail(directMatch, null);
      return;
    }

    setIsPlayerLookupLoading(true);
    setPlayerLookupError(null);
    try {
      const params = new URLSearchParams();
      params.set("date", /^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? dateInput : activeData.dateEt);
      params.set("player", search);
      const response = await fetch(`/api/snapshot/player?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as {
        ok?: boolean;
        result?: SnapshotPlayerLookupData;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error ?? "Player lookup failed.");
      }

      openPlayerDetail(payload.result.row, {
        requestedDateEt: payload.result.requestedDateEt,
        resolvedDateEt: payload.result.resolvedDateEt,
        note: payload.result.note,
      });
    } catch (error) {
      setPlayerLookupError(error instanceof Error ? error.message : "Player lookup failed.");
    } finally {
      setIsPlayerLookupLoading(false);
    }
  }

  const matchupStatsByKey = useMemo(() => {
    const map = new Map<string, SnapshotBoardData["teamMatchups"][number]>();
    activeData.teamMatchups.forEach((item) => map.set(item.matchupKey, item));
    return map;
  }, [activeData.teamMatchups]);

  const filteredRows = useMemo(() => {
    const search = playerSearch.trim().toLowerCase();
    return activeData.rows.filter((row) => {
      if (matchup && row.matchupKey !== matchup) return false;
      if (search && !row.playerName.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [activeData.rows, matchup, playerSearch]);

  useEffect(() => {
    const query = initialPlayerSearch.trim();
    if (!query) return;
    if (filteredRows.length === 0) return;

    const queryLower = query.toLowerCase();
    const exact = filteredRows.find((row) => row.playerName.toLowerCase() === queryLower);
    const startsWith = filteredRows.find((row) => row.playerName.toLowerCase().startsWith(queryLower));
    const bestMatch = exact ?? startsWith ?? filteredRows[0];
    openPlayerDetail(bestMatch);
  }, [filteredRows, initialPlayerSearch, openPlayerDetail]);

  const playerSuggestionPool = useMemo(() => {
    const rows = matchup ? activeData.rows.filter((row) => row.matchupKey === matchup) : activeData.rows;
    const deduped = new Map<string, SnapshotRow>();
    rows.forEach((row) => {
      if (!deduped.has(row.playerId)) {
        deduped.set(row.playerId, row);
      }
    });
    return Array.from(deduped.values()).sort((a, b) => a.playerName.localeCompare(b.playerName));
  }, [activeData.rows, matchup]);

  const playerSuggestions = useMemo(() => {
    const query = playerSearch.trim().toLowerCase();
    if (!query) {
      return playerSuggestionPool.slice(0, 10);
    }
    const starts = playerSuggestionPool.filter((row) => row.playerName.toLowerCase().startsWith(query));
    const contains = playerSuggestionPool.filter(
      (row) => row.playerName.toLowerCase().includes(query) && !row.playerName.toLowerCase().startsWith(query),
    );
    return [...starts, ...contains].slice(0, 10);
  }, [playerSuggestionPool, playerSearch]);

  const filteredTeamMatchups = useMemo(() => {
    if (!showAdvancedView) return [];
    if (!matchup) return activeData.teamMatchups;
    return activeData.teamMatchups.filter((item) => item.matchupKey === matchup);
  }, [activeData.teamMatchups, matchup, showAdvancedView]);

  const recentLogsPending =
    selectedPlayer != null && selectedPlayer.detailLevel !== "FULL" && selectedPlayer.recentLogs.length === 0;
  const showPlayerLookupContext =
    playerLookupMeta != null &&
    (playerLookupMeta.requestedDateEt !== playerLookupMeta.resolvedDateEt || Boolean(playerLookupMeta.note));

  const currentMarketLabel = useMemo(
    () => MARKET_FILTER_OPTIONS.find((option) => option.value === market)?.label ?? market,
    [market],
  );
  const teamStatsMarket = market === "ALL" ? null : market;

  const marketFocusCandidates = useMemo(
    () => {
      if (!showAdvancedView || market === "ALL") return [];
      return filteredRows
        .map((row) => buildFocusCandidate(row, market, lineMap[scopedLineKey(row.playerId, market)]))
        .sort((left, right) => {
          if (right.focusScore !== left.focusScore) return right.focusScore - left.focusScore;
          const leftConfidence = left.display?.confidence ?? 0;
          const rightConfidence = right.display?.confidence ?? 0;
          if (rightConfidence !== leftConfidence) return rightConfidence - leftConfidence;
          return left.row.playerName.localeCompare(right.row.playerName);
        });
    },
    [filteredRows, lineMap, market, scopedLineKey, showAdvancedView],
  );

  const allQualifiedCandidates = useMemo(
    () =>
      filteredRows
        .flatMap((row) =>
          MARKET_OPTIONS.map((option) =>
            buildFocusCandidate(row, option.value, lineMap[scopedLineKey(row.playerId, option.value)]),
          ).filter((candidate) => candidate.signalQualified),
        )
        .sort((left, right) => {
          const leftConfidence = left.display?.confidence ?? 0;
          const rightConfidence = right.display?.confidence ?? 0;
          if (rightConfidence !== leftConfidence) return rightConfidence - leftConfidence;
          if (right.focusScore !== left.focusScore) return right.focusScore - left.focusScore;
          if (left.row.gameTimeEt !== right.row.gameTimeEt) return left.row.gameTimeEt.localeCompare(right.row.gameTimeEt);
          if (left.row.playerName !== right.row.playerName) return left.row.playerName.localeCompare(right.row.playerName);
          return left.market.localeCompare(right.market);
        }),
    [filteredRows, lineMap, scopedLineKey],
  );

  const allFocusCandidates = useMemo(
    () => {
      if (!showAdvancedView) return [];
      return filteredRows
        .flatMap((row) =>
          MARKET_OPTIONS.map((option) =>
            buildFocusCandidate(row, option.value, lineMap[scopedLineKey(row.playerId, option.value)]),
          ),
        )
        .sort((left, right) => {
          const leftConfidence = left.display?.confidence ?? 0;
          const rightConfidence = right.display?.confidence ?? 0;
          if (rightConfidence !== leftConfidence) return rightConfidence - leftConfidence;
          if (right.focusScore !== left.focusScore) return right.focusScore - left.focusScore;
          if (left.row.gameTimeEt !== right.row.gameTimeEt) return left.row.gameTimeEt.localeCompare(right.row.gameTimeEt);
          if (left.row.playerName !== right.row.playerName) return left.row.playerName.localeCompare(right.row.playerName);
          return left.market.localeCompare(right.market);
        });
    },
    [filteredRows, lineMap, scopedLineKey, showAdvancedView],
  );

  const focusCandidates = useMemo(() => {
    if (!showAdvancedView) return [];
    return market === "ALL" ? allFocusCandidates : marketFocusCandidates;
  }, [allFocusCandidates, market, marketFocusCandidates, showAdvancedView]);

  const topFocusCandidates = useMemo(
    () => focusCandidates.filter((candidate) => candidate.focusTier !== "DEEP").slice(0, 8),
    [focusCandidates],
  );

  const qualifiedCandidates = useMemo(
    () => focusCandidates.filter((candidate) => candidate.signalQualified),
    [focusCandidates],
  );

  const allQualifiedMarketSummary = useMemo(
    () => {
      const counts = new Map<SnapshotMarket, number>();
      allQualifiedCandidates.forEach((candidate) => {
        counts.set(candidate.market, (counts.get(candidate.market) ?? 0) + 1);
      });
      return MARKET_OPTIONS.map((option) => ({
        ...option,
        count: counts.get(option.value) ?? 0,
      })).filter((option) => option.count > 0);
    },
    [allQualifiedCandidates],
  );

  const rowByPlayerId = useMemo(
    () => new Map(activeData.rows.map((row) => [row.playerId, row] as const)),
    [activeData.rows],
  );
  const backendDailyCardCandidates = useMemo<DailyCardCandidate[]>(
    () =>
      (activeData.precisionCard ?? []).flatMap((entry) => {
        const row = rowByPlayerId.get(entry.playerId);
        if (!row) return [];
        return [
          {
            candidate: buildFocusCandidate(row, entry.market, lineMap[scopedLineKey(entry.playerId, entry.market)]),
            precision: entry.precisionSignal ?? precisionSignalForMarket(row, entry.market),
            source: entry.source,
          } satisfies DailyCardCandidate,
        ];
      }),
    [activeData.precisionCard, lineMap, rowByPlayerId, scopedLineKey],
  );

  const strongProjectionCandidates = useMemo(() => {
    const results: (FocusCandidate & { projGap: number; threshold: number })[] = [];
    filteredRows.forEach((row) => {
      if (isUnavailableForDailyCard(row)) return;
      STRONG_PROJECTION_MARKETS.forEach((mkt) => {
        const threshold = STRONG_PROJECTION_THRESHOLDS[mkt];
        if (threshold == null) return;
        const projection = row.projectedTonight[mkt];
        if (projection == null) return;
        const signal = liveSignalForMarket(row, mkt);
        if (signal?.marketLine == null) return;
        if (signal.side !== "OVER") return;
        const currentLine = signal.marketLine;
        if (currentLine == null) return;
        const gap = projection - currentLine;
        if (gap < threshold) return;
        results.push({
          ...buildFocusCandidate(row, mkt, lineMap[scopedLineKey(row.playerId, mkt)]),
          projGap: gap,
          threshold,
        });
      });
    });
    results.sort((a, b) => {
      const aRatio = a.projGap / a.threshold;
      const bRatio = b.projGap / b.threshold;
      return bRatio - aRatio;
    });
    return results;
  }, [filteredRows, lineMap, scopedLineKey]);


  const dailyCardCandidates = useMemo<DailyCardCandidate[]>(
    () => backendDailyCardCandidates,
    [backendDailyCardCandidates],
  );
  const leadDailyCardCandidate = dailyCardCandidates[0] ?? null;
  const leadDailyCardHitChance = useMemo(
    () => resolvePrecisionHitChance(leadDailyCardCandidate?.precision),
    [leadDailyCardCandidate],
  );

  const researchTabMeta = useMemo(
    () => RESEARCH_TABS.find((tab) => tab.key === activeResearchTab) ?? RESEARCH_TABS[0],
    [activeResearchTab],
  );

  const researchMatchupPreview = useMemo(() => {
    const matchupsOnPage = matchup
      ? activeData.teamMatchups.filter((item) => item.matchupKey === matchup)
      : activeData.teamMatchups;

    return matchupsOnPage.slice(0, 3).map((item) => {
      const matchupSignals = allQualifiedCandidates.filter((candidate) => candidate.row.matchupKey === item.matchupKey);
      return {
        item,
        signalCount: matchupSignals.length,
        topSignals: matchupSignals.slice(0, 2),
      };
    });
  }, [activeData.teamMatchups, allQualifiedCandidates, matchup]);

  const recentResearchPreview = useMemo(() => {
    const precisionPreview = dailyCardCandidates.slice(0, 3).map((entry) => {
      const chance = resolvePrecisionHitChance(entry.precision);
      return {
        id: `precision-${entry.candidate.row.playerId}-${entry.candidate.market}`,
        title: `${entry.candidate.row.playerName} ${entry.candidate.market}`,
        subtitle: `${entry.candidate.row.teamCode} vs ${entry.candidate.row.opponentCode} | ${entry.candidate.row.gameTimeEt}`,
        metric: formatChanceValue(chance.value),
        note: entry.candidate.reasons[0] ?? entry.candidate.supportText,
      };
    });

    if (precisionPreview.length > 0) {
      return precisionPreview;
    }

    return strongProjectionCandidates.slice(0, 3).map((candidate) => ({
      id: `projection-${candidate.row.playerId}-${candidate.market}`,
      title: `${candidate.row.playerName} ${candidate.market}`,
      subtitle: `${candidate.row.teamCode} vs ${candidate.row.opponentCode} | ${candidate.row.gameTimeEt}`,
      metric: `Gap ${formatAverage(candidate.projGap, true)}`,
      note: candidate.reasons[0] ?? candidate.supportText,
    }));
  }, [dailyCardCandidates, strongProjectionCandidates]);

  const scoutFeedPreview = useMemo(() => allQualifiedCandidates.slice(0, 3), [allQualifiedCandidates]);

  const [showAllStrongProjections, setShowAllStrongProjections] = useState(false);
  const STRONG_PROJ_PREVIEW = 6;
  const visibleStrongProjections = useMemo(
    () => (showAllStrongProjections ? strongProjectionCandidates : strongProjectionCandidates.slice(0, STRONG_PROJ_PREVIEW)),
    [strongProjectionCandidates, showAllStrongProjections],
  );

  const displayedCandidates = useMemo(() => {
    if (showQualifiedOnly && qualifiedCandidates.length > 0) return qualifiedCandidates;
    return focusCandidates;
  }, [focusCandidates, qualifiedCandidates, showQualifiedOnly]);

  const matchupFocusCards = useMemo(() => {
    if (!showAdvancedView) return [];
    return filteredTeamMatchups.map((item) => {
      const candidates = focusCandidates.filter((candidate) => candidate.row.matchupKey === item.matchupKey);
      return {
        item,
        totalFocus: candidates.filter((candidate) => candidate.focusTier !== "DEEP").length,
        qualifiedCount: candidates.filter((candidate) => candidate.signalQualified).length,
        topCandidates: candidates.slice(0, 3),
      };
    });
  }, [filteredTeamMatchups, focusCandidates, showAdvancedView]);

  const selectedMinutesFloor = 22;
  const qualifiedFocusCount = useMemo(
    () =>
      market === "ALL"
        ? allQualifiedCandidates.length
        : allQualifiedCandidates.filter((candidate) => candidate.market === market).length,
    [allQualifiedCandidates, market],
  );

  useEffect(() => {
    if (playerSuggestions.length === 0) {
      setPlayerSuggestIndex(-1);
      return;
    }
    if (playerSuggestIndex >= playerSuggestions.length) {
      setPlayerSuggestIndex(0);
    }
  }, [playerSuggestions, playerSuggestIndex]);

  function applyPlayerSuggestion(row: SnapshotRow): void {
    setPlayerSearch(row.playerName);
    setPlayerSuggestOpen(false);
    setPlayerSuggestIndex(-1);
    setPlayerLookupError(null);
    openPlayerDetail(row, null);
  }

  function jumpToSection(sectionId: string): void {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openAllQualifiedBoard(): void {
    setShowSecondarySignals(true);
    window.setTimeout(() => jumpToSection("all-qualified-section"), 40);
  }

  function openFeedbackPage(): void {
    router.push("/feedback");
  }

  async function openDonationCheckout(): Promise<void> {
    if (isDonationLoading) return;
    setDonationError(null);
    setDonationMessage(null);
    setIsDonationLoading(true);

    try {
      const response = await fetch("/api/donate/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Unable to open donation checkout right now.");
      }

      window.location.assign(payload.url);
    } catch (error) {
      setDonationError(error instanceof Error ? error.message : "Unable to open donation checkout right now.");
    } finally {
      setIsDonationLoading(false);
    }
  }

  function focusPlayerLookup(): void {
    const target = document.getElementById("player-search-input") as HTMLInputElement | null;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => target.focus(), 120);
  }

  return (
    <main className="app-shell mx-auto max-w-[1680px] px-4 pb-16 pt-5 sm:px-6 lg:px-10">
      <section className="space-y-5">
        <div className="surface-nav">
          <div className="flex items-center gap-4">
            <div>
              <p className="surface-eyebrow">ULTOPS NBA</p>
              <p className="title-font text-[1.9rem] leading-none text-white sm:text-[2.5rem]">Player Prop Intelligence</p>
            </div>
            <span className="product-chip product-chip--cyan">Premium Research Platform</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => jumpToSection("daily-card-section")} className="nav-link">
              Precision Card
            </button>
            <button type="button" onClick={() => jumpToSection("raw-model-section")} className="nav-link">
              Research Center
            </button>
            <button
              type="button"
              onClick={showSecondarySignals ? () => setShowSecondarySignals(false) : openAllQualifiedBoard}
              className="nav-link"
            >
              {showSecondarySignals ? "Hide Scout Feed" : "Scout Feed"}
            </button>
            <button
              type="button"
              onClick={openFeedbackPage}
              className="secondary-action"
            >
              Feedback
            </button>
            <button
              type="button"
              onClick={openDonationCheckout}
              disabled={isDonationLoading}
              className="rounded-full border border-amber-300/30 bg-amber-500/10 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-100 transition hover:bg-amber-500/18 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDonationLoading ? "Opening Support..." : "Support ULTOPS"}
            </button>
            <button type="button" onClick={() => setGuideOpen(true)} className="nav-link">
              Methodology
            </button>
          </div>
        </div>

        <div className="product-hero px-5 py-5 sm:px-6 sm:py-6">
          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="hero-copy-stack space-y-6">
              <div>
                <p className="hero-kicker">Institutional NBA Prop Research</p>
                <h1 className="hero-title">ULTOPS finds the best NBA prop edges fast.</h1>
                <p className="hero-copy">
                  Precision Card first. Live line context, matchup research, and full player-by-player detail stay close
                  behind it so the product feels sharp, credible, and ready to sell.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="product-chip product-chip--cyan">Ranked Precision Card</span>
                <span className="product-chip product-chip--teal">Consensus Line Tracking</span>
                <span className="product-chip product-chip--gold">Premium Research Tools</span>
              </div>

              <div className="stat-grid md:grid-cols-3">
                <div className="stat-tile">
                  <p className="stat-label">Live Card</p>
                  <p className="stat-value">
                    {activeData.precisionSystem ? dailyCardCandidates.length : allQualifiedCandidates.length}
                  </p>
                  <p className="stat-note">
                    {activeData.precisionSystem
                      ? `${activeData.precisionSystem.label} ready`
                      : "Precision board warming up"}
                  </p>
                </div>
                <div className="stat-tile">
                  <p className="stat-label">
                    {activeData.precisionSystem?.accuracyLabel ?? "Backtest Rate"}
                  </p>
                  <p className="stat-value">
                    {activeData.precisionSystem ? `${formatStat(activeData.precisionSystem.historicalAccuracy)}%` : "-"}
                  </p>
                  <p className="stat-note">Verified benchmark for the promoted card</p>
                </div>
                <div className="stat-tile">
                  <p className="stat-label">Rows On Slate</p>
                  <p className="stat-value">{filteredRows.length}</p>
                  <p className="stat-note">{qualifiedFocusCount} lower-priority signals behind the card</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => jumpToSection("daily-card-section")} className="primary-action">
                  View Precision Card
                </button>
                <button type="button" onClick={() => jumpToSection("raw-model-section")} className="secondary-action">
                  Open Research Center
                </button>
                <button type="button" onClick={showSecondarySignals ? () => setShowSecondarySignals(false) : openAllQualifiedBoard} className="tertiary-action">
                  {showSecondarySignals ? "Hide Scout Feed" : "Open Scout Feed"}
                </button>
              </div>
            </div>

            <div className="hero-preview-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="section-kicker">Live Precision Preview</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Tonight&apos;s headline edge</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    A live preview of the top-ranked precision case, so the page sells the value immediately before anyone
                    dives into the deeper research workflow.
                  </p>
                </div>
                <span className="badge badge-premium">Premium View</span>
              </div>

              {leadDailyCardCandidate ? (
                <div className="mt-5 space-y-4">
                  <div className="rounded-[22px] border border-white/10 bg-black/15 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="badge badge-premium">Top Precision Pick</span>
                          <span className="badge">{leadDailyCardCandidate.candidate.market}</span>
                        </div>
                        <h3 className="mt-3 text-2xl font-semibold text-white">
                          {leadDailyCardCandidate.candidate.row.playerName}
                        </h3>
                        <p className="mt-1 text-sm text-slate-400">
                          {leadDailyCardCandidate.candidate.row.teamCode} vs {leadDailyCardCandidate.candidate.row.opponentCode} | {leadDailyCardCandidate.candidate.row.gameTimeEt}
                        </p>
                      </div>
                      <div className="rounded-[20px] border border-blue-300/20 bg-blue-500/10 px-5 py-4 text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">Recommendation</p>
                        <p className="mt-2 text-2xl font-semibold text-white">
                          {leadDailyCardCandidate.precision?.side ?? leadDailyCardCandidate.candidate.display?.side ?? leadDailyCardCandidate.candidate.modelLine.modelSide}{" "}
                          {formatAverage(leadDailyCardCandidate.candidate.currentLine)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="insight-card">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Hit Chance</p>
                        <p className="mt-2 text-xl font-semibold text-white">{formatChanceValue(leadDailyCardHitChance.value)}</p>
                      </div>
                      <div className="insight-card">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Line In Focus</p>
                        <p className="mt-2 text-xl font-semibold text-white">
                          {leadDailyCardCandidate.candidate.currentLineLabel}
                        </p>
                      </div>
                      <div className="insight-card">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Case Summary</p>
                        <p className="mt-2 text-sm leading-6 text-slate-200">
                          {leadDailyCardCandidate.candidate.reasons[0] ?? leadDailyCardCandidate.candidate.supportText}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="stat-tile">
                      <p className="stat-label">Last Updated</p>
                      <p className="stat-value text-[1.2rem]">{formatIsoToEtTime(activeData.lastUpdatedAt)}</p>
                    </div>
                    <div className="stat-tile">
                      <p className="stat-label">{activeData.precisionSystem?.picksPerDayLabel ?? "Picks/Day"}</p>
                      <p className="stat-value">
                        {activeData.precisionSystem?.historicalPicksPerDay != null
                          ? formatStat(activeData.precisionSystem.historicalPicksPerDay)
                          : "-"}
                      </p>
                    </div>
                    <div className="stat-tile">
                      <p className="stat-label">Research Depth</p>
                      <p className="stat-value">{allQualifiedCandidates.length}</p>
                      <p className="stat-note">Broader signals behind the main card</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-[22px] border border-white/10 bg-black/15 px-5 py-5 text-sm leading-6 text-slate-300">
                  The live preview will populate as soon as the board loads a precision card for the selected date.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="sticky-toolbar">
          <div className="command-bar">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="control-kicker">Trading Toolbar</p>
                <h2 className="control-title">Load the slate, refresh the market, and inspect any player instantly.</h2>
                <p className="control-copy">
                  Keep the controls tight and visible while you move between the Precision Card, Research Center, and Scout Feed.
                </p>
              </div>
              <span className="badge">
                {activeData.matchups.length} game{activeData.matchups.length === 1 ? "" : "s"} on slate
              </span>
            </div>

            <form onSubmit={handleLoadData} className="mt-4 grid gap-3 xl:grid-cols-[150px_220px_180px_145px_145px_minmax(320px,1fr)]">
              <label className="control-label">
                Date
                <input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="control-input cursor-pointer"
                />
              </label>
              <label className="control-label">
                Matchup
                <select
                  value={matchup}
                  onChange={(e) => setMatchup(e.target.value)}
                  className="control-input cursor-pointer"
                >
                  <option value="">All Matchups</option>
                  {activeData.matchups.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="control-label">
                Market
                <select
                  value={market}
                  onChange={(e) => setMarket(e.target.value as MarketFilter)}
                  className="control-input cursor-pointer"
                >
                  {MARKET_FILTER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={isBoardLoading} className="primary-action self-end disabled:opacity-50">
                {isBoardLoading ? "Loading..." : "Load Board"}
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="secondary-action self-end disabled:opacity-50"
              >
                {isRefreshing ? "Refreshing..." : "Refresh Live"}
              </button>

              <div className="relative self-end">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  id="player-search-input"
                  value={playerSearch}
                  onFocus={() => {
                    setPlayerSuggestOpen(true);
                    setPlayerSuggestIndex(-1);
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setPlayerSuggestOpen(false);
                      setPlayerSuggestIndex(-1);
                    }, 120);
                  }}
                  onChange={(e) => {
                    setPlayerSearch(e.target.value);
                    setPlayerSuggestOpen(true);
                    setPlayerSuggestIndex(-1);
                  }}
                  onKeyDown={(event) => {
                    if (!playerSuggestOpen && event.key === "ArrowDown" && playerSuggestions.length > 0) {
                      event.preventDefault();
                      setPlayerSuggestOpen(true);
                      setPlayerSuggestIndex(0);
                      return;
                    }
                    if (!playerSuggestOpen) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setPlayerSuggestIndex((c) => (c + 1 >= playerSuggestions.length ? 0 : c + 1));
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setPlayerSuggestIndex((c) => (c <= 0 ? playerSuggestions.length - 1 : c - 1));
                      return;
                    }
                    if (event.key === "Enter" && playerSuggestIndex >= 0 && playerSuggestIndex < playerSuggestions.length) {
                      event.preventDefault();
                      applyPlayerSuggestion(playerSuggestions[playerSuggestIndex]);
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handlePlayerLookup();
                      return;
                    }
                    if (event.key === "Escape") {
                      setPlayerSuggestOpen(false);
                      setPlayerSuggestIndex(-1);
                    }
                  }}
                  placeholder="Search any player and open the full case..."
                  className="control-input pl-10 pr-3"
                />
                {playerSuggestOpen && playerSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 max-h-64 overflow-y-auto rounded-2xl border border-white/10 bg-[#091426] shadow-2xl">
                    {playerSuggestions.map((row, idx) => (
                      <button
                        key={`suggest-${row.playerId}`}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyPlayerSuggestion(row);
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs ${
                          idx === playerSuggestIndex ? "bg-blue-500/18 text-blue-100" : "text-slate-200 hover:bg-white/5"
                        }`}
                      >
                        <span className="font-medium">{row.playerName}</span>
                        <span className="text-[10px] text-slate-400">
                          {row.teamCode} vs {row.opponentCode}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </form>
          </div>
        </div>

        {donationMessage && <p className="notice-banner notice-banner--info">{donationMessage}</p>}
        {donationError && <p className="notice-banner notice-banner--error">{donationError}</p>}
        {refreshMessage && <p className="notice-banner notice-banner--success">{refreshMessage}</p>}
        {refreshError && <p className="notice-banner notice-banner--error">{refreshError}</p>}
        {playerLookupError && <p className="notice-banner notice-banner--error">{playerLookupError}</p>}
        {boardError && <p className="notice-banner notice-banner--error">{boardError}</p>}
      </section>

      {activeData.precisionSystem ? (
        <section
          id="daily-card-section"
          className="section-shell section-shell--teal mt-10 p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-teal-100/70">{activeData.precisionSystem.label}</p>
              <h2 className="mt-1 text-3xl font-semibold text-white">Today&apos;s {activeData.precisionSystem.label} Card</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-200/90">
                {`This card is selected on the backend from precision-only ${activeData.precisionSystem.label} signals. When the strict slate runs thin, the selector uses a narrow precision rescue stage instead of falling back to secondary or raw-model fill.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <div className="rounded-2xl border border-teal-300/15 bg-teal-500/[0.08] px-3 py-2">
                <p className="uppercase tracking-[0.12em] text-teal-100/70">Top Card</p>
                <p className="mt-1 text-xl font-semibold text-white">{dailyCardCandidates.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0b1628] px-3 py-2">
                <p className="uppercase tracking-[0.12em] text-slate-300/70">
                  {activeData.precisionSystem.accuracyLabel ?? "Hist Rate"}
                </p>
                <p className="mt-1 text-xl font-semibold text-white">{formatStat(activeData.precisionSystem.historicalAccuracy)}%</p>
              </div>
              {activeData.precisionSystem.historicalPicksPerDay != null ? (
                <div className="rounded-2xl border border-white/10 bg-[#0b1628] px-3 py-2">
                  <p className="uppercase tracking-[0.12em] text-slate-300/70">
                    {activeData.precisionSystem.picksPerDayLabel ?? "Picks/Day"}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-white">{formatStat(activeData.precisionSystem.historicalPicksPerDay)}</p>
                </div>
              ) : null}
            </div>
          </div>
          {activeData.precisionSystem.note ? (
            <p className="mt-3 rounded-2xl border border-cyan-300/15 bg-cyan-500/[0.08] px-4 py-3 text-xs text-cyan-50/90">
              {activeData.precisionSystem.note}
            </p>
          ) : null}

          {dailyCardCandidates.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-white/10 bg-black/15 px-5 py-5 text-sm text-slate-300">
              No live {activeData.precisionSystem.label} picks are ready on this slate yet. Refresh the board once the latest lines finish loading.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-[26px] border border-white/10 bg-black/15 px-5 py-5 text-sm text-slate-300">
                <p className="font-semibold text-white">
                  {`This section only shows the final backend ${activeData.precisionSystem.label} card. ${dailyCardCandidates.length} of ${precisionCardTargetCount} card slot${precisionCardTargetCount === 1 ? "" : "s"} ${dailyCardCandidates.length === 1 ? "is" : "are"} loaded for this slate.`}
                </p>
                <p className="mt-2">
                  Every pick shown here comes from the final precision-only backend card and is ranked from strongest to weakest for today&apos;s slate.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {dailyCardCandidates.map((entry, index) => {
                  const side =
                    entry.precision?.side ?? entry.candidate.display?.side ?? entry.candidate.modelLine.modelSide;
                  const isLead = index === 0;
                  const hitChance = resolvePrecisionHitChance(entry.precision);

                  return (
                    <button
                        key={`daily-card-${entry.candidate.row.playerId}-${entry.candidate.market}`}
                        type="button"
                        onClick={() => {
                          setPlayerLookupError(null);
                          openPlayerDetail(entry.candidate.row, null, entry.candidate.market);
                        }}
                        className={`group rounded-[28px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_22px_48px_-32px_rgba(15,23,42,0.9)] ${
                          isLead
                          ? "border-blue-300/28 bg-[linear-gradient(150deg,rgba(88,166,255,0.14)_0%,rgba(17,24,39,0.94)_45%,rgba(8,15,29,0.98)_100%)] xl:col-span-3"
                          : "border-white/10 bg-[#0b1527]/88 hover:bg-[#101c33]"
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            {isLead && (
                              <span className="rounded-full border border-blue-300/30 bg-[linear-gradient(110deg,rgba(88,166,255,0.9),rgba(59,130,246,0.9))] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white shadow-[0_0_12px_rgba(59,130,246,0.35)]">
                                Top Pick
                              </span>
                            )}
                            <span
                              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${dailyCardSourceClass(entry.source)}`}
                            >
                              {dailyCardSourceLabel(entry.source)}
                            </span>
                            <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300 font-semibold border border-white/5">
                              {entry.candidate.market}
                            </span>
                          </div>
                          <div>
                            <h3 className={`font-bold text-white tracking-tight ${isLead ? "text-3xl" : "text-xl"}`}>
                              {entry.candidate.row.playerName}
                            </h3>
                            <p className="mt-1 text-sm font-medium text-slate-400">
                              {entry.candidate.row.teamCode} vs {entry.candidate.row.opponentCode} • {entry.candidate.row.gameTimeEt}
                            </p>
                          </div>
                        </div>

                        <div className={`mt-2 md:mt-0 flex flex-col items-center justify-center rounded-2xl border px-6 py-3 shadow-md ${side === 'OVER' ? 'bg-sky-500/10 border-sky-400/20 text-sky-300' : side === 'UNDER' ? 'bg-rose-500/10 border-rose-400/20 text-rose-300' : 'bg-slate-500/10 border-slate-400/20 text-slate-300'}`}>
                          <span className="text-[10px] uppercase tracking-widest font-bold opacity-70 mb-1">Recommendation</span>
                          <span className="text-xl font-black">
                            {side === "NEUTRAL" ? "WAIT" : `${side} ${formatAverage(entry.candidate.currentLine)}`}
                          </span>
                        </div>
                      </div>

                      <div className="mt-5 rounded-xl bg-black/20 p-4 border border-white/5">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          Hit Chance
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-white">{formatChanceValue(hitChance.value)}</p>
                        <p className="mt-2 text-sm leading-relaxed text-slate-300">
                          {hitChance.subtitle ?? "Best available hit estimate for this pick."}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
              {/*
              <div className="rounded-[26px] border border-white/10 bg-black/15 px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-teal-100/70">All True {activeData.precisionSystem.label} Picks</p>
                    <h3 className="mt-1 text-lg font-semibold text-white">
                      {precisionCandidates.length} true {activeData.precisionSystem.label} pick{precisionCandidates.length === 1 ? "" : "s"} under the current filters
                    </h3>
                    <p className="mt-1 max-w-3xl text-sm text-slate-300">
                      This list shows every true {activeData.precisionSystem.label} selection under the current filters. Each row leads with the best available hit chance for tonight&apos;s call, using the game-specific precision probability when available.
                    </p>
                  </div>
                  {precisionCandidates.length > precisionCardTargetCount ? (
                    <button
                      type="button"
                      onClick={() => setShowAllCoreSixPicks((current) => !current)}
                      className="rounded-full border border-teal-300/30 bg-teal-500/12 px-3 py-1.5 text-xs font-semibold text-teal-100 transition hover:bg-teal-500/20"
                    >
                      {showAllCoreSixPicks ? `Show Top ${precisionCardTargetCount}` : `Show All ${precisionCandidates.length}`}
                    </button>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {visibleCoreSixCandidates.map((candidate, index) => {
                    const side = candidate.precision.side ?? candidate.display?.side ?? candidate.modelLine.modelSide;
                    const hitChance = resolvePrecisionHitChance(candidate.precision);
                    return (
                      <button
                        key={`all-core-six-${candidate.row.playerId}-${candidate.market}`}
                        type="button"
                        onClick={() => {
                          setPlayerLookupError(null);
                          openPlayerDetail(candidate.row, null, candidate.market);
                        }}
                        className="rounded-[22px] border border-white/10 bg-[#0b1527]/88 p-4 text-left transition hover:-translate-y-0.5 hover:bg-[#101c33]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-teal-300/35 bg-teal-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-100">
                                #{index + 1}
                              </span>
                              <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300 font-semibold border border-white/5">
                                {candidate.market}
                              </span>
                            </div>
                            <h4 className="mt-2 text-lg font-semibold text-white">{candidate.row.playerName}</h4>
                            <p className="mt-1 text-xs text-slate-400">
                              {candidate.row.teamCode} vs {candidate.row.opponentCode} • {candidate.row.gameTimeEt}
                            </p>
                          </div>
                          <div className={`flex min-w-[120px] flex-col items-center justify-center rounded-2xl border px-4 py-3 text-center ${side === "OVER" ? "border-sky-400/20 bg-sky-500/10 text-sky-300" : side === "UNDER" ? "border-rose-400/20 bg-rose-500/10 text-rose-300" : "border-slate-400/20 bg-slate-500/10 text-slate-300"}`}>
                            <span className="text-[10px] uppercase tracking-widest font-bold opacity-70">Recommendation</span>
                            <span className="mt-1 text-base font-black">
                              {side === "NEUTRAL" ? "WAIT" : `${side} ${formatAverage(candidate.currentLine)}`}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-xl border border-white/8 bg-black/15 px-3 py-2">
                            <p className="uppercase tracking-[0.12em] text-slate-500">Hit Chance</p>
                            <p className="mt-1 text-sm font-semibold text-white">{formatChanceValue(hitChance.value)}</p>
                          </div>
                          <div className="rounded-xl border border-white/8 bg-black/15 px-3 py-2">
                            <p className="uppercase tracking-[0.12em] text-slate-500">Gap</p>
                            <p className="mt-1 text-sm font-semibold text-white">{candidate.precision.absLineGap == null ? "-" : formatStat(candidate.precision.absLineGap)}</p>
                          </div>
                          <div className="rounded-xl border border-white/8 bg-black/15 px-3 py-2">
                            <p className="uppercase tracking-[0.12em] text-slate-500">Leaf</p>
                            <p className="mt-1 text-sm font-semibold text-white">{candidate.precision.leafAccuracy == null ? "-" : `${formatStat(candidate.precision.leafAccuracy)}%`}</p>
                          </div>
                          <div className="rounded-xl border border-white/8 bg-black/15 px-3 py-2">
                            <p className="uppercase tracking-[0.12em] text-slate-500">Bucket</p>
                            <p className="mt-1 text-sm font-semibold text-white">{candidate.precision.bucketRecentAccuracy == null ? "-" : `${formatStat(candidate.precision.bucketRecentAccuracy)}%`}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              */}
            </div>
          )}
        </section>
      ) : null}

      {showSecondarySignals && strongProjectionCandidates.length > 0 && (
        <section id="strong-projections-section" className="section-shell section-shell--violet mt-6 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-purple-200/80">Strong Projections</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">High-Confidence Projection Overs</h2>
              <p className="mt-2 text-sm text-slate-400 max-w-2xl">
                Players where the model&apos;s projection clears the live consensus line by a significant margin and the live signal still points over.
                Thresholds: PTS +5, REB +2, AST +2, THREES +1.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-center">
              <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Picks</p>
                <p className="mt-1 text-xl font-semibold text-white">{strongProjectionCandidates.length}</p>
              </div>
            </div>
          </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleStrongProjections.map((candidate, index) => {
              const projection = candidate.row.projectedTonight[candidate.market];
              const line = candidate.currentLine ?? candidate.modelLine.fairLine;
              return (
                <button
                  key={`strong-proj-${candidate.row.playerId}-${candidate.market}`}
                  type="button"
                  onClick={() => {
                    setPlayerLookupError(null);
                    openPlayerDetail(candidate.row, null, candidate.market);
                  }}
                  className="rounded-[22px] border border-purple-300/15 bg-[#0b1527]/88 p-4 text-left transition hover:-translate-y-0.5 hover:bg-[#12102e]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-purple-300/35 bg-purple-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-purple-100">
                          #{index + 1}
                        </span>
                        <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300 font-semibold border border-white/5">
                          {candidate.market}
                        </span>
                      </div>
                      <h4 className="mt-2 text-lg font-semibold text-white">{candidate.row.playerName}</h4>
                      <p className="mt-1 text-xs text-slate-400">
                        {candidate.row.teamCode} vs {candidate.row.opponentCode} &bull; {candidate.row.gameTimeEt}
                      </p>
                    </div>
                    <div className="flex min-w-[120px] flex-col items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-center text-sky-300">
                      <span className="text-[10px] uppercase tracking-widest font-bold opacity-70">Projection</span>
                      <span className="mt-1 text-base font-black">
                        OVER {formatAverage(line)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/8 bg-black/15 px-3 py-2">
                      <p className="uppercase tracking-[0.12em] text-slate-500">Projection</p>
                      <p className="mt-1 text-sm font-semibold text-white">{formatAverage(projection)}</p>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-black/15 px-3 py-2">
                      <p className="uppercase tracking-[0.12em] text-slate-500">Line</p>
                      <p className="mt-1 text-sm font-semibold text-white">{formatAverage(line)}</p>
                    </div>
                    <div className="rounded-xl border border-purple-400/15 bg-purple-500/8 px-3 py-2">
                      <p className="uppercase tracking-[0.12em] text-purple-300/80">Gap</p>
                      <p className="mt-1 text-sm font-semibold text-purple-200">+{formatAverage(candidate.projGap)}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {strongProjectionCandidates.length > STRONG_PROJ_PREVIEW && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShowAllStrongProjections((prev) => !prev)}
                className="rounded-full border border-purple-300/25 bg-purple-500/10 px-5 py-2 text-xs font-semibold text-purple-100 transition hover:bg-purple-500/20"
              >
                {showAllStrongProjections ? `Show Top ${STRONG_PROJ_PREVIEW}` : `Show All ${strongProjectionCandidates.length}`}
              </button>
            </div>
          )}
        </section>
      )}

      <section id="raw-model-section" className="section-shell section-shell--emerald mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Research Center</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Full player intelligence without the clutter.</h2>
            <p className="section-copy mt-2 max-w-3xl">
              Switch between the core research lenses instead of stacking long utility blocks. The player search in the
              toolbar still opens the full case for any player on the slate.
            </p>
          </div>
          <button type="button" onClick={focusPlayerLookup} className="secondary-action">
            Open Player Lookup
          </button>
        </div>

        <div className="research-tabs mt-5">
          {RESEARCH_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveResearchTab(tab.key)}
              className={`research-tab ${activeResearchTab === tab.key ? "research-tab--active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-sm text-slate-400">{researchTabMeta.description}</p>

        {activeResearchTab === "trends" ? (
          activeData.universalSystem ? (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="insight-card">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">WF Raw</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{formatStat(activeData.universalSystem.walkForwardRawAccuracy)}%</p>
                </div>
                <div className="insight-card">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">30D Raw</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{formatStat(activeData.universalSystem.replayRawAccuracy)}%</p>
                </div>
                <div className="insight-card">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">WF Blended</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{formatStat(activeData.universalSystem.walkForwardBlendedAccuracy)}%</p>
                </div>
                <div className="insight-card">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Coverage</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{formatStat(activeData.universalSystem.walkForwardCoveragePct)}%</p>
                </div>
              </div>
              <div className="rounded-[18px] border border-amber-300/15 bg-amber-500/[0.08] px-4 py-4 text-sm leading-6 text-slate-200">
                {activeData.universalSystem.note}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-[18px] border border-white/10 bg-black/15 px-4 py-4 text-sm leading-6 text-slate-300">
              Raw model summary is still loading, but the player lookup will still open a full research case from the toolbar.
            </div>
          )
        ) : null}

        {activeResearchTab === "splits" ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="insight-card">
                <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Card Target</p>
                <p className="mt-2 text-2xl font-semibold text-white">{precisionCardTargetCount}</p>
              </div>
              <div className="insight-card">
                <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Rows On Slate</p>
                <p className="mt-2 text-2xl font-semibold text-white">{filteredRows.length}</p>
              </div>
              <div className="insight-card">
                <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Lower-Priority Signals</p>
                <p className="mt-2 text-2xl font-semibold text-white">{allQualifiedCandidates.length}</p>
              </div>
            </div>
            <div className="rounded-[18px] border border-white/10 bg-black/15 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Market Mix</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {allQualifiedMarketSummary.length > 0 ? (
                  allQualifiedMarketSummary.map((option) => (
                    <span key={`research-split-${option.value}`} className="badge">
                      {option.value}: {option.count}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-300">No broader market mix available under the current filters yet.</span>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {activeResearchTab === "matchup" ? (
          <div className="mt-4 grid gap-3">
            {researchMatchupPreview.length > 0 ? (
              researchMatchupPreview.map(({ item, signalCount, topSignals }) => (
                <div key={`research-matchup-${item.matchupKey}`} className="editorial-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{item.awayTeam} at {item.homeTeam}</p>
                      <p className="editorial-meta mt-1">{item.gameTimeEt}</p>
                    </div>
                    <span className="badge">{signalCount} signals</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {topSignals.length > 0 ? (
                      topSignals.map((candidate) => (
                        <button
                          key={`matchup-preview-${candidate.row.playerId}-${candidate.market}`}
                          type="button"
                          onClick={() => {
                            setPlayerLookupError(null);
                            openPlayerDetail(candidate.row, null, candidate.market);
                          }}
                          className="flex w-full items-center justify-between gap-3 rounded-[16px] border border-white/10 bg-black/15 px-3 py-3 text-left hover:bg-white/[0.04]"
                        >
                          <div>
                            <p className="text-sm font-medium text-white">{candidate.row.playerName}</p>
                            <p className="editorial-meta mt-1">{candidate.market} | {candidate.currentLineLabel}</p>
                          </div>
                          <span className="badge">{candidate.display?.side ?? candidate.modelLine.modelSide}</span>
                        </button>
                      ))
                    ) : (
                      <p className="text-sm text-slate-300">No standout signals for this matchup under the current filters yet.</p>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[18px] border border-white/10 bg-black/15 px-4 py-4 text-sm leading-6 text-slate-300">
                Matchup research will populate once the slate loads game environments for the selected filters.
              </div>
            )}
          </div>
        ) : null}

        {activeResearchTab === "recent" ? (
          <div className="mt-4 grid gap-3">
            {recentResearchPreview.length > 0 ? (
              recentResearchPreview.map((item) => (
                <div key={item.id} className="editorial-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <p className="editorial-meta mt-1">{item.subtitle}</p>
                    </div>
                    <span className="badge">{item.metric}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-200">{item.note}</p>
                </div>
              ))
            ) : (
              <div className="rounded-[18px] border border-white/10 bg-black/15 px-4 py-4 text-sm leading-6 text-slate-300">
                Recent form previews will appear here once the board has either a live precision card or projection pocket data.
              </div>
            )}
          </div>
        ) : null}

        {activeResearchTab === "notes" ? (
          <div className="mt-4 space-y-3">
            <div className="editorial-card">
              <p className="text-sm font-semibold text-white">Product positioning</p>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                Precision Card is the sellable front door. Research Center is the premium support layer that explains the
                edge without overpowering the main picks.
              </p>
            </div>
            <div className="editorial-card">
              <p className="text-sm font-semibold text-white">Operator note</p>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                {activeData.precisionSystem?.note ?? "Load the board to view the latest precision note for this slate."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setGuideOpen(true)} className="secondary-action">
                View Methodology
              </button>
              <button type="button" onClick={focusPlayerLookup} className="primary-action">
                Search A Player
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section id="player-raw-section" className="section-shell section-shell--violet mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="section-kicker">Scout Feed</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Editorial looks beyond the main card.</h2>
            <p className="section-copy mt-2">
              These are broader raw-model signals rendered as a calmer analyst feed. They support the product, but they do
              not compete with the Precision Card.
            </p>
          </div>
          <span className="badge badge-premium">{scoutFeedPreview.length} previewed</span>
        </div>

        <div className="mt-4 space-y-3">
          {scoutFeedPreview.length > 0 ? (
            scoutFeedPreview.map((candidate) => {
              const side = candidate.display?.side ?? candidate.modelLine.modelSide;
              const hitChance = resolveMarketHitChance(candidate.row, candidate.market, candidate.display);
              return (
                <button
                  key={`scout-preview-${candidate.row.playerId}-${candidate.market}`}
                  type="button"
                  onClick={() => {
                    setPlayerLookupError(null);
                    openPlayerDetail(candidate.row, null, candidate.market);
                  }}
                  className="editorial-card w-full text-left transition hover:bg-white/[0.04]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="badge">{candidate.market}</span>
                        <span className="badge">{side === "NEUTRAL" ? "Hold" : `${side} ${formatAverage(candidate.currentLine)}`}</span>
                      </div>
                      <p className="mt-3 text-lg font-semibold text-white">{candidate.row.playerName}</p>
                      <p className="editorial-meta mt-1">
                        {candidate.row.teamCode} vs {candidate.row.opponentCode} | {candidate.row.gameTimeEt}
                      </p>
                    </div>
                    <div className="rounded-[16px] border border-white/10 bg-black/15 px-4 py-3 text-right">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Edge</p>
                      <p className="mt-2 text-lg font-semibold text-white">{formatChanceValue(hitChance.value)}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-200">
                    {candidate.reasons[0] ?? candidate.supportText}
                  </p>
                </button>
              );
            })
          ) : (
            <div className="rounded-[18px] border border-white/10 bg-black/15 px-4 py-4 text-sm leading-6 text-slate-300">
              No broader feed items are available on this slate yet.
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={showSecondarySignals ? () => setShowSecondarySignals(false) : openAllQualifiedBoard}
            className="secondary-action"
          >
            {showSecondarySignals ? "Hide Full Scout Feed" : `Open Full Scout Feed (${allQualifiedCandidates.length})`}
          </button>
          <button type="button" onClick={() => jumpToSection("deep-board")} className="tertiary-action">
            Open Full Slate Board
          </button>
        </div>
      </section>

      {showSecondarySignals ? (
      <section id="all-qualified-section" className="section-shell section-shell--cyan mt-6 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">Scout Feed</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">Broader Raw-Model Signals Across The Slate</h2>
            <p className="mt-1 text-sm text-slate-300">
              These are broader model signals outside the promoted {activeData.precisionSystem?.label ?? "Precision Card"}.
              Keep them for extra context only; they are no longer the homepage focus.
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 px-3 py-2 text-right text-xs text-cyan-50">
              <p className="uppercase tracking-[0.14em] text-cyan-100/70">Signals On Page</p>
            <p className="mt-1 text-2xl font-semibold text-white">{allQualifiedCandidates.length}</p>
          </div>
        </div>

        {allQualifiedMarketSummary.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {allQualifiedMarketSummary.map((option) => (
              <span
                key={`all-qualified-summary-${option.value}`}
                className="rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-100"
              >
                {option.value}: {option.count}
              </span>
            ))}
          </div>
        ) : null}

        {allQualifiedCandidates.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-slate-300/15 bg-[#0d162d] px-4 py-5 text-sm text-slate-300">
            No broader raw-model signals are showing across any market for the current filters yet.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {allQualifiedCandidates.map((candidate, index) => {
              const side = candidate.display?.side ?? candidate.modelLine.modelSide;

              return (
                <button
                  key={`qualified-all-${candidate.row.playerId}-${candidate.market}`}
                  type="button"
                  onClick={() => {
                    setPlayerLookupError(null);
                    openPlayerDetail(candidate.row, null, candidate.market);
                  }}
                  className={`rounded-[26px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_22px_48px_-32px_rgba(15,23,42,0.9)] ${
                    index === 0
                      ? "border-cyan-300/30 bg-[linear-gradient(150deg,rgba(6,182,212,0.12)_0%,rgba(17,24,39,0.94)_48%,rgba(8,15,29,0.98)_100%)]"
                      : "border-white/10 bg-[#0b1527]/88 hover:bg-[#101c33]"
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300 font-semibold border border-white/5">
                          {candidate.market}
                        </span>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold tracking-tight text-white">{candidate.row.playerName}</h3>
                        <p className="mt-1 text-sm font-medium text-slate-400">
                          {candidate.row.teamCode} vs {candidate.row.opponentCode} • {candidate.row.gameTimeEt}
                        </p>
                      </div>
                    </div>

                    <div className={`mt-2 md:mt-0 flex flex-col items-center justify-center rounded-2xl border px-6 py-3 shadow-md ${side === 'OVER' ? 'bg-sky-500/10 border-sky-400/20 text-sky-300' : side === 'UNDER' ? 'bg-rose-500/10 border-rose-400/20 text-rose-300' : 'bg-slate-500/10 border-slate-400/20 text-slate-300'}`}>
                      <span className="text-[10px] uppercase tracking-widest font-bold opacity-70 mb-1">Recommendation</span>
                      <span className="text-xl font-black">
                        {side === "NEUTRAL" ? "WAIT" : `${side} ${formatAverage(candidate.currentLine)}`}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 rounded-xl bg-black/20 p-4 border border-white/5">
                    <p className="text-sm font-medium leading-relaxed text-slate-200">
                      {candidate.reasons[0] ?? candidate.supportText}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
      ) : null}

      {showAdvancedView ? (
        <>
      <section className="mt-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="section-shell section-shell--emerald p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/80">Today&apos;s Focus Board</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">{currentMarketLabel}</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-300">
                Ranked for quick action using live qualification, confidence, edge size, minutes risk, and data quality.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-right text-xs text-emerald-50">
              <p className="uppercase tracking-[0.14em] text-emerald-100/70">Best Current Looks</p>
              <p className="mt-1 text-2xl font-semibold text-white">{topFocusCandidates.length}</p>
            </div>
          </div>

          {topFocusCandidates.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-slate-300/15 bg-[#0d162d] px-4 py-5 text-sm text-slate-300">
              No strong focus bets surfaced for the current filters yet. Try a different market or matchup.
            </div>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {topFocusCandidates.map((candidate, index) => (
                <button
                  key={`focus-${candidate.row.playerId}-${candidate.market}`}
                  type="button"
                  onClick={() => {
                    setPlayerLookupError(null);
                    openPlayerDetail(candidate.row, null, candidate.market);
                  }}
                  className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-30px_rgba(148,163,184,0.65)] ${focusTierClass(
                    candidate.focusTier,
                  )}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-white/65">#{index + 1} {focusTierLabel(candidate.focusTier)}</p>
                      <h3 className="mt-1 text-lg font-semibold text-white">{candidate.row.playerName}</h3>
                      <p className="mt-1 text-xs text-slate-200/80">
                        {candidate.row.teamCode} vs {candidate.row.opponentCode} | {candidate.row.gameTimeEt}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${modelSideClass(candidate.display?.side ?? candidate.modelLine.modelSide)}`}>
                        {(candidate.display?.side ?? candidate.modelLine.modelSide) === "NEUTRAL"
                          ? "WAIT"
                          : `${candidate.display?.side ?? candidate.modelLine.modelSide} ${candidate.market}`}
                      </span>
                      <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/80">
                        Score {formatStat(candidate.focusScore)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-100 sm:grid-cols-4">
                    <div className="rounded-xl bg-black/15 px-2 py-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Status</p>
                      <p className="mt-1 font-semibold">{candidate.display?.statusText ?? "MODEL READ"}</p>
                    </div>
                    <div className="rounded-xl bg-black/15 px-2 py-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Confidence</p>
                      <p className="mt-1 font-semibold">
                        {candidate.display?.confidence == null ? "-" : formatStat(candidate.display.confidence)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-black/15 px-2 py-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Line / Gap</p>
                      <p className="mt-1 font-semibold">
                        {formatAverage(candidate.currentLine)} / {formatAverage(candidate.display?.projectionGap ?? candidate.modelLine.projectionGap, true)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-black/15 px-2 py-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Minutes</p>
                      <p className="mt-1 font-semibold">
                        {formatAverage(candidate.row.playerContext.projectedMinutes)} proj
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-slate-100/90">
                    {candidate.reasons.map((reason) => (
                      <p key={`${candidate.row.playerId}-${reason}`}>{reason}</p>
                    ))}
                    <p className="text-slate-200/75">{candidate.supportText}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="section-shell section-shell--gold p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200/80">Games Today</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">Slate at a Glance</h2>
              <p className="mt-1 text-sm text-slate-300">
                {isAllMarketsView
                  ? "Each matchup rolls up the strongest overall props first, so you can scan the whole slate before narrowing down."
                  : "Each matchup shows how many current-market bets are worth a closer look before the full board."}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {matchupFocusCards.length === 0 ? (
              <div className="rounded-2xl border border-slate-300/15 bg-[#0d162d] px-4 py-5 text-sm text-slate-300">
                No games loaded for the current filters.
              </div>
            ) : (
              matchupFocusCards.map(({ item, totalFocus, qualifiedCount, topCandidates }) => (
                <article key={`slate-${item.matchupKey}`} className="rounded-2xl border border-white/10 bg-black/15 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{item.awayTeam} at {item.homeTeam}</p>
                      <p className="mt-1 text-xs text-slate-300">{item.gameTimeEt}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.12em]">
                      <span className="rounded-full border border-amber-300/20 bg-amber-500/10 px-2 py-1 text-amber-100">
                        {totalFocus} focus
                      </span>
                      <span className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-2 py-1 text-emerald-100">
                        {qualifiedCount} precision-ready
                      </span>
                    </div>
                  </div>

                  {topCandidates.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-400">No standout current-market looks in this matchup yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {topCandidates.map((candidate) => (
                        <button
                          key={`slate-pick-${candidate.row.playerId}-${candidate.market}`}
                          type="button"
                          onClick={() => {
                            setPlayerLookupError(null);
                            openPlayerDetail(candidate.row, null, candidate.market);
                          }}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left hover:bg-white/[0.07]"
                        >
                          <div>
                            <p className="text-sm font-medium text-white">{candidate.row.playerName}</p>
                            <p className="mt-1 text-[11px] text-slate-300">
                              {candidate.display?.statusText ?? "MODEL READ"} | {candidate.currentLineLabel}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`text-xs font-semibold ${(candidate.display?.side ?? candidate.modelLine.modelSide) === "OVER" ? "text-emerald-200" : (candidate.display?.side ?? candidate.modelLine.modelSide) === "UNDER" ? "text-amber-200" : "text-slate-200"}`}>
                              {candidate.display?.side ?? candidate.modelLine.modelSide}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-300">Score {formatStat(candidate.focusScore)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </article>
      </section>


      {showSecondarySignals && !isAllMarketsView ? (
      <section className="section-shell section-shell--gold mt-6 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200/80">Secondary Slice</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">Raw-Model {currentMarketLabel} Signals</h2>
            <p className="mt-1 text-sm text-slate-300">
              This is the selected-market slice of the broader raw-model board, not the promoted {activeData.precisionSystem?.label ?? "Precision Card"}.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-right text-xs text-amber-50">
            <p className="uppercase tracking-[0.14em] text-amber-100/70">Signals In {market}</p>
            <p className="mt-1 text-2xl font-semibold text-white">{qualifiedCandidates.length}</p>
          </div>
        </div>

        {qualifiedCandidates.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-slate-300/15 bg-[#0d162d] px-4 py-5 text-sm text-slate-300">
            No broader raw-model signals are showing for the current filters and market yet.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {qualifiedCandidates.map((candidate, index) => (
              <button
                key={`qualified-${candidate.row.playerId}-${candidate.market}`}
                type="button"
                onClick={() => {
                  setPlayerLookupError(null);
                  openPlayerDetail(candidate.row, null, candidate.market);
                }}
                className="rounded-2xl border border-amber-300/30 bg-[#0d162d] p-4 text-left hover:bg-[#111e3c]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-amber-200/75">Signal #{index + 1}</p>
                    <h3 className="mt-1 text-lg font-semibold text-white">{candidate.row.playerName}</h3>
                    <p className="mt-1 text-xs text-slate-300">
                      {candidate.row.teamCode} vs {candidate.row.opponentCode} | {candidate.row.gameTimeEt}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-100">
                      RAW SIGNAL
                    </span>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${modelSideClass(candidate.display?.side ?? candidate.modelLine.modelSide)}`}>
                      {candidate.display?.side ?? candidate.modelLine.modelSide}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-100 sm:grid-cols-4">
                  <div className="rounded-xl bg-black/15 px-2 py-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Status</p>
                    <p className="mt-1 font-semibold">{candidate.display?.statusText ?? "MODEL READ"}</p>
                  </div>
                  <div className="rounded-xl bg-black/15 px-2 py-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Confidence</p>
                    <p className="mt-1 font-semibold">
                      {candidate.display?.confidence == null ? "-" : formatStat(candidate.display.confidence)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-black/15 px-2 py-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Line / Gap</p>
                    <p className="mt-1 font-semibold">
                      {formatAverage(candidate.currentLine)} / {formatAverage(candidate.display?.projectionGap ?? candidate.modelLine.projectionGap, true)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-black/15 px-2 py-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Risk</p>
                    <p className="mt-1 font-semibold">
                      {candidate.display?.minutesRisk == null ? "-" : formatStat(candidate.display.minutesRisk)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-xs text-slate-200/85">
                  {candidate.reasons.map((reason) => (
                    <p key={`${candidate.row.playerId}-qualified-${reason}`}>{reason}</p>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">Team Matchup Stats</h2>
        {isAllMarketsView ? (
          <div className="rounded-2xl border border-slate-300/15 bg-[#0e1932] p-5 text-sm text-slate-300">
            Pick a specific market when you want team offense vs defense matchup stats. The default all-markets view stays focused on the best overall prop selection.
          </div>
        ) : isBoardLoading && filteredTeamMatchups.length === 0 ? (
          <div className="rounded-2xl border border-slate-300/15 bg-[#0e1932] p-5 text-sm text-slate-300">
            Loading matchup stats...
          </div>
        ) : filteredTeamMatchups.length === 0 ? (
          <div className="rounded-2xl border border-slate-300/15 bg-[#0e1932] p-5 text-sm text-slate-300">No matchup stats available.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredTeamMatchups.map((item) => {
              const matchupMarket = teamStatsMarket ?? "PTS";
              const awayEdge = edge(item.awayLast10For[matchupMarket], item.homeLast10Allowed[matchupMarket]);
              const homeEdge = edge(item.homeLast10For[matchupMarket], item.awayLast10Allowed[matchupMarket]);
              return (
                <article key={item.matchupKey} className="rounded-2xl border border-slate-300/15 bg-[#0e1932] p-4 shadow-[0_16px_40px_-30px_rgba(245,158,11,0.45)]">
                  <p className="text-xs uppercase tracking-[0.12em] text-amber-200">{item.matchupKey}</p>
                  <p className="text-xs text-slate-400">{item.gameTimeEt}</p>

                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl border border-slate-300/20 bg-[#0b152a] p-3">
                      <p className="font-semibold text-white">{item.awayTeam}</p>
                      <p className="text-slate-300">
                        Record: {item.awaySeasonRecord.wins}-{item.awaySeasonRecord.losses} (L10 {item.awayLast10Record.wins}-{item.awayLast10Record.losses})
                      </p>
                      <p className="text-slate-300">
                        For ({matchupMarket}): {formatAverage(item.awaySeasonFor[matchupMarket])} | L10 {formatAverage(item.awayLast10For[matchupMarket])}
                      </p>
                      <p className="text-slate-300">
                        Allowed ({matchupMarket}): {formatAverage(item.awaySeasonAllowed[matchupMarket])} | L10 {formatAverage(item.awayLast10Allowed[matchupMarket])}
                      </p>
                      <p className="text-slate-300">
                        Attack vs Opp D: {formatAverage(awayEdge, true)}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-300/20 bg-[#0b152a] p-3">
                      <p className="font-semibold text-white">{item.homeTeam}</p>
                      <p className="text-slate-300">
                        Record: {item.homeSeasonRecord.wins}-{item.homeSeasonRecord.losses} (L10 {item.homeLast10Record.wins}-{item.homeLast10Record.losses})
                      </p>
                      <p className="text-slate-300">
                        For ({matchupMarket}): {formatAverage(item.homeSeasonFor[matchupMarket])} | L10 {formatAverage(item.homeLast10For[matchupMarket])}
                      </p>
                      <p className="text-slate-300">
                        Allowed ({matchupMarket}): {formatAverage(item.homeSeasonAllowed[matchupMarket])} | L10 {formatAverage(item.homeLast10Allowed[matchupMarket])}
                      </p>
                      <p className="text-slate-300">
                        Attack vs Opp D: {formatAverage(homeEdge, true)}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section id="deep-board" className="mt-6">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">Deep Board</h2>
            <p className="mt-1 text-xs text-slate-400">
              {showQualifiedOnly && qualifiedCandidates.length > 0
                ? `Showing only precision-ready ${currentMarketLabel} signals. Switch to all raw player rows any time.`
                : `Full slate raw data sorted by focus score for ${currentMarketLabel}. Open any player for the full read.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowQualifiedOnly(true)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${
                showQualifiedOnly
                  ? "border border-amber-300/45 bg-amber-500/20 text-amber-100"
                  : "border border-slate-300/20 bg-[#0d162d] text-slate-300"
              }`}
            >
              Precision Ready
            </button>
            <button
              type="button"
              onClick={() => setShowQualifiedOnly(false)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${
                !showQualifiedOnly
                  ? "border border-cyan-300/45 bg-cyan-500/20 text-cyan-100"
                  : "border border-slate-300/20 bg-[#0d162d] text-slate-300"
              }`}
            >
              All Raw Data
            </button>
            <button
              type="button"
              onClick={() => setShowAdvancedView(!showAdvancedView)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${
                showAdvancedView
                  ? "border border-purple-300/45 bg-purple-500/20 text-purple-100"
                  : "border border-slate-300/20 bg-[#0d162d] text-slate-300"
              }`}
            >
              Advanced Data
            </button>
          </div>
        </div>
        {isBoardLoading && displayedCandidates.length === 0 ? (
          <div className="rounded-2xl border border-slate-300/15 bg-[#0e1932] p-6 text-sm text-slate-300">
            Loading player snapshot...
          </div>
        ) : displayedCandidates.length === 0 ? (
          <div className="rounded-2xl border border-slate-300/15 bg-[#0e1932] p-6 text-sm text-slate-300">
            {showQualifiedOnly
              ? "No precision-ready signals found for the current filters. Switch to All Raw Data to inspect the full board."
              : "No players found for selected filters."}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-300/15 bg-[#0d162d] shadow-[0_16px_60px_-35px_rgba(245,158,11,0.55)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[2350px] text-left text-sm">
                <thead className="bg-[#1a2a51] text-xs uppercase tracking-[0.12em] text-slate-200/80">
                  <tr>
                    <th className="px-4 py-3">Player</th>
                    {isAllMarketsView ? <th className="px-4 py-3">Market</th> : null}
                    <th className="px-4 py-3">Focus</th>
                    <th className="px-4 py-3">Matchup</th>
                    <th className="px-4 py-3">
                      <HeaderWithTip
                        label="Type"
                        definition="Player archetype from recent production profile (creator, scorer, big, spacer, etc.)."
                      />
                    </th>
                    {showAdvancedView ? (
                      <>
                        <th className="px-4 py-3">
                          <HeaderWithTip
                            label="Starter"
                            definition="Starter status from actual game logs: last-game starter flag and starts in last 10."
                          />
                        </th>
                        <th className="px-4 py-3">
                          <HeaderWithTip
                            label="Data Q"
                            definition="Data completeness score for this player row: logs, status coverage, context, and stability."
                          />
                        </th>
                      </>
                    ) : null}
                    <th className="px-4 py-3">
                      <HeaderWithTip
                        label="Min L3/L10"
                        definition="Average minutes over last 3 and last 10 games."
                      />
                    </th>
                    {showAdvancedView ? (
                      <th className="px-4 py-3">
                        <HeaderWithTip
                          label="Min Trend"
                          definition="Last-3 minutes average minus last-10 minutes average."
                        />
                      </th>
                    ) : null}
                    <th className="px-4 py-3">
                      <HeaderWithTip
                        label="Read"
                        definition="Short directional read built from the current signal status, line source, and side support."
                      />
                    </th>
                    <th className="px-4 py-3">
                      <HeaderWithTip
                        label="L10 Avg"
                        definition="Average stat value across the player's last 10 completed games."
                      />
                    </th>
                    <th className="px-4 py-3">
                      <HeaderWithTip
                        label="Season Avg"
                        definition="Average stat value across all completed games this season."
                      />
                    </th>
                    {showAdvancedView ? (
                      <>
                        <th className="px-4 py-3">
                          <HeaderWithTip
                            label="Vol (SD)"
                            definition="Volatility measured by standard deviation over last 10 games. Higher means less stable output."
                          />
                        </th>
                        <th className="px-4 py-3">
                          <HeaderWithTip
                            label="Consistency"
                            definition="Percent of last 10 games within 1 standard deviation of the player's own L10 average."
                          />
                        </th>
                        <th className="px-4 py-3">
                          <HeaderWithTip
                            label="Floor/Ceil"
                            definition="Lowest and highest values from the last 10 games."
                          />
                        </th>
                        <th className="px-4 py-3">
                          <HeaderWithTip
                            label="Trend"
                            definition="Last-3 average minus season average. Positive means recent form is above season baseline."
                          />
                        </th>
                        <th className="px-4 py-3">
                          <HeaderWithTip
                            label="Opp +/-"
                            definition="Opponent allowance vs league average for this market. Positive means softer matchup."
                          />
                        </th>
                      </>
                    ) : null}
                    <th className="px-4 py-3">
                      <HeaderWithTip
                        label="Proj Tonight"
                        definition="Model projection for this market tonight from recent form, season baseline, home/away split, matchup allowance, and minutes trend."
                      />
                    </th>
                    {!isAllMarketsView ? (
                      <th className="px-4 py-3">
                        <HeaderWithTip
                          label={`${signalLabelForMarket(market)} Filter`}
                          definition={
                            market === "PTS"
                              ? "Selective points-side screen tuned from Jokic backtests. Uses live line, confidence, minutes risk, and favorite suppression to mark PRECISION READY or RAW ONLY."
                              : market === "REB"
                                ? "Selective rebounds-side screen using the live rebound line, confidence, and minutes risk to mark PRECISION READY or RAW ONLY."
                                : market === "AST"
                                  ? "Selective assists-side screen using the live assist line, confidence, and minutes risk to mark PRECISION READY or RAW ONLY."
                                  : market === "THREES"
                                    ? "Selective 3PM-side screen using the live line, confidence, and minutes risk to mark PRECISION READY or RAW ONLY."
                                    : "Selective combo-market screen using the live line, confidence, and minutes risk to mark PRECISION READY or RAW ONLY."
                          }
                        />
                      </th>
                    ) : (
                      <th className="px-4 py-3">Live Filter</th>
                    )}
                    <th className="px-4 py-3">Your Line</th>
                    <th className="px-4 py-3">
                      <HeaderWithTip
                        label="L10 O/U"
                        definition="Over/under count versus your line using the player's last 10 completed games."
                      />
                    </th>
                    <th className="px-4 py-3">
                      <HeaderWithTip
                        label="Minute Badge"
                        definition="Hit rate versus your line when filtering to games above the selected minutes floor."
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedCandidates.map((candidate) => {
                    const row = candidate.row;
                    const candidateMarket = candidate.market;
                    const l10Values = row.last10[candidateMarket];
                    const l10Volatility = standardDeviation(l10Values);
                    const l10Consistency = consistencyPct(l10Values);
                    const floor = minValue(l10Values);
                    const ceiling = maxValue(l10Values);
                    const marketView = resolveMarketRecommendationView(row, candidateMarket);
                    const liveSignalDisplay = marketView.display;
                    const modelLine = candidate.modelLine;
                    const currentLine = candidate.currentLine;
                    const l10Hit = currentLine == null ? null : hitCounts(l10Values, currentLine);
                    const minuteFloorLogs = row.analysisLogs.filter((log) => log.minutes >= selectedMinutesFloor);
                    const minuteFloorValues = minuteFloorLogs.map((log) => marketValueFromLog(log, candidateMarket));
                    const minuteFloorHit = currentLine == null ? null : hitCounts(minuteFloorValues, currentLine);

                    return (
                      <tr
                        key={`${row.playerId}:${candidateMarket}`}
                        onClick={() => {
                          setPlayerLookupError(null);
                          openPlayerDetail(row, null, candidateMarket);
                        }}
                        className={`cursor-pointer border-t border-slate-300/10 text-slate-100 hover:bg-cyan-300/8 ${focusRowAccentClass(
                          candidate.focusTier,
                        )}`}
                      >
                        <td className="px-4 py-3 font-semibold">
                          <div>{row.playerName}</div>
                          <div className="text-xs text-slate-400">{row.position ?? "N/A"}</div>
                        </td>
                        {isAllMarketsView ? (
                          <td className="px-4 py-3 text-xs font-semibold text-cyan-100">{signalLabelForMarket(candidateMarket)}</td>
                        ) : null}
                        <td className="px-4 py-3 text-xs">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${focusTierClass(candidate.focusTier)}`}>
                              {focusTierLabel(candidate.focusTier)}
                            </span>
                            {candidate.signalQualified ? (
                              <span className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                                PRECISION READY
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-slate-300">Score {formatStat(candidate.focusScore)}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div>
                            {row.teamCode} vs {row.opponentCode} ({row.isHome ? "Home" : "Away"})
                          </div>
                          <div className="text-slate-400">{row.gameTimeEt}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">{row.playerContext.archetype}</td>
                        {showAdvancedView ? (
                          <>
                            <td className="px-4 py-3 text-xs">
                              <div>{row.playerContext.projectedStarter}</div>
                              <div className="text-slate-400">
                                Start L10 {row.playerContext.startsLast10}/10 ({formatPercentValue(
                                  row.playerContext.starterRateLast10 == null ? null : row.playerContext.starterRateLast10 * 100,
                                )})
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${completenessTierClass(
                                  row.dataCompleteness.tier,
                                )}`}
                              >
                                {row.dataCompleteness.score} {row.dataCompleteness.tier}
                              </span>
                            </td>
                          </>
                        ) : null}
                        <td className="px-4 py-3 text-xs">
                          <div>
                            {formatAverage(row.playerContext.minutesLast3Avg)} / {formatAverage(row.playerContext.minutesLast10Avg)}
                          </div>
                          <div className="text-slate-400">
                            Proj{" "}
                            {row.playerContext.projectedMinutesFloor == null ||
                            row.playerContext.projectedMinutesCeiling == null
                              ? formatAverage(row.playerContext.projectedMinutes)
                              : `${formatAverage(row.playerContext.projectedMinutes)} (${formatAverage(
                                  row.playerContext.projectedMinutesFloor,
                                )}-${formatAverage(row.playerContext.projectedMinutesCeiling)})`}
                          </div>
                        </td>
                        {showAdvancedView ? (
                          <td className="px-4 py-3">{formatAverage(row.playerContext.minutesTrend, true)}</td>
                        ) : null}
                        <td className="px-4 py-3 text-xs">
                          <div>{candidate.reasons[0]}</div>
                          <div className="mt-1 text-slate-400">{candidate.currentLineLabel}</div>
                          <div className="mt-1 text-slate-400">{candidate.supportText}</div>
                        </td>
                        <td className="px-4 py-3">{formatAverage(row.last10Average[candidateMarket])}</td>
                        <td className="px-4 py-3">{formatAverage(row.seasonAverage[candidateMarket])}</td>
                        {showAdvancedView ? (
                          <>
                            <td className="px-4 py-3">{formatAverage(l10Volatility)}</td>
                            <td className="px-4 py-3">{formatPercentValue(l10Consistency)}</td>
                            <td className="px-4 py-3">
                              {floor == null || ceiling == null ? "-" : `${formatStat(floor)} / ${formatStat(ceiling)}`}
                            </td>
                            <td className="px-4 py-3">{formatAverage(row.trendVsSeason[candidateMarket], true)}</td>
                            <td className="px-4 py-3">{formatAverage(row.opponentAllowanceDelta[candidateMarket], true)}</td>
                          </>
                        ) : null}
                        <td className="px-4 py-3 text-xs">
                          <div>{formatAverage(row.projectedTonight[candidateMarket])}</div>
                          <div className="mt-1 flex items-center gap-1">
                            <span className="text-slate-400">Fair</span>
                            <span className="font-semibold text-cyan-100">{formatAverage(modelLine.fairLine)}</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${modelSideClass(modelLine.modelSide)}`}>
                              {modelLine.modelSide}
                            </span>
                          </div>
                        </td>
                        {liveSignalDisplay != null && marketView.marketLine != null ? (
                          <td className="px-4 py-3 text-xs">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${liveSignalDisplay.statusClass}`}>
                                  {liveSignalDisplay.statusText}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${modelSideClass(marketView.finalSide)}`}>
                                  {marketView.finalSide}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ptsConfidenceClass(liveSignalDisplay.confidenceTier ?? null)}`}>
                                  {liveSignalDisplay.confidence == null
                                    ? "No Score"
                                    : `${formatStat(liveSignalDisplay.confidence ?? 0)} ${liveSignalDisplay.confidenceTier ?? ""}`.trim()}
                                </span>
                              </div>
                              <div className="text-slate-300">
                                {marketView.marketLineLabel} | Gap {formatAverage(liveSignalDisplay.projectionGap, true)}
                              </div>
                              <div className="text-slate-400">
                                Risk {formatAverage(liveSignalDisplay.minutesRisk)} | Books {liveSignalDisplay.sportsbookCount || "-"}
                              </div>
                              {marketView.hitChance.value != null ? (
                                <div className="max-w-[240px] text-[10px] text-emerald-200">
                                  {marketView.hitChance.label} {formatHitChanceDisplay(marketView.hitChance)}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        ) : (
                          <td className="px-4 py-3 text-xs text-slate-400">Awaiting confirmed {candidateMarket} market line</td>
                        )}
                        <td className="px-4 py-3">
                          <div className="mb-1 text-[10px] text-slate-400">
                            {modelLine.fairLine == null
                              ? "No model line"
                              : `O <= ${formatStat(modelLine.actionOverLine ?? modelLine.fairLine)} | U >= ${formatStat(
                                  modelLine.actionUnderLine ?? modelLine.fairLine,
                                )}`}
                          </div>
                          <input
                            value={lineMap[scopedLineKey(row.playerId, candidateMarket)] ?? ""}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              setLineMap((current) => ({
                                ...current,
                                [scopedLineKey(row.playerId, candidateMarket)]: event.target.value,
                              }))
                            }
                            inputMode="decimal"
                            placeholder={modelLine.fairLine == null ? "24.5" : formatStat(modelLine.fairLine)}
                            className="w-20 rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1 text-sm text-white outline-none focus:border-cyan-300/60"
                          />
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {currentLine == null || !l10Hit
                            ? "-"
                            : `${candidate.currentLineLabel}: ${l10Hit.over}/${l10Values.length} O | ${l10Hit.under}/${l10Values.length} U`}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {currentLine == null || !minuteFloorHit ? (
                            <span className="text-slate-400">Set line</span>
                          ) : minuteFloorValues.length === 0 ? (
                            <span className="text-slate-400">No {formatStat(selectedMinutesFloor)}+ min sample</span>
                          ) : (
                            <div className="inline-flex min-w-[175px] items-center justify-between rounded-lg border border-amber-300/35 bg-amber-500/10 px-2 py-1">
                              <span className="font-semibold text-amber-100">
                                {formatStat(selectedMinutesFloor)}+m: {minuteFloorHit.over}/{minuteFloorValues.length}
                              </span>
                              <span className="text-amber-200">
                                {formatPercent(minuteFloorHit.over, minuteFloorValues.length)}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

        </>
      ) : null}

      {guideOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setGuideOpen(false);
            }
          }}
        >
          <section
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200/20 bg-[#0e1932] p-5 shadow-[0_30px_90px_-40px_rgba(245,158,11,0.65)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300/20 pb-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200">Navigation Guide</p>
                <h3 className="title-font mt-1 text-2xl uppercase text-white">How To Use The Snapshot</h3>
              </div>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="rounded-lg border border-slate-300/30 bg-[#0c1428] px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800/40"
              >
                Close Guide
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <article className="rounded-xl border border-slate-300/20 bg-[#0b152a] p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.14em] text-amber-200">Quick Start</p>
                <ol className="mt-2 space-y-1 text-xs text-slate-300">
                  <li>1. Check the <strong>{activeData.precisionSystem?.label ?? "Bettable Card"}</strong> for the strongest precision-ranked picks today.</li>
                  <li>2. Use <strong>Player Search</strong> to open the full raw-data panel for any player and inspect every market.</li>
                  <li>3. Open <strong>Lower-Priority Signals</strong> only if you want broader raw-model context beyond the promoted card.</li>
                  <li>4. Use <strong>Advanced Data</strong> toggle anywhere to reveal deeper stats if you want more detail.</li>
                  <li>5. Use the player search bar to look up any player directly.</li>
                </ol>
              </article>

              <article className="rounded-xl border border-slate-300/20 bg-[#0b152a] p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.14em] text-amber-200">Understanding Recommendations</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  <li>- <strong>OVER / UNDER</strong> tells you the model&apos;s directional pick.</li>
                  <li>- The <strong>number</strong> next to it is the line the model is reacting to.</li>
                  <li>- The <strong>reason text</strong> explains why in plain language.</li>
                  <li>- For custom scenarios, open the player detail and set your own line in any market card.</li>
                </ul>
              </article>

              <article className="rounded-xl border border-slate-300/20 bg-[#0b152a] p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.14em] text-amber-200">Player Detail Panel</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  <li>- <strong>Player Context</strong>: role, starter status, projected minutes.</li>
                  <li>- <strong>All Markets Detail</strong>: averages, projections, and fair lines for every stat category.</li>
                  <li>- <strong>Game Logs</strong>: recent performance history and game-by-game results.</li>
                  <li>- Use the <strong>Jump to section</strong> dropdown to quickly navigate within the panel.</li>
                </ul>
              </article>

              <article className="rounded-xl border border-slate-300/20 bg-[#0b152a] p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.14em] text-amber-200">Controls</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  <li>- Press <strong>Esc</strong> to close the guide or player panel.</li>
                  <li>- <strong>Refresh Data</strong> pulls the latest lineup and stat updates.</li>
                  <li>- Use the <strong>date picker</strong> and <strong>matchup filter</strong> to change the slate.</li>
                  <li>- Hover any <strong>?</strong> icon for a quick definition.</li>
                </ul>
              </article>
            </div>
          </section>
        </div>
      ) : null}

      {selectedPlayer ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePlayerDetail();
            }
          }}
        >
          <div
            className="glass max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-300/20 bg-[#0b122a]/95 px-4 py-3 backdrop-blur sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="title-font text-2xl uppercase text-white">{selectedPlayer.playerName}</h2>
                  <p className="text-sm text-slate-300">
                    {selectedPlayer.teamCode} vs {selectedPlayer.opponentCode} ({selectedPlayer.isHome ? "Home" : "Away"})
                  </p>
                  <p className="text-xs text-slate-400">{selectedPlayer.gameTimeEt}</p>
                  {showPlayerLookupContext ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-full border border-cyan-300/35 bg-cyan-400/10 px-2 py-0.5 text-cyan-100">
                        Requested {playerLookupMeta?.requestedDateEt}
                      </span>
                      <span className="rounded-full border border-slate-300/20 bg-[#0d1630] px-2 py-0.5 text-slate-200">
                        Loaded {playerLookupMeta?.resolvedDateEt}
                      </span>
                    </div>
                  ) : null}
                  {showPlayerLookupContext && playerLookupMeta?.note ? (
                    <p className="mt-2 max-w-2xl rounded-lg border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                      {playerLookupMeta.note}
                    </p>
                  ) : null}
                  {isPlayerDetailLoading ? (
                    <p className="mt-2 max-w-2xl rounded-lg border border-cyan-300/20 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-100">
                      Loading the full player detail now. The header is ready, and the deeper logs and intel will fill in next.
                    </p>
                  ) : null}
                  {playerDetailError ? (
                    <p className="mt-2 max-w-2xl rounded-lg border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
                      {playerDetailError}
                    </p>
                  ) : null}
                  {selectedPlayerMarketSystemMix ? (
                    <p className="mt-2 max-w-3xl rounded-lg border border-violet-300/20 bg-violet-500/10 px-3 py-2 text-[11px] text-violet-100">
                      <span className="font-semibold text-violet-50">{selectedPlayerMarketSystemMix.title}:</span>{" "}
                      {selectedPlayerMarketSystemMix.body}
                    </p>
                  ) : null}
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {MARKET_OPTIONS.map((option) => {
                      const signalMarket = option.value;
                      const key = scopedLineKey(selectedPlayer.playerId, signalMarket);
                      const customLine = parseLine(lineMap[key] ?? "");
                      const marketView = resolveMarketRecommendationView(selectedPlayer, signalMarket, customLine);
                      const sourceMeta = resolveMarketRecommendationSource(marketView, customLine);
                      const isFocused = focusedMarket === signalMarket;
                      const modelLine = selectedPlayer.modelLines[signalMarket];
                      const display = marketView.display;
                      if (!display && modelLine.fairLine == null) return null;

                      return (
                        <article
                          key={signalMarket}
                          onClick={() => setFocusedMarket(signalMarket)}
                          className={`rounded-2xl border p-3 text-left transition ${
                            isFocused
                              ? "border-blue-300/45 bg-blue-500/12 shadow-[0_18px_30px_-24px_rgba(59,130,246,0.9)]"
                              : "border-white/10 bg-black/15 hover:border-blue-300/25 hover:bg-white/[0.04]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="rounded-full border border-slate-300/20 bg-[#0d1630] px-2 py-0.5 text-[11px] font-semibold text-white">
                              {signalLabelForMarket(signalMarket)}
                            </span>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${modelSideClass(marketView.finalSide)}`}>
                              {marketView.finalSide}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${sourceMeta.className}`}>
                              {sourceMeta.label}
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] text-slate-400">{sourceMeta.detail}</p>

                          <p className="mt-3 text-xs font-medium text-slate-200">{marketView.marketLineLabel}</p>
                          {marketView.hitChance.value != null ? (
                            <p className="mt-2 text-sm font-semibold text-emerald-100">
                              {marketView.hitChance.label} {formatHitChanceDisplay(marketView.hitChance)}
                            </p>
                          ) : (
                            <p className="mt-2 text-xs text-slate-400">
                              {customLine != null
                                ? "Custom line active. Scroll for the updated read."
                                : marketView.note
                                  ? marketView.note
                                : display?.lineOrigin === "MODEL"
                                  ? "Waiting on a confirmed game line."
                                  : "No live model score yet."}
                            </p>
                          )}

                          <label className="mt-3 block text-[10px] uppercase tracking-[0.12em] text-slate-400">
                            Use your line
                            <input
                              value={lineMap[key] ?? ""}
                              onClick={(event) => event.stopPropagation()}
                              onFocus={() => setFocusedMarket(signalMarket)}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                setFocusedMarket(signalMarket);
                                setLineMap((current) => ({
                                  ...current,
                                  [key]: nextValue,
                                }));
                              }}
                              inputMode="decimal"
                              placeholder={marketView.marketLine != null ? formatStat(marketView.marketLine) : modelLine.fairLine == null ? "Set line" : formatStat(modelLine.fairLine)}
                              className="mt-1 w-full rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1.5 text-sm text-white outline-none focus:border-cyan-300/60"
                            />
                          </label>

                          {showAdvancedView ? (
                            <div className="mt-3 space-y-1 text-[10px] text-slate-300">
                              <p>Status: {display?.statusText ?? "No live signal"}</p>
                              <p>Gap: {formatAverage(display?.projectionGap ?? modelLine.projectionGap, true)}</p>
                              <p>Minutes Risk: {formatAverage(display?.minutesRisk ?? null)}</p>
                              <p>Model Fair Line: {formatAverage(modelLine.fairLine)}</p>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCompactDetail((current) => !current)}
                    className="rounded-lg border border-cyan-300/35 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-100 hover:bg-cyan-500/25"
                  >
                    Compact: {compactDetail ? "On" : "Off"}
                  </button>
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      const targetId = event.target.value;
                      if (targetId) {
                        jumpToDetailSection(targetId);
                        event.currentTarget.value = "";
                      }
                    }}
                    className="rounded-lg border border-slate-300/30 bg-[#0d1630] px-2 py-1 text-xs text-slate-100 outline-none focus:border-cyan-300/60"
                  >
                    <option value="">Jump to section</option>
                    {DETAIL_SECTIONS.map((section) => (
                      <option key={section.key} value={section.id}>
                        {section.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={closePlayerDetail}
                    className="rounded-lg border border-slate-300/30 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800/40"
                    title="Close details (Esc)"
                  >
                    Close
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Tip: press Esc or click outside this panel to close.</p>
            </div>

            <div className="px-4 py-4 sm:px-6">
            <CollapsibleSection
              id="detail-context"
              title="Player Context"
              subtitle="Role, starter status, data quality, defender, and teammate context."
              collapsed={collapsedSections.context}
              onToggle={() => toggleSection("context")}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <article className="rounded-xl border border-slate-300/20 bg-[#101938] p-3 text-xs text-slate-200">
                  <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                    <p className="inline-flex items-center gap-1">
                      Type
                      <InfoTip
                        label="Type"
                        definition="Archetype from recent stat shape and minutes role."
                      />
                    </p>
                    <p className="text-right">{selectedPlayer.playerContext.archetype}</p>

                    <p className="inline-flex items-center gap-1">
                      Starter
                      <InfoTip
                        label="Starter"
                        definition="Based on actual starter flags in game logs, plus last-game starter status."
                      />
                    </p>
                    <p className="text-right">
                      {selectedPlayer.playerContext.projectedStarter}
                      {selectedPlayer.playerContext.startedLastGame == null
                        ? ""
                        : selectedPlayer.playerContext.startedLastGame
                          ? " (Started last game)"
                          : " (Did not start last game)"}
                    </p>

                    <p className="inline-flex items-center gap-1">
                      Starts L10
                      <InfoTip
                        label="Starts L10"
                        definition="How many of the player's last 10 completed games were starts."
                      />
                    </p>
                    <p className="text-right">
                      {selectedPlayer.playerContext.startsLast10}/10 ({formatPercentValue(
                        selectedPlayer.playerContext.starterRateLast10 == null
                          ? null
                          : selectedPlayer.playerContext.starterRateLast10 * 100,
                      )})
                    </p>

                    <p className="inline-flex items-center gap-1">
                      Rotation Rank
                      <InfoTip
                        label="Rotation Rank"
                        definition="Team rank by last-10 minutes among active teammates."
                      />
                    </p>
                    <p className="text-right">
                      {selectedPlayer.playerContext.rotationRank != null ? selectedPlayer.playerContext.rotationRank : "-"}
                    </p>

                    <p className="inline-flex items-center gap-1">
                      Data Completeness
                      <InfoTip
                        label="Data Completeness"
                        definition="Quality score for this row based on sample size, status coverage, context availability, and stability metrics."
                      />
                    </p>
                    <p className="text-right">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${completenessTierClass(
                          selectedPlayer.dataCompleteness.tier,
                        )}`}
                      >
                        {selectedPlayer.dataCompleteness.score} {selectedPlayer.dataCompleteness.tier}
                      </span>
                    </p>

                    <p className="inline-flex items-center gap-1">
                      Coverage Split
                      <InfoTip
                        label="Coverage Split"
                        definition="Component scores feeding Data Completeness: sample, status, context, and stability."
                      />
                    </p>
                    <p className="text-right">
                      Smp {formatPercentValue(selectedPlayer.dataCompleteness.components.sampleCoverage)} | Sts{" "}
                      {formatPercentValue(selectedPlayer.dataCompleteness.components.statusCoverage)} | Ctx{" "}
                      {formatPercentValue(selectedPlayer.dataCompleteness.components.contextCoverage)} | Stb{" "}
                      {formatPercentValue(selectedPlayer.dataCompleteness.components.stabilityCoverage)}
                    </p>

                    <p className="inline-flex items-center gap-1">
                      Minutes L3 / L10
                      <InfoTip
                        label="Minutes L3 / L10"
                        definition="Average minutes over last 3 games compared to last 10 games."
                      />
                    </p>
                    <p className="text-right">
                      {formatAverage(selectedPlayer.playerContext.minutesLast3Avg)} /{" "}
                      {formatAverage(selectedPlayer.playerContext.minutesLast10Avg)}
                    </p>

                    <p className="inline-flex items-center gap-1">
                      Current Team Min
                      <InfoTip
                        label="Current Team Min"
                        definition="Average minutes in games played for current team (last up to 5 current-team games)."
                      />
                    </p>
                    <p className="text-right">
                      {formatAverage(selectedPlayer.playerContext.minutesCurrentTeamAvg)} (
                      {selectedPlayer.playerContext.minutesCurrentTeamGames} g)
                    </p>

                    <p className="inline-flex items-center gap-1">
                      Projected Minutes Band
                      <InfoTip
                        label="Projected Minutes Band"
                        definition="Expected playing time with a floor/ceiling range used to sanity-check role-based projections."
                      />
                    </p>
                    <p className="text-right">
                      {selectedPlayer.playerContext.projectedMinutes == null
                        ? "-"
                        : selectedPlayer.playerContext.projectedMinutesFloor == null ||
                            selectedPlayer.playerContext.projectedMinutesCeiling == null
                          ? formatAverage(selectedPlayer.playerContext.projectedMinutes)
                          : `${formatAverage(selectedPlayer.playerContext.projectedMinutes)} (${formatAverage(
                              selectedPlayer.playerContext.projectedMinutesFloor,
                            )}-${formatAverage(selectedPlayer.playerContext.projectedMinutesCeiling)})`}
                    </p>

                    <p className="inline-flex items-center gap-1">
                      Minutes Trend
                      <InfoTip
                        label="Minutes Trend"
                        definition="L3 minutes minus L10 minutes. Positive means role growing."
                      />
                    </p>
                    <p className="text-right">{formatAverage(selectedPlayer.playerContext.minutesTrend, true)}</p>

                    <p className="inline-flex items-center gap-1">
                      Minutes Volatility
                      <InfoTip
                        label="Minutes Volatility"
                        definition="Standard deviation of last-10 minutes. Lower is more stable workload."
                      />
                    </p>
                    <p className="text-right">{formatAverage(selectedPlayer.playerContext.minutesVolatility)}</p>
                  </div>
                  {selectedPlayer.dataCompleteness.issues.length > 0 ? (
                    <div className="mt-2 rounded-lg bg-[#0d1630] p-2 text-[11px] text-amber-200">
                      <p className="font-semibold">Data Gaps</p>
                      {selectedPlayer.dataCompleteness.issues.map((issue, index) => (
                        <p key={`${issue}-${index}`}>- {issue}</p>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 rounded-lg bg-[#0d1630] p-2 text-[11px] text-emerald-200">
                      All key data inputs are present for this player snapshot.
                    </div>
                  )}
                </article>

                <article className="rounded-xl border border-slate-300/20 bg-[#101938] p-3 text-xs text-slate-200">
                  <p className="inline-flex items-center gap-1 font-semibold text-white">
                    Expected Primary Defender
                    <InfoTip
                      label="Expected Primary Defender"
                      definition="Estimated by opponent position match and highest recent minutes."
                    />
                  </p>
                  {selectedPlayer.playerContext.primaryDefender ? (
                    <div className="mt-2 space-y-1 text-slate-300">
                      <p>
                        {selectedPlayer.playerContext.primaryDefender.playerName} (
                        {selectedPlayer.playerContext.primaryDefender.position ?? "N/A"})
                      </p>
                      <p>
                        Min L10: {formatAverage(selectedPlayer.playerContext.primaryDefender.avgMinutesLast10)} | Stocks/36:{" "}
                        {formatAverage(selectedPlayer.playerContext.primaryDefender.stocksPer36Last10)}
                      </p>
                      <p>{selectedPlayer.playerContext.primaryDefender.matchupReason}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-slate-300">No defender projection available yet.</p>
                  )}

                  <p className="mt-3 inline-flex items-center gap-1 font-semibold text-white">
                    Top Teammates (By Minutes)
                    <InfoTip
                      label="Top Teammates"
                      definition="Most active teammates by last-10 minutes, with PRA and assists context."
                    />
                  </p>
                  {selectedPlayer.playerContext.teammateCore.length === 0 ? (
                    <p className="mt-2 text-slate-300">No teammate context available.</p>
                  ) : (
                    <div className="mt-2 space-y-1 text-slate-300">
                      {selectedPlayer.playerContext.teammateCore.map((mate) => (
                        <p key={mate.playerId}>
                          {mate.playerName} ({mate.position ?? "N/A"}) | Min L10 {formatAverage(mate.avgMinutesLast10)} | PRA{" "}
                          {formatAverage(mate.avgPRA10)} | AST {formatAverage(mate.avgAST10)}
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              id="detail-intel"
              title={`Game Intelligence (${selectedPlayer.gameIntel.modules.length} Modules)`}
              subtitle="Full game context stack: live signals + derived models + pending feed connectors."
              collapsed={collapsedSections.intel}
              onToggle={() => toggleSection("intel")}
            >
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {selectedPlayer.gameIntel.modules.map((module) => (
                  <article key={module.id} className="rounded-xl border border-slate-300/20 bg-[#101938] p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-white">{module.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${intelStatusClass(module.status)}`}>
                        {module.status}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-400">{module.description}</p>
                    <div className="mt-2 space-y-1 text-slate-200">
                      {module.items.map((item, index) => (
                        <p key={`${module.id}-${index}`}>
                          <span className="text-slate-400">{item.label}:</span> {item.value}
                        </p>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              id="detail-backtest"
              title="PTS Backtest"
              subtitle="Chronological holdout summary and the full game-by-game points side sheet when a saved report exists."
              collapsed={collapsedSections.backtest}
              onToggle={() => toggleSection("backtest")}
            >
              {playerBacktestLoading ? (
                <div className="rounded-xl border border-slate-300/20 bg-[#101938] p-3 text-xs text-slate-300">
                  Loading saved player backtest...
                </div>
              ) : playerBacktestError ? (
                <div className="rounded-xl border border-rose-300/20 bg-rose-500/10 p-3 text-xs text-rose-100">
                  {playerBacktestError}
                </div>
              ) : playerBacktest ? (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    {[
                      { label: "Full Sample", value: playerBacktest.fullSample },
                      { label: "Training", value: playerBacktest.trainingSample },
                      { label: "Holdout", value: playerBacktest.holdoutSample },
                    ].map((item) => (
                      <article key={item.label} className="rounded-xl border border-slate-300/20 bg-[#101938] p-3 text-xs text-slate-200">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">{item.label}</p>
                        <p className="mt-2 text-2xl font-semibold text-white">
                          {item.value.accuracyPct == null ? "-" : `${item.value.accuracyPct.toFixed(2)}%`}
                        </p>
                        <p className="mt-1 text-slate-300">
                          {item.value.correct} correct / {item.value.wrong} wrong on {item.value.games} games
                        </p>
                        <p className="mt-1 text-slate-400">
                          {item.value.from ?? "-"} to {item.value.to ?? "-"}
                        </p>
                        <p className="mt-1 text-slate-400">
                          Avg line {formatAverage(item.value.averageLine)} | Avg proj {formatAverage(item.value.averageProjection)}
                        </p>
                      </article>
                    ))}
                  </div>

                  <div className="rounded-xl border border-slate-300/20 bg-[#101938] p-3 text-xs text-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">Game Sheet</p>
                        <p className="mt-1 text-slate-400">
                          Holdout ratio {formatStat(playerBacktest.holdoutRatio * 100)}%. Saved report: {playerBacktest.reportPath.split("\\").slice(-1)[0]}
                        </p>
                      </div>
                      {playerBacktest.sheetPath ? (
                        <p className="text-[11px] text-slate-400">Sheet: {playerBacktest.sheetPath.split("\\").slice(-1)[0]}</p>
                      ) : null}
                    </div>

                    {playerBacktest.games.length === 0 ? (
                      <p className="mt-3 text-slate-300">No game sheet rows were saved with this report.</p>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-[11px] text-slate-200">
                          <thead className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                            <tr>
                              <th className="px-2 py-2">Date</th>
                              <th className="px-2 py-2">Matchup</th>
                              <th className="px-2 py-2">Line</th>
                              <th className="px-2 py-2">Proj</th>
                              <th className="px-2 py-2">Pick</th>
                              <th className="px-2 py-2">Actual</th>
                              <th className="px-2 py-2">Result</th>
                              <th className="px-2 py-2">Spread</th>
                              <th className="px-2 py-2">Total</th>
                              <th className="px-2 py-2">Conf</th>
                              <th className="px-2 py-2">Risk</th>
                            </tr>
                          </thead>
                          <tbody>
                            {playerBacktest.games.map((game) => (
                              <tr key={`${game.gameDateEt}-${game.matchupKey}`} className="border-t border-slate-300/10">
                                <td className="px-2 py-2">{game.gameDateEt}</td>
                                <td className="px-2 py-2">{game.matchupKey}</td>
                                <td className="px-2 py-2">{formatAverage(game.bookPtsLine)}</td>
                                <td className="px-2 py-2">{formatAverage(game.projectedPts)}</td>
                                <td className="px-2 py-2">
                                  <span className={`rounded-full px-2 py-0.5 font-semibold ${modelSideClass((game.predictedSide as "OVER" | "UNDER" | "NEUTRAL" | null) ?? "NEUTRAL")}`}>
                                    {game.predictedSide ?? "-"}
                                  </span>
                                </td>
                                <td className="px-2 py-2">{formatAverage(game.actualPts)}</td>
                                <td className="px-2 py-2">
                                  <span
                                    className={`rounded-full px-2 py-0.5 font-semibold ${
                                      game.correct === true
                                        ? "bg-emerald-500/15 text-emerald-200"
                                        : game.correct === false
                                          ? "bg-rose-500/15 text-rose-200"
                                          : "bg-slate-500/20 text-slate-200"
                                    }`}
                                  >
                                    {game.correct === true ? "Correct" : game.correct === false ? "Wrong" : "-"}
                                  </span>
                                </td>
                                <td className="px-2 py-2">{formatAverage(game.openingTeamSpread, true)}</td>
                                <td className="px-2 py-2">{formatAverage(game.openingTotal)}</td>
                                <td className="px-2 py-2">{formatAverage(game.ptsSideConfidence)}</td>
                                <td className="px-2 py-2">{formatAverage(game.ptsMinutesRisk)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-300/20 bg-[#101938] p-3 text-xs text-slate-300">
                  No saved player backtest report was found for this player.
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              id="detail-markets"
              title="All Markets Detail"
              subtitle="Click any market card to open a full breakdown using the final live line, or your custom line if you set one."
              collapsed={collapsedSections.markets}
              onToggle={() => toggleSection("markets")}
            >
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowAdvancedView(!showAdvancedView)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${
                    showAdvancedView
                      ? "border border-purple-300/45 bg-purple-500/20 text-purple-100"
                      : "border border-slate-300/20 bg-[#0d162d] text-slate-300"
                  }`}
                >
                  Advanced Data
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {MARKET_OPTIONS.map((option) => {
                  const m = option.value;
                  const l5 = selectedPlayer.last5[m];
                  const l10 = selectedPlayer.last10[m];
                  const key = scopedLineKey(selectedPlayer.playerId, m);
                  const customLine = parseLine(lineMap[key] ?? "");
                  const modelLine = selectedPlayer.modelLines[m];
                  const marketView = resolveMarketRecommendationView(selectedPlayer, m, customLine);
                  const display = marketView.display;
                  const referenceLine = marketView.marketLine;
                  const finalSide = marketView.finalSide;
                  const finalProjectionGap = display?.projectionGap ?? modelLine.projectionGap;
                  const activeLineLabel = marketView.marketLineLabel;
                  const selectedLine = referenceLine;
                  const l5Hit = selectedLine == null ? null : hitCounts(l5, selectedLine);
                  const l10Hit = selectedLine == null ? null : hitCounts(l10, selectedLine);
                  const isFocused = focusedMarket === m;
                  const hitChance = marketView.hitChance;
                  return (
                    <article
                      key={m}
                      onClick={() => setFocusedMarket(m)}
                      className={`cursor-pointer rounded-xl border p-3 text-xs transition ${
                        isFocused
                          ? "border-cyan-300/70 bg-cyan-400/10"
                          : "border-slate-300/20 bg-[#101938] hover:border-cyan-200/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-white">{option.label}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                            isFocused ? "bg-cyan-300/20 text-cyan-100" : "bg-slate-600/30 text-slate-300"
                          }`}
                        >
                          {isFocused ? "Selected" : "View"}
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-300">
                        <p>L3 Avg</p>
                        <p className="text-right">{formatAverage(selectedPlayer.last3Average[m])}</p>
                        <p>L10 Avg</p>
                        <p className="text-right">{formatAverage(selectedPlayer.last10Average[m])}</p>
                        <p>Season</p>
                        <p className="text-right">{formatAverage(selectedPlayer.seasonAverage[m])}</p>
                        {showAdvancedView ? (
                          <>
                            <p>Home/Away</p>
                            <p className="text-right">{formatAverage(selectedPlayer.homeAwayAverage[m])}</p>
                            <p>Trend</p>
                            <p className="text-right">{formatAverage(selectedPlayer.trendVsSeason[m], true)}</p>
                            <p>Opp +/-</p>
                            <p className="text-right">{formatAverage(selectedPlayer.opponentAllowanceDelta[m], true)}</p>
                          </>
                        ) : null}
                        <p>Proj Tonight</p>
                        <p className="text-right">{formatAverage(selectedPlayer.projectedTonight[m])}</p>
                        <p>Game Line</p>
                        <p className="text-right">{formatAverage(referenceLine)}</p>
                        <p>Final Side</p>
                        <p className="text-right">
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${modelSideClass(finalSide)}`}>
                            {finalSide}
                          </span>
                        </p>
                        <p>Line Source</p>
                        <p className="text-right">{activeLineLabel}</p>
                        {marketView.note ? (
                          <>
                            <p>Read Status</p>
                            <p className="text-right text-amber-200">{marketView.note}</p>
                          </>
                        ) : null}
                        {hitChance.value != null ? (
                          <>
                            <p>{hitChance.label}</p>
                            <p className="text-right">{formatHitChanceDisplay(hitChance)}</p>
                          </>
                        ) : null}
                        {showAdvancedView ? (
                          <>
                            <p>Status</p>
                            <p className="text-right">{display?.statusText ?? "No live signal"}</p>
                            <p>Projection Gap</p>
                            <p className="text-right">{formatAverage(finalProjectionGap, true)}</p>
                            <p>Model Fair Line</p>
                            <p className="text-right">{formatAverage(modelLine.fairLine)}</p>
                            <p>Model Side</p>
                            <p className="text-right">
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${modelSideClass(modelLine.modelSide)}`}>
                                {modelLine.modelSide}
                              </span>
                            </p>
                          </>
                        ) : null}
                      </div>

                      <div className="mt-2">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">L5 Game Log</p>
                        <p className="mt-1 rounded-md border border-slate-300/15 bg-[#0d1630] px-2 py-1 font-mono text-[11px] text-slate-200">
                          {l5.length ? l5.map((v) => formatStat(v)).join(", ") : "-"}
                        </p>
                      </div>

                      <input
                        value={lineMap[key] ?? ""}
                        onClick={(event) => event.stopPropagation()}
                        onFocus={() => setFocusedMarket(m)}
                        onChange={(event) =>
                          setLineMap((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        inputMode="decimal"
                        placeholder={referenceLine == null ? "Set line" : formatStat(referenceLine)}
                        className="mt-2 w-full rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/60"
                      />

                      <div className="mt-2 space-y-2 text-[11px]">
                        {selectedLine == null || !l5Hit || !l10Hit ? (
                          <p className="rounded-md border border-slate-300/15 bg-[#0d1630] px-2 py-1.5 text-slate-300">
                            No line available yet for this market.
                          </p>
                        ) : (
                          <>
                            <div className="rounded-md border border-slate-300/15 bg-[#0d1630] px-2 py-1.5">
                              <p className="text-[10px] uppercase tracking-[0.12em] text-cyan-100">
                                Last 5 vs Line
                                <span className="ml-2 text-slate-400 normal-case tracking-normal">
                                  {activeLineLabel}
                                </span>
                              </p>
                              <div className="mt-1 grid grid-cols-3 gap-1 text-[10px]">
                                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-center text-emerald-200">
                                  O {l5Hit.over}/{l5.length}
                                </span>
                                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-center text-amber-200">
                                  U {l5Hit.under}/{l5.length}
                                </span>
                                <span className="rounded bg-slate-500/25 px-1.5 py-0.5 text-center text-slate-200">
                                  P {l5Hit.push}/{l5.length}
                                </span>
                              </div>
                              <p className="mt-1 text-[10px] text-slate-300">
                                O {formatPercent(l5Hit.over, l5.length)} | U {formatPercent(l5Hit.under, l5.length)} | P{" "}
                                {formatPercent(l5Hit.push, l5.length)}
                              </p>
                            </div>

                            <div className="rounded-md border border-slate-300/15 bg-[#0d1630] px-2 py-1.5">
                              <p className="text-[10px] uppercase tracking-[0.12em] text-cyan-100">
                                Last 10 vs Line
                                <span className="ml-2 text-slate-400 normal-case tracking-normal">
                                  {activeLineLabel}
                                </span>
                              </p>
                              <div className="mt-1 grid grid-cols-3 gap-1 text-[10px]">
                                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-center text-emerald-200">
                                  O {l10Hit.over}/{l10.length}
                                </span>
                                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-center text-amber-200">
                                  U {l10Hit.under}/{l10.length}
                                </span>
                                <span className="rounded bg-slate-500/25 px-1.5 py-0.5 text-center text-slate-200">
                                  P {l10Hit.push}/{l10.length}
                                </span>
                              </div>
                              <p className="mt-1 text-[10px] text-slate-300">
                                O {formatPercent(l10Hit.over, l10.length)} | U {formatPercent(l10Hit.under, l10.length)} | P{" "}
                                {formatPercent(l10Hit.push, l10.length)}
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {(() => {
                const m = focusedMarket;
                const key = scopedLineKey(selectedPlayer.playerId, m);
                const customLine = parseLine(lineMap[key] ?? "");
                const modelLine = selectedPlayer.modelLines[m];
                const marketView = resolveMarketRecommendationView(selectedPlayer, m, customLine);
                const display = marketView.display;
                const referenceLine = marketView.marketLine;
                const finalSide = marketView.finalSide;
                const activeLineLabel = marketView.marketLineLabel;
                const selectedLine = referenceLine;
                const l5 = selectedPlayer.last5[m];
                const l10 = selectedPlayer.last10[m];
                const l5Hit = selectedLine == null ? null : hitCounts(l5, selectedLine);
                const l10Hit = selectedLine == null ? null : hitCounts(l10, selectedLine);
                const focusedLabel = MARKET_OPTIONS.find((option) => option.value === m)?.label ?? m;
                const l10Median = median(l10);
                const l10StdDev = standardDeviation(l10);
                const l10Min = minValue(l10);
                const l10Max = maxValue(l10);
                const l10Range = l10Min == null || l10Max == null ? null : l10Max - l10Min;
                const l10Consistency = consistencyPct(l10);
                const l3VsLine =
                  selectedLine == null || selectedPlayer.last3Average[m] == null ? null : selectedPlayer.last3Average[m] - selectedLine;
                const l10VsLine =
                  selectedLine == null || selectedPlayer.last10Average[m] == null ? null : selectedPlayer.last10Average[m] - selectedLine;
                const seasonVsLine =
                  selectedLine == null || selectedPlayer.seasonAverage[m] == null ? null : selectedPlayer.seasonAverage[m] - selectedLine;
                const zEdge =
                  selectedLine == null ||
                  selectedPlayer.last10Average[m] == null ||
                  l10StdDev == null ||
                  l10StdDev === 0
                    ? null
                    : (selectedPlayer.last10Average[m] - selectedLine) / l10StdDev;
                const oneSdBandLow = selectedLine == null || l10StdDev == null ? null : selectedLine - l10StdDev;
                const oneSdBandHigh = selectedLine == null || l10StdDev == null ? null : selectedLine + l10StdDev;
                const projectionValue = selectedPlayer.projectedTonight[m];
                const projectionVsLine = selectedLine == null || projectionValue == null ? null : projectionValue - selectedLine;
                const minutesKey = scopedMinuteFloorKey(selectedPlayer.playerId, m);
                const projectedFloorDefault =
                  selectedPlayer.playerContext.projectedMinutesFloor == null
                    ? 22
                    : Math.max(0, Math.floor(selectedPlayer.playerContext.projectedMinutesFloor));
                const minutesFloor = parseMinutesFloor(minutesFloorMap[minutesKey] ?? "") ?? projectedFloorDefault;
                const analysisLogs = selectedPlayer.analysisLogs.length > 0 ? selectedPlayer.analysisLogs : selectedPlayer.recentLogs;
                const minuteFilteredLogs = analysisLogs.filter((log) => log.minutes >= minutesFloor);
                const minuteFilteredValues = minuteFilteredLogs.map((log) => marketValueFromLog(log, m));
                const minuteFilteredHit = selectedLine == null ? null : hitCounts(minuteFilteredValues, selectedLine);
                const minuteFilteredAvg = average(minuteFilteredValues);
                const minuteFilteredMedian = median(minuteFilteredValues);
                const minuteFilteredP25 = percentile(minuteFilteredValues, 0.25);
                const minuteFilteredP75 = percentile(minuteFilteredValues, 0.75);
                const analysisWindowLabel =
                  analysisLogs.length === 0
                    ? "-"
                    : `${analysisLogs[analysisLogs.length - 1]?.gameDateEt ?? "-"} to ${analysisLogs[0]?.gameDateEt ?? "-"}`;
                const hitChance = marketView.hitChance;

                return (
                  <article className="mt-4 rounded-xl border border-cyan-300/30 bg-[#0c1533] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-cyan-100">{focusedLabel} Analyzer</h4>
                      <p className="text-[11px] text-slate-400">Final live read for the selected market, with optional raw model context in Advanced Data.</p>
                    </div>

                    <div className="mt-3 grid gap-3 lg:grid-cols-[280px_1fr]">
                      <div className="rounded-lg border border-slate-300/20 bg-[#101938] p-3">
                        <label className="text-[11px] uppercase tracking-[0.12em] text-slate-300">
                          Active line
                          <input
                            value={lineMap[key] ?? ""}
                            onChange={(event) =>
                              setLineMap((current) => ({
                                ...current,
                            [key]: event.target.value,
                              }))
                            }
                            inputMode="decimal"
                            placeholder={referenceLine == null ? (modelLine.fairLine == null ? "Set line" : formatStat(modelLine.fairLine)) : formatStat(referenceLine)}
                            className="mt-1 w-full rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1.5 text-sm text-white outline-none focus:border-cyan-300/60"
                          />
                        </label>
                        <div className="mt-2 rounded-lg border border-slate-300/15 bg-[#0d1630] p-2 text-xs text-slate-200">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100">Final Read</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${modelSideClass(finalSide)}`}>
                              {finalSide}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                            <p>Game line</p>
                            <p className="text-right">{formatAverage(referenceLine)}</p>
                            <p>Line source</p>
                            <p className="text-right">{activeLineLabel}</p>
                            <p>{hitChance.label}</p>
                            <p className="text-right">{formatHitChanceDisplay(hitChance)}</p>
                            <p>Status</p>
                            <p className="text-right">{display?.statusText ?? "No live signal"}</p>
                            <p>Projection gap</p>
                            <p className="text-right">{formatAverage(display?.projectionGap ?? modelLine.projectionGap, true)}</p>
                            {showAdvancedView ? (
                              <>
                                <p>Model fair line</p>
                                <p className="text-right">{formatAverage(modelLine.fairLine)}</p>
                                <p>Model side</p>
                                <p className="text-right">
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${modelSideClass(modelLine.modelSide)}`}>
                                    {modelLine.modelSide}
                                  </span>
                                </p>
                              </>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 rounded-lg border border-slate-300/15 bg-[#0d1630] p-2 text-xs text-slate-200">
                          <div className="flex items-center justify-between gap-2">
                            <p className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-cyan-100">
                              Minutes Scenario
                              <InfoTip
                                label="Minutes Scenario"
                                definition="Filters game history by minimum minutes played so you can test role-based assumptions like 22+ minutes."
                              />
                            </p>
                            <p className="text-[10px] text-slate-400">Window: {analysisWindowLabel}</p>
                          </div>
                          <label className="mt-2 block text-[10px] uppercase tracking-[0.1em] text-slate-400">
                            Min minutes (&gt;=)
                            <input
                              value={minutesFloorMap[minutesKey] ?? ""}
                              onChange={(event) =>
                                setMinutesFloorMap((current) => ({
                                  ...current,
                                  [minutesKey]: event.target.value,
                                }))
                              }
                              inputMode="decimal"
                              placeholder={String(projectedFloorDefault)}
                              className="mt-1 w-full rounded-lg border border-slate-300/20 bg-[#101938] px-2 py-1.5 text-sm text-white outline-none focus:border-cyan-300/60"
                            />
                          </label>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {[20, 22, 24, 26, 28].map((value) => (
                              <button
                                key={`${m}-minutes-${value}`}
                                type="button"
                                onClick={() =>
                                  setMinutesFloorMap((current) => ({
                                    ...current,
                                    [minutesKey]: String(value),
                                  }))
                                }
                                className={`rounded px-2 py-0.5 text-[10px] ${
                                  minutesFloor === value
                                    ? "border border-cyan-300/70 bg-cyan-400/20 text-cyan-100"
                                    : "border border-slate-400/30 bg-[#101938] text-slate-300"
                                }`}
                              >
                                {value}+
                              </button>
                            ))}
                          </div>
                          <div className="mt-2 space-y-1 text-[11px]">
                            <p>
                              Sample: {minuteFilteredValues.length}/{analysisLogs.length} games | Avg:{" "}
                              {formatAverage(minuteFilteredAvg)} | Med: {formatAverage(minuteFilteredMedian)}
                            </p>
                            <p>
                              IQR: {formatAverage(minuteFilteredP25)} to {formatAverage(minuteFilteredP75)}
                            </p>
                            {selectedLine == null || !minuteFilteredHit ? (
                              <p className="text-slate-400">No active line available for this market yet.</p>
                            ) : (
                              <p className="text-cyan-100">
                                Vs {formatStat(selectedLine)} at {formatStat(minutesFloor)}+ min: OVER {minuteFilteredHit.over}/
                                {minuteFilteredValues.length} ({formatPercent(minuteFilteredHit.over, minuteFilteredValues.length)}) |
                                UNDER {minuteFilteredHit.under}/{minuteFilteredValues.length} (
                                {formatPercent(minuteFilteredHit.under, minuteFilteredValues.length)}) | PUSH {minuteFilteredHit.push}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 space-y-1 text-xs text-slate-300">
                          <p className="flex items-center justify-between">
                            <span>L3 Avg</span>
                            <span>{formatAverage(selectedPlayer.last3Average[m])}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>L10 Avg</span>
                            <span>{formatAverage(selectedPlayer.last10Average[m])}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>Season Avg</span>
                            <span>{formatAverage(selectedPlayer.seasonAverage[m])}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>Home/Away Avg</span>
                            <span>{formatAverage(selectedPlayer.homeAwayAverage[m])}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>Trend vs Season</span>
                            <span>{formatAverage(selectedPlayer.trendVsSeason[m], true)}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>Opp +/-</span>
                            <span>{formatAverage(selectedPlayer.opponentAllowanceDelta[m], true)}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>Proj Tonight</span>
                            <span>{formatAverage(projectionValue)}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>Game Line</span>
                            <span>{formatAverage(referenceLine)}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>{hitChance.label}</span>
                            <span>{formatHitChanceDisplay(hitChance)}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>Final Side</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${modelSideClass(finalSide)}`}>
                              {finalSide}
                            </span>
                          </p>
                        </div>

                        <div className="mt-3 rounded-lg border border-slate-300/15 bg-[#0d1630] p-2">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100">Advanced Metrics</p>
                          <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs text-slate-300">
                            <p className="inline-flex items-center gap-1">
                              Median L10
                              <InfoTip
                                label="Median L10"
                                definition="Middle value of the last 10 games; less sensitive to one-off spikes than average."
                              />
                            </p>
                            <p className="text-right">{formatAverage(l10Median)}</p>

                            <p className="inline-flex items-center gap-1">
                              Volatility (SD)
                              <InfoTip
                                label="Volatility (SD)"
                                definition="Standard deviation of last 10 games; bigger number means more boom/bust outcomes."
                              />
                            </p>
                            <p className="text-right">{formatAverage(l10StdDev)}</p>

                            <p className="inline-flex items-center gap-1">
                              Consistency
                              <InfoTip
                                label="Consistency"
                                definition="Share of last 10 games within one SD of the player's L10 average."
                              />
                            </p>
                            <p className="text-right">{formatPercentValue(l10Consistency)}</p>

                            <p className="inline-flex items-center gap-1">
                              L10 Range
                              <InfoTip
                                label="L10 Range"
                                definition="Difference between last 10 max and min values, plus floor/ceiling for context."
                              />
                            </p>
                            <p className="text-right">
                              {l10Range == null || l10Min == null || l10Max == null
                                ? "-"
                                : `${formatStat(l10Range)} (${formatStat(l10Min)}-${formatStat(l10Max)})`}
                            </p>

                            <p className="inline-flex items-center gap-1">
                              Z-Edge
                              <InfoTip
                                label="Z-Edge"
                                definition="(L10 average - your line) divided by volatility. +0.5 or higher is a stronger over lean; -0.5 or lower is a stronger under lean."
                              />
                            </p>
                            <p className="text-right">{zEdge == null ? "-" : zEdge.toFixed(2)}</p>
                          </div>
                        </div>

                        {selectedLine == null ? (
                          <p className="mt-3 rounded-lg bg-[#0d1630] px-2 py-2 text-xs text-slate-300">
                            No active line is available for this market yet.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-1 rounded-lg bg-[#0d1630] px-2 py-2 text-xs text-slate-200">
                            <p>Line source: {activeLineLabel}</p>
                            <p>
                              L5: {l5Hit?.over ?? 0}/{l5.length} OVER ({formatPercent(l5Hit?.over ?? 0, l5.length)}) |{" "}
                              {l5Hit?.under ?? 0}/{l5.length} UNDER ({formatPercent(l5Hit?.under ?? 0, l5.length)})
                            </p>
                            <p>
                              L10: {l10Hit?.over ?? 0}/{l10.length} OVER ({formatPercent(l10Hit?.over ?? 0, l10.length)}) |{" "}
                              {l10Hit?.under ?? 0}/{l10.length} UNDER ({formatPercent(l10Hit?.under ?? 0, l10.length)})
                            </p>
                            <p>L3 Avg vs line: {formatAverage(l3VsLine, true)}</p>
                            <p>L10 Avg vs line: {formatAverage(l10VsLine, true)}</p>
                            <p>Season Avg vs line: {formatAverage(seasonVsLine, true)}</p>
                            <p>Projection vs line: {formatAverage(projectionVsLine, true)}</p>
                            <p>
                              {formatStat(minutesFloor)}+ min sample: {minuteFilteredHit?.over ?? 0}/{minuteFilteredValues.length} OVER (
                              {formatPercent(minuteFilteredHit?.over ?? 0, minuteFilteredValues.length)})
                            </p>
                            <p>
                              1 SD line band:{" "}
                              {oneSdBandLow == null || oneSdBandHigh == null
                                ? "-"
                                : `${formatStat(oneSdBandLow)} to ${formatStat(oneSdBandHigh)}`}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="overflow-hidden rounded-lg border border-slate-300/20">
                        <table className="w-full text-xs">
                          <thead className="bg-[#162249] text-slate-200/80">
                            <tr>
                              <th className="px-2 py-2 text-left">Date</th>
                              <th className="px-2 py-2 text-left">Opp</th>
                              <th className="px-2 py-2 text-left">Site</th>
                              <th className="px-2 py-2 text-left">Start</th>
                              <th className="px-2 py-2 text-left">Min</th>
                              <th className="px-2 py-2 text-left">{m}</th>
                              <th className="px-2 py-2 text-left">Vs line</th>
                              <th className="px-2 py-2 text-left">Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recentLogsPending ? (
                              <tr className="border-t border-slate-300/10">
                                <td colSpan={8} className="px-2 py-3 text-cyan-100">
                                  Loading the last 10 completed-game logs...
                                </td>
                              </tr>
                            ) : selectedPlayer.recentLogs.length === 0 ? (
                              <tr className="border-t border-slate-300/10">
                                <td colSpan={8} className="px-2 py-3 text-slate-300">
                                  No completed-game logs available yet.
                                </td>
                              </tr>
                            ) : (
                              selectedPlayer.recentLogs.map((log, index) => {
                                const value = marketValueFromLog(log, m);
                                const diff = selectedLine == null ? null : value - selectedLine;
                                const result = selectedLine == null ? null : resultLabel(value, selectedLine);
                                return (
                                  <tr key={`${m}-${log.gameDateEt}-${index}`} className="border-t border-slate-300/10">
                                    <td className="px-2 py-2">{log.gameDateEt}</td>
                                    <td className="px-2 py-2">{log.opponent ?? "-"}</td>
                                    <td className="px-2 py-2">{log.isHome ? "Home" : "Away"}</td>
                                    <td className="px-2 py-2">{log.starter == null ? "-" : log.starter ? "Y" : "N"}</td>
                                    <td className="px-2 py-2">{formatStat(log.minutes)}</td>
                                    <td className="px-2 py-2 font-semibold text-white">{formatStat(value)}</td>
                                    <td className="px-2 py-2">{diff == null ? "-" : formatAverage(diff, true)}</td>
                                    <td
                                      className={`px-2 py-2 font-semibold ${
                                        result === "OVER"
                                          ? "text-emerald-300"
                                          : result === "UNDER"
                                            ? "text-amber-300"
                                            : result === "PUSH"
                                              ? "text-cyan-200"
                                              : "text-slate-300"
                                      }`}
                                    >
                                      {result ?? "-"}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </article>
                );
              })()}
            </CollapsibleSection>

            <CollapsibleSection
              id="detail-logs"
              title="Last 10 Completed Games"
              collapsed={collapsedSections.logs}
              onToggle={() => toggleSection("logs")}
            >
              {recentLogsPending ? (
                <p className="mt-3 text-sm text-cyan-100">Loading the last 10 completed-game logs...</p>
              ) : selectedPlayer.recentLogs.length === 0 ? (
                <p className="mt-3 text-sm text-slate-300">No completed-game logs available yet.</p>
              ) : (
                <div className="mt-2 overflow-hidden rounded-xl border border-slate-300/15">
                  <table className="w-full text-xs">
                    <thead className="bg-[#162249] text-slate-200/80">
                      <tr>
                        <th className="px-2 py-2 text-left">Date</th>
                        <th className="px-2 py-2 text-left">Opp</th>
                        <th className="px-2 py-2 text-left">Site</th>
                        <th className="px-2 py-2 text-left">Start</th>
                        <th className="px-2 py-2 text-left">Min</th>
                        <th className="px-2 py-2 text-left">PTS</th>
                        <th className="px-2 py-2 text-left">REB</th>
                        <th className="px-2 py-2 text-left">AST</th>
                        <th className="px-2 py-2 text-left">3PM</th>
                        <th className="px-2 py-2 text-left">STL</th>
                        <th className="px-2 py-2 text-left">BLK</th>
                        <th className="px-2 py-2 text-left">PRA</th>
                        <th className="px-2 py-2 text-left">PA</th>
                        <th className="px-2 py-2 text-left">PR</th>
                        <th className="px-2 py-2 text-left">RA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPlayer.recentLogs.map((log, index) => {
                        const pra = log.points + log.rebounds + log.assists;
                        const pa = log.points + log.assists;
                        const pr = log.points + log.rebounds;
                        const ra = log.rebounds + log.assists;
                        return (
                          <tr key={`${log.gameDateEt}-${index}`} className="border-t border-slate-300/10">
                            <td className="px-2 py-2">{log.gameDateEt}</td>
                            <td className="px-2 py-2">{log.opponent ?? "-"}</td>
                            <td className="px-2 py-2">{log.isHome ? "Home" : "Away"}</td>
                            <td className="px-2 py-2">{log.starter == null ? "-" : log.starter ? "Y" : "N"}</td>
                            <td className="px-2 py-2">{formatStat(log.minutes)}</td>
                            <td className="px-2 py-2">{formatStat(log.points)}</td>
                            <td className="px-2 py-2">{formatStat(log.rebounds)}</td>
                            <td className="px-2 py-2">{formatStat(log.assists)}</td>
                            <td className="px-2 py-2">{formatStat(log.threes)}</td>
                            <td className="px-2 py-2">{formatStat(log.steals)}</td>
                            <td className="px-2 py-2">{formatStat(log.blocks)}</td>
                            <td className="px-2 py-2">{formatStat(pra)}</td>
                            <td className="px-2 py-2">{formatStat(pa)}</td>
                            <td className="px-2 py-2">{formatStat(pr)}</td>
                            <td className="px-2 py-2">{formatStat(ra)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              id="detail-summary"
              title="Quick Read"
              collapsed={collapsedSections.summary}
              onToggle={() => toggleSection("summary")}
            >
              <section className="text-xs text-slate-300">
                {(() => {
                  const key = scopedLineKey(selectedPlayer.playerId, focusedMarket);
                  const customLine = parseLine(lineMap[key] ?? "");
                  const marketView = resolveMarketRecommendationView(selectedPlayer, focusedMarket, customLine);
                  const referenceLine = marketView.marketLine;
                  const finalSide = marketView.finalSide;

                  return (
                    <p>
                      Quick read ({focusedMarket}): L5 avg {formatAverage(average(selectedPlayer.last5[focusedMarket]))} | L10 avg{" "}
                      {formatAverage(selectedPlayer.last10Average[focusedMarket])} | Projection{" "}
                      {formatAverage(selectedPlayer.projectedTonight[focusedMarket])} | Game line {formatAverage(referenceLine)} | Final side{" "}
                      {finalSide} | Trend {formatAverage(selectedPlayer.trendVsSeason[focusedMarket], true)} | Opp +/-{" "}
                      {formatAverage(selectedPlayer.opponentAllowanceDelta[focusedMarket], true)}
                    </p>
                  );
                })()}
              </section>
            </CollapsibleSection>

            {matchupStatsByKey.has(selectedPlayer.matchupKey) ? (
              <CollapsibleSection
                id="detail-team"
                title="Team Context"
                collapsed={collapsedSections.team}
                onToggle={() => toggleSection("team")}
              >
              <section className="rounded-xl border border-slate-300/20 bg-[#101938] p-3 text-xs">
                {(() => {
                  const item = matchupStatsByKey.get(selectedPlayer.matchupKey)!;
                  const teamIsAway = selectedPlayer.teamCode === item.awayTeam;
                  const teamFor = teamIsAway ? item.awayLast10For[focusedMarket] : item.homeLast10For[focusedMarket];
                  const oppAllowed = teamIsAway ? item.homeLast10Allowed[focusedMarket] : item.awayLast10Allowed[focusedMarket];
                  return (
                    <p className="text-slate-300">
                      Team context ({selectedPlayer.teamCode} {focusedMarket}): L10 offense {formatAverage(teamFor)} vs opponent L10 allowed {formatAverage(oppAllowed)} | edge{" "}
                      {formatAverage(edge(teamFor, oppAllowed), true)}
                    </p>
                  );
                })()}
              </section>
              </CollapsibleSection>
            ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <section id="comments-section" className="section-shell section-shell--violet mt-8 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-violet-200/80">Community</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">Suggestions & Feedback</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              The homepage stays focused on the board now. Use the separate page for site comments, bug reports,
              feature ideas, and general suggestions.
            </p>
          </div>
          <button
            type="button"
            onClick={openFeedbackPage}
            className="rounded-full border border-violet-300/30 bg-violet-500/12 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/20"
          >
            Open Suggestions Page
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 px-4 py-4 text-sm text-slate-300">
          Leave public comments and suggestions on a dedicated page without crowding the homepage. That page keeps the
          full message list together so people can review older ideas and ongoing feedback in one place.
        </div>
      </section>
    </main>
  );
}

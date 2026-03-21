"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getTodayEtDateString } from "@/lib/snapshot/time";
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

const VISIT_REFRESH_INTERVAL_MS = 30_000;
const VISIT_REFRESH_FOLLOW_UP_LOAD_MS = 15_000;

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

const HOMEPAGE_QUALIFIED_PICK_LIMIT = 6;

type DetailSectionKey = "context" | "intel" | "backtest" | "markets" | "logs" | "summary" | "team";

type DetailSectionMeta = {
  key: DetailSectionKey;
  id: string;
  title: string;
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

function lineInFocus(customLine: number | null, modelLine: number | null): number | null {
  return customLine ?? modelLine;
}

function lineSourceLabel(customLine: number | null, modelLine: number | null): string {
  if (customLine != null) return `Your ${formatStat(customLine)}`;
  if (modelLine != null) return `Model ${formatStat(modelLine)}`;
  return "No line";
}

function modelSideClass(side: "OVER" | "UNDER" | "NEUTRAL"): string {
  if (side === "OVER") return "bg-emerald-500/15 text-emerald-200";
  if (side === "UNDER") return "bg-amber-500/15 text-amber-200";
  return "bg-slate-500/20 text-slate-200";
}

function ptsFilterClass(qualified: boolean): string {
  return qualified ? "bg-emerald-500/15 text-emerald-200" : "bg-rose-500/15 text-rose-200";
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

function comparePrecisionSignals(
  left: Pick<SnapshotPrecisionPickSignal, "historicalAccuracy" | "absLineGap" | "leafAccuracy" | "bucketRecentAccuracy"> &
    Partial<Pick<SnapshotPrecisionPickSignal, "projectionWinProbability" | "projectionPriceEdge">>,
  right: Pick<SnapshotPrecisionPickSignal, "historicalAccuracy" | "absLineGap" | "leafAccuracy" | "bucketRecentAccuracy"> &
    Partial<Pick<SnapshotPrecisionPickSignal, "projectionWinProbability" | "projectionPriceEdge">>,
): number {
  if (right.historicalAccuracy !== left.historicalAccuracy) {
    return right.historicalAccuracy - left.historicalAccuracy;
  }

  const rightWinProbability = right.projectionWinProbability ?? Number.NEGATIVE_INFINITY;
  const leftWinProbability = left.projectionWinProbability ?? Number.NEGATIVE_INFINITY;
  if (rightWinProbability !== leftWinProbability) {
    return rightWinProbability - leftWinProbability;
  }

  const rightPriceEdge = right.projectionPriceEdge ?? Number.NEGATIVE_INFINITY;
  const leftPriceEdge = left.projectionPriceEdge ?? Number.NEGATIVE_INFINITY;
  if (rightPriceEdge !== leftPriceEdge) {
    return rightPriceEdge - leftPriceEdge;
  }

  const rightGap = right.absLineGap ?? Number.NEGATIVE_INFINITY;
  const leftGap = left.absLineGap ?? Number.NEGATIVE_INFINITY;
  if (rightGap !== leftGap) {
    return rightGap - leftGap;
  }

  const rightLeaf = right.leafAccuracy ?? Number.NEGATIVE_INFINITY;
  const leftLeaf = left.leafAccuracy ?? Number.NEGATIVE_INFINITY;
  if (rightLeaf !== leftLeaf) {
    return rightLeaf - leftLeaf;
  }

  const rightBucket = right.bucketRecentAccuracy ?? Number.NEGATIVE_INFINITY;
  const leftBucket = left.bucketRecentAccuracy ?? Number.NEGATIVE_INFINITY;
  if (rightBucket !== leftBucket) {
    return rightBucket - leftBucket;
  }

  return 0;
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

type MarketSignalDisplay = {
  statusText: string;
  statusClass: string;
  side: SnapshotModelSide;
  confidence: number | null;
  confidenceTier: SnapshotPtsConfidenceTier | null;
  projectionGap: number | null;
  minutesRisk: number | null;
  line: number | null;
  sportsbookCount: number | null;
  message: string | null;
};

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

type PrecisionCandidate = FocusCandidate & {
  precision: SnapshotPrecisionPickSignal;
};

type DailyCardCandidate = {
  candidate: PrecisionCandidate;
  precision: SnapshotPrecisionPickSignal;
};

function resolveMarketSignalDisplay(
  marketLabel: string,
  signal: SnapshotPtsSignal | null,
  modelLine: SnapshotRow["modelLines"][SnapshotMarket],
): MarketSignalDisplay | null {
  const usingModelFallback = (signal?.marketLine ?? null) == null && modelLine.fairLine != null;
  if (!signal && !usingModelFallback) return null;

  const qualified = signal?.qualified ?? false;
  const line = usingModelFallback ? modelLine.fairLine : signal?.marketLine ?? null;
  const projectionGap = usingModelFallback ? modelLine.projectionGap : signal?.projectionGap ?? null;
  const message = usingModelFallback
    ? `Live line unavailable. Using model fair line ${formatAverage(modelLine.fairLine)}. Action zone O <= ${formatAverage(
        modelLine.actionOverLine ?? modelLine.fairLine,
      )} / U >= ${formatAverage(modelLine.actionUnderLine ?? modelLine.fairLine)}.`
    : !qualified && signal && signal.passReasons.length > 0
      ? signal.passReasons.join(" ")
      : null;

  return {
    statusText: usingModelFallback ? `${marketLabel} MODEL` : `${marketLabel} ${qualified ? "QUALIFIED" : "PASS"}`,
    statusClass: usingModelFallback ? "bg-cyan-500/15 text-cyan-200" : ptsFilterClass(qualified),
    side: usingModelFallback ? modelLine.modelSide : signal?.side ?? "NEUTRAL",
    confidence: usingModelFallback ? null : signal?.confidence ?? null,
    confidenceTier: usingModelFallback ? null : signal?.confidenceTier ?? null,
    projectionGap,
    minutesRisk: signal?.minutesRisk ?? null,
    line,
    sportsbookCount: usingModelFallback ? null : signal?.sportsbookCount ?? null,
    message,
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

function buildFocusCandidate(
  row: SnapshotRow,
  market: SnapshotMarket,
  customLineValue: string | undefined,
): FocusCandidate {
  const signal = liveSignalForMarket(row, market);
  const modelLine = row.modelLines[market];
  const display = resolveMarketSignalDisplay(signalLabelForMarket(market), signal, modelLine);
  const customLine = parseLine(customLineValue ?? "");
  const currentLine = lineInFocus(customLine, display?.line ?? modelLine.fairLine);
  const currentLineLabel =
    customLine != null
      ? lineSourceLabel(customLine, modelLine.fairLine)
      : display?.line != null
        ? `Live ${formatStat(display.line)}`
        : lineSourceLabel(customLine, modelLine.fairLine);
  const side = display?.side ?? modelLine.modelSide;
  const gap = Math.abs(display?.projectionGap ?? modelLine.projectionGap ?? 0);
  const confidence = display?.confidence ?? null;
  const minutesRisk = display?.minutesRisk ?? null;
  const confidenceScore = confidence == null ? 0 : clampNumber((confidence - 50) * 0.7, 0, 24);
  const gapScore = clampNumber(gap * 10, 0, 24);
  const riskScore = minutesRisk == null ? 4 : clampNumber(12 - minutesRisk * 16, 0, 12);
  const support = directionalSupport(side, row.trendVsSeason[market], row.opponentAllowanceDelta[market]);
  const modelAgreementBonus = side !== "NEUTRAL" && side === modelLine.modelSide ? 6 : side === "NEUTRAL" ? 0 : -2;
  const lineAvailabilityBonus = display?.line != null ? 6 : modelLine.fairLine != null ? 3 : 0;
  const signalQualified = signal?.qualified ?? false;
  const liveQualifiedBonus = signalQualified ? 34 : display != null ? 8 : 0;
  const score = roundNumber(
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
  );
  const focusTier = focusTierFromScore(score, signalQualified);
  const reasons: string[] = [];
  reasons.push(
    display == null
      ? "No live signal; using model context."
      : `${display.statusText} ${display.side === "NEUTRAL" ? "" : display.side}`.trim(),
  );
  if (display?.projectionGap != null) {
    reasons.push(`Gap ${formatAverage(display.projectionGap, true)} vs ${currentLineLabel.toLowerCase()}.`);
  }
  if (confidence != null || minutesRisk != null) {
    reasons.push(
      `Conf ${confidence == null ? "-" : formatStat(confidence)} | Risk ${minutesRisk == null ? "-" : formatStat(minutesRisk)}`,
    );
  }
  reasons.push(`Data ${row.dataCompleteness.score} ${row.dataCompleteness.tier}.`);

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
    supportText: support.text,
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

function lineKey(playerId: string, market: SnapshotMarket): string {
  return `${playerId}:${market}`;
}

function minuteFloorKey(playerId: string, market: SnapshotMarket): string {
  return `${playerId}:${market}:minutes-floor`;
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

function formatClientTimestamp(value: Date): string {
  return value.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
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
    <section id={id} className="mt-4 rounded-xl border border-slate-300/20 bg-[#0c1533]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <div>
          <h3 className="text-xs uppercase tracking-[0.16em] text-cyan-200">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p> : null}
        </div>
        <span className="rounded-md border border-slate-300/25 bg-[#101938] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-200">
          {collapsed ? "Expand" : "Collapse"}
        </span>
      </button>
      {collapsed ? null : <div className="px-3 pb-3">{children}</div>}
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
  const playerDetailRequestRef = useRef(0);
  const lastVisitRefreshRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  const refreshInFlightRef = useRef(false);
  const pendingBoardReloadTimeoutRef = useRef<number | null>(null);
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
  const [pageOpenedAt, setPageOpenedAt] = useState<string | null>(null);
  const showAdvancedView = false;
  const [collapsedSections, setCollapsedSections] = useState<Record<DetailSectionKey, boolean>>(
    defaultCollapsedSections(true),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
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

  const fetchBoardSnapshot = useCallback(async (targetDate: string, options?: { bustCache?: boolean }): Promise<SnapshotBoardData> => {
    const params = new URLSearchParams();
    params.set("date", targetDate);
    if (options?.bustCache) {
      params.set("t", String(Date.now()));
    }

    const response = await fetch(`/api/snapshot/board?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as SnapshotBoardApiResponse;
    if (!response.ok || !payload.ok || !payload.result) {
      throw new Error(payload.error ?? "Board load failed.");
    }
    return payload.result;
  }, []);

  const loadBoardData = useCallback(async (targetDate: string, options?: { bustCache?: boolean }): Promise<void> => {
    const requestId = boardRequestRef.current + 1;
    boardRequestRef.current = requestId;
    boardLoadTargetRef.current = targetDate;
    setIsBoardLoading(true);
    setBoardError(null);

    try {
      const result = await fetchBoardSnapshot(targetDate, options);
      if (requestId !== boardRequestRef.current) return;
      setBoardData(result);
    } catch (error) {
      if (requestId !== boardRequestRef.current) return;
      setBoardError(error instanceof Error ? error.message : "Board load failed.");
    } finally {
      if (requestId === boardRequestRef.current) {
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
      void loadBoardData(targetDate, { bustCache: true });
    }, delayMs);
  }, [loadBoardData]);

  const runBoardRefresh = useCallback(async (targetDate: string, source: "manual" | "visit"): Promise<void> => {
    const isTodaySlate = targetDate === getTodayEtDateString(new Date());
    if (!isTodaySlate) {
      await loadBoardData(targetDate, { bustCache: true });
      return;
    }

    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    setIsRefreshing(true);
    setRefreshError(null);
    setRefreshMessage(
      source === "visit"
        ? "Refreshing the live board for this visit..."
        : "Refresh started. The page stays usable while the newest board finishes loading.",
    );

    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: source === "visit" ? "FAST" : "DELTA" }),
      });
      const payload = (await response.json()) as SnapshotRefreshApiResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Refresh failed");
      }

      const warnings = payload.result?.warnings ?? [];
      if (warnings.some((item) => item.toLowerCase().includes("already running"))) {
        setRefreshMessage(
          source === "visit"
            ? "A live refresh is already running. Loading the newest board as soon as it finishes."
            : "Refresh is already running. Loading the newest board shortly.",
        );
        scheduleBoardReload(targetDate);
        await loadBoardData(targetDate, { bustCache: true });
        return;
      }

      setRefreshMessage(
        source === "visit"
          ? `Board refreshed for this visit (${payload.result?.status ?? "SUCCESS"}).`
          : `Refresh complete (${payload.result?.status ?? "SUCCESS"}). Updating board...`,
      );
      await loadBoardData(targetDate, { bustCache: true });
    } catch (error) {
      if (source === "visit") {
        const message = error instanceof Error ? error.message : "Auto refresh failed.";
        setRefreshError(`Auto refresh failed: ${message}`);
        await loadBoardData(targetDate, { bustCache: true });
        return;
      }

      setRefreshError(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [loadBoardData, scheduleBoardReload]);

  const refreshBoardForVisit = useCallback(
    (targetDate: string, options?: { minIntervalMs?: number }): void => {
      const now = Date.now();
      const visitKey =
        targetDate === getTodayEtDateString(new Date()) ? `live-refresh:${targetDate}` : `board-load:${targetDate}`;
      const minIntervalMs = options?.minIntervalMs ?? VISIT_REFRESH_INTERVAL_MS;
      if (lastVisitRefreshRef.current.key === visitKey && now - lastVisitRefreshRef.current.at < minIntervalMs) {
        return;
      }

      lastVisitRefreshRef.current = { key: visitKey, at: now };
      setPageOpenedAt(formatClientTimestamp(new Date(now)));
      void runBoardRefresh(targetDate, "visit");
    },
    [runBoardRefresh],
  );

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
    setDateInput(initialData.dateEt);
  }, [initialData.dateEt]);

  useEffect(() => {
    setBoardData(initialData);
    setBoardError(null);
    boardLoadTargetRef.current = initialData.dateEt;
    if (!hasBoardSnapshotData(initialData)) {
      void loadBoardData(initialData.dateEt, { bustCache: true });
    }
    refreshBoardForVisit(initialData.dateEt);
  }, [initialData, loadBoardData, refreshBoardForVisit]);

  useEffect(() => {
    const handlePageShow = (): void => {
      refreshBoardForVisit(activeData.dateEt);
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [activeData.dateEt, refreshBoardForVisit]);

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

    void fetch(`/api/snapshot/player/backtest?player=${encodeURIComponent(playerName)}`, {
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

      setSelectedPlayer(payload.result.row);
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
      void hydratePlayerDetail(row, lookupMeta);
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
      void loadBoardData(normalizedDate);
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

  const currentMarketLabel = useMemo(
    () => MARKET_FILTER_OPTIONS.find((option) => option.value === market)?.label ?? market,
    [market],
  );
  const teamStatsMarket = market === "ALL" ? null : market;

  const marketFocusCandidates = useMemo(
    () => {
      if (!showAdvancedView || market === "ALL") return [];
      return filteredRows
        .map((row) => buildFocusCandidate(row, market, lineMap[lineKey(row.playerId, market)]))
        .sort((left, right) => {
          if (right.focusScore !== left.focusScore) return right.focusScore - left.focusScore;
          const leftConfidence = left.display?.confidence ?? 0;
          const rightConfidence = right.display?.confidence ?? 0;
          if (rightConfidence !== leftConfidence) return rightConfidence - leftConfidence;
          return left.row.playerName.localeCompare(right.row.playerName);
        });
    },
    [filteredRows, lineMap, market, showAdvancedView],
  );

  const allQualifiedCandidates = useMemo(
    () =>
      filteredRows
        .flatMap((row) =>
          MARKET_OPTIONS.map((option) =>
            buildFocusCandidate(row, option.value, lineMap[lineKey(row.playerId, option.value)]),
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
    [filteredRows, lineMap],
  );

  const allFocusCandidates = useMemo(
    () => {
      if (!showAdvancedView) return [];
      return filteredRows
        .flatMap((row) =>
          MARKET_OPTIONS.map((option) => buildFocusCandidate(row, option.value, lineMap[lineKey(row.playerId, option.value)])),
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
    [filteredRows, lineMap, showAdvancedView],
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

  const precisionCandidates = useMemo(
    () => {
      const ranked = filteredRows
        .flatMap((row) =>
          (activeData.precisionSystem?.supportedMarkets ?? []).flatMap((supportedMarket) => {
            const precision = precisionSignalForMarket(row, supportedMarket);
            if (!precision) return [];
            const isPrecisionQualified = precision?.qualified ?? precision?.side !== "NEUTRAL";
            if (!isPrecisionQualified) return [];
            return [
              {
                ...buildFocusCandidate(row, supportedMarket, lineMap[lineKey(row.playerId, supportedMarket)]),
                precision,
              } satisfies PrecisionCandidate,
            ];
          }),
        )
        .sort((left, right) => {
          const signalComparison = comparePrecisionSignals(left.precision, right.precision);
          if (signalComparison !== 0) return signalComparison;
          if (right.focusScore !== left.focusScore) return right.focusScore - left.focusScore;
          return left.row.playerName.localeCompare(right.row.playerName);
        });

      const seenPlayers = new Set<string>();
      return ranked.filter((candidate) => {
        if (isUnavailableForDailyCard(candidate.row)) return false;
        if (seenPlayers.has(candidate.row.playerId)) return false;
        seenPlayers.add(candidate.row.playerId);
        return true;
      });
    },
    [activeData.precisionSystem?.supportedMarkets, filteredRows, lineMap],
  );

  const dailyCardCandidates = useMemo<DailyCardCandidate[]>(
    () =>
      precisionCandidates.map((candidate) => ({
        candidate,
        precision: candidate.precision,
      })),
    [precisionCandidates],
  );

  const displayedCandidates = useMemo(() => {
    if (showQualifiedOnly && qualifiedCandidates.length > 0) return qualifiedCandidates;
    return focusCandidates;
  }, [focusCandidates, qualifiedCandidates, showQualifiedOnly]);

  const homepageQualifiedCandidates = useMemo(
    () => allQualifiedCandidates.slice(0, HOMEPAGE_QUALIFIED_PICK_LIMIT),
    [allQualifiedCandidates],
  );

  const leadingMarket = useMemo(() => {
    if (allQualifiedMarketSummary.length === 0) return null;
    return [...allQualifiedMarketSummary].sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))[0];
  }, [allQualifiedMarketSummary]);

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
    jumpToSection("all-qualified-section");
  }

  function focusPlayerLookup(): void {
    const target = document.getElementById("player-search-input") as HTMLInputElement | null;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => target.focus(), 120);
  }

  return (
    <main className="mx-auto max-w-[1600px] px-4 pb-12 pt-6 sm:px-6 lg:px-10">
      <section className="overflow-hidden rounded-[34px] border border-[#f0d7a1]/15 bg-[radial-gradient(1100px_440px_at_0%_0%,#0f766e55_0%,transparent_62%),radial-gradient(900px_420px_at_100%_0%,#f59e0b33_0%,transparent_58%),linear-gradient(155deg,#071426_0%,#0d1830_48%,#111828_100%)] px-5 py-5 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.9)] sm:px-7 sm:py-7">
        <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <div className="space-y-5">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-[#f3d99b]">UltOps NBA Research</p>
              <h1 className="title-font mt-3 max-w-4xl text-4xl uppercase leading-[0.95] text-white sm:text-[3.35rem]">
                Find The Best Card Fast, Then Open Only The Research You Need
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-200/88">
                This homepage is now built for a fast public read: give the board a few seconds to load, start with the
                Daily 6 card, then scan the top qualified plays. If you want deeper research on anyone else, open that
                player directly from lookup.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300/80">
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                  Page opened: {pageOpenedAt ?? "Loading..."}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                  Board updated:{" "}
                  {activeData.lastUpdatedAt ? new Date(activeData.lastUpdatedAt).toLocaleString() : "No refresh yet"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => jumpToSection("daily-card-section")}
              className="rounded-full border border-[#4fd1c5]/35 bg-[#0f766e]/20 px-4 py-2 text-sm font-semibold text-teal-50 transition hover:bg-[#0f766e]/30"
            >
              Start With Daily 6
            </button>
            <button
              type="button"
              onClick={openAllQualifiedBoard}
              className="rounded-full border border-[#f0d7a1]/35 bg-[#f59e0b]/16 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-[#f59e0b]/24"
            >
              View All Qualified Picks
            </button>
            <button
              type="button"
              onClick={() => {
                void handleRefresh();
              }}
              disabled={isRefreshing}
              className="rounded-full border border-white/15 bg-white/8 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshing ? "Refreshing Slate..." : "Refresh Slate"}
            </button>
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="rounded-full border border-white/12 bg-[#13203a] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-[#182746]"
            >
              How It Works
            </button>
          </div>

          <div className="rounded-[26px] border border-cyan-300/20 bg-[#0b2940]/72 px-4 py-4 text-sm text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <p className="font-semibold text-white">Give the board a few seconds to fully load.</p>
            <p className="mt-1 text-cyan-50/82">
              The site settles the slate, live lines, and qualified picks in the background. You should see the top cards
              stabilize a moment after you hit <span className="font-semibold text-white">Load Board</span> or{" "}
              <span className="font-semibold text-white">Refresh Slate</span>.
            </p>
          </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-[22px] border border-teal-300/16 bg-[#0b2a2c]/66 px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-teal-100/65">
                  {activeData.precisionSystem ? `${activeData.precisionSystem.label} Today` : "Daily Card Today"}
                </p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {activeData.precisionSystem ? dailyCardCandidates.length : allQualifiedCandidates.length}
                </p>
                <p className="mt-2 text-xs text-slate-300">The first card to trust-check.</p>
              </article>
              <article className="rounded-[22px] border border-amber-300/16 bg-[#2a1b0b]/66 px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-amber-100/65">
                  {isAllMarketsView ? "Qualified On Page" : "Qualified This Market"}
                </p>
                <p className="mt-2 text-3xl font-semibold text-white">{qualifiedFocusCount}</p>
                <p className="mt-2 text-xs text-slate-300">Strong model-backed reads live now.</p>
              </article>
              <article className="rounded-[22px] border border-cyan-300/16 bg-[#0a2438]/66 px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/65">Best Market Today</p>
                <p className="mt-2 text-3xl font-semibold text-white">{leadingMarket?.value ?? "-"}</p>
                <p className="mt-2 text-xs text-slate-300">Where the board is surfacing the most value.</p>
              </article>
              <article className="rounded-[22px] border border-slate-200/10 bg-[#111b2f]/72 px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Markets Live</p>
                <p className="mt-2 text-3xl font-semibold text-white">{allQualifiedMarketSummary.length}</p>
                <p className="mt-2 text-xs text-slate-300">How many prop markets are live on this board.</p>
              </article>
            </div>

            {allQualifiedMarketSummary.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMarket("ALL")}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    isAllMarketsView
                      ? "border-teal-300/45 bg-teal-500/15 text-teal-100"
                      : "border-white/10 bg-white/6 text-slate-200 hover:border-cyan-300/30 hover:text-white"
                  }`}
                >
                  All Picks {allQualifiedCandidates.length}
                </button>
                {allQualifiedMarketSummary.map((option) => (
                  <button
                    key={`market-summary-${option.value}`}
                    type="button"
                    onClick={() => setMarket(option.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      market === option.value
                        ? "border-amber-300/45 bg-amber-500/15 text-amber-100"
                        : "border-white/10 bg-white/6 text-slate-200 hover:border-cyan-300/30 hover:text-white"
                    }`}
                  >
                    {option.value} {option.count}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-4">
            <div className="rounded-[28px] border border-white/10 bg-[#0b1324]/82 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Board Controls</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Load The Slate You Want</h2>
                  <p className="mt-2 text-sm text-slate-300">
                    Use the date, matchup, and market controls here, then let the board settle before reading the cards.
                  </p>
                </div>
                <span className="rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-100">
                  Homepage = Daily 6 + Qualified
                </span>
              </div>

              <form onSubmit={handleLoadData} className="mt-5 grid grid-cols-1 gap-3">
                <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                  <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-300/85">
                    Date (ET)
                    <input
                      type="date"
                      value={dateInput}
                      onChange={(event) => setDateInput(event.target.value)}
                      className="rounded-xl border border-slate-300/20 bg-[#091121] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-300/85">
                    Matchup
                    <select
                      value={matchup}
                      onChange={(event) => setMatchup(event.target.value)}
                      className="rounded-xl border border-slate-300/20 bg-[#091121] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                    >
                      <option value="">All Matchups</option>
                      {activeData.matchups.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_170px]">
                  <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-300/85">
                    Market
                    <select
                      value={market}
                      onChange={(event) => setMarket(event.target.value as MarketFilter)}
                      className="rounded-xl border border-slate-300/20 bg-[#091121] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                    >
                      {MARKET_FILTER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="submit"
                    className="h-[42px] self-end rounded-xl border border-amber-300/35 bg-amber-500/18 px-4 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/26"
                  >
                    {isBoardLoading ? "Loading..." : "Load Board"}
                  </button>
                </div>
              </form>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#0c162a]/82 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Player Lookup</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Open Any Player Directly</h2>
                  <p className="mt-2 text-sm text-slate-300">
                    The homepage stays trimmed down. Use lookup whenever you want the full player detail instead of more
                    homepage clutter.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={focusPlayerLookup}
                  className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/12"
                >
                  Focus Lookup
                </button>
              </div>

              <div className="mt-5">
                <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-300/85">
                  Player Search
                  <div className="relative">
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
                onChange={(event) => {
                  setPlayerSearch(event.target.value);
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
                    setPlayerSuggestIndex((current) => {
                      const next = current + 1;
                      return next >= playerSuggestions.length ? 0 : next;
                    });
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setPlayerSuggestIndex((current) => {
                      if (current <= 0) return playerSuggestions.length - 1;
                      return current - 1;
                    });
                    return;
                  }
                  if (event.key === "Enter" && playerSuggestIndex >= 0 && playerSuggestIndex < playerSuggestions.length) {
                    event.preventDefault();
                    applyPlayerSuggestion(playerSuggestions[playerSuggestIndex]);
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handlePlayerLookup();
                    return;
                  }
                  if (event.key === "Escape") {
                    setPlayerSuggestOpen(false);
                    setPlayerSuggestIndex(-1);
                  }
                }}
                placeholder="Type any player name..."
                className="w-full rounded-xl border border-slate-300/20 bg-[#091121] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
              />
              {playerSuggestOpen && playerSuggestions.length > 0 ? (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-64 overflow-y-auto rounded-xl border border-slate-300/20 bg-[#0a1630] shadow-[0_18px_45px_-20px_rgba(15,23,42,0.95)]">
                  {playerSuggestions.map((row, index) => (
                    <button
                      key={`suggest-${row.playerId}`}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyPlayerSuggestion(row);
                      }}
                      className={`flex w-full items-center justify-between gap-2 border-b border-slate-300/10 px-3 py-2 text-left text-xs last:border-b-0 ${
                        index === playerSuggestIndex ? "bg-cyan-400/18 text-cyan-100" : "text-slate-200 hover:bg-slate-700/30"
                      }`}
                    >
                      <span className="font-medium">{row.playerName}</span>
                      <span className="text-[11px] text-slate-400">
                        {row.teamCode} vs {row.opponentCode}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
                  </div>
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] text-slate-400">
                  Opens the full player research panel, even when that player is not on the visible homepage cards.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void handlePlayerLookup();
                  }}
                  disabled={isPlayerLookupLoading}
                  className="rounded-xl border border-cyan-300/35 bg-cyan-500/16 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/24 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPlayerLookupLoading ? "Opening Research..." : "Open Player Research"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {refreshMessage ? (
          <p className="mt-4 rounded-2xl border border-emerald-300/15 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-100">
            {refreshMessage}
          </p>
        ) : null}
        {refreshError ? (
          <p className="mt-4 rounded-2xl border border-rose-300/15 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
            {refreshError}
          </p>
        ) : null}
        {playerLookupError ? (
          <p className="mt-4 rounded-2xl border border-rose-300/15 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
            {playerLookupError}
          </p>
        ) : null}
        {isBoardLoading ? (
          <p className="mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-100">
            Loading board for {dateInput}...
          </p>
        ) : null}
        {boardError ? (
          <p className="mt-4 rounded-2xl border border-rose-300/15 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
            {boardError}
          </p>
        ) : null}
      </section>

      {activeData.precisionSystem ? (
        <section
          id="daily-card-section"
          className="mt-8 rounded-[32px] border border-[#4fd1c5]/15 bg-[radial-gradient(900px_320px_at_0%_0%,#0f766e2a_0%,transparent_60%),radial-gradient(760px_320px_at_100%_0%,#f59e0b26_0%,transparent_60%),linear-gradient(160deg,#0a1426_0%,#0d1a30_55%,#101b2f_100%)] p-5 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.88)] sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-teal-100/70">{activeData.precisionSystem.label}</p>
              <h2 className="mt-1 text-3xl font-semibold text-white">Today&apos;s Best One-Prop-Per-Player Card</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-200/90">
                This section only shows true Daily 6 model picks. No fillers, no duplicate players, and the strongest reads
                are ranked first.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-2xl border border-teal-300/15 bg-teal-500/[0.08] px-3 py-2">
                <p className="uppercase tracking-[0.12em] text-teal-100/70">Today</p>
                <p className="mt-1 text-xl font-semibold text-white">{dailyCardCandidates.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0b1628] px-3 py-2">
                <p className="uppercase tracking-[0.12em] text-slate-300/70">Hist Rate</p>
                <p className="mt-1 text-xl font-semibold text-white">{formatStat(activeData.precisionSystem.historicalAccuracy)}%</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0b1628] px-3 py-2">
                <p className="uppercase tracking-[0.12em] text-slate-300/70">Card Rule</p>
                <p className="mt-1 text-xl font-semibold text-white">1 prop / player</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0b1628] px-3 py-2">
                <p className="uppercase tracking-[0.12em] text-slate-300/70">Markets</p>
                <p className="mt-1 text-sm font-semibold text-white">{activeData.precisionSystem.supportedMarkets.join(" / ")}</p>
              </div>
            </div>
          </div>

          {dailyCardCandidates.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-white/10 bg-black/15 px-5 py-5 text-sm text-slate-300">
              No true one-prop-per-player Daily 6 picks are available for the current filters yet. Try clearing matchup or
              player filters and refresh the board.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-[26px] border border-white/10 bg-black/15 px-5 py-5 text-sm text-slate-300">
                <p className="font-semibold text-white">
                  {precisionCandidates.length >= 6
                    ? `The slate produced ${precisionCandidates.length} true ${activeData.precisionSystem.label} selection${precisionCandidates.length === 1 ? "" : "s"}, and they are all shown here.`
                    : `The ${activeData.precisionSystem.label} model found ${precisionCandidates.length} true play${precisionCandidates.length === 1 ? "" : "s"} today. This card does not mix in non-model filler picks.`}
                </p>
                <p className="mt-2">
                  Every pick shown here follows the one-prop-per-player rule and is ranked from strongest to weakest for today&apos;s slate.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {dailyCardCandidates.map((entry, index) => {
                  const side =
                    entry.precision.side ?? entry.candidate.display?.side ?? entry.candidate.modelLine.modelSide;
                  const isLead = index === 0;

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
                          ? "border-fuchsia-300/30 bg-[linear-gradient(150deg,rgba(168,85,247,0.14)_0%,rgba(17,24,39,0.94)_45%,rgba(8,15,29,0.98)_100%)] xl:col-span-3"
                          : "border-white/10 bg-[#0b1527]/88 hover:bg-[#101c33]"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80">
                              {isLead ? "Top Daily 6 Pick" : `Card #${index + 1}`}
                            </span>
                            <span className="rounded-full border border-fuchsia-200/20 bg-fuchsia-400/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-50/90">
                              {entry.candidate.market}
                            </span>
                          </div>
                          <div>
                            <h3 className={`font-semibold text-white ${isLead ? "text-3xl" : "text-2xl"}`}>
                              {entry.candidate.row.playerName}
                            </h3>
                            <p className="mt-1 text-sm text-slate-200/82">
                              {entry.candidate.row.teamCode} vs {entry.candidate.row.opponentCode} |{" "}
                              {entry.candidate.row.gameTimeEt}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${modelSideClass(side)}`}>
                            {side === "NEUTRAL" ? "WAIT" : `${side} ${entry.candidate.market}`}
                          </span>
                          <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/78">
                            Hist {formatStat(entry.precision.historicalAccuracy)}%
                          </span>
                        </div>
                      </div>

                      <div className={`mt-5 grid gap-2 text-xs text-slate-100 ${isLead ? "sm:grid-cols-2 xl:grid-cols-5" : "grid-cols-2 sm:grid-cols-4"}`}>
                        <div className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">
                          <p className="text-[10px] uppercase tracking-[0.12em] text-white/52">Line</p>
                          <p className="mt-1 font-semibold">{formatAverage(entry.candidate.currentLine)}</p>
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">
                          <p className="text-[10px] uppercase tracking-[0.12em] text-white/52">Gap</p>
                          <p className="mt-1 font-semibold">{formatAverage(entry.precision.absLineGap, true)}</p>
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">
                          <p className="text-[10px] uppercase tracking-[0.12em] text-white/52">Bucket</p>
                          <p className="mt-1 font-semibold">{formatAverage(entry.precision.bucketRecentAccuracy)}</p>
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">
                          <p className="text-[10px] uppercase tracking-[0.12em] text-white/52">Leaf</p>
                          <p className="mt-1 font-semibold">{formatAverage(entry.precision.leafAccuracy)}</p>
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">
                          <p className="text-[10px] uppercase tracking-[0.12em] text-white/52">Model Prob</p>
                          <p className="mt-1 font-semibold">
                            {entry.precision.projectionWinProbability == null
                              ? "-"
                              : `${formatStat(entry.precision.projectionWinProbability)}%`}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2 text-sm text-slate-100/90">
                        <p>{entry.candidate.reasons[0] ?? entry.candidate.supportText}</p>
                        <p className="text-slate-300/75">
                          Historical rule pack: {entry.precision.historicalPicks} similar picks at{" "}
                          {formatStat(entry.precision.historicalAccuracy)}%.
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      ) : null}

      <section id="best-picks-section" className="mt-6 rounded-[24px] border border-emerald-300/20 bg-[linear-gradient(160deg,#0e1932_0%,#0b1730_55%,#0f1e24_100%)] p-4 shadow-[0_18px_60px_-36px_rgba(16,185,129,0.6)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/80">Qualified Picks</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">The Strongest Qualified Plays On The Page</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              The homepage now only shows qualified model picks. If you want to research anyone else in full detail, use
              the player lookup instead of scanning extra homepage clutter.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {allQualifiedCandidates.length > homepageQualifiedCandidates.length ? (
              <button
                type="button"
                onClick={openAllQualifiedBoard}
                className="rounded-full border border-emerald-300/30 bg-emerald-500/12 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/20"
              >
                View All {allQualifiedCandidates.length}
              </button>
            ) : null}
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-right text-xs text-emerald-50">
              <p className="uppercase tracking-[0.14em] text-emerald-100/70">Qualified On Page</p>
              <p className="mt-1 text-2xl font-semibold text-white">{allQualifiedCandidates.length}</p>
            </div>
          </div>
        </div>

        {homepageQualifiedCandidates.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-slate-300/15 bg-[#0d162d] px-4 py-5 text-sm text-slate-300">
            No qualified picks are available for the current filters yet. Try another date, matchup, or market, then give
            the board a few seconds to finish loading.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-4 text-sm text-slate-300">
              Showing the top {homepageQualifiedCandidates.length} of {allQualifiedCandidates.length} qualified picks on
              the homepage. Use <span className="font-semibold text-white">View All Qualified Picks</span> any time to
              open the full all-market board.
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {homepageQualifiedCandidates.map((candidate, index) => {
                const side = candidate.display?.side ?? candidate.modelLine.modelSide;

                return (
                  <button
                    key={`qualified-home-${candidate.row.playerId}-${candidate.market}`}
                    type="button"
                    onClick={() => {
                      setPlayerLookupError(null);
                      openPlayerDetail(candidate.row, null, candidate.market);
                    }}
                    className={`rounded-[26px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_22px_48px_-32px_rgba(15,23,42,0.9)] ${
                      index === 0
                        ? "border-emerald-300/30 bg-[linear-gradient(150deg,rgba(16,185,129,0.12)_0%,rgba(17,24,39,0.94)_48%,rgba(8,15,29,0.98)_100%)]"
                        : "border-white/10 bg-[#0b1527]/88 hover:bg-[#101c33]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80">
                            {index === 0 ? "Top Qualified" : `Qualified #${index + 1}`}
                          </span>
                          <span className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-100/90">
                            {candidate.market}
                          </span>
                        </div>
                        <div>
                          <h3 className="text-2xl font-semibold text-white">{candidate.row.playerName}</h3>
                          <p className="mt-1 text-sm text-slate-200/82">
                            {candidate.row.teamCode} vs {candidate.row.opponentCode} | {candidate.row.gameTimeEt}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${modelSideClass(side)}`}>
                          {side === "NEUTRAL" ? "WAIT" : `${side} ${candidate.market}`}
                        </span>
                        <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/78">
                          {candidate.display?.confidence == null ? "Conf -" : `Conf ${formatStat(candidate.display.confidence)}`}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-2 text-xs text-slate-100 sm:grid-cols-4">
                      <div className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/52">Status</p>
                        <p className="mt-1 font-semibold">{candidate.display?.statusText ?? "MODEL READ"}</p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/52">Line</p>
                        <p className="mt-1 font-semibold">{formatAverage(candidate.currentLine)}</p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/52">Gap</p>
                        <p className="mt-1 font-semibold">
                          {formatAverage(candidate.display?.projectionGap ?? candidate.modelLine.projectionGap, true)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/52">Proj Min</p>
                        <p className="mt-1 font-semibold">{formatAverage(candidate.row.playerContext.projectedMinutes)}</p>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2 text-sm text-slate-100/90">
                      <p>{candidate.reasons[0] ?? candidate.supportText}</p>
                      <p className="text-slate-300/75">{candidate.supportText}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-[28px] border border-[#f0d7a1]/15 bg-[linear-gradient(150deg,#111827_0%,#0c162b_52%,#111827_100%)] p-5 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.9)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#f3d99b]">Research Deeper</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Use Player Lookup For Full Player Research</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              The homepage now stays tight on purpose. If you want deeper logs, matchup context, backtest detail, or every
              market for a player, jump to lookup and open the full panel there instead of loading more homepage clutter.
            </p>
          </div>
          <button
            type="button"
            onClick={focusPlayerLookup}
            className="rounded-full border border-[#f0d7a1]/35 bg-[#f59e0b]/16 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-[#f59e0b]/24"
          >
            Jump To Lookup
          </button>
        </div>
      </section>

      <section id="all-qualified-section" className="mt-6 rounded-[24px] border border-cyan-300/20 bg-[linear-gradient(160deg,#101e38_0%,#0d1a30_55%,#12223f_100%)] p-4 shadow-[0_18px_60px_-36px_rgba(34,211,238,0.4)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">All Markets</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">All Qualified Bets Today</h2>
            <p className="mt-1 text-sm text-slate-300">
              This board is not locked to the market picker. It aggregates every qualified play from every supported
              market for the current page filters.
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 px-3 py-2 text-right text-xs text-cyan-50">
            <p className="uppercase tracking-[0.14em] text-cyan-100/70">Qualified On Page</p>
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
            No qualified bets are showing across any market for the current filters yet.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {allQualifiedCandidates.map((candidate, index) => (
              <button
                key={`qualified-all-${candidate.row.playerId}-${candidate.market}`}
                type="button"
                onClick={() => {
                  setPlayerLookupError(null);
                  openPlayerDetail(candidate.row, null, candidate.market);
                }}
                className="rounded-2xl border border-cyan-300/30 bg-[#0d162d] p-4 text-left hover:bg-[#111e3c]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-200/75">
                      Qualified #{index + 1} | {candidate.market}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-white">{candidate.row.playerName}</h3>
                    <p className="mt-1 text-xs text-slate-300">
                      {candidate.row.teamCode} vs {candidate.row.opponentCode} | {candidate.row.gameTimeEt}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-100">
                      {candidate.market}
                    </span>
                    <span className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-100">
                      QUALIFIED
                    </span>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${modelSideClass(candidate.display?.side ?? candidate.modelLine.modelSide)}`}>
                      {(candidate.display?.side ?? candidate.modelLine.modelSide) === "NEUTRAL"
                        ? "WAIT"
                        : `${candidate.display?.side ?? candidate.modelLine.modelSide} ${candidate.market}`}
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
                    <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Focus</p>
                    <p className="mt-1 font-semibold">{formatStat(candidate.focusScore)}</p>
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-xs text-slate-200/85">
                  {candidate.reasons.map((reason) => (
                    <p key={`all-qualified-${candidate.row.playerId}-${candidate.market}-${reason}`}>{reason}</p>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {showAdvancedView ? (
        <>
      <section className="mt-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="rounded-[24px] border border-emerald-300/20 bg-[linear-gradient(160deg,#0e1932_0%,#0b1730_55%,#0f1e24_100%)] p-4 shadow-[0_18px_60px_-36px_rgba(16,185,129,0.6)] sm:p-5">
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

        <article className="rounded-[24px] border border-amber-300/20 bg-[linear-gradient(160deg,#101936_0%,#111a31_45%,#23170d_100%)] p-4 shadow-[0_18px_60px_-36px_rgba(245,158,11,0.55)] sm:p-5">
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
                        {qualifiedCount} qualified
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


      {!isAllMarketsView ? (
      <section className="mt-6 rounded-[24px] border border-amber-300/20 bg-[linear-gradient(160deg,#121b34_0%,#0e182f_55%,#20130b_100%)] p-4 shadow-[0_18px_60px_-36px_rgba(245,158,11,0.55)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200/80">Qualified Bets</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">Qualified {currentMarketLabel} Plays</h2>
            <p className="mt-1 text-sm text-slate-300">
              This is the selected-market slice of the all-market qualified board above.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-right text-xs text-amber-50">
            <p className="uppercase tracking-[0.14em] text-amber-100/70">Qualified In {market}</p>
            <p className="mt-1 text-2xl font-semibold text-white">{qualifiedCandidates.length}</p>
          </div>
        </div>

        {qualifiedCandidates.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-slate-300/15 bg-[#0d162d] px-4 py-5 text-sm text-slate-300">
            No qualified bets are showing for the current filters and market yet.
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
                    <p className="text-[10px] uppercase tracking-[0.16em] text-amber-200/75">Qualified #{index + 1}</p>
                    <h3 className="mt-1 text-lg font-semibold text-white">{candidate.row.playerName}</h3>
                    <p className="mt-1 text-xs text-slate-300">
                      {candidate.row.teamCode} vs {candidate.row.opponentCode} | {candidate.row.gameTimeEt}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-100">
                      QUALIFIED
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
                ? `Showing only qualified ${currentMarketLabel} bets. Switch to all players any time.`
                : `Full slate sorted by focus score for ${currentMarketLabel}. Open any player for the full read.`}
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
              Qualified Only
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
              All Players
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
              ? "No qualified bets found for the current filters. Switch to All Players to inspect the full board."
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
                    <th className="px-4 py-3">
                      <HeaderWithTip
                        label="Min L3/L10"
                        definition="Average minutes over last 3 and last 10 games."
                      />
                    </th>
                    <th className="px-4 py-3">
                      <HeaderWithTip
                        label="Min Trend"
                        definition="Last-3 minutes average minus last-10 minutes average."
                      />
                    </th>
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
                              ? "Selective points-side screen tuned from Jokic backtests. Uses live line, confidence, minutes risk, and favorite suppression to mark QUALIFIED or PASS."
                              : market === "REB"
                                ? "Selective rebounds-side screen using the live rebound line, confidence, and minutes risk to mark QUALIFIED or PASS."
                                : market === "AST"
                                  ? "Selective assists-side screen using the live assist line, confidence, and minutes risk to mark QUALIFIED or PASS."
                                  : market === "THREES"
                                    ? "Selective 3PM-side screen using the live line, confidence, and minutes risk to mark QUALIFIED or PASS."
                                    : "Selective combo-market screen using the live line, confidence, and minutes risk to mark QUALIFIED or PASS."
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
                    const liveSignalDisplay = candidate.display;
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
                                QUALIFIED
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
                        <td className="px-4 py-3">{formatAverage(row.playerContext.minutesTrend, true)}</td>
                        <td className="px-4 py-3 text-xs">
                          <div>{candidate.reasons[0]}</div>
                          <div className="mt-1 text-slate-400">{candidate.currentLineLabel}</div>
                          <div className="mt-1 text-slate-400">{candidate.supportText}</div>
                        </td>
                        <td className="px-4 py-3">{formatAverage(row.last10Average[candidateMarket])}</td>
                        <td className="px-4 py-3">{formatAverage(row.seasonAverage[candidateMarket])}</td>
                        <td className="px-4 py-3">{formatAverage(l10Volatility)}</td>
                        <td className="px-4 py-3">{formatPercentValue(l10Consistency)}</td>
                        <td className="px-4 py-3">
                          {floor == null || ceiling == null ? "-" : `${formatStat(floor)} / ${formatStat(ceiling)}`}
                        </td>
                        <td className="px-4 py-3">{formatAverage(row.trendVsSeason[candidateMarket], true)}</td>
                        <td className="px-4 py-3">{formatAverage(row.opponentAllowanceDelta[candidateMarket], true)}</td>
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
                        {liveSignalDisplay != null ? (
                          <td className="px-4 py-3 text-xs">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${liveSignalDisplay.statusClass}`}>
                                  {liveSignalDisplay.statusText}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${modelSideClass(liveSignalDisplay.side)}`}>
                                  {liveSignalDisplay.side}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ptsConfidenceClass(liveSignalDisplay.confidenceTier ?? null)}`}>
                                  {liveSignalDisplay.confidence == null
                                    ? "No Conf"
                                    : `${formatStat(liveSignalDisplay.confidence ?? 0)} ${liveSignalDisplay.confidenceTier ?? ""}`.trim()}
                                </span>
                              </div>
                              <div className="text-slate-300">
                                Line {formatAverage(liveSignalDisplay.line)} | Gap {formatAverage(liveSignalDisplay.projectionGap, true)}
                              </div>
                              <div className="text-slate-400">
                                Risk {formatAverage(liveSignalDisplay.minutesRisk)} | Books {liveSignalDisplay.sportsbookCount || "-"}
                              </div>
                              {liveSignalDisplay.message ? (
                                <div className="max-w-[240px] text-[10px] text-rose-200">
                                  {liveSignalDisplay.message}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        ) : (
                          <td className="px-4 py-3 text-xs text-slate-400">No live {candidateMarket} line</td>
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
                            value={lineMap[lineKey(row.playerId, candidateMarket)] ?? ""}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              setLineMap((current) => ({
                                ...current,
                                [lineKey(row.playerId, candidateMarket)]: event.target.value,
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
                  <li>1. Start with `All Markets` to see the strongest overall slate.</li>
                  <li>2. Use the market chips to jump into a single stat family only when you want to narrow the board.</li>
                  <li>3. Read the `Daily 6` card first, then the overall best-pick section.</li>
                  <li>4. Override with your own line only when needed, then read `L10 O/U` plus `Minute Badge`.</li>
                  <li>5. Click a player row to open the full analyzer and context sections.</li>
                </ol>
              </article>

              <article className="rounded-xl border border-slate-300/20 bg-[#0b152a] p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.14em] text-amber-200">Minute Badge</p>
                <p className="mt-2 text-xs text-slate-300">
                  `Minute Badge` shows hit rate only in games with 22+ minutes. Example:
                  `22+m: 85/104 (82%)` means 85 overs in 104 games with 22+ minutes.
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  For custom minute scenarios, use the player detail view where each market card supports a manual minutes floor input.
                </p>
              </article>

              <article className="rounded-xl border border-slate-300/20 bg-[#0b152a] p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.14em] text-amber-200">Player Detail Workflow</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  <li>- Start compact mode on.</li>
                  <li>- Open `All Markets Detail` to review fair line, model side, and minutes scenario.</li>
                  <li>- Compare projection vs active line, then check minute-scenario sample and volatility.</li>
                  <li>- Validate with `Player Context` and `Team Context` before final decision.</li>
                </ul>
              </article>

              <article className="rounded-xl border border-slate-300/20 bg-[#0b152a] p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.14em] text-amber-200">Controls</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  <li>- `Esc` closes guide or player detail modal.</li>
                  <li>- `Refresh Data` pulls latest logs/lineup changes.</li>
                  <li>- Hover `?` icons for formulas and term definitions.</li>
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
                  {playerLookupMeta ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-full border border-cyan-300/35 bg-cyan-400/10 px-2 py-0.5 text-cyan-100">
                        Requested {playerLookupMeta.requestedDateEt}
                      </span>
                      <span className="rounded-full border border-slate-300/20 bg-[#0d1630] px-2 py-0.5 text-slate-200">
                        Loaded {playerLookupMeta.resolvedDateEt}
                      </span>
                    </div>
                  ) : null}
                  {playerLookupMeta?.note ? (
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
                  {(["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"] as SnapshotMarket[]).map((signalMarket) => {
                    const display = resolveMarketSignalDisplay(
                      signalLabelForMarket(signalMarket),
                      liveSignalForMarket(selectedPlayer, signalMarket),
                      selectedPlayer.modelLines[signalMarket],
                    );
                    if (!display) return null;

                    return (
                      <div key={signalMarket} className="mt-2">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className={`rounded-full border px-2 py-0.5 font-semibold ${display.statusClass}`}>
                            {display.statusText}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 font-semibold ${modelSideClass(display.side)}`}>
                            {display.side}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 font-semibold ${ptsConfidenceClass(display.confidenceTier)}`}>
                            Conf {display.confidence == null ? "-" : formatStat(display.confidence)}
                          </span>
                          <span className="rounded-full border border-slate-300/20 bg-[#0d1630] px-2 py-0.5 text-slate-200">
                            Gap {formatAverage(display.projectionGap, true)}
                          </span>
                          <span className="rounded-full border border-slate-300/20 bg-[#0d1630] px-2 py-0.5 text-slate-200">
                            Risk {formatAverage(display.minutesRisk)}
                          </span>
                          <span className="rounded-full border border-slate-300/20 bg-[#0d1630] px-2 py-0.5 text-slate-200">
                            Line {formatAverage(display.line)}
                          </span>
                        </div>
                        {display.message ? (
                          <p className="mt-2 max-w-2xl rounded-lg border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
                            {display.message}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
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
              subtitle="Click any market card to open a full breakdown against the model fair line or your override."
              collapsed={collapsedSections.markets}
              onToggle={() => toggleSection("markets")}
            >
              <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {MARKET_OPTIONS.map((option) => {
                  const m = option.value;
                  const l5 = selectedPlayer.last5[m];
                  const l10 = selectedPlayer.last10[m];
                  const key = lineKey(selectedPlayer.playerId, m);
                  const customLine = parseLine(lineMap[key] ?? "");
                  const modelLine = selectedPlayer.modelLines[m];
                  const selectedLine = lineInFocus(customLine, modelLine.fairLine);
                  const l5Hit = selectedLine == null ? null : hitCounts(l5, selectedLine);
                  const l10Hit = selectedLine == null ? null : hitCounts(l10, selectedLine);
                  const isFocused = focusedMarket === m;
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
                        <p>Home/Away</p>
                        <p className="text-right">{formatAverage(selectedPlayer.homeAwayAverage[m])}</p>
                        <p>Trend</p>
                        <p className="text-right">{formatAverage(selectedPlayer.trendVsSeason[m], true)}</p>
                        <p>Opp +/-</p>
                        <p className="text-right">{formatAverage(selectedPlayer.opponentAllowanceDelta[m], true)}</p>
                        <p>Proj Tonight</p>
                        <p className="text-right">{formatAverage(selectedPlayer.projectedTonight[m])}</p>
                        <p>Fair Line</p>
                        <p className="text-right">{formatAverage(modelLine.fairLine)}</p>
                        <p>Model Side</p>
                        <p className="text-right">
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${modelSideClass(modelLine.modelSide)}`}>
                            {modelLine.modelSide}
                          </span>
                        </p>
                        <p>Decision Zone</p>
                        <p className="text-right">
                          {modelLine.fairLine == null
                            ? "-"
                            : `O<=${formatStat(modelLine.actionOverLine ?? modelLine.fairLine)} | U>=${formatStat(
                                modelLine.actionUnderLine ?? modelLine.fairLine,
                              )}`}
                        </p>
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
                        placeholder={modelLine.fairLine == null ? "Set line" : formatStat(modelLine.fairLine)}
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
                                  {lineSourceLabel(customLine, modelLine.fairLine)}
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
                                  {lineSourceLabel(customLine, modelLine.fairLine)}
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
                const key = lineKey(selectedPlayer.playerId, m);
                const customLine = parseLine(lineMap[key] ?? "");
                const modelLine = selectedPlayer.modelLines[m];
                const selectedLine = lineInFocus(customLine, modelLine.fairLine);
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
                const minutesKey = minuteFloorKey(selectedPlayer.playerId, m);
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

                return (
                  <article className="mt-4 rounded-xl border border-cyan-300/30 bg-[#0c1533] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-cyan-100">{focusedLabel} Analyzer</h4>
                      <p className="text-[11px] text-slate-400">Line-based breakdown for the selected market.</p>
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
                            placeholder={modelLine.fairLine == null ? "Set line" : formatStat(modelLine.fairLine)}
                            className="mt-1 w-full rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1.5 text-sm text-white outline-none focus:border-cyan-300/60"
                          />
                        </label>
                        <div className="mt-2 rounded-lg border border-slate-300/15 bg-[#0d1630] p-2 text-xs text-slate-200">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100">Model Line</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${modelSideClass(modelLine.modelSide)}`}>
                              {modelLine.modelSide}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                            <p>Fair line</p>
                            <p className="text-right">{formatAverage(modelLine.fairLine)}</p>
                            <p>Action over</p>
                            <p className="text-right">
                              {modelLine.actionOverLine == null ? "-" : `<= ${formatStat(modelLine.actionOverLine)}`}
                            </p>
                            <p>Action under</p>
                            <p className="text-right">
                              {modelLine.actionUnderLine == null ? "-" : `>= ${formatStat(modelLine.actionUnderLine)}`}
                            </p>
                            <p>Projection gap</p>
                            <p className="text-right">{formatAverage(modelLine.projectionGap, true)}</p>
                            <p>Line source</p>
                            <p className="text-right">{lineSourceLabel(customLine, modelLine.fairLine)}</p>
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
                            <span>Fair Line</span>
                            <span>{formatAverage(modelLine.fairLine)}</span>
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
                            <p>Line source: {lineSourceLabel(customLine, modelLine.fairLine)}</p>
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
                            {selectedPlayer.recentLogs.length === 0 ? (
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
              {selectedPlayer.recentLogs.length === 0 ? (
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
              <p>
                Quick read ({focusedMarket}): L5 avg {formatAverage(average(selectedPlayer.last5[focusedMarket]))} | L10 avg{" "}
                {formatAverage(selectedPlayer.last10Average[focusedMarket])} | Projection {formatAverage(selectedPlayer.projectedTonight[focusedMarket])} | Fair line{" "}
                {formatAverage(selectedPlayer.modelLines[focusedMarket].fairLine)} | Model side {selectedPlayer.modelLines[focusedMarket].modelSide} | Trend{" "}
                {formatAverage(selectedPlayer.trendVsSeason[focusedMarket], true)} | Opp +/-{" "}
                {formatAverage(selectedPlayer.opponentAllowanceDelta[focusedMarket], true)}
              </p>
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
    </main>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  SnapshotBoardData,
  SnapshotMarket,
  SnapshotModelSide,
  SnapshotPlayerBacktestReport,
  SnapshotPlayerLookupData,
  SnapshotPtsConfidenceTier,
  SnapshotPtsSignal,
  SnapshotRow,
} from "@/lib/types/snapshot";

type SnapshotDashboardProps = {
  data: SnapshotBoardData;
  initialMarket: SnapshotMarket;
  initialMatchup: string;
  initialPlayerSearch: string;
};

type SnapshotBoardApiResponse = {
  ok?: boolean;
  result?: SnapshotBoardData;
  error?: string;
};

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
  const router = useRouter();
  const boardLoadTargetRef = useRef<string | null>(initialData.rows.length > 0 ? initialData.dateEt : null);
  const boardRequestRef = useRef(0);
  const [boardData, setBoardData] = useState<SnapshotBoardData>(initialData);
  const activeData = boardData;
  const [matchup, setMatchup] = useState(
    initialMatchup && initialData.matchups.some((option) => option.key === initialMatchup) ? initialMatchup : "",
  );
  const [dateInput, setDateInput] = useState(initialData.dateEt);
  const [market, setMarket] = useState<SnapshotMarket>(initialMarket);
  const [playerSearch, setPlayerSearch] = useState(initialPlayerSearch);
  const [playerSuggestOpen, setPlayerSuggestOpen] = useState(false);
  const [playerSuggestIndex, setPlayerSuggestIndex] = useState(-1);
  const [lineMap, setLineMap] = useState<Record<string, string>>({});
  const [minutesFloorMap, setMinutesFloorMap] = useState<Record<string, string>>({});
  const [guideOpen, setGuideOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<SnapshotRow | null>(null);
  const [focusedMarket, setFocusedMarket] = useState<SnapshotMarket>(initialMarket);
  const [compactDetail, setCompactDetail] = useState(true);
  const [showQualifiedOnly, setShowQualifiedOnly] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState<Record<DetailSectionKey, boolean>>(
    defaultCollapsedSections(true),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isBoardLoading, setIsBoardLoading] = useState(initialData.rows.length === 0);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [isPlayerLookupLoading, setIsPlayerLookupLoading] = useState(false);
  const [playerLookupError, setPlayerLookupError] = useState<string | null>(null);
  const [playerLookupMeta, setPlayerLookupMeta] = useState<Omit<SnapshotPlayerLookupData, "row"> | null>(null);
  const [playerBacktest, setPlayerBacktest] = useState<SnapshotPlayerBacktestReport | null>(null);
  const [playerBacktestLoading, setPlayerBacktestLoading] = useState(false);
  const [playerBacktestError, setPlayerBacktestError] = useState<string | null>(null);

  async function loadBoardData(targetDate: string): Promise<void> {
    const requestId = boardRequestRef.current + 1;
    boardRequestRef.current = requestId;
    boardLoadTargetRef.current = targetDate;
    setIsBoardLoading(true);
    setBoardError(null);

    try {
      const response = await fetch(`/api/snapshot/board?date=${encodeURIComponent(targetDate)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as SnapshotBoardApiResponse;
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error ?? "Board load failed.");
      }
      if (requestId !== boardRequestRef.current) return;
      setBoardData(payload.result);
    } catch (error) {
      if (requestId !== boardRequestRef.current) return;
      setBoardError(error instanceof Error ? error.message : "Board load failed.");
    } finally {
      if (requestId === boardRequestRef.current) {
        setIsBoardLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!selectedPlayer) {
      setFocusedMarket(market);
    }
  }, [selectedPlayer, market]);

  useEffect(() => {
    setDateInput(initialData.dateEt);
  }, [initialData.dateEt]);

  useEffect(() => {
    if (boardLoadTargetRef.current === initialData.dateEt && (activeData.rows.length > 0 || isBoardLoading)) {
      return;
    }
    setBoardData(initialData);
    setBoardError(null);
    void loadBoardData(initialData.dateEt);
  }, [activeData.rows.length, initialData, initialData.dateEt, isBoardLoading]);

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
    setPlayerLookupMeta(null);
    setSelectedPlayer(null);
  }

  function openPlayerDetail(
    row: SnapshotRow,
    lookupMeta: Omit<SnapshotPlayerLookupData, "row"> | null = null,
    targetMarket: SnapshotMarket | null = null,
  ): void {
    setFocusedMarket(targetMarket ?? market);
    setPlayerLookupMeta(lookupMeta);
    setSelectedPlayer(row);
  }

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
    params.set("market", market);
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
    router.push(targetUrl);
    void loadBoardData(normalizedDate);
  }

  async function handleRefresh(): Promise<void> {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setRefreshError(null);
    setRefreshMessage(null);
    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "DELTA" }),
      });
      const payload = (await response.json()) as {
        result?: { status?: string; warnings?: string[] };
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Refresh failed");
      }
      const warnings = payload.result?.warnings ?? [];
      if (warnings.some((item) => item.toLowerCase().includes("already running"))) {
        setRefreshMessage("Refresh is already running. Please wait 1-2 minutes, then click Load Data.");
        return;
      }
      setRefreshMessage(`Refresh complete (${payload.result?.status ?? "SUCCESS"}). Updating board...`);
      await loadBoardData(/^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? dateInput : activeData.dateEt);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setIsRefreshing(false);
    }
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
    setFocusedMarket(market);
    setPlayerLookupMeta(null);
    setSelectedPlayer(bestMatch);
  }, [initialPlayerSearch, activeData.dateEt, initialMarket, initialMatchup, filteredRows, market]);

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
    if (!matchup) return activeData.teamMatchups;
    return activeData.teamMatchups.filter((item) => item.matchupKey === matchup);
  }, [activeData.teamMatchups, matchup]);

  const currentMarketLabel = useMemo(
    () => MARKET_OPTIONS.find((option) => option.value === market)?.label ?? market,
    [market],
  );

  const focusCandidates = useMemo(
    () =>
      filteredRows
        .map((row) => buildFocusCandidate(row, market, lineMap[lineKey(row.playerId, market)]))
        .sort((left, right) => {
          if (right.focusScore !== left.focusScore) return right.focusScore - left.focusScore;
          const leftConfidence = left.display?.confidence ?? 0;
          const rightConfidence = right.display?.confidence ?? 0;
          if (rightConfidence !== leftConfidence) return rightConfidence - leftConfidence;
          return left.row.playerName.localeCompare(right.row.playerName);
        }),
    [filteredRows, market, lineMap],
  );

  const topFocusCandidates = useMemo(
    () => focusCandidates.filter((candidate) => candidate.focusTier !== "DEEP").slice(0, 8),
    [focusCandidates],
  );

  const qualifiedCandidates = useMemo(
    () => focusCandidates.filter((candidate) => candidate.signalQualified),
    [focusCandidates],
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

  const allQualifiedMarketSummary = useMemo(
    () =>
      MARKET_OPTIONS.map((option) => ({
        ...option,
        count: allQualifiedCandidates.filter((candidate) => candidate.market === option.value).length,
      })).filter((option) => option.count > 0),
    [allQualifiedCandidates],
  );

  const displayedCandidates = useMemo(() => {
    if (showQualifiedOnly && qualifiedCandidates.length > 0) return qualifiedCandidates;
    return focusCandidates;
  }, [focusCandidates, qualifiedCandidates, showQualifiedOnly]);

  const matchupFocusCards = useMemo(
    () =>
      filteredTeamMatchups.map((item) => {
        const candidates = focusCandidates.filter((candidate) => candidate.row.matchupKey === item.matchupKey);
        return {
          item,
          totalFocus: candidates.filter((candidate) => candidate.focusTier !== "DEEP").length,
          qualifiedCount: candidates.filter((candidate) => candidate.signalQualified).length,
          topCandidates: candidates.slice(0, 3),
        };
      }),
    [filteredTeamMatchups, focusCandidates],
  );

  const selectedMinutesFloor = 22;
  const activeLineCount = useMemo(
    () => Object.keys(lineMap).filter((key) => Boolean(parseLine(lineMap[key]))).length,
    [lineMap],
  );
  const highQualityCount = useMemo(
    () => filteredRows.filter((row) => row.dataCompleteness.tier === "HIGH").length,
    [filteredRows],
  );
  const focusCount = useMemo(
    () => focusCandidates.filter((candidate) => candidate.focusTier !== "DEEP").length,
    [focusCandidates],
  );
  const qualifiedFocusCount = useMemo(
    () => focusCandidates.filter((candidate) => candidate.signalQualified).length,
    [focusCandidates],
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

  return (
    <main className="mx-auto max-w-[1750px] px-4 pb-8 pt-6 sm:px-6 lg:px-10">
      <section className="rounded-[26px] border border-[#d5e2ff33] bg-[radial-gradient(1200px_420px_at_8%_0%,#1f5f6f66_0%,transparent_58%),radial-gradient(900px_500px_at_100%_0%,#d9770655_0%,transparent_64%),linear-gradient(150deg,#0e1a35_0%,#121c33_52%,#0b1528_100%)] px-5 py-5 shadow-[0_20px_80px_-45px_rgba(245,158,11,0.65)] sm:px-7 sm:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-amber-200/85">NBA Snapshot Terminal</p>
            <h1 className="title-font mt-1 text-3xl uppercase text-white sm:text-[2.35rem]">Player Prop Command Center</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-200/90">
              Faster reads, cleaner card flow, and minute-aware market context. Use your own lines and inspect every player through the detail console.
            </p>
            <p className="mt-1 text-xs text-slate-300/80">
              Last refresh: {activeData.lastUpdatedAt ? new Date(activeData.lastUpdatedAt).toLocaleString() : "No refresh yet"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void handleRefresh();
              }}
              disabled={isRefreshing}
              className="rounded-xl border border-emerald-300/45 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshing ? "Refreshing..." : "Refresh Data"}
            </button>
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="rounded-xl border border-amber-300/45 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/30"
            >
              Open Guide
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
          <article className="rounded-xl border border-slate-200/15 bg-[#0e1830]/75 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Players Showing</p>
            <p className="mt-1 text-xl font-semibold text-white">{filteredRows.length}</p>
          </article>
          <article className="rounded-xl border border-slate-200/15 bg-[#0e1830]/75 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Matchups</p>
            <p className="mt-1 text-xl font-semibold text-white">{filteredTeamMatchups.length}</p>
          </article>
          <article className="rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-emerald-100/70">Focus This Market</p>
            <p className="mt-1 text-xl font-semibold text-white">{focusCount}</p>
          </article>
          <article className="rounded-xl border border-amber-300/20 bg-amber-500/10 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-amber-100/70">Qualified This Market</p>
            <p className="mt-1 text-xl font-semibold text-white">{qualifiedFocusCount}</p>
          </article>
          <article className="rounded-xl border border-cyan-300/20 bg-cyan-500/10 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-cyan-100/70">Qualified All Markets</p>
            <p className="mt-1 text-xl font-semibold text-white">{allQualifiedCandidates.length}</p>
          </article>
          <article className="rounded-xl border border-slate-200/15 bg-[#0e1830]/75 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">High Data Quality</p>
            <p className="mt-1 text-xl font-semibold text-white">{highQualityCount}</p>
          </article>
          <article className="rounded-xl border border-slate-200/15 bg-[#0e1830]/75 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Lines Entered</p>
            <p className="mt-1 text-xl font-semibold text-white">{activeLineCount}</p>
          </article>
        </div>

        <form onSubmit={handleLoadData} className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[190px_1fr_220px_150px]">
          <label className="flex min-w-[170px] flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-300/85">
            Date (ET)
            <input
              type="date"
              value={dateInput}
              onChange={(event) => setDateInput(event.target.value)}
              className="rounded-xl border border-slate-300/25 bg-[#081127]/90 px-3 py-2 text-sm text-white outline-none focus:border-amber-300/70"
            />
          </label>

          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-300/85">
            Matchup
            <select
              value={matchup}
              onChange={(event) => setMatchup(event.target.value)}
              className="rounded-xl border border-slate-300/25 bg-[#081127]/90 px-3 py-2 text-sm text-white outline-none focus:border-amber-300/70"
            >
              <option value="">All Matchups</option>
              {activeData.matchups.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-300/85">
            Market
            <select
              value={market}
              onChange={(event) => setMarket(event.target.value as SnapshotMarket)}
              className="rounded-xl border border-slate-300/25 bg-[#081127]/90 px-3 py-2 text-sm text-white outline-none focus:border-amber-300/70"
            >
              {MARKET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="h-[42px] self-end rounded-xl border border-amber-300/45 bg-amber-500/20 px-4 text-sm font-semibold text-amber-100 hover:bg-amber-500/30"
          >
            Load Data
          </button>
        </form>

        <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-50">
          Selected market controls the focus board, slate cards, and deep board. The cross-market section below shows
          every qualified bet on the page across PTS, REB, AST, THREES, PRA, PA, PR, and RA.
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3">
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-300/85">
            Player Search
            <div className="relative">
              <input
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
                placeholder="Type player name..."
                className="w-full rounded-xl border border-slate-300/25 bg-[#081127]/90 px-3 py-2 text-sm text-white outline-none focus:border-amber-300/70"
              />
              {playerSuggestOpen && playerSuggestions.length > 0 ? (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-64 overflow-y-auto rounded-xl border border-slate-300/25 bg-[#0a1630] shadow-[0_18px_45px_-20px_rgba(15,23,42,0.95)]">
                  {playerSuggestions.map((row, index) => (
                    <button
                      key={`suggest-${row.playerId}`}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyPlayerSuggestion(row);
                      }}
                      className={`flex w-full items-center justify-between gap-2 border-b border-slate-300/10 px-3 py-2 text-left text-xs last:border-b-0 ${
                        index === playerSuggestIndex ? "bg-amber-400/20 text-amber-100" : "text-slate-200 hover:bg-slate-700/30"
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void handlePlayerLookup();
                }}
                disabled={isPlayerLookupLoading}
                className="rounded-xl border border-cyan-300/45 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPlayerLookupLoading ? "Opening..." : "Open Player Lookup"}
              </button>
              <p className="text-[11px] text-slate-400">
                Opens the player detail directly, even if he is not on the current slate.
              </p>
            </div>
          </label>
        </div>

        <p className="mt-3 text-xs text-slate-300/80">
          Tip: the table now defaults to the <span className="text-amber-200">Model Fair Line</span>. Type your own line only when you want to override it.
        </p>

        {refreshMessage ? <p className="mt-2 text-xs text-emerald-200">{refreshMessage}</p> : null}
        {refreshError ? <p className="mt-2 text-xs text-rose-200">{refreshError}</p> : null}
        {playerLookupError ? <p className="mt-2 text-xs text-rose-200">{playerLookupError}</p> : null}
        {isBoardLoading ? <p className="mt-2 text-xs text-cyan-200">Loading board for {dateInput}...</p> : null}
        {boardError ? <p className="mt-2 text-xs text-rose-200">{boardError}</p> : null}
      </section>

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
                  key={`focus-${candidate.row.playerId}`}
                  type="button"
                  onClick={() => {
                    setPlayerLookupError(null);
                    openPlayerDetail(candidate.row, null);
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
                        {candidate.row.teamCode} vs {candidate.row.opponentCode} • {candidate.row.gameTimeEt}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${modelSideClass(candidate.display?.side ?? candidate.modelLine.modelSide)}`}>
                        {(candidate.display?.side ?? candidate.modelLine.modelSide) === "NEUTRAL"
                          ? "WAIT"
                          : `${candidate.display?.side ?? candidate.modelLine.modelSide} ${market}`}
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
                Each matchup shows how many current-market bets are worth a closer look before the full board.
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
                          key={`slate-pick-${candidate.row.playerId}`}
                          type="button"
                          onClick={() => {
                            setPlayerLookupError(null);
                            openPlayerDetail(candidate.row, null);
                          }}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left hover:bg-white/[0.07]"
                        >
                          <div>
                            <p className="text-sm font-medium text-white">{candidate.row.playerName}</p>
                            <p className="mt-1 text-[11px] text-slate-300">
                              {candidate.display?.statusText ?? "MODEL READ"} • {candidate.currentLineLabel}
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

      <section className="mt-6 rounded-[24px] border border-cyan-300/20 bg-[linear-gradient(160deg,#101e38_0%,#0d1a30_55%,#12223f_100%)] p-4 shadow-[0_18px_60px_-36px_rgba(34,211,238,0.4)] sm:p-5">
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
                key={`qualified-${candidate.row.playerId}`}
                type="button"
                onClick={() => {
                  setPlayerLookupError(null);
                  openPlayerDetail(candidate.row, null);
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

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">Team Matchup Stats</h2>
        {isBoardLoading && filteredTeamMatchups.length === 0 ? (
          <div className="rounded-2xl border border-slate-300/15 bg-[#0e1932] p-5 text-sm text-slate-300">
            Loading matchup stats...
          </div>
        ) : filteredTeamMatchups.length === 0 ? (
          <div className="rounded-2xl border border-slate-300/15 bg-[#0e1932] p-5 text-sm text-slate-300">No matchup stats available.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredTeamMatchups.map((item) => {
              const awayEdge = edge(item.awayLast10For[market], item.homeLast10Allowed[market]);
              const homeEdge = edge(item.homeLast10For[market], item.awayLast10Allowed[market]);
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
                        For ({market}): {formatAverage(item.awaySeasonFor[market])} | L10 {formatAverage(item.awayLast10For[market])}
                      </p>
                      <p className="text-slate-300">
                        Allowed ({market}): {formatAverage(item.awaySeasonAllowed[market])} | L10 {formatAverage(item.awayLast10Allowed[market])}
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
                        For ({market}): {formatAverage(item.homeSeasonFor[market])} | L10 {formatAverage(item.homeLast10For[market])}
                      </p>
                      <p className="text-slate-300">
                        Allowed ({market}): {formatAverage(item.homeSeasonAllowed[market])} | L10 {formatAverage(item.homeLast10Allowed[market])}
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

      <section className="mt-6">
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
                    {["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"].includes(market) ? (
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
                    ) : null}
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
                    const l10Values = row.last10[market];
                    const l10Volatility = standardDeviation(l10Values);
                    const l10Consistency = consistencyPct(l10Values);
                    const floor = minValue(l10Values);
                    const ceiling = maxValue(l10Values);
                    const liveSignalDisplay = candidate.display;
                    const modelLine = candidate.modelLine;
                    const currentLine = candidate.currentLine;
                    const l10Hit = currentLine == null ? null : hitCounts(l10Values, currentLine);
                    const minuteFloorLogs = row.analysisLogs.filter((log) => log.minutes >= selectedMinutesFloor);
                    const minuteFloorValues = minuteFloorLogs.map((log) => marketValueFromLog(log, market));
                    const minuteFloorHit = currentLine == null ? null : hitCounts(minuteFloorValues, currentLine);

                    return (
                      <tr
                        key={row.playerId}
                        onClick={() => {
                          setPlayerLookupError(null);
                          openPlayerDetail(row, null);
                        }}
                        className={`cursor-pointer border-t border-slate-300/10 text-slate-100 hover:bg-cyan-300/8 ${focusRowAccentClass(
                          candidate.focusTier,
                        )}`}
                      >
                        <td className="px-4 py-3 font-semibold">
                          <div>{row.playerName}</div>
                          <div className="text-xs text-slate-400">{row.position ?? "N/A"}</div>
                        </td>
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
                        <td className="px-4 py-3">{formatAverage(row.last10Average[market])}</td>
                        <td className="px-4 py-3">{formatAverage(row.seasonAverage[market])}</td>
                        <td className="px-4 py-3">{formatAverage(l10Volatility)}</td>
                        <td className="px-4 py-3">{formatPercentValue(l10Consistency)}</td>
                        <td className="px-4 py-3">
                          {floor == null || ceiling == null ? "-" : `${formatStat(floor)} / ${formatStat(ceiling)}`}
                        </td>
                        <td className="px-4 py-3">{formatAverage(row.trendVsSeason[market], true)}</td>
                        <td className="px-4 py-3">{formatAverage(row.opponentAllowanceDelta[market], true)}</td>
                        <td className="px-4 py-3 text-xs">
                          <div>{formatAverage(row.projectedTonight[market])}</div>
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
                          <td className="px-4 py-3 text-xs text-slate-400">No live {market} line</td>
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
                            value={lineMap[lineKey(row.playerId, market)] ?? ""}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              setLineMap((current) => ({
                                ...current,
                                [lineKey(row.playerId, market)]: event.target.value,
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
                  <li>1. Pick a date, matchup, and market from the top filters.</li>
                  <li>2. For `PTS`, `REB`, and `AST`, read the market filter first. `QUALIFIED` means the live side cleared the confidence and minutes-risk rules.</li>
                  <li>3. Read the `Model Fair Line` and `Over/Under Zone` in each row.</li>
                  <li>4. Override with your own line only when needed, then read `L10 O/U` plus `Minute Badge`.</li>
                  <li>5. Click a player row to open full analyzer + context sections.</li>
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
                Quick read ({market}): L5 avg {formatAverage(average(selectedPlayer.last5[market]))} | L10 avg{" "}
                {formatAverage(selectedPlayer.last10Average[market])} | Projection {formatAverage(selectedPlayer.projectedTonight[market])} | Fair line{" "}
                {formatAverage(selectedPlayer.modelLines[market].fairLine)} | Model side {selectedPlayer.modelLines[market].modelSide} | Trend{" "}
                {formatAverage(selectedPlayer.trendVsSeason[market], true)} | Opp +/-{" "}
                {formatAverage(selectedPlayer.opponentAllowanceDelta[market], true)}
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
                  const teamFor = teamIsAway ? item.awayLast10For[market] : item.homeLast10For[market];
                  const oppAllowed = teamIsAway ? item.homeLast10Allowed[market] : item.awayLast10Allowed[market];
                  return (
                    <p className="text-slate-300">
                      Team context ({selectedPlayer.teamCode} {market}): L10 offense {formatAverage(teamFor)} vs opponent L10 allowed {formatAverage(oppAllowed)} | edge{" "}
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

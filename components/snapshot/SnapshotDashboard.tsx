"use client";

import { useEffect, useMemo, useState } from "react";
import type { SnapshotBoardData, SnapshotMarket, SnapshotRow } from "@/lib/types/snapshot";

type SnapshotDashboardProps = {
  data: SnapshotBoardData;
  initialMarket: SnapshotMarket;
  initialMatchup: string;
  initialPlayerSearch: string;
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

type DetailSectionKey = "context" | "intel" | "markets" | "logs" | "summary" | "team";

type DetailSectionMeta = {
  key: DetailSectionKey;
  id: string;
  title: string;
};

const DETAIL_SECTIONS: DetailSectionMeta[] = [
  { key: "context", id: "detail-context", title: "Player Context" },
  { key: "intel", id: "detail-intel", title: "Game Intelligence" },
  { key: "markets", id: "detail-markets", title: "All Markets Detail" },
  { key: "logs", id: "detail-logs", title: "Last 10 Completed Games" },
  { key: "summary", id: "detail-summary", title: "Quick Read" },
  { key: "team", id: "detail-team", title: "Team Context" },
];

function defaultCollapsedSections(compact = false): Record<DetailSectionKey, boolean> {
  return {
    context: false,
    intel: compact,
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
  data,
  initialMarket,
  initialMatchup,
  initialPlayerSearch,
}: SnapshotDashboardProps): React.ReactElement {
  const [matchup, setMatchup] = useState(
    initialMatchup && data.matchups.some((option) => option.key === initialMatchup) ? initialMatchup : "",
  );
  const [market, setMarket] = useState<SnapshotMarket>(initialMarket);
  const [playerSearch, setPlayerSearch] = useState(initialPlayerSearch);
  const [playerSuggestOpen, setPlayerSuggestOpen] = useState(false);
  const [playerSuggestIndex, setPlayerSuggestIndex] = useState(-1);
  const [lineMap, setLineMap] = useState<Record<string, string>>({});
  const [minutesFloorMap, setMinutesFloorMap] = useState<Record<string, string>>({});
  const [guideOpen, setGuideOpen] = useState(false);
  const [defaultMinutesFloor, setDefaultMinutesFloor] = useState("22");
  const [selectedPlayer, setSelectedPlayer] = useState<SnapshotRow | null>(null);
  const [focusedMarket, setFocusedMarket] = useState<SnapshotMarket>(initialMarket);
  const [compactDetail, setCompactDetail] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState<Record<DetailSectionKey, boolean>>(
    defaultCollapsedSections(true),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPlayer) {
      setFocusedMarket(market);
    }
  }, [selectedPlayer, market]);

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

  function closePlayerDetail(): void {
    setSelectedPlayer(null);
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
      const payload = (await response.json()) as { result?: { status?: string }; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Refresh failed");
      }
      setRefreshMessage(`Refresh complete (${payload.result?.status ?? "SUCCESS"}). Reloading board...`);
      window.location.reload();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setIsRefreshing(false);
    }
  }

  const matchupStatsByKey = useMemo(() => {
    const map = new Map<string, SnapshotBoardData["teamMatchups"][number]>();
    data.teamMatchups.forEach((item) => map.set(item.matchupKey, item));
    return map;
  }, [data.teamMatchups]);

  const filteredRows = useMemo(() => {
    const search = playerSearch.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (matchup && row.matchupKey !== matchup) return false;
      if (search && !row.playerName.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [data.rows, matchup, playerSearch]);

  const playerSuggestionPool = useMemo(() => {
    const rows = matchup ? data.rows.filter((row) => row.matchupKey === matchup) : data.rows;
    const deduped = new Map<string, SnapshotRow>();
    rows.forEach((row) => {
      if (!deduped.has(row.playerId)) {
        deduped.set(row.playerId, row);
      }
    });
    return Array.from(deduped.values()).sort((a, b) => a.playerName.localeCompare(b.playerName));
  }, [data.rows, matchup]);

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
    if (!matchup) return data.teamMatchups;
    return data.teamMatchups.filter((item) => item.matchupKey === matchup);
  }, [data.teamMatchups, matchup]);

  const selectedMinutesFloor = parseMinutesFloor(defaultMinutesFloor) ?? 22;
  const activeLineCount = useMemo(
    () => Object.keys(lineMap).filter((key) => Boolean(parseLine(lineMap[key]))).length,
    [lineMap],
  );
  const highQualityCount = useMemo(
    () => filteredRows.filter((row) => row.dataCompleteness.tier === "HIGH").length,
    [filteredRows],
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
              Last refresh: {data.lastUpdatedAt ? new Date(data.lastUpdatedAt).toLocaleString() : "No refresh yet"}
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

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <article className="rounded-xl border border-slate-200/15 bg-[#0e1830]/75 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Players Showing</p>
            <p className="mt-1 text-xl font-semibold text-white">{filteredRows.length}</p>
          </article>
          <article className="rounded-xl border border-slate-200/15 bg-[#0e1830]/75 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Matchups</p>
            <p className="mt-1 text-xl font-semibold text-white">{filteredTeamMatchups.length}</p>
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

        <form method="GET" className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[190px_1fr_220px_150px]">
          <label className="flex min-w-[170px] flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-300/85">
            Date (ET)
            <input
              name="date"
              type="date"
              defaultValue={data.dateEt}
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
              {data.matchups.map((option) => (
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
            Load Date
          </button>
        </form>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_230px]">
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
          </label>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-300/85">
            Badge Minutes Floor
            <input
              value={defaultMinutesFloor}
              onChange={(event) => setDefaultMinutesFloor(event.target.value)}
              inputMode="decimal"
              placeholder="22"
              className="rounded-xl border border-slate-300/25 bg-[#081127]/90 px-3 py-2 text-sm text-white outline-none focus:border-amber-300/70"
            />
          </label>
        </div>

        <p className="mt-3 text-xs text-slate-300/80">
          Tip: enter your line in the table, then use the new <span className="text-amber-200">Minute Badge</span> and player analyzer to validate workload assumptions.
        </p>

        {refreshMessage ? <p className="mt-2 text-xs text-emerald-200">{refreshMessage}</p> : null}
        {refreshError ? <p className="mt-2 text-xs text-rose-200">{refreshError}</p> : null}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">Team Matchup Stats</h2>
        {filteredTeamMatchups.length === 0 ? (
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
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">Player Snapshot</h2>
        {filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-300/15 bg-[#0e1932] p-6 text-sm text-slate-300">
            No players found for selected filters.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-300/15 bg-[#0d162d] shadow-[0_16px_60px_-35px_rgba(245,158,11,0.55)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[2350px] text-left text-sm">
                <thead className="bg-[#1a2a51] text-xs uppercase tracking-[0.12em] text-slate-200/80">
                  <tr>
                    <th className="px-4 py-3">Player</th>
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
                    <th className="px-4 py-3">L5 {market}</th>
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
                  {filteredRows.map((row) => {
                    const l5Values = row.last5[market];
                    const l10Values = row.last10[market];
                    const l10Volatility = standardDeviation(l10Values);
                    const l10Consistency = consistencyPct(l10Values);
                    const floor = minValue(l10Values);
                    const ceiling = maxValue(l10Values);
                    const currentLine = parseLine(lineMap[lineKey(row.playerId, market)] ?? "");
                    const l10Hit = currentLine == null ? null : hitCounts(l10Values, currentLine);
                    const minuteFloorLogs = row.analysisLogs.filter((log) => log.minutes >= selectedMinutesFloor);
                    const minuteFloorValues = minuteFloorLogs.map((log) => marketValueFromLog(log, market));
                    const minuteFloorHit = currentLine == null ? null : hitCounts(minuteFloorValues, currentLine);

                    return (
                      <tr
                        key={row.playerId}
                        onClick={() => {
                          setFocusedMarket(market);
                          setSelectedPlayer(row);
                        }}
                        className="cursor-pointer border-t border-slate-300/10 text-slate-100 hover:bg-cyan-300/8"
                      >
                        <td className="px-4 py-3 font-semibold">
                          <div>{row.playerName}</div>
                          <div className="text-xs text-slate-400">{row.position ?? "N/A"}</div>
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
                          {l5Values.length ? l5Values.map((value) => formatStat(value)).join(", ") : "No logs"}
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
                        <td className="px-4 py-3">{formatAverage(row.projectedTonight[market])}</td>
                        <td className="px-4 py-3">
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
                            placeholder="24.5"
                            className="w-20 rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1 text-sm text-white outline-none focus:border-cyan-300/60"
                          />
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {currentLine == null || !l10Hit
                            ? "-"
                            : `${l10Hit.over}/${l10Values.length} O | ${l10Hit.under}/${l10Values.length} U`}
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
                  <li>2. Enter your line in the table row for each player.</li>
                  <li>3. Read `L10 O/U` plus the new `Minute Badge` before opening detail.</li>
                  <li>4. Click a player row to open full analyzer + context sections.</li>
                </ol>
              </article>

              <article className="rounded-xl border border-slate-300/20 bg-[#0b152a] p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.14em] text-amber-200">Minute Badge</p>
                <p className="mt-2 text-xs text-slate-300">
                  `Minute Badge` shows hit rate only in games above your selected minutes floor. Example:
                  `22+m: 85/104 (82%)` means 85 overs in 104 games with 22+ minutes.
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  Use `Badge Minutes Floor` in the header to change the floor globally (20, 22, 24, etc.).
                </p>
              </article>

              <article className="rounded-xl border border-slate-300/20 bg-[#0b152a] p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.14em] text-amber-200">Player Detail Workflow</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  <li>- Start compact mode on.</li>
                  <li>- Open `All Markets Detail` to set line + minutes scenario.</li>
                  <li>- Compare projection vs line, then check minute-scenario sample and volatility.</li>
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
            <div className="sticky top-0 z-20 border-b border-slate-300/20 bg-[#0b122a]/95 px-4 py-3 backdrop-blur sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="title-font text-2xl uppercase text-white">{selectedPlayer.playerName}</h2>
                  <p className="text-sm text-slate-300">
                    {selectedPlayer.teamCode} vs {selectedPlayer.opponentCode} ({selectedPlayer.isHome ? "Home" : "Away"})
                  </p>
                  <p className="text-xs text-slate-400">{selectedPlayer.gameTimeEt}</p>
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
              id="detail-markets"
              title="All Markets Detail"
              subtitle="Click any market card to open a full breakdown against your typed line."
              collapsed={collapsedSections.markets}
              onToggle={() => toggleSection("markets")}
            >
              <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {MARKET_OPTIONS.map((option) => {
                  const m = option.value;
                  const l5 = selectedPlayer.last5[m];
                  const l10 = selectedPlayer.last10[m];
                  const key = lineKey(selectedPlayer.playerId, m);
                  const selectedLine = parseLine(lineMap[key] ?? "");
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
                        placeholder="Set line"
                        className="mt-2 w-full rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/60"
                      />

                      <div className="mt-2 space-y-2 text-[11px]">
                        {selectedLine == null || !l5Hit || !l10Hit ? (
                          <p className="rounded-md border border-slate-300/15 bg-[#0d1630] px-2 py-1.5 text-slate-300">
                            Enter a line to see L5/L10 over-under breakdown.
                          </p>
                        ) : (
                          <>
                            <div className="rounded-md border border-slate-300/15 bg-[#0d1630] px-2 py-1.5">
                              <p className="text-[10px] uppercase tracking-[0.12em] text-cyan-100">Last 5 vs Line</p>
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
                              <p className="text-[10px] uppercase tracking-[0.12em] text-cyan-100">Last 10 vs Line</p>
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
                const selectedLine = parseLine(lineMap[key] ?? "");
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
                          Your line
                          <input
                            value={lineMap[key] ?? ""}
                            onChange={(event) =>
                              setLineMap((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            inputMode="decimal"
                            placeholder="Set line"
                            className="mt-1 w-full rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1.5 text-sm text-white outline-none focus:border-cyan-300/60"
                          />
                        </label>

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
                              <p className="text-slate-400">Set a line to get minute-filtered O/U hit rate.</p>
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
                            Enter a line to see over/under rates and per-game comparisons.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-1 rounded-lg bg-[#0d1630] px-2 py-2 text-xs text-slate-200">
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
                {formatAverage(selectedPlayer.last10Average[market])} | Projection {formatAverage(selectedPlayer.projectedTonight[market])} | Trend{" "}
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

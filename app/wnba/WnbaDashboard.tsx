"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  ExternalLink,
  Filter,
  Gauge,
  LineChart,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Target,
  Trophy,
  X,
} from "lucide-react";
import {
  WNBA_INPUT_COLUMNS,
  WNBA_MODEL_STAGES,
  WNBA_MODEL_SUMMARY,
  WNBA_PORTFOLIO_RULES,
} from "@/lib/wnba/modelSummary";

type ModelAction = "SELECTED" | "CANDIDATE" | "COVERAGE";
type Side = "OVER" | "UNDER";
type BoardMode = "top" | "candidates" | "coverage" | "all";
type SortKey = "score" | "probability" | "edge" | "player";
type SettlementStatus = "PENDING" | "WIN" | "LOSS" | "PUSH" | "NO_ACTION" | string;

export type CurrentCardRow = {
  candidate_id?: string;
  selected_rank: number | null;
  tier: string;
  final_score: number;
  player: string;
  team: string;
  team_name?: string;
  opponent: string;
  opponent_name?: string;
  matchup_key?: string;
  market: string;
  side: Side;
  line: number;
  over_odds: number | null;
  under_odds: number | null;
  projected_value: number;
  line_gap: number;
  abs_line_gap?: number;
  model_probability: number;
  fair_probability?: number | null;
  price_edge: number | null;
  projected_minutes?: number | null;
  sample_size?: number | null;
  sportsbook_count?: number | null;
  source_pick?: string | null;
  source_projection?: number | null;
  source_odds?: number | null;
  source_book?: string;
  source_market?: string;
  source_url?: string;
  line_last_updated?: string | null;
  model_action?: ModelAction;
  rejection_reason?: string | null;
  risk_flags: string[];
  reasons: string[];
};

export type CurrentCard = {
  generatedAt: string;
  modelName: string;
  slateDate: string;
  modelVersion: string;
  mode: string;
  sourceNote?: string;
  sourceUrls?: string[];
  summary: {
    totalBoardRows: number;
    selectedCount: number;
    candidateCount: number;
    averageModelProbability: number | null;
    averageFinalScore: number | null;
    priceCoveragePct: number;
    warningCount?: number;
    selectedByTier?: Record<string, number>;
    boardRowsByAction?: Record<string, number>;
  };
  warnings: string[];
  boardRows: CurrentCardRow[];
  selectedRows: CurrentCardRow[];
  candidateRows: CurrentCardRow[];
};

export type CurrentSettlement = {
  generatedAt: string;
  slateDate: string;
  summary: {
    trackedPicks: number;
    settledPicks: number;
    pendingPicks: number;
    noActionPicks?: number;
    wins: number;
    losses: number;
    pushes: number;
    accuracyPct: number | null;
  };
  rows?: Array<{
    selected_rank: number;
    player: string;
    team_name?: string;
    opponent_name?: string;
    market: string;
    side: Side;
    line: number;
    actual: number | null;
    settlement: SettlementStatus;
    model_probability: number;
    final_score: number;
    source_book?: string | null;
    source_url?: string | null;
  }>;
};

const BOARD_LIMIT = 24;
const MARKET_LABELS: Record<string, string> = {
  AST: "AST",
  PTS: "PTS",
  REB: "REB",
  THREES: "3PM",
  PA: "P+A",
  PR: "P+R",
  RA: "R+A",
  PRA: "P+R+A",
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatDecimal(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toFixed(digits).replace(/\.0+$/, "");
}

function formatPct(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

function formatSigned(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatOdds(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "single side";
  }
  return value > 0 ? `+${value.toFixed(0)}` : value.toFixed(0);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "time unavailable";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "time unavailable";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatFlag(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "nan") {
    return null;
  }
  return trimmed;
}

function marketLabel(value: string): string {
  const cleaned = cleanText(value) ?? value;
  const normalized = cleaned.toUpperCase().replace(/\s+/g, " ").trim();
  if (MARKET_LABELS[normalized]) {
    return MARKET_LABELS[normalized];
  }
  if (normalized.includes("3 POINT") || normalized.includes("3-POINT")) {
    return "3PM";
  }
  if (normalized === "POINTS" || normalized === "PTS") {
    return "PTS";
  }
  if (normalized === "REBOUNDS" || normalized === "REB") {
    return "REB";
  }
  if (normalized === "ASSISTS" || normalized === "AST") {
    return "AST";
  }
  if (normalized.includes("PTS + REB") || normalized.includes("POINTS + REBOUNDS")) {
    return "P+R";
  }
  if (normalized.includes("PTS + AST") || normalized.includes("POINTS + ASSISTS")) {
    return "P+A";
  }
  return cleaned;
}

function matchupLabel(row: CurrentCardRow): string {
  const team = row.team_name || row.team || "Team TBD";
  const opponent = row.opponent_name || row.opponent || "Team TBD";
  return `${team} vs ${opponent}`;
}

function pickTitle(row: CurrentCardRow): string {
  return `${row.side} ${marketLabel(row.market)} ${formatDecimal(row.line, 1)}`;
}

function pickOdds(row: CurrentCardRow): string {
  return formatOdds(row.side === "OVER" ? row.over_odds : row.under_odds);
}

function listedSide(row: CurrentCardRow): Side {
  const sourcePick = cleanText(row.source_pick);
  return sourcePick === "OVER" || sourcePick === "UNDER" ? sourcePick : row.side;
}

function listedOdds(row: CurrentCardRow): string {
  const side = listedSide(row);
  const odds = row.source_odds ?? (side === "OVER" ? row.over_odds : row.under_odds);
  return formatOdds(odds);
}

function actionLabel(row: CurrentCardRow): string {
  if (row.model_action === "SELECTED") {
    return "Selected";
  }
  if (row.model_action === "CANDIDATE") {
    return "Candidate";
  }
  return row.rejection_reason ? `Scored only: ${formatFlag(row.rejection_reason)}` : "Scored only";
}

function actionTone(row: CurrentCardRow): string {
  if (row.model_action === "SELECTED") {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  }
  if (row.model_action === "CANDIDATE") {
    return "border-amber-300/30 bg-amber-300/10 text-amber-100";
  }
  return "border-white/10 bg-white/[0.03] text-zinc-300";
}

function riskTone(flag: string): string {
  if (flag.includes("single_side") || flag.includes("thin")) {
    return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  }
  if (flag.includes("disagreement") || flag.includes("volatile")) {
    return "border-rose-300/25 bg-rose-300/10 text-rose-100";
  }
  return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
}

function sortRows(rows: CurrentCardRow[], sortKey: SortKey): CurrentCardRow[] {
  return [...rows].sort((left, right) => {
    if (sortKey === "player") {
      return left.player.localeCompare(right.player);
    }
    if (sortKey === "probability") {
      return right.model_probability - left.model_probability || right.final_score - left.final_score;
    }
    if (sortKey === "edge") {
      return Math.abs(right.line_gap) - Math.abs(left.line_gap) || right.final_score - left.final_score;
    }
    return right.final_score - left.final_score || right.model_probability - left.model_probability;
  });
}

function StatTile({
  label,
  value,
  note,
  icon: Icon,
  tone = "cyan",
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Target;
  tone?: "cyan" | "emerald" | "amber" | "violet";
}) {
  const toneClass = {
    cyan: "text-cyan-200 bg-cyan-300/10 border-cyan-300/20",
    emerald: "text-emerald-200 bg-emerald-300/10 border-emerald-300/20",
    amber: "text-amber-100 bg-amber-300/10 border-amber-300/20",
    violet: "text-violet-100 bg-violet-300/10 border-violet-300/20",
  }[tone];

  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3 shadow-[0_14px_36px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">{label}</div>
          <div className="mt-2 text-2xl font-semibold tracking-normal text-zinc-50">{value}</div>
        </div>
        <div className={classNames("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", toneClass)}>
          <Icon aria-hidden="true" size={17} />
        </div>
      </div>
      <div className="mt-1 text-xs leading-5 text-zinc-400">{note}</div>
    </div>
  );
}

function SegmentButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "min-h-9 rounded-md border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        active
          ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100"
          : "border-white/10 bg-zinc-950/40 text-zinc-300 hover:border-white/20 hover:bg-white/[0.04]",
      )}
    >
      {label}
    </button>
  );
}

function PickCard({ row, compact = false }: { row: CurrentCardRow; compact?: boolean }) {
  const risks = row.risk_flags.slice(0, compact ? 2 : 4);
  const rankLabel = row.selected_rank ? `#${row.selected_rank}` : row.tier;
  const sourceBook = cleanText(row.source_book) ?? "Public board";

  return (
    <article className="rounded-lg border border-white/10 bg-zinc-950/70 p-4 shadow-[0_18px_45px_rgba(0,0,0,0.24)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-100">
              <Trophy aria-hidden="true" size={12} />
              {rankLabel}
            </span>
            <span className={classNames("rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]", actionTone(row))}>
              {actionLabel(row)}
            </span>
          </div>
          <h2 className="mt-3 truncate text-xl font-semibold tracking-normal text-zinc-50">{row.player}</h2>
          <div className="mt-1 text-sm text-zinc-400">{matchupLabel(row)}</div>
        </div>
        <div className={classNames(
          "shrink-0 rounded-lg border px-3 py-2 text-right",
          row.side === "OVER"
            ? "border-emerald-300/25 bg-emerald-300/10"
            : "border-cyan-300/25 bg-cyan-300/10",
        )}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-300">{row.side}</div>
          <div className="mt-0.5 text-lg font-semibold text-zinc-50">{marketLabel(row.market)} {formatDecimal(row.line, 1)}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <MiniMetric label="Projection" value={formatDecimal(row.projected_value, 2)} />
        <MiniMetric label="Model" value={formatPct(row.model_probability)} />
        <MiniMetric label="Gap" value={formatSigned(row.line_gap)} />
        <MiniMetric label="Price" value={pickOdds(row)} />
      </div>

      {!compact ? (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm leading-6 text-zinc-300">
          {row.reasons.slice(0, 3).join(" / ")}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {risks.map((flag) => (
          <span key={`${row.candidate_id ?? row.player}:${flag}`} className={classNames("rounded-md border px-2 py-1 text-[11px] font-medium", riskTone(flag))}>
            {formatFlag(flag)}
          </span>
        ))}
        {row.source_url ? (
          <a
            href={row.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-cyan-300/25 hover:text-cyan-100"
          >
            {sourceBook}
            <ExternalLink aria-hidden="true" size={12} />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div className="mt-1 font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

function BoardRow({ row }: { row: CurrentCardRow }) {
  const side = listedSide(row);
  const sourceBook = cleanText(row.source_book) ?? "Public board";
  const sourceMarket = cleanText(row.source_market) ?? row.market;

  return (
    <div className="grid gap-3 rounded-lg border border-white/10 bg-zinc-950/55 p-3 text-sm lg:grid-cols-[1.2fr_0.75fr_0.75fr_0.75fr_0.75fr_0.75fr] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate font-semibold text-zinc-50">{row.player}</div>
          <span className={classNames("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]", actionTone(row))}>
            {actionLabel(row)}
          </span>
        </div>
        <div className="mt-1 truncate text-xs text-zinc-400">{matchupLabel(row)}</div>
      </div>
      <BoardCell label="Model lean" value={pickTitle(row)} accent={row.side === "OVER" ? "emerald" : "cyan"} />
      <BoardCell label="Model" value={`${formatPct(row.model_probability)} / ${formatScore(row.final_score)}`} />
      <BoardCell label="Gap" value={formatSigned(row.line_gap)} />
      <BoardCell label="Listed" value={`${side} ${marketLabel(sourceMarket)} ${listedOdds(row)}`} />
      <div className="min-w-0 text-xs leading-5 text-zinc-400">
        <div className="font-medium text-zinc-300">{sourceBook}</div>
        <div className="truncate">{row.risk_flags.slice(0, 2).map(formatFlag).join(" / ") || "No major flags"}</div>
      </div>
    </div>
  );
}

function BoardCell({ label, value, accent }: { label: string; value: string; accent?: "cyan" | "emerald" }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div className={classNames(
        "mt-1 truncate font-semibold",
        accent === "cyan" ? "text-cyan-100" : accent === "emerald" ? "text-emerald-100" : "text-zinc-100",
      )}>
        {value}
      </div>
    </div>
  );
}

function EmptyBoardState({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 bg-zinc-950/45 p-8 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-300">
        <Filter aria-hidden="true" size={19} />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-zinc-50">No board rows match</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
        The current filters are hiding the slate. Clear them to return to the full WNBA board.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
      >
        <X aria-hidden="true" size={16} />
        Clear filters
      </button>
    </div>
  );
}

function SettlementPanel({ settlement }: { settlement: CurrentSettlement }) {
  const rows = settlement.rows ?? [];

  return (
    <section className="rounded-lg border border-white/10 bg-zinc-950/45 p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-300/20 bg-emerald-300/10 text-emerald-100">
            <CheckCircle2 aria-hidden="true" size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">Settlement Tracker</h2>
            <div className="mt-1 text-sm text-zinc-400">
              {settlement.summary.settledPicks} settled / {settlement.summary.pendingPicks} pending
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[360px]">
          <MiniMetric label="Wins" value={String(settlement.summary.wins)} />
          <MiniMetric label="Losses" value={String(settlement.summary.losses)} />
          <MiniMetric
            label="Accuracy"
            value={settlement.summary.accuracyPct === null ? "Pending" : `${settlement.summary.accuracyPct.toFixed(1)}%`}
          />
        </div>
      </div>

      {rows.length ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <div key={`${row.selected_rank}:${row.player}:${row.market}`} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-50">
                    #{row.selected_rank} {row.player}
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {row.side} {marketLabel(row.market)} {formatDecimal(row.line, 1)}
                  </div>
                </div>
                <span className={classNames("shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]", settlementTone(row.settlement))}>
                  {formatFlag(row.settlement)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-400">
                <span>Actual {formatDecimal(row.actual, 1)}</span>
                <span>{cleanText(row.source_book) ?? "Public board"}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function settlementTone(status: SettlementStatus): string {
  if (status === "WIN") {
    return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  }
  if (status === "LOSS") {
    return "border-rose-300/25 bg-rose-300/10 text-rose-100";
  }
  if (status === "PUSH") {
    return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
  }
  return "border-amber-300/25 bg-amber-300/10 text-amber-100";
}

function InfoPanel({ title, children, icon: Icon }: { title: string; children: React.ReactNode; icon: typeof Target }) {
  return (
    <section className="rounded-lg border border-white/10 bg-zinc-950/55 p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-cyan-100">
          <Icon aria-hidden="true" size={17} />
        </div>
        <h2 className="text-lg font-semibold text-zinc-50">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function WnbaDashboard({
  card,
  settlement,
}: {
  card: CurrentCard;
  settlement: CurrentSettlement;
}) {
  const [mode, setMode] = useState<BoardMode>("top");
  const [market, setMarket] = useState("ALL");
  const [side, setSide] = useState<"ALL" | Side>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const markets = useMemo(() => Array.from(new Set(card.boardRows.map((row) => row.market))).sort(), [card.boardRows]);
  const queryKey = query.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    const baseRows = card.boardRows.filter((row) => {
      if (mode === "top" && row.model_action !== "SELECTED") return false;
      if (mode === "candidates" && row.model_action !== "CANDIDATE") return false;
      if (mode === "coverage" && row.model_action !== "COVERAGE") return false;
      if (market !== "ALL" && row.market !== market) return false;
      if (side !== "ALL" && row.side !== side) return false;
      if (queryKey) {
        const haystack = [
          row.player,
          row.team,
          row.team_name,
          row.opponent,
          row.opponent_name,
          row.market,
          row.side,
          cleanText(row.source_book),
          row.rejection_reason,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(queryKey)) return false;
      }
      return true;
    });

    return sortRows(baseRows, sortKey);
  }, [card.boardRows, market, mode, queryKey, side, sortKey]);

  const visibleRows = showAll ? filteredRows : filteredRows.slice(0, BOARD_LIMIT);
  const hiddenRows = Math.max(0, filteredRows.length - visibleRows.length);
  const topCandidateRows = sortRows(card.candidateRows, "score").slice(0, 4);
  const selectedTierText = card.summary.selectedByTier
    ? Object.entries(card.summary.selectedByTier)
        .map(([tier, count]) => `${count} ${tier}`)
        .join(" / ")
    : `${card.summary.selectedCount} picks`;
  const settlementText =
    settlement.summary.accuracyPct === null
      ? `${settlement.summary.pendingPicks} pending`
      : `${settlement.summary.accuracyPct.toFixed(1)}% settled accuracy`;

  const clearFilters = () => {
    setMode("all");
    setMarket("ALL");
    setSide("ALL");
    setSortKey("score");
    setQuery("");
    setShowAll(false);
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,#09090b_0%,#111115_48%,#151519_100%)]" />
      <div className="relative mx-auto flex max-w-[1440px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="sticky top-0 z-40 -mx-4 border-b border-white/10 bg-zinc-950/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-sm font-bold tracking-[0.16em] text-cyan-100">
                W
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
                  ULTOPS / WNBA
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold text-zinc-50">
                  {card.summary.selectedCount} picks for {card.slateDate}
                </div>
              </div>
            </div>

            <nav className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
              <a href="#card" className="shrink-0 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-cyan-300/25 hover:text-cyan-100">
                Today
              </a>
              <a href="#board" className="shrink-0 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-cyan-300/25 hover:text-cyan-100">
                Board
              </a>
              <a href="#model" className="shrink-0 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-cyan-300/25 hover:text-cyan-100">
                Model
              </a>
              <Link
                href="/"
                className="inline-flex shrink-0 items-center gap-2 rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-cyan-300/25 hover:text-cyan-100"
              >
                <ArrowLeft aria-hidden="true" size={14} />
                NBA board
              </Link>
            </nav>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_420px] lg:items-stretch">
          <div className="rounded-lg border border-white/10 bg-zinc-950/55 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-md border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
                <CheckCircle2 aria-hidden="true" size={15} />
                Current card live
              </span>
              <span className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-300">
                <Clock3 aria-hidden="true" size={15} />
                {formatDateTime(card.generatedAt)} ET
              </span>
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-normal text-zinc-50 sm:text-5xl">
              WNBA Prop Card
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-400">
              {card.modelName} ranks the current slate by model probability, projection gap, book price, and portfolio risk.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile icon={Target} label="Selected" value={String(card.summary.selectedCount)} note={`${card.summary.totalBoardRows} board rows`} tone="emerald" />
              <StatTile icon={Gauge} label="Avg prob." value={formatPct(card.summary.averageModelProbability)} note={selectedTierText} tone="cyan" />
              <StatTile icon={Star} label="Avg score" value={formatScore(card.summary.averageFinalScore)} note="Selected card" tone="violet" />
              <StatTile icon={ShieldCheck} label="Settlement" value={settlement.summary.accuracyPct === null ? "Pending" : `${settlement.summary.accuracyPct.toFixed(1)}%`} note={settlementText} tone="amber" />
            </div>
          </div>

          <aside className="rounded-lg border border-white/10 bg-zinc-950/55 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-300/25 bg-amber-300/10 text-amber-100">
                <AlertTriangle aria-hidden="true" size={18} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-50">Slate Notes</h2>
                <div className="text-sm text-zinc-400">{card.summary.priceCoveragePct.toFixed(1)}% pick-side price coverage</div>
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {card.warnings.map((warning) => (
                <div key={warning} className="rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm leading-6 text-amber-50/90">
                  {warning}
                </div>
              ))}
            </div>
          </aside>
        </section>

        <SettlementPanel settlement={settlement} />

        <section id="card" className="scroll-mt-28">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-normal text-zinc-50">Today&apos;s Picks</h2>
              <div className="mt-1 text-sm text-zinc-400">Ranked one per player, highest model score first.</div>
            </div>
            <div className="text-sm font-semibold text-zinc-300">{card.summary.selectedCount} selected</div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {card.selectedRows.map((row) => (
              <PickCard key={row.candidate_id ?? `${row.player}:${row.market}:${row.line}`} row={row} />
            ))}
          </div>
        </section>

        {topCandidateRows.length ? (
          <section className="rounded-lg border border-white/10 bg-zinc-950/45 p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-zinc-50">Next Up</h2>
                <div className="mt-1 text-sm text-zinc-400">Strong rows held by portfolio or slate gates.</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode("candidates");
                  setShowAll(false);
                  document.getElementById("board")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 text-sm font-semibold text-amber-100 transition hover:bg-amber-300/15"
              >
                <SlidersHorizontal aria-hidden="true" size={16} />
                View watch list
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {topCandidateRows.map((row) => (
                <PickCard key={row.candidate_id ?? `${row.player}:${row.market}:${row.line}:candidate`} row={row} compact />
              ))}
            </div>
          </section>
        ) : null}

        <section id="board" className="scroll-mt-28 rounded-lg border border-white/10 bg-zinc-950/45 p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                  <BarChart3 aria-hidden="true" size={18} />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-normal text-zinc-50">Board Explorer</h2>
                  <div className="mt-1 text-sm text-zinc-400">{filteredRows.length} of {card.boardRows.length} rows shown by current filters</div>
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(230px,1fr)_160px_150px_150px] xl:min-w-[760px]">
              <label className="relative block">
                <span className="sr-only">Search WNBA board</span>
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setShowAll(false);
                  }}
                  placeholder="Search player, team, market"
                  className="h-10 w-full rounded-md border border-white/10 bg-zinc-950 pl-9 pr-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/35 focus:ring-2 focus:ring-cyan-300/10"
                />
              </label>
              <SelectControl
                label="Market"
                value={market}
                onChange={(value) => {
                  setMarket(value);
                  setShowAll(false);
                }}
                options={[["ALL", "All markets"], ...markets.map((item) => [item, marketLabel(item)] as const)]}
              />
              <SelectControl
                label="Side"
                value={side}
                onChange={(value) => {
                  setSide(value as "ALL" | Side);
                  setShowAll(false);
                }}
                options={[
                  ["ALL", "Both sides"],
                  ["OVER", "Over"],
                  ["UNDER", "Under"],
                ]}
              />
              <SelectControl
                label="Sort"
                value={sortKey}
                onChange={(value) => setSortKey(value as SortKey)}
                options={[
                  ["score", "Score"],
                  ["probability", "Probability"],
                  ["edge", "Gap"],
                  ["player", "Player"],
                ]}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <SegmentButton label="Top card" active={mode === "top"} onClick={() => { setMode("top"); setShowAll(false); }} />
            <SegmentButton label="Watch list" active={mode === "candidates"} onClick={() => { setMode("candidates"); setShowAll(false); }} />
            <SegmentButton label="Coverage" active={mode === "coverage"} onClick={() => { setMode("coverage"); setShowAll(false); }} />
            <SegmentButton label="All rows" active={mode === "all"} onClick={() => { setMode("all"); setShowAll(false); }} />
            {(query || market !== "ALL" || side !== "ALL" || mode !== "top" || sortKey !== "score") ? (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-zinc-300 transition hover:border-rose-300/25 hover:text-rose-100"
              >
                <X aria-hidden="true" size={14} />
                Reset
              </button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-2">
            {visibleRows.map((row) => (
              <BoardRow key={row.candidate_id ?? `${row.player}:${row.market}:${row.line}:${row.model_action}`} row={row} />
            ))}
          </div>

          {filteredRows.length === 0 ? <EmptyBoardState onClear={clearFilters} /> : null}

          {hiddenRows > 0 ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-zinc-900 px-4 text-sm font-semibold text-zinc-200 transition hover:border-cyan-300/25 hover:text-cyan-100"
              >
                <ChevronDown aria-hidden="true" size={16} />
                Show {hiddenRows} more
              </button>
            </div>
          ) : showAll && filteredRows.length > BOARD_LIMIT ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-zinc-900 px-4 text-sm font-semibold text-zinc-200 transition hover:border-cyan-300/25 hover:text-cyan-100"
              >
                <ArrowDownUp aria-hidden="true" size={16} />
                Collapse board
              </button>
            </div>
          ) : null}
        </section>

        <section id="model" className="grid scroll-mt-28 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <InfoPanel title="Model Stack" icon={LineChart}>
            <div className="grid gap-3 md:grid-cols-2">
              {WNBA_MODEL_STAGES.map((stage) => (
                <div key={stage.label} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                  <h3 className="font-semibold text-zinc-50">{stage.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{stage.detail}</p>
                </div>
              ))}
            </div>
          </InfoPanel>

          <div className="grid gap-4">
            <InfoPanel title="Portfolio Gates" icon={ShieldCheck}>
              <div className="grid gap-2">
                {WNBA_PORTFOLIO_RULES.map((rule) => (
                  <div key={rule} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-300">
                    {rule}
                  </div>
                ))}
              </div>
            </InfoPanel>

            <InfoPanel title="Data Contract" icon={Database}>
              <div className="flex flex-wrap gap-2">
                {WNBA_INPUT_COLUMNS.map((column) => (
                  <span key={column} className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-zinc-300">
                    {column}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-sm leading-6 text-zinc-400">{WNBA_MODEL_SUMMARY.claimBoundary}</p>
            </InfoPanel>
          </div>
        </section>
      </div>
    </main>
  );
}

function formatScore(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(3) : "n/a";
}

function SelectControl({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<readonly [string, string]>;
}) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full appearance-none rounded-md border border-white/10 bg-zinc-950 px-3 pr-8 text-sm font-medium text-zinc-100 outline-none transition focus:border-cyan-300/35 focus:ring-2 focus:ring-cyan-300/10"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" size={15} />
    </label>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Database,
  ExternalLink,
  GitBranch,
  LineChart,
  ShieldCheck,
  Target,
  Trophy,
} from "lucide-react";
import {
  WNBA_INPUT_COLUMNS,
  WNBA_MODEL_METRICS,
  WNBA_MODEL_STAGES,
  WNBA_MODEL_SUMMARY,
  WNBA_PORTFOLIO_RULES,
} from "@/lib/wnba/modelSummary";
import currentCardData from "@/wnba/output/current-card.json";
import currentSettlementData from "@/wnba/output/current-settlement.json";

export const metadata: Metadata = {
  title: "ULTOPS | WNBA Player Prop Model",
  description: "WNBA player prop model section for the ULTOPS snapshot site.",
  robots: {
    index: false,
    follow: false,
  },
};

const panelClass =
  "rounded-2xl border border-[var(--border)] bg-[color:rgba(255,253,252,0.86)] shadow-[0_8px_30px_rgba(20,16,35,0.06)]";

type CurrentCardRow = {
  selected_rank: number | null;
  tier: string;
  final_score: number;
  player: string;
  team: string;
  opponent: string;
  market: string;
  side: "OVER" | "UNDER";
  line: number;
  over_odds: number | null;
  under_odds: number | null;
  projected_value: number;
  line_gap: number;
  model_probability: number;
  price_edge: number | null;
  source_pick?: string | null;
  source_projection?: number | null;
  source_book?: string;
  source_market?: string;
  source_url?: string;
  risk_flags: string[];
  reasons: string[];
};

type CurrentCard = {
  generatedAt: string;
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
  };
  warnings: string[];
  selectedRows: CurrentCardRow[];
  candidateRows: CurrentCardRow[];
};

const WNBA_CURRENT_CARD = currentCardData as CurrentCard;

type CurrentSettlement = {
  generatedAt: string;
  slateDate: string;
  summary: {
    trackedPicks: number;
    settledPicks: number;
    pendingPicks: number;
    wins: number;
    losses: number;
    pushes: number;
    accuracyPct: number | null;
  };
};

const WNBA_CURRENT_SETTLEMENT = currentSettlementData as CurrentSettlement;

function formatPct(value: number | null | undefined): string {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "n/a";
}

function formatScore(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(3) : "n/a";
}

function formatOdds(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "";
  }
  return value > 0 ? `+${value.toFixed(0)}` : value.toFixed(0);
}

function formatFlag(flag: string): string {
  return flag.replaceAll("_", " ");
}

function PickCard({ row }: { row: CurrentCardRow }) {
  const sideOdds = row.side === "OVER" ? row.over_odds : row.under_odds;
  const riskFlags = row.risk_flags.filter((flag) => flag !== "single_side_price").slice(0, 3);

  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            <Trophy aria-hidden="true" size={14} />
            Rank {row.selected_rank ?? "-"} / Tier {row.tier}
          </div>
          <h3 className="mt-2 truncate text-lg font-semibold text-[var(--text)]">{row.player}</h3>
          <div className="mt-1 text-sm text-[var(--text-2)]">
            {row.team} vs {row.opponent}
          </div>
        </div>
        <div className="rounded-xl border border-[color:rgba(47,125,90,0.22)] bg-[color:rgba(47,125,90,0.10)] px-3 py-2 text-right">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--positive)]">
            {row.side}
          </div>
          <div className="mt-0.5 text-base font-semibold text-[var(--text)]">
            {row.market} {row.line}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Projection</div>
          <div className="mt-1 font-semibold text-[var(--text)]">{row.projected_value.toFixed(2)}</div>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Model Prob.</div>
          <div className="mt-1 font-semibold text-[var(--text)]">{formatPct(row.model_probability)}</div>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Score</div>
          <div className="mt-1 font-semibold text-[var(--text)]">{formatScore(row.final_score)}</div>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Book Price</div>
          <div className="mt-1 font-semibold text-[var(--text)]">{formatOdds(sideOdds) || "single side"}</div>
        </div>
      </div>

      <div className="mt-4 text-sm leading-6 text-[var(--text-2)]">
        Source projection {row.source_projection?.toFixed(1) ?? "n/a"} on {row.source_market || row.market};
        model gap {row.line_gap > 0 ? "+" : ""}
        {row.line_gap.toFixed(2)}.
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {riskFlags.map((flag) => (
          <span key={flag} className="rounded-full bg-[color:rgba(221,149,55,0.12)] px-2.5 py-1 text-xs font-medium text-[var(--warning)]">
            {formatFlag(flag)}
          </span>
        ))}
        {row.source_url ? (
          <a
            href={row.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--text-2)] transition hover:text-[var(--text)]"
          >
            Source
            <ExternalLink aria-hidden="true" size={12} />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-[var(--text)]">{value}</div>
      <div className="mt-1 text-sm text-[var(--text-2)]">{note}</div>
    </div>
  );
}

function StageCard({ label, detail, index }: { label: string; detail: string; index: number }) {
  const icons = [LineChart, Activity, BarChart3, ShieldCheck] as const;
  const Icon = icons[index % icons.length];

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[color:rgba(109,74,255,0.18)] bg-[var(--accent-soft)] text-[var(--accent)]">
          <Icon aria-hidden="true" size={19} strokeWidth={2.1} />
        </span>
        <h2 className="text-base font-semibold text-[var(--text)]">{label}</h2>
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--text-2)]">{detail}</p>
    </div>
  );
}

export default function WnbaPage(): React.ReactElement {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(47,125,90,0.12),transparent_30%),radial-gradient(circle_at_top_right,rgba(109,74,255,0.10),transparent_28%),linear-gradient(180deg,rgba(255,253,252,0.70)_0%,rgba(245,241,232,0.90)_100%)]" />
      <div className="relative mx-auto flex max-w-[1440px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[color:rgba(255,253,252,0.88)] px-4 py-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)] backdrop-blur-md md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold tracking-[0.12em] text-[var(--positive)]">
              W
            </div>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                ULTOPS / WNBA Snapshot
              </div>
              <div className="mt-1 text-sm text-[var(--text-2)]">Player prop model section</div>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-2)] transition hover:border-[color:rgba(109,74,255,0.24)] hover:text-[var(--text)]"
          >
            <ArrowLeft aria-hidden="true" size={17} />
            NBA board
          </Link>
        </header>

        <section className={`${panelClass} overflow-hidden`}>
          <div className="grid gap-6 p-5 lg:grid-cols-[1.15fr_0.85fr] lg:p-7">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:rgba(47,125,90,0.22)] bg-[color:rgba(47,125,90,0.10)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--positive)]">
                <Activity aria-hidden="true" size={14} />
                {WNBA_MODEL_SUMMARY.status}
              </div>
              <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-normal text-[var(--text)] sm:text-5xl">
                WNBA Player Prop Model
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--text-2)]">
                {WNBA_MODEL_SUMMARY.modelName} is now part of the site repo. It scores supplied WNBA prop boards with
                projection gap, probability, price edge, risk flags, and correlation-aware selection rules.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {WNBA_MODEL_SUMMARY.markets.map((market) => (
                  <span
                    key={market}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-xs font-semibold text-[var(--text-2)]"
                  >
                    {market}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-3">
                <Database aria-hidden="true" className="text-[var(--accent)]" size={20} />
                <div>
                  <div className="text-sm font-semibold text-[var(--text)]">Model assets</div>
                  <div className="text-xs text-[var(--text-2)]">{WNBA_MODEL_SUMMARY.repoPath}</div>
                </div>
              </div>
              <div className="grid gap-2 text-sm text-[var(--text-2)]">
                <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-2)] px-3 py-2">
                  <span>Model version</span>
                  <span className="truncate font-medium text-[var(--text)]">{WNBA_MODEL_SUMMARY.modelVersion}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-2)] px-3 py-2">
                  <span>Raw log file</span>
                  <span className="truncate font-medium text-[var(--text)]">{WNBA_MODEL_SUMMARY.rawRows} rows</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-2)] px-3 py-2">
                  <span>Default range</span>
                  <span className="truncate font-medium text-[var(--text)]">{WNBA_MODEL_SUMMARY.dateRange}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {WNBA_MODEL_METRICS.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </section>

        <section className={`${panelClass} p-5 lg:p-6`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <Target aria-hidden="true" className="text-[var(--positive)]" size={22} />
                <h2 className="text-xl font-semibold text-[var(--text)]">Current Model Card</h2>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-2)]">
                Slate {WNBA_CURRENT_CARD.slateDate}; generated {new Date(WNBA_CURRENT_CARD.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET from public sourced prop rows.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[540px]">
              <MetricCard
                label="Selected"
                value={String(WNBA_CURRENT_CARD.summary.selectedCount)}
                note={`${WNBA_CURRENT_CARD.summary.totalBoardRows} sourced rows`}
              />
              <MetricCard
                label="Avg prob."
                value={formatPct(WNBA_CURRENT_CARD.summary.averageModelProbability)}
                note="Selected props"
              />
              <MetricCard
                label="Avg score"
                value={formatScore(WNBA_CURRENT_CARD.summary.averageFinalScore)}
                note="Model rank"
              />
              <MetricCard
                label="Price cov."
                value={`${WNBA_CURRENT_CARD.summary.priceCoveragePct.toFixed(1)}%`}
                note="Pick-side prices"
              />
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {WNBA_CURRENT_CARD.selectedRows.length ? (
              WNBA_CURRENT_CARD.selectedRows.map((row) => <PickCard key={`${row.player}-${row.market}-${row.line}`} row={row} />)
            ) : (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-2)]">
                No current rows cleared the model gates.
              </div>
            )}
          </div>

          {WNBA_CURRENT_CARD.warnings.length ? (
            <div className="mt-4 grid gap-2">
              {WNBA_CURRENT_CARD.warnings.map((warning) => (
                <div
                  key={warning}
                  className="flex gap-2 rounded-xl border border-[color:rgba(221,149,55,0.24)] bg-[color:rgba(221,149,55,0.10)] px-3 py-2 text-sm text-[var(--text-2)]"
                >
                  <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--warning)]" size={16} />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm leading-6 text-[var(--text-2)]">
            Verified accuracy:{" "}
            <span className="font-semibold text-[var(--text)]">
              {WNBA_CURRENT_SETTLEMENT.summary.accuracyPct === null
                ? "pending"
                : `${WNBA_CURRENT_SETTLEMENT.summary.accuracyPct.toFixed(1)}%`}
            </span>
            . Settled {WNBA_CURRENT_SETTLEMENT.summary.settledPicks} of{" "}
            {WNBA_CURRENT_SETTLEMENT.summary.trackedPicks} current-card picks;{" "}
            {WNBA_CURRENT_SETTLEMENT.summary.pendingPicks} pending final ESPN boxscores.
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
          <div className={`${panelClass} p-5 lg:p-6`}>
            <div className="flex items-center gap-3">
              <LineChart aria-hidden="true" className="text-[var(--accent)]" size={21} />
              <h2 className="text-xl font-semibold text-[var(--text)]">Model Stack</h2>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {WNBA_MODEL_STAGES.map((stage, index) => (
                <StageCard key={stage.label} {...stage} index={index} />
              ))}
            </div>
          </div>

          <aside className={`${panelClass} p-5 lg:p-6`}>
            <div className="flex items-center gap-3">
              <ShieldCheck aria-hidden="true" className="text-[var(--positive)]" size={21} />
              <h2 className="text-xl font-semibold text-[var(--text)]">Portfolio Gates</h2>
            </div>
            <div className="mt-5 grid gap-2">
              {WNBA_PORTFOLIO_RULES.map((rule) => (
                <div
                  key={rule}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text-2)]"
                >
                  {rule}
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
          <div className={`${panelClass} p-5 lg:p-6`}>
            <div className="flex items-center gap-3">
              <CalendarDays aria-hidden="true" className="text-[var(--warning)]" size={21} />
              <h2 className="text-xl font-semibold text-[var(--text)]">Season Windows</h2>
            </div>
            <div className="mt-5 grid gap-2">
              {WNBA_MODEL_SUMMARY.regularSeasonWindows.map((window) => (
                <div key={window} className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-2)]">
                  {window}
                </div>
              ))}
            </div>
          </div>

          <div className={`${panelClass} p-5 lg:p-6`}>
            <div className="flex items-center gap-3">
              <GitBranch aria-hidden="true" className="text-[var(--accent)]" size={21} />
              <h2 className="text-xl font-semibold text-[var(--text)]">Board Contract</h2>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {WNBA_INPUT_COLUMNS.map((column) => (
                <span
                  key={column}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-2)]"
                >
                  {column}
                </span>
              ))}
            </div>
            <p className="mt-5 text-sm leading-6 text-[var(--text-2)]">{WNBA_MODEL_SUMMARY.claimBoundary}</p>
          </div>
        </section>
      </div>
    </main>
  );
}

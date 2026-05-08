import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Database,
  GitBranch,
  LineChart,
  ShieldCheck,
} from "lucide-react";
import {
  WNBA_INPUT_COLUMNS,
  WNBA_MODEL_METRICS,
  WNBA_MODEL_STAGES,
  WNBA_MODEL_SUMMARY,
  WNBA_PORTFOLIO_RULES,
} from "@/lib/wnba/modelSummary";

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

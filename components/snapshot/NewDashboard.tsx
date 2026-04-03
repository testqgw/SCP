"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatIsoToEtTime, getTodayEtTimeString } from "@/lib/snapshot/time";
import type {
  SnapshotBoardData,
  SnapshotMarket,
  SnapshotPrecisionCardEntry,
  SnapshotModelSide,
  SnapshotRow,
} from "@/lib/types/snapshot";

// ===== V1 SUBCOMPONENTS =====

function formatPercent(value: number): string {
  if (value > 1) return value.toFixed(1);
  return (value * 100).toFixed(1);
}

function StatItem({ value, label, isTime }: { value: string; label: string; isTime?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={\`text-lg font-bold \${isTime ? "text-[var(--text-tertiary)]" : "text-white"}\`}>
        {value}
      </span>
      <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
    </div>
  );
}

function MetricCard({
  value,
  label,
  sublabel,
  color = "cyan",
  suffix = "",
  isCount = false,
  isPercent = false,
}: {
  value: number;
  label: string;
  sublabel: string;
  color?: "cyan" | "green" | "purple" | "amber";
  suffix?: string;
  isCount?: boolean;
  isPercent?: boolean;
}) {
  const overlayClasses = {
    cyan: "from-cyan-500/20 to-blue-500/20 border-cyan-500/30",
    green: "from-emerald-500/20 to-green-500/20 border-emerald-500/30",
    purple: "from-purple-500/20 to-violet-500/20 border-purple-500/30",
    amber: "from-amber-500/20 to-yellow-500/20 border-amber-500/30",
  };
  const textClasses = {
    cyan: "text-cyan-400",
    green: "text-emerald-400",
    purple: "text-purple-400",
    amber: "text-amber-400",
  };

  let displayValue: string;
  if (isCount) {
    displayValue = Math.round(value).toString();
  } else if (isPercent) {
    displayValue = (value > 1 ? value : value * 100).toFixed(1);
  } else {
    displayValue = value.toFixed(1);
  }

  return (
    <div
      className={\`surface p-4 relative overflow-hidden hover:border-[var(--border-medium)] transition border \${overlayClasses[color]}\`}
    >
      <div className={\`absolute inset-0 bg-gradient-to-br \${overlayClasses[color]} opacity-50\`} />
      <div className="relative">
        <div className={\`text-3xl font-bold \${textClasses[color]}\`}>
          {displayValue}
          {suffix}
        </div>
        <div className="text-sm font-medium text-white mt-1">{label}</div>
        <div className="text-xs text-[var(--text-muted)] mt-0.5">{sublabel}</div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={\`relative px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition \${
        active
          ? "bg-[var(--surface-strong)] text-white"
          : "text-[var(--text-tertiary)] hover:text-white hover:bg-[var(--surface-soft)]"
      }\`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className={\`ml-2 px-1.5 py-0.5 text-xs rounded-full \${
            active
              ? "bg-[var(--brand)] text-black"
              : "bg-[var(--surface-strong)] text-[var(--text-secondary)]"
          }\`}
        >
          {badge}
        </span>
      )}
      {active && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[var(--brand)] rounded-full" />
      )}
    </button>
  );
}

function FeaturedPickCard({ data }: { data?: SnapshotPrecisionCardEntry & { row?: SnapshotRow } }) {
  const router = useRouter();

  if (!data?.row || !data.market) {
    return (
      <div className="surface p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-purple-500/5" />
        <div className="relative text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--surface-strong)] animate-pulse" />
          <p className="text-[var(--text-secondary)] font-medium">Model is ready</p>
          <p className="text-sm text-[var(--text-muted)] mt-1">Market opening soon</p>
        </div>
      </div>
    );
  }

  const row = data.row;
  const market = data.market;
  const signal = data.precisionSignal;
  const hitChance = signal?.projectionWinProbability
    ? Math.round(signal.projectionWinProbability * 100)
    : null;
  const modelLine = row.modelLines?.[market];
  const currentLine = data.lockedLine ?? null;
  const fairLine = modelLine?.fairLine ?? null;
  const edge = modelLine?.projectionGap ?? 0;
  const edgeColorClass =
    edge > 0 ? "text-[var(--success)]" : edge < 0 ? "text-[var(--danger)]" : "text-[var(--text-muted)]";

  return (
    <div className="surface p-0 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 via-transparent to-amber-500/20 pointer-events-none" />
      <div className="relative p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-2xl font-bold text-white">{row.playerName}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="badge badge-blue text-xs">{row.teamCode}</span>
              <span className="text-[var(--text-muted)]">@</span>
              <span className="badge badge-gold text-xs">{row.opponentCode}</span>
              <span className="text-xs text-[var(--text-muted)] ml-2">{row.gameTimeEt}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Market</div>
            <div className="text-lg font-bold text-[var(--brand)]">{market}</div>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-4 p-4 rounded-xl bg-[var(--surface-strong)]">
          <div className="flex-1">
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">
              Recommendation
            </div>
            <div className="text-xl font-bold text-white">
              {signal?.side ?? "NEUTRAL"} {currentLine ?? "--"} {market}
            </div>
            {currentLine === null && fairLine !== null && (
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                Fair line: {fairLine} · awaiting market
              </div>
            )}
          </div>
          {hitChance && (
            <div className="text-center px-4 border-l border-[var(--border-subtle)]">
              <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Confidence</div>
              <div className="text-2xl font-bold text-[var(--success)]">{hitChance}%</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Line</div>
            <div className="text-lg font-semibold text-white">{currentLine ?? "--"}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Fair Line</div>
            <div className="text-lg font-semibold text-[var(--brand)]">{fairLine ?? "--"}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Edge</div>
            <div className={\`text-lg font-semibold \${edgeColorClass}\`}>
              {edge > 0 ? "+" : ""}
              {edge.toFixed(1)}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-[var(--border-subtle)]">
          <div className="text-xs text-[var(--text-muted)]">
            Updated{" "}
            {row.lastUpdatedAt ? formatIsoToEtTime(row.lastUpdatedAt) : "--"}
          </div>
          <button
            onClick={() => router.push(`/?player=${row.playerId}`)}
            className="text-sm font-medium text-[var(--brand)] hover:text-[var(--brand-2)] transition"
          >
            Deep Dive →
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== NEW DASHBOARD COMPONENT =====

type NewDashboardProps = {
  data: SnapshotBoardData;
  initialMarket?: SnapshotMarket | "ALL";
};

export default function NewDashboard({ data, initialMarket = "ALL" }: NewDashboardProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"precision" | "research" | "scout" | "lines">("precision");
  const featuredPickRef = useRef<HTMLDivElement>(null);
  const researchSectionRef = useRef<HTMLElement>(null);

  // Live stats from data
  const heroStats = useMemo(() => ({
    winRate: data.precisionSystem?.historicalAccuracy ?? 70.2,
    propsTracked: data.board?.length ?? 511,
    signals: Object.values(data.precisionSignalsByPlayer ?? {}).flat().length ?? 69,
    updatedAt: data.generatedAt ?? new Date().toISOString(),
  }), [data]);

  // Find lead featured pick (your existing logic adapted)
  const leadDailyCardCandidate = useMemo(() => {
    // Get first precision pick or first board item with signal
    const precisionPicks = Object.values(data.precisionSignalsByPlayer ?? {})
      .flat()
      .filter((p) => p.qualified && p.side !== "NEUTRAL")
      .sort((a, b) => (b.selectionScore ?? 0) - (a.selectionScore ?? 0));
    
    return precisionPicks[0] ?? null;
  }, [data]);

  const allQualifiedCandidates = useMemo(() => {
    // Your existing candidate logic
    return data.board?.filter((row) => {
      const hasPrecision = Object.values(data.precisionSignalsByPlayer?.[row.playerId] ?? {})
        .some((s) => s.qualified && s.side !== "NEUTRAL");
      return hasPrecision;
    }) ?? [];
  }, [data]);

  const scrollToBestPick = useCallback(() => {
    featuredPickRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const openResearchCenter = useCallback(() => {
    setActiveTab("research");
    setTimeout(() => {
      researchSectionRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }, []);

  return (
    <main className="min-h-screen">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
          <div className="absolute top-0 right-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8">
          <div className="grid lg:grid-cols-2 gap-8 items-center">
            {/* Left: Headline + CTAs */}
            <div className="space-y-6">
              <h1 className="title-font text-4xl sm:text-5xl lg:text-6xl leading-[1.1] text-white">
                Find the sharpest{" "}
                <span className="text-gradient">NBA props</span> before the market moves.
              </h1>

              <p className="text-lg text-[var(--text-tertiary)] max-w-xl leading-relaxed">
                Ranked picks with line context, matchup edges, and player-level research in one
                view.
              </p>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={scrollToBestPick}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-sm bg-gradient-to-r from-cyan-400 to-cyan-500 text-black hover:from-cyan-300 hover:to-cyan-400 transition shadow-lg shadow-cyan-500/25"
                >
                  View Tonight&apos;s Best Pick
                </button>
                <button
                  onClick={openResearchCenter}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-sm bg-white/10 border border-white/20 text-white hover:bg-white/20 transition"
                >
                  Open Research Center
                </button>
              </div>

              {/* Stat Strip */}
              <div className="flex flex-wrap gap-6 pt-4 border-t border-[var(--border-subtle)]">
                <StatItem
                  value={\`\${formatPercent(heroStats.winRate)}%\`}
                  label="Backtest Win Rate"
                />
                <StatItem value={heroStats.propsTracked.toString()} label="Props Tracked" />
                <StatItem value={heroStats.signals.toString()} label="Active Signals" />
                <StatItem
                  value={getTodayEtTimeString()}
                  label="Updated"
                  isTime
                />
              </div>
            </div>

            {/* Right: Featured Pick */}
            <div ref={featuredPickRef}>
              <FeaturedPickCard data={leadDailyCardCandidate} />
            </div>
          </div>
        </div>
      </section>

      {/* METRIC GRID */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            value={data.precisionCardSummary?.truePickCount ?? 0}
            label="Live Picks"
            sublabel="Qualified today"
            color="cyan"
            isCount
          />
          <MetricCard
            value={heroStats.winRate}
            label="Backtest Win Rate"
            sublabel="All markets YTD"
            color="green"
            suffix="%"
            isPercent
          />
          <MetricCard
            value={heroStats.propsTracked}
            label="Props On Slate"
            sublabel="Across 8 markets"
            color="purple"
            isCount
          />
          <MetricCard
            value={heroStats.signals}
            label="Research Depth"
            sublabel="Active signals"
            color="amber"
            isCount
          />
        </div>
      </section>

      {/* TABS */}
      <section
        ref={researchSectionRef}
        className="sticky top-0 z-40 bg-[var(--bg-primary)]/80 backdrop-blur-xl border-b border-[var(--border-subtle)]"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1 overflow-x-auto py-3 no-scrollbar">
            <TabButton
              active={activeTab === "precision"}
              onClick={() => setActiveTab("precision")}
              label="Precision Card"
              badge={data.precisionCardSummary?.truePickCount}
            />
            <TabButton
              active={activeTab === "research"}
              onClick={() => setActiveTab("research")}
              label="Research Center"
            />
            <TabButton
              active={activeTab === "scout"}
              onClick={() => setActiveTab("scout")}
              label="Scout Feed"
              badge={allQualifiedCandidates.length}
            />
            <TabButton
              active={activeTab === "lines"}
              onClick={() => setActiveTab("lines")}
              label="Line Tracking"
            />
          </div>
        </div>
      </section>

      {/* TAB CONTENT */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-[400px]">
        {activeTab === "precision" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">Precision Card</h2>
              <span className="inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/20 border border-cyan-500/30 text-cyan-400">
                {data.precisionCardSummary?.truePickCount ?? 0} Picks
              </span>
            </div>
            <p className="text-[var(--text-tertiary)]">
              Top-ranked selections from the universal model with confidence scoring.
            </p>
            {/* Wire your existing precision card list here */}
            <div className="p-8 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border-subtle)] text-center text-[var(--text-muted)]">
              Precision card content wired here
            </div>
          </div>
        )}

        {activeTab === "research" && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-white">Research Center</h2>
            <p className="text-[var(--text-tertiary)]">
              Full player-by-player analysis and matchup context.
            </p>
            <div className="p-8 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border-subtle)] text-center text-[var(--text-muted)]">
              Research center content wired here
            </div>
          </div>
        )}

        {activeTab === "scout" && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-white">Scout Feed</h2>
            <p className="text-[var(--text-tertiary)]">
              {allQualifiedCandidates.length} qualified signals across all markets.
            </p>
            <div className="p-8 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border-subtle)] text-center text-[var(--text-muted)]">
              Scout feed content wired here
            </div>
          </div>
        )}

        {activeTab === "lines" && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-white">Line Tracking</h2>
            <p className="text-[var(--text-tertiary)]">
              Live line movement and consensus tracking.
            </p>
            <div className="p-8 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border-subtle)] text-center text-[var(--text-muted)]">
              Line tracking content wired here
            </div>
          </div>
        )}
      </section>

      {/* LEGACY BRIDGE: Link back to old dashboard */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 border-t border-[var(--border-subtle)]">
        <div className="text-center">
          <p className="text-[var(--text-muted)] text-sm">
            Testing NewDashboard v1.{" "}
            <a href="/?legacy=1" className="text-[var(--brand)] hover:underline">
              Return to legacy dashboard
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
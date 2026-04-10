'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SnapshotBoardFeedItem,
  SnapshotBoardViewData,
  SnapshotDashboardPrecisionSignal,
  SnapshotDashboardRow,
  SnapshotDashboardSignal,
  SnapshotMarket,
  SnapshotModelSide,
  SnapshotPrecisionCardEntry,
} from '@/lib/types/snapshot';

type Tab = 'precision' | 'research' | 'scout' | 'tracking';
type ViewKey = 'overview' | 'players' | 'feed' | 'lines' | 'method';
type Kind = 'LIVE' | 'DERIVED' | 'PLACEHOLDER' | 'MODEL';
type HighlightTarget = { kind: 'player' | 'matchup'; key: string } | null;

const MARKETS: SnapshotMarket[] = ['PTS', 'REB', 'AST', 'THREES', 'PRA', 'PA', 'PR', 'RA'];
const MARKET_LABELS: Record<SnapshotMarket, string> = {
  PTS: 'PTS',
  REB: 'REB',
  AST: 'AST',
  THREES: '3PM',
  PRA: 'PRA',
  PA: 'PA',
  PR: 'PR',
  RA: 'RA',
};

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'precision', label: 'Overview', hint: 'Best board setups' },
  { id: 'research', label: 'Players', hint: 'Player dossiers' },
  { id: 'scout', label: 'Feed', hint: 'Live board signals' },
  { id: 'tracking', label: 'Lines', hint: 'Live line vs fair' },
];

const TAB_TO_VIEW: Record<Tab, ViewKey> = {
  precision: 'overview',
  research: 'players',
  scout: 'feed',
  tracking: 'lines',
};

const VIEW_TO_TAB: Partial<Record<ViewKey, Tab>> = {
  overview: 'precision',
  players: 'research',
  feed: 'scout',
  lines: 'tracking',
};

const TOP_NAV: Array<{ label: string; tab?: Tab; action?: 'help' }> = [
  { label: 'Overview', tab: 'precision' },
  { label: 'Players', tab: 'research' },
  { label: 'Feed', tab: 'scout' },
  { label: 'Lines', tab: 'tracking' },
  { label: 'Method', action: 'help' },
];

const KIND_CLASS: Record<Kind, string> = {
  LIVE: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]',
  DERIVED: 'border-[color:rgba(183,129,44,0.24)] bg-[color:rgba(183,129,44,0.10)] text-[var(--warning)]',
  PLACEHOLDER: 'border-[var(--border)] bg-[color:rgba(240,232,220,0.55)] text-[var(--muted)]',
  MODEL: 'border-[color:rgba(109,74,255,0.22)] bg-[var(--accent-soft)] text-[var(--accent)]',
};

const PILL_CLASS: Record<'default' | 'cyan' | 'amber', string> = {
  default: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)]',
  cyan: 'border-[color:rgba(109,74,255,0.18)] bg-[var(--accent-soft)] text-[var(--accent)]',
  amber: 'border-[color:rgba(183,129,44,0.22)] bg-[color:rgba(183,129,44,0.10)] text-[var(--warning)]',
};

const SIDE_CLASS: Record<SnapshotModelSide, string> = {
  OVER: 'border-[color:rgba(47,125,90,0.20)] bg-[color:rgba(47,125,90,0.10)] text-[var(--positive)]',
  UNDER: 'border-[color:rgba(180,74,74,0.20)] bg-[color:rgba(180,74,74,0.10)] text-[var(--negative)]',
  NEUTRAL: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]',
};

const ACTION_CLASS =
  'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(109,74,255,0.35)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]';

const CARD_BUTTON_CLASS = `${ACTION_CLASS} hover:-translate-y-0.5 hover:border-[color:rgba(109,74,255,0.24)] hover:shadow-[0_10px_24px_rgba(29,26,34,0.06)]`;
const WORKSPACE_SWITCH_CLASS =
  'rounded-full border px-3 py-1.5 text-[13px] font-medium sm:px-3.5 sm:py-2';
const ACTIVE_SWITCH_CLASS =
  'border-[color:rgba(109,74,255,0.24)] bg-[var(--surface)] text-[var(--accent)] shadow-[0_6px_18px_rgba(109,74,255,0.10)]';
const INACTIVE_SWITCH_CLASS =
  'border-[var(--border)] bg-transparent text-[var(--text-2)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)] hover:text-[var(--text)]';

function n(v: number | null | undefined, d = 1) {
  if (v == null || Number.isNaN(v)) return '-';
  const s = v.toFixed(d);
  return d > 0 ? s.replace(/\.0+$/, '') : s;
}

function signed(v: number | null | undefined, d = 1) {
  if (v == null || Number.isNaN(v)) return '-';
  return `${v > 0 ? '+' : ''}${n(v, d)}`;
}

function pct(v: number | null | undefined, d = 1) {
  return v == null || Number.isNaN(v) ? '-' : `${n(v, d)}%`;
}

function ts(v: string | null) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function matchup(row: SnapshotDashboardRow) {
  return `${row.matchupKey.replace('@', ' @ ')} - ${row.gameTimeEt}`;
}

function relativeTime(v: string | null, now: number) {
  if (!v) return 'Waiting for the first board refresh';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'Timestamp unavailable';
  const deltaMinutes = Math.max(0, Math.floor((now - d.getTime()) / 60_000));
  if (deltaMinutes < 1) return 'moments ago';
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const hours = Math.floor(deltaMinutes / 60);
  const minutes = deltaMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h ago` : `${days}d ago`;
}

function minutesSince(v: string | null, now: number) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((now - d.getTime()) / 60_000));
}

function firstSentence(v: string | null | undefined) {
  if (!v) return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^.*?[.!?](?:\s|$)/);
  return (match?.[0] ?? trimmed).trim();
}

function signal(row: SnapshotDashboardRow, market: SnapshotMarket): SnapshotDashboardSignal | null {
  if (market === 'PTS') return row.ptsSignal;
  if (market === 'REB') return row.rebSignal;
  if (market === 'AST') return row.astSignal;
  if (market === 'THREES') return row.threesSignal;
  if (market === 'PRA') return row.praSignal;
  if (market === 'PA') return row.paSignal;
  if (market === 'PR') return row.prSignal;
  if (market === 'RA') return row.raSignal;
  return null;
}

function Badge({ label, kind = 'PLACEHOLDER' as Kind }: { label: string; kind?: Kind }) {
  if (!label || kind === 'PLACEHOLDER' || label.trim().toUpperCase() === 'PLACEHOLDER') return null;
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${KIND_CLASS[kind]}`}>{label}</span>;
}

function Pill({ label, tone = 'default' }: { label: string; tone?: 'default' | 'cyan' | 'amber' }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${PILL_CLASS[tone]}`}>{label}</span>;
}

function Side({ side, kind }: { side: SnapshotModelSide; kind: Kind }) {
  return <Badge label={side} kind={kind} />;
}

function Stat({
  label,
  value,
  kind,
  note,
  dense = false,
  showKind = true,
}: {
  label: string;
  value: string;
  kind: Kind;
  note?: string;
  dense?: boolean;
  showKind?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] ${dense ? 'p-3 md:p-3.5' : 'p-3.5 md:p-4'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--muted)] md:text-[10px]">{label}</p>
        {showKind ? <Badge label={kind} kind={kind} /> : null}
      </div>
      <div className={`mt-2 font-semibold tracking-tight text-[var(--text)] ${dense ? 'text-base md:text-lg' : 'text-xl md:text-2xl'}`}>{value}</div>
      {note ? <div className="mt-1 text-[11px] leading-5 text-[var(--text-2)] md:text-xs">{note}</div> : null}
    </div>
  );
}

function EmptyState({
  eyebrow,
  title,
  detail,
  kind = 'PLACEHOLDER',
  actionLabel,
  onAction,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  kind?: Kind;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-[28px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">{eyebrow}</div>
          <div className="mt-2 text-base font-semibold text-[var(--text)] sm:text-lg">{title}</div>
        </div>
        <Badge label={kind} kind={kind} />
      </div>
      <div className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-2)]">{detail}</div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className={`${ACTION_CLASS} mt-4 inline-flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-medium text-[var(--text)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)]`}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function MatchupsCard({
  matchups,
  selectedKey,
  highlightedKey,
  onSelect,
}: {
  matchups: SnapshotBoardViewData['matchups'];
  selectedKey?: string | null;
  highlightedKey?: string | null;
  onSelect?: (matchupKey: string) => void;
}) {
  return (
    <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(20,16,35,0.06)]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Top matchups</div>
        <Badge label={matchups.length ? 'LIVE' : 'PLACEHOLDER'} kind={matchups.length ? 'LIVE' : 'PLACEHOLDER'} />
      </div>
      {matchups.length ? (
        <div className="mt-4 space-y-3">
          {matchups.slice(0, 4).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={onSelect ? () => onSelect(m.key) : undefined}
              className={`w-full rounded-2xl border px-4 py-3 text-left ${
                onSelect ? ACTION_CLASS : ''
              } ${
                selectedKey === m.key
                  ? 'border-[color:rgba(109,74,255,0.32)] bg-[var(--accent-soft)] shadow-[0_10px_24px_rgba(109,74,255,0.10)]'
                  : onSelect
                    ? 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)]'
                    : 'border-[var(--border)] bg-[var(--surface-2)]'
              } ${
                highlightedKey === m.key ? 'shadow-[0_0_0_3px_rgba(109,74,255,0.14)]' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--text)]">{m.label}</div>
                  <div className="mt-1 text-xs text-[var(--text-2)]">{m.gameTimeEt}</div>
                </div>
                {selectedKey === m.key ? <Badge label="Selected" kind="DERIVED" /> : null}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--text-2)]">
          Matchup windows will appear here as soon as the slate loads. Until then, the board stays usable through the
          featured card and research tabs.
        </div>
      )}
    </div>
  );
}

type View = {
  row: SnapshotDashboardRow;
  market: SnapshotMarket;
  label: string;
  live: number | null;
  fair: number | null;
  proj: number | null;
  edge: number | null;
  conf: number | null;
  books: number | null;
  side: SnapshotModelSide;
  liveKind: Kind;
  liveLineKind: Kind;
  fairKind: Kind;
  projKind: Kind;
  edgeKind: Kind;
  confKind: Kind;
  booksKind: Kind;
  sideKind: Kind;
  rank: string | null;
  source: string;
  note: string;
  score: number;
  reasons: string[];
  precision: SnapshotDashboardPrecisionSignal | null;
};

type ResearchRecentRead = {
  view: View;
  recentAverage: number | null;
  seasonAverage: number | null;
  trend: number | null;
  opponentDelta: number | null;
  recentFive: string;
  note: string;
  kind: Kind;
};

function booksLiveLabel(books: number | null | undefined) {
  if (books == null || Number.isNaN(books)) return null;
  const rounded = Math.max(0, Math.round(books));
  return `${rounded} ${rounded === 1 ? 'book' : 'books'} live`;
}

function booksCountLabel(books: number | null | undefined) {
  if (books == null || Number.isNaN(books)) return null;
  const rounded = Math.max(0, Math.round(books));
  return `${rounded} ${rounded === 1 ? 'book' : 'books'}`;
}

function gapRead(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return '-';
  if (Math.abs(value) < 0.05) return 'On line';
  return `${n(Math.abs(value), digits)} ${value > 0 ? 'above' : 'below'}`;
}

function gapNote(view: Pick<View, 'live' | 'fair'>) {
  if (view.live != null) return 'Projection vs live line';
  if (view.fair != null) return 'Projection vs fair line';
  return 'Projection vs current basis';
}

function conciseLeadReason(
  view: Pick<View, 'edge' | 'live' | 'fair' | 'proj' | 'books'>,
  fallback?: string | null,
) {
  if (view.live != null && view.edge != null) {
    const coverage = booksCountLabel(view.books);
    return `Projection is ${gapRead(view.edge)} the live line${coverage ? ` across ${coverage}` : ''}.`;
  }
  if (view.proj != null && view.fair != null) {
    const fairGap = Number((view.proj - view.fair).toFixed(1));
    if (Math.abs(fairGap) < 0.05) return 'Projection is right on the board fair line.';
    return `Projection is ${gapRead(fairGap)} the board fair line.`;
  }
  return firstSentence(fallback) ?? 'The live number is playable while the rest of the board context catches up.';
}

function recommendationHeadline(view: Pick<View, 'side' | 'live' | 'fair' | 'label'>) {
  const line = view.live ?? view.fair;
  if (view.side === 'NEUTRAL') {
    return line == null ? `${view.label} waiting for line` : `${view.label} ${n(line)}`;
  }
  return line == null ? `${view.side} ${view.label}` : `${view.side} ${n(line)} ${view.label}`;
}

function recommendationDetail(view: Pick<View, 'live' | 'fair' | 'books' | 'note'>) {
  if (view.live != null) {
    return booksLiveLabel(view.books) ?? 'Consensus live line';
  }
  if (view.fair != null) {
    return `Model fair line ${n(view.fair)} until live books land`;
  }
  return view.note;
}

function signalTokenLabel(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function selectorFamilyLabel(value: string | null | undefined) {
  return signalTokenLabel(value);
}

function selectorTierLabel(value: string | null | undefined) {
  return signalTokenLabel(value);
}

function feedReason(event: SnapshotBoardFeedItem) {
  return event.detail;
}

function feedEventTitle(event: SnapshotBoardFeedItem) {
  return event.title;
}

function feedBucketLabel(timestamp: string | null, now: number) {
  const minutes = minutesSince(timestamp, now);
  if (minutes == null) return 'Earlier';
  if (minutes < 5) return 'Now';
  if (minutes < 15) return 'Last 15 min';
  return 'Earlier';
}

function feedStatusLabel(event: Pick<SnapshotBoardFeedItem, 'status'>) {
  if (event.status === 'LOCKED') return 'Locked at tipoff';
  if (event.status === 'FINAL') return 'Final';
  return 'Pregame';
}

function feedStatusTone(event: Pick<SnapshotBoardFeedItem, 'status'>): 'amber' | 'cyan' {
  return event.status === 'PREGAME' ? 'amber' : 'cyan';
}

function CompactMetric({
  label,
  value,
  compact = false,
  className = '',
}: {
  label: string;
  value: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`border border-[var(--border)] bg-[var(--surface-2)] ${
        compact
          ? 'rounded-xl px-2.5 py-2 md:rounded-xl md:px-3 md:py-2.5'
          : 'rounded-xl px-3 py-2.5 md:rounded-2xl md:py-3'
      } ${className}`}
    >
      <div className={`uppercase tracking-[0.16em] text-[var(--muted)] ${compact ? 'text-[8px] md:text-[9px]' : 'text-[9px] md:text-[10px]'}`}>{label}</div>
      <div className={`mt-1 font-semibold tracking-tight text-[var(--text)] ${compact ? 'text-sm md:text-base' : 'text-base md:text-lg'}`}>{value}</div>
    </div>
  );
}

function RecommendationBox({
  view,
  title = 'Recommendation',
  align = 'left',
  className = '',
  size = 'default',
}: {
  view: Pick<View, 'side' | 'sideKind' | 'live' | 'fair' | 'books' | 'label' | 'note'>;
  title?: string;
  align?: 'left' | 'right';
  className?: string;
  size?: 'default' | 'hero' | 'compact';
}) {
  const detail = recommendationDetail(view);
  const boxSizeClass =
    size === 'hero'
      ? 'rounded-[20px] px-4 py-2.5 sm:rounded-[24px] sm:px-[18px] sm:py-3.5'
      : size === 'compact'
        ? 'rounded-[16px] px-3 py-2.5 sm:rounded-[18px] sm:px-3.5 sm:py-3'
        : 'rounded-[18px] px-3.5 py-3 sm:rounded-[22px] sm:px-4 sm:py-3';
  const titleClass = size === 'hero' ? 'text-[10px] tracking-[0.18em]' : 'text-[10px] tracking-[0.18em]';
  const headlineClass =
    size === 'hero'
      ? 'mt-2 text-xl font-semibold tracking-tight sm:mt-2.5 sm:text-[2rem]'
      : size === 'compact'
        ? 'mt-2 text-base font-semibold tracking-tight sm:text-lg'
        : 'mt-2 text-base font-semibold tracking-tight sm:text-xl';
  const detailClass = size === 'hero' ? 'mt-0.5 text-xs opacity-80' : 'mt-1 text-xs opacity-80';
  const titleToneClass = size === 'hero' ? 'opacity-60' : 'opacity-75';
  return (
    <div className={`border ${boxSizeClass} ${SIDE_CLASS[view.side]} ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <div className={`${titleClass} uppercase ${titleToneClass}`}>{title}</div>
      <div className={headlineClass}>{recommendationHeadline(view)}</div>
      <div className={detailClass}>{detail}</div>
    </div>
  );
}

function BoardPulseCard({
  boardRefresh,
  featuredUpdate,
  liveLines,
  feedItems,
  strongestMarket,
  bestAlternative,
  mostActiveGame,
  booksLive,
  note,
  className = '',
}: {
  boardRefresh: string;
  featuredUpdate: string;
  liveLines: string;
  feedItems: string;
  strongestMarket: string;
  bestAlternative: string;
  mostActiveGame: string;
  booksLive: string;
  note: string;
  className?: string;
}) {
  return (
    <div className={`rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Board pulse</div>
          <h2 className="mt-2 text-lg font-semibold text-[var(--text)] sm:text-xl">What changed on the board</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-2)]">
            Freshness, live depth, and the active game context without the extra board theory up top.
          </p>
        </div>
        <Badge label="LIVE" kind="LIVE" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3">
        <CompactMetric label="Board refresh" value={boardRefresh} />
        <CompactMetric label="Featured update" value={featuredUpdate} />
        <CompactMetric label="Live lines" value={liveLines} />
        <CompactMetric label="Feed items" value={feedItems} />
      </div>
      <div className="mt-4 divide-y divide-[var(--border)]">
        <div className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="text-[var(--text-2)]">Strongest market</span>
          <span className="font-semibold text-[var(--text)] sm:text-right">{strongestMarket}</span>
        </div>
        <div className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="text-[var(--text-2)]">Best alternative</span>
          <span className="font-semibold text-[var(--text)] sm:text-right">{bestAlternative}</span>
        </div>
        <div className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="text-[var(--text-2)]">Most active game</span>
          <span className="font-semibold text-[var(--text)] sm:text-right">{mostActiveGame}</span>
        </div>
        <div className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="text-[var(--text-2)]">Avg books live</span>
          <span className="font-semibold text-[var(--text)] sm:text-right">{booksLive}</span>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3 text-sm leading-6 text-[var(--text-2)]">
        {note}
      </div>
    </div>
  );
}

type BoardResponse = { ok: true; result: SnapshotBoardViewData } | { ok: false; error: string };

type RefreshResponse =
  | {
      ok: true;
      result: {
        runId: string;
        status: 'SUCCESS' | 'PARTIAL';
        warnings: string[];
        isPublishable: boolean;
        qualityIssues: string[];
        totals: {
          games: number;
          players: number;
        };
      };
    }
  | { ok: false; error: string };

type RefreshNotice = {
  kind: Kind;
  title: string;
  detail: string;
};

function isActionableView(v: View) {
  return v.live != null || v.precision?.qualified || v.conf != null || v.edge != null || v.reasons.length > 0;
}

function compareViews(a: View, b: View) {
  return (
    b.score - a.score ||
    (b.conf ?? 0) - (a.conf ?? 0) ||
    a.market.localeCompare(b.market) ||
    a.row.playerName.localeCompare(b.row.playerName)
  );
}

function rankViews(views: View[]) {
  return views.slice().sort(compareViews);
}

function leadViewFromViews(views: View[]) {
  return views.find((view) => view.live != null) ?? views.find((view) => isActionableView(view)) ?? views[0] ?? null;
}

function viewFor(row: SnapshotDashboardRow, market: SnapshotMarket, entry: SnapshotPrecisionCardEntry | null = null): View {
  const liveSignal = signal(row, market);
  const precision = entry?.precisionSignal ?? row.precisionSignals?.[market] ?? null;
  const fair = row.modelLines[market].fairLine;
  const live = liveSignal?.marketLine ?? null;
  const proj = row.projectedTonight[market];
  const basis = live ?? fair;
  const usesComputedSide = !(precision?.qualified && precision.side !== 'NEUTRAL') && basis != null && proj != null;
  const side: SnapshotModelSide =
    precision?.qualified && precision.side !== 'NEUTRAL'
      ? precision.side
      : usesComputedSide
        ? proj > basis
          ? 'OVER'
          : proj < basis
            ? 'UNDER'
            : 'NEUTRAL'
        : liveSignal?.side ?? row.modelLines[market].modelSide;
  const usesDerivedConfidence = precision?.projectionWinProbability != null;
  const conf = usesDerivedConfidence
    ? precision.projectionWinProbability! * 100
    : precision?.historicalAccuracy ?? liveSignal?.confidence ?? null;
  const usesDerivedEdge = proj != null && basis != null;
  const edge = usesDerivedEdge ? Number((proj - basis).toFixed(1)) : precision?.projectionPriceEdge ?? null;
  const liveBooks = live != null && (liveSignal?.sportsbookCount ?? 0) > 0 ? (liveSignal?.sportsbookCount ?? null) : null;
  const reasons = [...(precision?.reasons ?? []).slice(0, 2), ...(liveSignal?.passReasons ?? []).slice(0, 2)].filter(Boolean);
  const score =
    (entry?.selectionScore ?? precision?.selectionScore ?? 0) +
    (conf ?? 0) * 0.35 +
    (edge != null ? Math.abs(edge) * 12 : 0) +
    (live != null ? 10 : 0) +
    (precision?.qualified ? 18 : 0) +
    Math.min(liveSignal?.sportsbookCount ?? 0, 6) +
    row.dataCompleteness.score * 0.08;
  return {
    row,
    market,
    label: MARKET_LABELS[market],
    live,
    fair,
    proj,
    edge,
    conf,
    books: liveBooks,
    side,
    liveKind: live != null ? 'LIVE' : 'MODEL',
    liveLineKind: live != null ? 'LIVE' : 'PLACEHOLDER',
    fairKind: fair != null ? 'MODEL' : 'PLACEHOLDER',
    projKind: proj != null ? 'MODEL' : 'PLACEHOLDER',
    edgeKind: edge != null ? (usesDerivedEdge ? 'DERIVED' : 'LIVE') : 'PLACEHOLDER',
    confKind: conf != null ? (usesDerivedConfidence ? 'DERIVED' : 'LIVE') : 'PLACEHOLDER',
    booksKind: liveBooks != null ? 'LIVE' : 'PLACEHOLDER',
    sideKind: usesComputedSide ? 'DERIVED' : 'LIVE',
    rank: entry ? `#${entry.rank}` : null,
    source: entry ? `Precision rank #${entry.rank}` : live != null ? 'Live consensus' : fair != null ? 'Fair line only' : 'No line yet',
    note: live != null ? `${liveBooks ?? 0} books live` : fair != null ? 'Fair line only until live consensus lands' : 'No market line available yet',
    score,
    reasons,
    precision,
  };
}

function lineList(values: number[]) {
  return values.length ? values.map((v) => n(v, 0)).join('  | ') : '-';
}

function trendRead(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return 'Recent-versus-season trend is not available yet.';
  if (value >= 1.5) return `Running clearly above season baseline at ${signed(value, 1)}.`;
  if (value <= -1.5) return `Running clearly below season baseline at ${signed(value, 1)}.`;
  if (value > 0.4) return `Running modestly above season baseline at ${signed(value, 1)}.`;
  if (value < -0.4) return `Running modestly below season baseline at ${signed(value, 1)}.`;
  return 'Tracking close to season baseline right now.';
}

function marketRead(view: View) {
  if (view.live != null && view.edge != null) {
    return `${view.side} ${signed(view.edge)} vs live`;
  }
  if (view.proj != null && view.fair != null) {
    return `${view.side} ${signed(view.proj - view.fair)} vs fair`;
  }
  if (view.live != null) {
    return `Live ${n(view.live)}`;
  }
  return 'Waiting for pricing context';
}

function formatRecord(wins: number, losses: number) {
  return `${wins}-${losses}`;
}

function playerSearchKey(row: SnapshotDashboardRow) {
  return [row.playerName, row.teamCode, row.opponentCode, row.matchupKey, row.position ?? '', row.gameTimeEt].join(' ').toLowerCase();
}

function slugifyParam(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseViewParam(value: string | null): ViewKey {
  if (value === 'players' || value === 'feed' || value === 'lines' || value === 'method') return value;
  return 'overview';
}

function viewKeepsPlayerParam(view: ViewKey) {
  return view === 'players';
}

function viewKeepsMatchupParam(view: ViewKey) {
  return view !== 'method';
}

function buildRefreshNotice(result: Extract<RefreshResponse, { ok: true }>['result'], refreshedAt: string | null): RefreshNotice {
  const totals = `${n(result.totals.games, 0)} games | ${n(result.totals.players, 0)} players`;
  const boardTime = refreshedAt ? `Board updated ${ts(refreshedAt)}` : null;
  const detailParts = [totals, boardTime, result.warnings[0] ?? null].filter(Boolean);
  return {
    kind: result.status === 'SUCCESS' && result.isPublishable ? 'LIVE' : 'DERIVED',
    title: result.status === 'SUCCESS' ? 'Slate refresh completed' : 'Slate refresh returned partial data',
    detail: detailParts.join(' | '),
  };
}

export default function NewDashboard({ data: initialData }: { data: SnapshotBoardViewData }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<Tab>('precision');
  const [headerView, setHeaderView] = useState<ViewKey>('overview');
  const [pickedPlayer, setPickedPlayer] = useState<string | null>(null);
  const [pinnedMatchupKey, setPinnedMatchupKey] = useState<string | null>(null);
  const [selectedMatchupKey, setSelectedMatchupKey] = useState<string | null>(initialData.matchups[0]?.key ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [urlReady, setUrlReady] = useState(false);
  const [highlightTarget, setHighlightTarget] = useState<HighlightTarget>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const overviewRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const matchupExplorerRef = useRef<HTMLElement | null>(null);
  const helpRef = useRef<HTMLDivElement | null>(null);
  const researchDossierRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasParsedUrlRef = useRef(false);
  const pendingUrlSearchRef = useRef<string | null>(null);
  const urlNavigationModeRef = useRef<'push' | 'replace'>('replace');
  const highlightTimeoutRef = useRef<number | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current != null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const rowById = useMemo(() => new Map(data.rows.map((row) => [row.playerId, row] as const)), [data.rows]);
  const precision = useMemo(
    () =>
      (data.precisionCard ?? [])
        .map((entry) => {
          const row = rowById.get(entry.playerId);
          return row ? { entry, row, view: viewFor(row, entry.market, entry) } : null;
        })
        .filter((x): x is { entry: SnapshotPrecisionCardEntry; row: SnapshotDashboardRow; view: View } => x !== null)
        .sort((a, b) => a.entry.rank - b.entry.rank || (b.entry.selectionScore ?? 0) - (a.entry.selectionScore ?? 0)),
    [data.precisionCard, rowById],
  );
  const allViews = useMemo(() => data.rows.flatMap((row) => MARKETS.map((market) => viewFor(row, market))), [data.rows]);
  const featured = useMemo(() => {
    const lead = precision[0]?.view;
    if (lead) return lead;
    return (
      allViews
        .filter((v) => v.live != null || v.precision?.qualified || v.conf != null || v.edge != null)
        .sort((a, b) => b.score - a.score || (b.conf ?? 0) - (a.conf ?? 0) || a.row.playerName.localeCompare(b.row.playerName))[0] ?? null
    );
  }, [allViews, precision]);
  const slatePlayers = useMemo(() => {
    const ids = new Set<string>();
    const out: SnapshotDashboardRow[] = [];
    precision.forEach(({ row }) => {
      if (!ids.has(row.playerId)) {
        ids.add(row.playerId);
        out.push(row);
      }
    });
    data.rows
      .slice()
      .sort((a, b) => b.dataCompleteness.score - a.dataCompleteness.score || a.playerName.localeCompare(b.playerName))
      .forEach((row) => {
        if (!ids.has(row.playerId)) {
          ids.add(row.playerId);
          out.push(row);
        }
      });
    return out;
  }, [data.rows, precision]);
  const researchRows = useMemo(() => slatePlayers.slice(0, 6), [slatePlayers]);
  const searchResults = useMemo(() => {
    if (!deferredSearchQuery) return [];
    return slatePlayers.filter((row) => playerSearchKey(row).includes(deferredSearchQuery));
  }, [deferredSearchQuery, slatePlayers]);
  const headerPlayerResults = useMemo(() => searchResults.slice(0, 5), [searchResults]);
  const headerMatchupResults = useMemo(() => {
    if (!deferredSearchQuery) return [] as SnapshotBoardViewData['matchups'];
    return data.matchups
      .filter((matchup) =>
        [matchup.label, matchup.key, matchup.gameTimeEt]
          .join(' ')
          .toLowerCase()
          .includes(deferredSearchQuery),
      )
      .slice(0, 4);
  }, [data.matchups, deferredSearchQuery]);
  const hasActiveSearch = deferredSearchQuery.length > 0;
  const researchListRows = deferredSearchQuery ? searchResults : researchRows;
  const searchLeadRow = deferredSearchQuery ? searchResults[0] ?? null : null;
  const searchPickedRow = useMemo(
    () => (hasActiveSearch && pickedPlayer ? searchResults.find((row) => row.playerId === pickedPlayer) ?? null : null),
    [hasActiveSearch, pickedPlayer, searchResults],
  );
  const researchRow = useMemo(
    () =>
      hasActiveSearch
        ? searchPickedRow ?? searchLeadRow ?? null
        : pickedPlayer
          ? rowById.get(pickedPlayer) ?? null
          : featured?.row ?? researchRows[0] ?? null,
    [featured?.row, hasActiveSearch, pickedPlayer, researchRows, rowById, searchLeadRow, searchPickedRow],
  );
  const researchListCards = useMemo(
    () =>
      researchListRows.map((row) => {
        const views = rankViews(MARKETS.map((market) => viewFor(row, market)));
        return {
          row,
          leadView: leadViewFromViews(views),
        };
      }),
    [researchListRows],
  );
  const researchViews = useMemo(
    () => (researchRow ? rankViews(MARKETS.map((market) => viewFor(researchRow, market))) : []),
    [researchRow],
  );
  const researchLiveViews = useMemo(() => researchViews.filter((view) => view.live != null), [researchViews]);
  const researchLeadView = useMemo(() => leadViewFromViews(researchViews), [researchViews]);
  const researchTopPrecision = useMemo(
    () => (researchRow ? precision.find((item) => item.row.playerId === researchRow.playerId) ?? null : null),
    [precision, researchRow],
  );
  const teamMatchup = useMemo(
    () => (researchRow ? data.teamMatchups.find((m) => m.matchupKey === researchRow.matchupKey) ?? null : null),
    [data.teamMatchups, researchRow],
  );
  const scoutViews = useMemo(
    () => allViews.filter((v) => isActionableView(v)).sort((a, b) => b.score - a.score).slice(0, 8),
    [allViews],
  );
  const trackViews = useMemo(
    () => allViews.filter((v) => v.live != null || v.fair != null || v.edge != null).sort((a, b) => Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0) || b.score - a.score).slice(0, 8),
    [allViews],
  );
  const selectedMatchup = useMemo(
    () => (selectedMatchupKey ? data.matchups.find((m) => m.key === selectedMatchupKey) ?? null : null),
    [data.matchups, selectedMatchupKey],
  );
  const selectedMatchupRows = useMemo(
    () => (selectedMatchupKey ? data.rows.filter((row) => row.matchupKey === selectedMatchupKey) : []),
    [data.rows, selectedMatchupKey],
  );
  const selectedMatchupTeamStats = useMemo(
    () => (selectedMatchupKey ? data.teamMatchups.find((m) => m.matchupKey === selectedMatchupKey) ?? null : null),
    [data.teamMatchups, selectedMatchupKey],
  );
  const matchupLabelByKey = useMemo(() => new Map(data.matchups.map((m) => [m.key, m.label] as const)), [data.matchups]);
  const playerByParam = useMemo(() => {
    const map = new Map<string, SnapshotDashboardRow>();
    slatePlayers.forEach((row) => {
      map.set(slugifyParam(row.playerName), row);
      map.set(row.playerId, row);
    });
    return map;
  }, [slatePlayers]);
  const matchupByParam = useMemo(() => {
    const map = new Map<string, SnapshotBoardViewData['matchups'][number]>();
    data.matchups.forEach((matchupItem) => {
      map.set(matchupItem.key, matchupItem);
      map.set(slugifyParam(matchupItem.key), matchupItem);
      map.set(slugifyParam(matchupItem.label), matchupItem);
    });
    return map;
  }, [data.matchups]);
  const selectedMatchupViews = useMemo(
    () =>
      rankViews(allViews.filter((v) => v.row.matchupKey === selectedMatchupKey && isActionableView(v))),
    [allViews, selectedMatchupKey],
  );
  const matchupBestSpots = useMemo(() => {
    const seenPlayers = new Set<string>();
    const spots: View[] = [];
    for (const view of selectedMatchupViews) {
      if (seenPlayers.has(view.row.playerId)) continue;
      seenPlayers.add(view.row.playerId);
      spots.push(view);
      if (spots.length === 5) break;
    }
    return spots;
  }, [selectedMatchupViews]);
  const precisionMarketMix = useMemo(() => {
    const counts = new Map<SnapshotMarket, number>();
    precision.forEach(({ view }) => {
      counts.set(view.market, (counts.get(view.market) ?? 0) + 1);
    });
    return MARKETS.map((market) => ({ market, count: counts.get(market) ?? 0 }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.market.localeCompare(b.market));
  }, [precision]);
  const precisionMatchupMix = useMemo(() => {
    const counts = new Map<string, number>();
    precision.forEach(({ row }) => {
      counts.set(row.matchupKey, (counts.get(row.matchupKey) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([matchupKey, count]) => ({
        matchupKey,
        count,
        label: matchupLabelByKey.get(matchupKey) ?? matchupKey.replace('@', ' @ '),
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [matchupLabelByKey, precision]);
  const matchupLiveCount = selectedMatchupViews.filter((v) => v.live != null).length;
  const matchupQualifiedCount = selectedMatchupViews.filter((v) => v.precision?.qualified).length;
  const liveCount = allViews.filter((v) => v.live != null).length;
  const qualifiedCount = allViews.filter((v) => v.precision?.qualified).length;
  const target = data.precisionSystem?.targetCardCount ?? data.precisionCardSummary?.targetCardCount ?? precision.length;
  const selected = data.precisionCardSummary?.selectedCount ?? precision.length;
  const gap = Math.max(target - selected, 0);
  const hasBoardRows = data.rows.length > 0;
  const featuredUpdatedAt = featured?.row.gameIntel.generatedAt ?? data.lastUpdatedAt ?? null;
  const boardRefreshRelative = relativeTime(data.lastUpdatedAt, now);
  const selectedMatchupLead = matchupBestSpots[0] ?? null;
  const selectedMatchupFocusMarket = selectedMatchupLead?.market ?? selectedMatchupViews[0]?.market ?? null;
  const selectedMatchupFocusLabel = selectedMatchupFocusMarket ? MARKET_LABELS[selectedMatchupFocusMarket] : null;
  const selectedMatchupAwayOffense = selectedMatchupTeamStats && selectedMatchupFocusMarket
    ? selectedMatchupTeamStats.awayLast10For[selectedMatchupFocusMarket]
    : null;
  const selectedMatchupHomeOffense = selectedMatchupTeamStats && selectedMatchupFocusMarket
    ? selectedMatchupTeamStats.homeLast10For[selectedMatchupFocusMarket]
    : null;
  const selectedMatchupAwayAllowed = selectedMatchupTeamStats && selectedMatchupFocusMarket
    ? selectedMatchupTeamStats.awayLast10Allowed[selectedMatchupFocusMarket]
    : null;
  const selectedMatchupHomeAllowed = selectedMatchupTeamStats && selectedMatchupFocusMarket
    ? selectedMatchupTeamStats.homeLast10Allowed[selectedMatchupFocusMarket]
    : null;
  const boardModelNote = firstSentence(data.universalSystem?.note);
  const featuredMarketAverageLast10 = featured ? featured.row.last10Average[featured.market] : null;
  const featuredMarketAverageSeason = featured ? featured.row.seasonAverage[featured.market] : null;
  const featuredMarketTrend = featured ? featured.row.trendVsSeason[featured.market] : null;
  const featuredMarketOpponentDelta = featured ? featured.row.opponentAllowanceDelta[featured.market] : null;
  const featuredRecentValues = featured ? featured.row.last5[featured.market].slice(-5) : [];
  const featuredRecentAverage = featuredRecentValues.length
    ? featuredRecentValues.reduce((sum, value) => sum + value, 0) / featuredRecentValues.length
    : null;
  const researchLeadTrend = researchRow && researchLeadView ? researchRow.trendVsSeason[researchLeadView.market] : null;
  const researchLeadOpponentDelta = researchRow && researchLeadView ? researchRow.opponentAllowanceDelta[researchLeadView.market] : null;
  const researchLeadRecentFive = researchRow && researchLeadView ? lineList(researchRow.last5[researchLeadView.market]) : '-';
  const researchMinutesBandWidth =
    researchRow?.playerContext.projectedMinutesFloor != null && researchRow.playerContext.projectedMinutesCeiling != null
      ? Number((researchRow.playerContext.projectedMinutesCeiling - researchRow.playerContext.projectedMinutesFloor).toFixed(1))
      : null;
  const researchTeamMarketLast10 = teamMatchup && researchRow && researchLeadView
    ? teamMatchup.awayTeam === researchRow.teamCode
      ? teamMatchup.awayLast10For[researchLeadView.market]
      : teamMatchup.homeLast10For[researchLeadView.market]
    : null;
  const researchOpponentMarketAllowedLast10 = teamMatchup && researchRow && researchLeadView
    ? teamMatchup.awayTeam === researchRow.teamCode
      ? teamMatchup.homeLast10Allowed[researchLeadView.market]
      : teamMatchup.awayLast10Allowed[researchLeadView.market]
    : null;
  const researchSeasonRecord = teamMatchup && researchRow
    ? teamMatchup.awayTeam === researchRow.teamCode
      ? formatRecord(teamMatchup.awaySeasonRecord.wins, teamMatchup.awaySeasonRecord.losses)
      : formatRecord(teamMatchup.homeSeasonRecord.wins, teamMatchup.homeSeasonRecord.losses)
    : null;
  const researchLast10Record = teamMatchup && researchRow
    ? teamMatchup.awayTeam === researchRow.teamCode
      ? formatRecord(teamMatchup.awayLast10Record.wins, teamMatchup.awayLast10Record.losses)
      : formatRecord(teamMatchup.homeLast10Record.wins, teamMatchup.homeLast10Record.losses)
    : null;
  const boardPulseNote =
    refreshNotice?.detail ??
    (featured
      ? `${recommendationHeadline(featured)} is leading the board across ${n(liveCount, 0)} live lines and ${n(data.matchups.length, 0)} games.`
      : `${n(liveCount, 0)} live lines are active across ${n(data.matchups.length, 0)} games right now.`);
  const researchWhyInteresting = useMemo(() => {
    if (!researchRow || !researchLeadView) {
      return 'Select a player and the board will explain why that slate row is worth a deeper look.';
    }

    const projectionSentence =
      researchLeadView.live != null && researchLeadView.edge != null
        ? `${researchLeadView.label} projects ${signed(researchLeadView.edge)} versus the live ${n(researchLeadView.live)} line, with the board fair line at ${n(researchLeadView.fair)} and projection at ${n(researchLeadView.proj)}.`
        : researchLeadView.proj != null && researchLeadView.fair != null
          ? `No live consensus ${researchLeadView.label} line is in the payload, so the board is comparing projection ${n(researchLeadView.proj)} to the fair line at ${n(researchLeadView.fair)}.`
          : `${researchLeadView.label} currently leads this dossier, but the board does not yet have a clean projection-versus-line gap to lean on.`;

    const trendSentence =
      researchLeadTrend == null
        ? `Recent-versus-season form for ${researchLeadView.label} is still incomplete.`
        : `${researchLeadView.label} form is ${signed(researchLeadTrend, 1)} versus season baseline across the current board sample.`;

    const matchupSentence =
      researchLeadOpponentDelta == null
        ? 'Opponent-specific allowance context is not available for that market yet.'
        : `Opponent context is ${signed(researchLeadOpponentDelta, 1)} for ${researchLeadView.label}, which helps frame the current lean without guaranteeing it.`;

    return `${researchRow.playerName} is interesting because ${projectionSentence} ${trendSentence} ${matchupSentence}`;
  }, [researchLeadOpponentDelta, researchLeadTrend, researchLeadView, researchRow]);
  const researchModelVsLineExplanation = useMemo(() => {
    if (!researchLeadView) {
      return 'No lead market is available yet, so the dossier cannot compare the model to the board.';
    }

    if (researchLeadView.live != null && researchLeadView.proj != null) {
      const fairGap =
        researchLeadView.fair != null ? Number((researchLeadView.proj - researchLeadView.fair).toFixed(1)) : null;
      return `${researchLeadView.label} is the lead angle because projection ${n(researchLeadView.proj)} sits ${signed(researchLeadView.edge, 1)} versus the live market at ${n(researchLeadView.live)}${fairGap == null ? '.' : ` and ${signed(fairGap, 1)} versus the board fair line.`}`;
    }

    if (researchLeadView.proj != null && researchLeadView.fair != null) {
      return `${researchLeadView.label} does not have a live consensus line right now, so the board is leaning on projection ${n(researchLeadView.proj)} versus fair line ${n(researchLeadView.fair)} for the current read.`;
    }

    return `${researchLeadView.label} is still the lead market in this dossier, but the payload is missing enough pricing context to state a cleaner model-versus-line gap.`;
  }, [researchLeadView]);
  const researchSupportDrivers = useMemo(() => {
    if (!researchRow || !researchLeadView) return [] as string[];

    const drivers: string[] = [];
    const precisionReason = researchTopPrecision?.entry.precisionSignal?.reasons?.[0];
    if (researchLeadView.live != null && researchLeadView.edge != null) {
      drivers.push(`${researchLeadView.label} is ${signed(researchLeadView.edge, 1)} away from the live board price.`);
    }
    if (researchLeadView.precision?.qualified) {
      drivers.push(
        `${researchLeadView.label} is precision-qualified${researchLeadView.precision.selectorFamily ? ` through ${researchLeadView.precision.selectorFamily}` : ''}.`,
      );
    }
    if (precisionReason) {
      drivers.push(precisionReason);
    }
    if (researchLeadView.books != null && researchLeadView.books >= 4) {
      drivers.push(`${n(researchLeadView.books, 0)} books are contributing to the live consensus line.`);
    }
    if (researchRow.playerContext.projectedMinutes != null) {
      drivers.push(
        `${n(researchRow.playerContext.projectedMinutes, 1)} projected minutes keep the role relevant to the slate read.`,
      );
    }
    if (researchLeadTrend != null && Math.abs(researchLeadTrend) >= 1) {
      drivers.push(`${researchLeadView.label} recent form is ${signed(researchLeadTrend, 1)} versus season baseline.`);
    }
    if (researchLeadOpponentDelta != null && Math.abs(researchLeadOpponentDelta) >= 1) {
      drivers.push(`Opponent context is ${signed(researchLeadOpponentDelta, 1)} for ${researchLeadView.label}.`);
    }

    return drivers.slice(0, 4);
  }, [researchLeadOpponentDelta, researchLeadTrend, researchLeadView, researchRow, researchTopPrecision]);
  const researchCautionDrivers = useMemo(() => {
    if (!researchRow || !researchLeadView) return [] as string[];

    const cautions: string[] = [];
    if (researchLeadView.live == null) {
      cautions.push(`No live consensus ${researchLeadView.label} line is in the payload yet.`);
    }
    if (researchLeadView.books != null && researchLeadView.books > 0 && researchLeadView.books < 3) {
      cautions.push(`Live market depth is thin at ${n(researchLeadView.books, 0)} books.`);
    }
    if (!researchLeadView.precision?.qualified) {
      cautions.push(`${researchLeadView.label} is not precision-qualified right now, so this is a board read rather than a promoted card spot.`);
    }
    if (researchRow.dataCompleteness.score < 70) {
      cautions.push(`Data completeness is only ${pct(researchRow.dataCompleteness.score, 0)} (${researchRow.dataCompleteness.tier}).`);
    }
    if (researchRow.playerContext.lineupStatus == null) {
      cautions.push('Lineup status is not in the payload yet.');
    }
    if (researchMinutesBandWidth != null && researchMinutesBandWidth >= 6) {
      cautions.push(
        `Minutes range is wide at ${n(researchRow.playerContext.projectedMinutesFloor, 1)} to ${n(researchRow.playerContext.projectedMinutesCeiling, 1)}.`,
      );
    }
    if (researchRow.playerContext.minutesVolatility != null && researchRow.playerContext.minutesVolatility >= 4) {
      cautions.push(`Minutes volatility is elevated at ${n(researchRow.playerContext.minutesVolatility, 1)}.`);
    }

    return cautions.slice(0, 4);
  }, [researchLeadView, researchMinutesBandWidth, researchRow]);
  const researchRecentReads = useMemo<ResearchRecentRead[]>(() => {
    if (!researchRow) return [];

    return researchViews.map<ResearchRecentRead>((view) => {
      const recentAverage = researchRow.last10Average[view.market];
      const seasonAverage = researchRow.seasonAverage[view.market];
      const trend = researchRow.trendVsSeason[view.market];
      const opponentDelta = researchRow.opponentAllowanceDelta[view.market];
      return {
        view,
        recentAverage,
        seasonAverage,
        trend,
        opponentDelta,
        recentFive: lineList(researchRow.last5[view.market]),
        note: trendRead(trend),
        kind:
          recentAverage == null || seasonAverage == null
            ? ('PLACEHOLDER' as Kind)
            : Math.abs(trend ?? 0) >= 0.5
              ? ('DERIVED' as Kind)
              : ('LIVE' as Kind),
      };
    });
  }, [researchViews, researchRow]);
  const researchMatchupRead = useMemo(() => {
    if (!researchRow || !researchLeadView) {
      return 'Select a player to see matchup interpretation.';
    }

    const offenseSentence =
      researchTeamMarketLast10 == null
        ? `${researchRow.teamCode} recent ${researchLeadView.label} offense is not available in the team summary yet.`
        : `${researchRow.teamCode} has produced ${n(researchTeamMarketLast10, 1)} ${researchLeadView.label} on its last-10 team sample.`;
    const defenseSentence =
      researchOpponentMarketAllowedLast10 == null
        ? `${researchRow.opponentCode} defensive allowance for ${researchLeadView.label} is not available yet.`
        : `${researchRow.opponentCode} has allowed ${n(researchOpponentMarketAllowedLast10, 1)} ${researchLeadView.label} on its last-10 defensive sample.`;
    const deltaSentence =
      researchLeadOpponentDelta == null
        ? `The board does not carry an opponent delta for ${researchLeadView.label} here.`
        : `Board opponent delta is ${signed(researchLeadOpponentDelta, 1)} for ${researchLeadView.label}.`;
    const defenderSentence = researchRow.playerContext.primaryDefender?.matchupReason
      ? `Primary defender note: ${researchRow.playerContext.primaryDefender.matchupReason}`
      : 'No primary defender note is available in the current payload.';

    return `${offenseSentence} ${defenseSentence} ${deltaSentence} ${defenderSentence}`;
  }, [
    researchLeadOpponentDelta,
    researchLeadView,
    researchOpponentMarketAllowedLast10,
    researchRow,
    researchTeamMarketLast10,
  ]);
  const tabSummary: Record<Tab, { detail: string; kind: Kind }> = {
    precision: {
      detail: precision.length ? `${n(precision.length, 0)} card item${precision.length === 1 ? '' : 's'}` : 'No card items yet',
      kind: precision.length ? 'LIVE' : 'PLACEHOLDER',
    },
    research: {
      detail: slatePlayers.length ? `${n(slatePlayers.length, 0)} slate players` : 'Slate not loaded',
      kind: slatePlayers.length ? 'LIVE' : 'PLACEHOLDER',
    },
    scout: {
      detail: scoutViews.length ? `${n(scoutViews.length, 0)} signal rows` : 'Waiting for signals',
      kind: scoutViews.length ? 'DERIVED' : 'PLACEHOLDER',
    },
    tracking: {
      detail: trackViews.length ? `${n(trackViews.length, 0)} tracked views` : 'No tracked views yet',
      kind: trackViews.length ? 'DERIVED' : 'PLACEHOLDER',
    },
  };
  const liveBookDepth = useMemo(() => {
    const liveBookViews = allViews.filter((view) => view.live != null && view.books != null);
    if (!liveBookViews.length) return null;
    return Number((liveBookViews.reduce((sum, view) => sum + (view.books ?? 0), 0) / liveBookViews.length).toFixed(1));
  }, [allViews]);
  const topOpportunities = useMemo(() => {
    const picks: View[] = [];
    const seen = new Set<string>();
    const push = (view: View | null | undefined) => {
      if (!view) return;
      const key = `${view.row.playerId}:${view.market}`;
      if (seen.has(key)) return;
      seen.add(key);
      picks.push(view);
    };

    precision.forEach(({ view }) => push(view));
    scoutViews.forEach((view) => push(view));
    selectedMatchupViews.forEach((view) => push(view));

    return picks.filter((view) => view.live != null).slice(0, 6);
  }, [precision, scoutViews, selectedMatchupViews]);
  const matchupExplorerSpots = useMemo(() => matchupBestSpots.slice(0, 3), [matchupBestSpots]);
  const boardFeedEvents = useMemo(() => data.boardFeed?.events ?? [], [data.boardFeed]);
  const liveFeedEvents = useMemo(() => boardFeedEvents.slice(0, 12), [boardFeedEvents]);
  const liveFeedBuckets = useMemo(() => {
    const grouped = new Map<string, SnapshotBoardFeedItem[]>();
    liveFeedEvents.forEach((event) => {
      const label = feedBucketLabel(event.createdAt, now);
      grouped.set(label, [...(grouped.get(label) ?? []), event]);
    });
    return ['Now', 'Last 15 min', 'Earlier']
      .map((label) => ({ label, events: grouped.get(label) ?? [] }))
      .filter((bucket) => bucket.events.length);
  }, [liveFeedEvents, now]);
  const boardFeedSummary = useMemo(() => {
    const counts = { surfaced: 0, moved: 0, locked: 0 };
    boardFeedEvents.forEach((event) => {
      if (event.eventType === 'SURFACED') counts.surfaced += 1;
      if (event.eventType === 'MOVED' || event.eventType === 'STRENGTHENED' || event.eventType === 'WEAKENED') counts.moved += 1;
      if (event.eventType === 'LOCKED') counts.locked += 1;
    });
    return counts;
  }, [boardFeedEvents]);
  const latestBoardFeedEvent = boardFeedEvents[0] ?? null;
  const featuredReasonList = useMemo(() => {
    if (!featured) return [] as string[];
    const reasons = featured.precision?.reasons?.length ? featured.precision.reasons : featured.reasons;
    return reasons.slice(0, 3);
  }, [featured]);
  const featuredLeadReason =
    (featured ? conciseLeadReason(featured, featuredReasonList[0] ?? null) : null) ??
    'The board is still waiting for a cleaner support note, but the live number is already playable.';
  const featuredWhyItMatters =
    firstSentence(featuredReasonList[0] ?? null) ??
    firstSentence(featuredLeadReason) ??
    'The board surfaced this number as one of the strongest live player-market pairs on the slate.';
  const featuredWhySupport = useMemo(() => {
    if (!featured) return null;
    const precisionLabel = selectorFamilyLabel(featured.precision?.selectorFamily);
    const tierLabel = selectorTierLabel(featured.precision?.selectorTier);
    const coverage = booksLiveLabel(featured.books);
    const parts = [
      featured.rank ? `Rank ${featured.rank}` : null,
      tierLabel ? `${tierLabel} signal` : featured.precision?.qualified ? 'Precision qualified' : null,
      precisionLabel,
      coverage,
    ].filter(Boolean);
    return parts.length ? parts.slice(0, 3).join(' · ') : null;
  }, [featured]);
  const workspaceCopy: Record<Tab, { title: string; detail: string }> = {
    precision: {
      title: 'Overview workspace',
      detail: 'Curated board picks, confidence mix, and matchup shortcuts stay grouped here.',
    },
    research: {
      title: 'Players workspace',
      detail: 'Search the active slate, then open a cleaner player dossier with line, projection, and support context first.',
    },
    scout: {
      title: 'Feed workspace',
      detail: 'The feed stays focused on live board signals and quick catalyst reads without forcing you through extra tabs.',
    },
    tracking: {
      title: 'Lines workspace',
      detail: 'Live line versus fair line stays in one comparison surface with current board context on the side.',
    },
  };
  const activeWorkspace = TABS.find((item) => item.id === tab) ?? TABS[0];
  const flashTarget = (kind: NonNullable<HighlightTarget>['kind'], key: string | null | undefined) => {
    if (!key) return;
    if (highlightTimeoutRef.current != null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    setHighlightTarget({ kind, key });
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightTarget((current) => (current?.kind === kind && current.key === key ? null : current));
      highlightTimeoutRef.current = null;
    }, 1800);
  };
  const isPlayerHighlighted = (playerId: string) => highlightTarget?.kind === 'player' && highlightTarget.key === playerId;
  const isMatchupHighlighted = (matchupKey: string) => highlightTarget?.kind === 'matchup' && highlightTarget.key === matchupKey;
  const scrollToSection = (
    ref: React.RefObject<HTMLElement | null>,
    behavior: ScrollBehavior = 'smooth',
    focusRef?: React.RefObject<HTMLElement | null>,
  ) => {
    window.setTimeout(() => {
      const element = ref.current;
      if (!element) return;
      const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
      const top = Math.max(0, window.scrollY + element.getBoundingClientRect().top - headerHeight - 12);
      window.scrollTo({ top, behavior });
      const focusTarget = focusRef?.current ?? element;
      const focusDelay = behavior === 'smooth' ? 220 : 0;
      window.setTimeout(() => focusTarget?.focus({ preventScroll: true }), focusDelay);
    }, 0);
  };
  const scrollToView = (nextView: ViewKey, options?: { behavior?: ScrollBehavior; matchupKey?: string | null }) => {
    const behavior = options?.behavior ?? 'smooth';
    if (nextView === 'method') {
      scrollToSection(helpRef, behavior);
      return;
    }
    if (nextView === 'overview' && options?.matchupKey) {
      scrollToSection(matchupExplorerRef, behavior);
      return;
    }
    if (nextView === 'players') {
      scrollToSection(workspaceRef, behavior, researchDossierRef);
      return;
    }
    scrollToSection(nextView === 'overview' ? overviewRef : workspaceRef, behavior);
  };
  const setMatchupSelection = (matchupKey: string, options?: { pin?: boolean; highlight?: boolean }) => {
    urlNavigationModeRef.current = 'push';
    setSelectedMatchupKey(matchupKey);
    if (options?.pin !== false) {
      setPinnedMatchupKey(matchupKey);
    }
    if (options?.highlight) {
      flashTarget('matchup', matchupKey);
    }
  };
  const activateTab = (nextTab: Tab) => {
    urlNavigationModeRef.current = 'push';
    setHeaderSearchOpen(false);
    setHeaderView(TAB_TO_VIEW[nextTab]);
    setTab(nextTab);
    scrollToView(TAB_TO_VIEW[nextTab]);
  };
  const openHelp = () => {
    urlNavigationModeRef.current = 'push';
    setHeaderSearchOpen(false);
    setHeaderView('method');
    scrollToView('method');
  };
  const openResearchSearch = () => {
    urlNavigationModeRef.current = 'push';
    setHeaderView('players');
    setTab('research');
    setHeaderSearchOpen(false);
    scrollToSection(workspaceRef, 'smooth');
    window.setTimeout(() => searchInputRef.current?.focus(), 220);
  };
  const setResearch = (playerId: string, options?: { scroll?: boolean }) => {
    urlNavigationModeRef.current = 'push';
    const row = rowById.get(playerId);
    if (row?.matchupKey) {
      setMatchupSelection(row.matchupKey, { highlight: false });
    }
    setPickedPlayer(playerId);
    setHeaderView('players');
    setTab('research');
    setHeaderSearchOpen(false);
    flashTarget('player', playerId);
    if (options?.scroll !== false) {
      scrollToView('players');
    }
  };
  const openMatchup = (matchupKey: string) => {
    urlNavigationModeRef.current = 'push';
    setMatchupSelection(matchupKey, { highlight: true });
    setHeaderView('overview');
    setTab('precision');
    setHeaderSearchOpen(false);
    scrollToView('overview', { matchupKey });
  };
  const commitHeaderSearch = () => {
    if (headerPlayerResults[0]) {
      setSearchQuery(headerPlayerResults[0].playerName);
      setResearch(headerPlayerResults[0].playerId);
      return;
    }
    if (headerMatchupResults[0]) {
      setSearchQuery(headerMatchupResults[0].label);
      openMatchup(headerMatchupResults[0].key);
      return;
    }
    activateTab('research');
  };

  useEffect(() => {
    const currentSearch = searchParams.toString();
    const nextView = parseViewParam(searchParams.get('view'));
    const nextTab = VIEW_TO_TAB[nextView];
    const nextPlayer = searchParams.get('player');
    const nextMatchup = searchParams.get('matchup');
    const matchedPlayer = nextPlayer ? playerByParam.get(nextPlayer) ?? null : null;
    const matchedMatchup = nextMatchup ? matchupByParam.get(nextMatchup) ?? null : null;
    const keepPlayer = viewKeepsPlayerParam(nextView);
    const keepMatchup = viewKeepsMatchupParam(nextView);
    const nextPickedPlayer = keepPlayer ? matchedPlayer?.playerId ?? null : null;
    const nextPinnedMatchupKey = keepMatchup
      ? matchedMatchup?.key ?? (keepPlayer ? matchedPlayer?.matchupKey ?? null : null)
      : null;
    const nextSelectedMatchupKey = nextPinnedMatchupKey;
    const isInternalUrlUpdate = pendingUrlSearchRef.current === currentSearch;

    setHeaderSearchOpen(false);
    setHeaderView(nextView);
    if (nextTab) {
      setTab(nextTab);
    }
    setPickedPlayer(nextPickedPlayer);
    setPinnedMatchupKey(nextPinnedMatchupKey);
    setSelectedMatchupKey(nextSelectedMatchupKey);
    setUrlReady(true);
    if (isInternalUrlUpdate) {
      pendingUrlSearchRef.current = null;
      hasParsedUrlRef.current = true;
      return;
    }
    const behavior: ScrollBehavior = hasParsedUrlRef.current ? 'smooth' : 'auto';
    hasParsedUrlRef.current = true;
    if (nextPickedPlayer) {
      flashTarget('player', nextPickedPlayer);
    } else if (nextSelectedMatchupKey) {
      flashTarget('matchup', nextSelectedMatchupKey);
    }
    if (currentSearch.length === 0 && nextView === 'overview') {
      return;
    }
    if (nextView === 'method') {
      scrollToSection(helpRef, behavior);
      return;
    }
    if (nextView === 'overview' && nextSelectedMatchupKey) {
      scrollToSection(matchupExplorerRef, behavior);
      return;
    }
    if (nextView === 'players') {
      scrollToSection(workspaceRef, behavior, researchDossierRef);
      return;
    }
    scrollToSection(nextView === 'overview' ? overviewRef : workspaceRef, behavior);
  }, [matchupByParam, playerByParam, searchParams]);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams();
    const encodedPlayer = pickedPlayer ? rowById.get(pickedPlayer) : null;
    const encodedMatchup = pinnedMatchupKey ? matchupByParam.get(pinnedMatchupKey) ?? null : null;
    const keepPlayer = viewKeepsPlayerParam(headerView);
    const keepMatchup = viewKeepsMatchupParam(headerView);

    if (headerView !== 'overview' || (keepPlayer && encodedPlayer) || (keepMatchup && encodedMatchup)) {
      params.set('view', headerView);
    }
    if (keepPlayer && encodedPlayer) {
      params.set('player', slugifyParam(encodedPlayer.playerName));
    }
    if (keepMatchup && encodedMatchup) {
      params.set('matchup', slugifyParam(encodedMatchup.key));
    }

    const nextSearch = params.toString();
    const currentSearch = searchParams.toString();
    if (nextSearch === currentSearch) return;
    pendingUrlSearchRef.current = nextSearch;
    const navigationMode = urlNavigationModeRef.current;
    urlNavigationModeRef.current = 'replace';
    startTransition(() => {
      const href = nextSearch ? `${pathname}?${nextSearch}` : pathname;
      if (navigationMode === 'push') {
        router.push(href, { scroll: false });
        return;
      }
      router.replace(href, { scroll: false });
    });
  }, [headerView, matchupByParam, pathname, pickedPlayer, pinnedMatchupKey, rowById, router, searchParams, urlReady]);

  useEffect(() => {
    if (pickedPlayer && !rowById.has(pickedPlayer)) {
      setPickedPlayer(null);
    }
  }, [pickedPlayer, rowById]);

  useEffect(() => {
    if (data.matchups.length === 0) {
      if (selectedMatchupKey != null) {
        setSelectedMatchupKey(null);
      }
      return;
    }
    if (selectedMatchupKey && data.matchups.some((m) => m.key === selectedMatchupKey)) {
      return;
    }
    const fallbackKey = data.matchups.find((m) => m.key === featured?.row.matchupKey)?.key ?? data.matchups[0]?.key ?? null;
    if (fallbackKey !== selectedMatchupKey) {
      setSelectedMatchupKey(fallbackKey);
    }
  }, [data.matchups, featured?.row.matchupKey, selectedMatchupKey]);

  const refreshSlate = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setRefreshNotice({
      kind: 'DERIVED',
      title: 'Refreshing slate',
      detail: 'Running the latest delta refresh and rebuilding the current board snapshot.',
    });

    let latestNotice: RefreshNotice | null = null;
    try {
      const refreshResponse = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'DELTA', source: 'manual' }),
      });
      const refreshPayload = (await refreshResponse.json().catch(() => null)) as RefreshResponse | null;
      if (!refreshResponse.ok || refreshPayload == null || !refreshPayload.ok) {
        throw new Error(refreshPayload && !refreshPayload.ok ? refreshPayload.error : 'Manual slate refresh failed.');
      }

      const boardResponse = await fetch(`/api/snapshot/board?date=${encodeURIComponent(data.dateEt)}&refresh=1&rebuild=1&t=${Date.now()}`, {
        cache: 'no-store',
      });
      const boardPayload = (await boardResponse.json().catch(() => null)) as BoardResponse | null;
      if (!boardResponse.ok || boardPayload == null || !boardPayload.ok) {
        throw new Error(boardPayload && !boardPayload.ok ? boardPayload.error : 'Latest board snapshot failed to load.');
      }

      startTransition(() => {
        setData(boardPayload.result);
      });
      latestNotice = buildRefreshNotice(refreshPayload.result, boardPayload.result.lastUpdatedAt);
      setRefreshNotice(latestNotice);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Manual slate refresh failed.';
      setRefreshNotice(
        latestNotice
          ? {
              kind: 'PLACEHOLDER',
              title: `${latestNotice.title}, but board reload failed`,
              detail: message,
            }
          : {
              kind: 'PLACEHOLDER',
              title: 'Refresh failed',
              detail: message,
            },
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(109,74,255,0.10),transparent_32%),radial-gradient(circle_at_top_right,rgba(183,129,44,0.10),transparent_28%),linear-gradient(180deg,rgba(255,253,252,0.65)_0%,rgba(245,241,232,0.88)_100%)]" />
      <div className="relative">
        <header ref={headerRef} className="sticky top-0 z-50 border-b border-[var(--border)] bg-[color:rgba(255,253,252,0.85)] backdrop-blur-md">
          <div className="mx-auto max-w-[1440px] px-3 py-1.5 sm:px-6 sm:py-2 xl:px-8">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold tracking-[0.12em] text-[var(--accent)] sm:h-10 sm:w-10 sm:rounded-2xl sm:text-sm">
                    U
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)] sm:text-[11px] sm:tracking-[0.28em]">ULTOPS / Snapshot</div>
                    <div className="mt-1 hidden text-sm text-[var(--text-2)] sm:block">NBA prop intelligence board</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                  <div className="relative hidden lg:block">
                    <input
                      type="search"
                      value={searchQuery}
                      onFocus={() => setHeaderSearchOpen(true)}
                      onBlur={() => window.setTimeout(() => setHeaderSearchOpen(false), 120)}
                      onChange={(event) => {
                        setSearchQuery(event.target.value);
                        setHeaderSearchOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitHeaderSearch();
                        }
                        if (event.key === 'Escape') {
                          setHeaderSearchOpen(false);
                        }
                      }}
                      placeholder="Search players or matchups"
                      className="w-[240px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[color:rgba(109,74,255,0.26)]"
                    />
                    {headerSearchOpen && deferredSearchQuery ? (
                      <div className="absolute right-0 top-full z-50 mt-2 w-[320px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_40px_rgba(20,16,35,0.12)]">
                        {headerPlayerResults.length ? (
                          <div className="border-b border-[var(--border)] p-2">
                            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Players</div>
                            {headerPlayerResults.map((row) => (
                              <button
                                key={`header-player:${row.playerId}`}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  setSearchQuery(row.playerName);
                                  setResearch(row.playerId);
                                }}
                                className={`${ACTION_CLASS} flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-[var(--surface-2)]`}
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-[var(--text)]">{row.playerName}</div>
                                  <div className="mt-0.5 truncate text-xs text-[var(--text-2)]">{matchup(row)}</div>
                                </div>
                                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Player</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {headerMatchupResults.length ? (
                          <div className="p-2">
                            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Matchups</div>
                            {headerMatchupResults.map((matchupResult) => (
                              <button
                                key={`header-matchup:${matchupResult.key}`}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  setSearchQuery(matchupResult.label);
                                  openMatchup(matchupResult.key);
                                }}
                                className={`${ACTION_CLASS} flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-[var(--surface-2)]`}
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-[var(--text)]">{matchupResult.label}</div>
                                  <div className="mt-0.5 truncate text-xs text-[var(--text-2)]">{matchupResult.gameTimeEt}</div>
                                </div>
                                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Game</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {!headerPlayerResults.length && !headerMatchupResults.length ? (
                          <div className="px-4 py-3 text-sm text-[var(--text-2)]">No live player or matchup matches for that search yet.</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={refreshSlate}
                    disabled={isRefreshing}
                    className={`${ACTION_CLASS} inline-flex min-h-10 items-center rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-medium sm:min-h-11 sm:px-4 sm:py-2.5 sm:text-sm ${
                      isRefreshing
                        ? 'cursor-wait bg-[color:rgba(183,129,44,0.12)] text-[var(--warning)]'
                        : 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
                    }`}
                  >
                    <span className="sm:hidden">{isRefreshing ? 'Refreshing' : 'Refresh'}</span>
                    <span className="hidden sm:inline">{isRefreshing ? 'Refreshing...' : 'Refresh slate'}</span>
                  </button>
                  <Badge label={isRefreshing ? 'Updated' : 'Live'} kind={isRefreshing ? 'DERIVED' : 'LIVE'} />
                </div>
              </div>
              <nav className="-mx-1 flex items-center gap-1 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-px px-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {TOP_NAV.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => (item.action === 'help' ? openHelp() : activateTab(item.tab!))}
                    className={`${ACTION_CLASS} min-h-[38px] shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium sm:min-h-10 sm:px-4 sm:py-2 sm:text-sm ${
                      (item.tab && headerView === TAB_TO_VIEW[item.tab]) || (item.action === 'help' && headerView === 'method')
                        ? 'bg-[var(--accent)] text-white'
                        : 'text-[var(--text-2)] hover:bg-[var(--surface)] hover:text-[var(--text)]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-3 pb-14 pt-4 sm:px-6 sm:pb-16 sm:pt-6 xl:px-8">
          <section className="grid grid-cols-3 gap-2 md:hidden">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 shadow-[0_8px_24px_rgba(20,16,35,0.04)]">
              <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Refresh</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{boardRefreshRelative}</div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 shadow-[0_8px_24px_rgba(20,16,35,0.04)]">
              <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Games</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{n(data.matchups.length, 0)}</div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 shadow-[0_8px_24px_rgba(20,16,35,0.04)]">
              <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Books avg</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{liveBookDepth == null ? '-' : n(liveBookDepth)}</div>
            </div>
          </section>

          <section className="mt-4 hidden grid-cols-2 gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)] md:mt-0 md:grid md:grid-cols-3 xl:grid-cols-6">
            <div className="flex flex-col rounded-xl bg-[var(--surface-2)] px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Slate date</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{data.dateEt}</div>
            </div>
            <div className="flex flex-col rounded-xl bg-[var(--surface-2)] px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Last refresh</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{ts(data.lastUpdatedAt)}</div>
              <div className="mt-1 text-xs text-[var(--text-2)]">{boardRefreshRelative}</div>
            </div>
            <div className="flex flex-col rounded-xl bg-[var(--surface-2)] px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Avg books live</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{liveBookDepth == null ? '-' : n(liveBookDepth)}</div>
              <div className="mt-1 text-xs text-[var(--text-2)]">Average consensus depth</div>
            </div>
            <div className="flex flex-col rounded-xl bg-[var(--surface-2)] px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Games</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{n(data.matchups.length, 0)}</div>
              <div className="mt-1 text-xs text-[var(--text-2)]">Live slate windows</div>
            </div>
            <div className="flex flex-col rounded-xl bg-[var(--surface-2)] px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Players</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{n(slatePlayers.length, 0)}</div>
              <div className="mt-1 text-xs text-[var(--text-2)]">Active slate pool</div>
            </div>
            <div className="flex flex-col rounded-xl bg-[var(--surface-2)] px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Top signal</div>
              <div className="mt-1 truncate text-sm font-semibold text-[var(--text)]">{featured ? `${featured.row.playerName} ${featured.label}` : '-'}</div>
              <div className="mt-1 truncate text-xs text-[var(--text-2)]">{featured ? recommendationHeadline(featured) : 'Waiting for board read'}</div>
            </div>
          </section>

          {refreshNotice ? (
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge label={refreshNotice.kind} kind={refreshNotice.kind} />
                <div className="text-sm font-semibold text-[var(--text)]">{refreshNotice.title}</div>
              </div>
              <div className="mt-2 text-sm text-[var(--text-2)]">{refreshNotice.detail}</div>
            </div>
          ) : null}

          <section className="mt-4 grid grid-cols-1 gap-4 md:mt-6 md:gap-6 xl:grid-cols-12">
            <div className="xl:col-span-7">
              {featured ? (
                <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_12px_34px_rgba(20,16,35,0.07)] sm:p-5 md:p-6">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-1.5 sm:gap-2">
                        {featured.rank ? <Badge label={featured.rank} kind="DERIVED" /> : null}
                        <Pill label={MARKET_LABELS[featured.market]} tone="amber" />
                      </div>
                      <div className="mt-3 hidden text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)] md:block">Best play</div>
                      <h1 className="mt-2 text-[2.2rem] font-semibold tracking-tight text-[var(--text)] sm:text-4xl md:text-5xl">{featured.row.playerName}</h1>
                      <div className="mt-2 md:hidden">
                        <RecommendationBox view={featured} title="Best play" size="hero" className="w-full" />
                      </div>
                      <p className="mt-3 max-w-2xl text-sm text-[var(--text-2)] sm:text-base">{matchup(featured.row)}</p>
                      <div className="mt-1 text-[11px] font-medium text-[var(--muted)]">
                        Updated {relativeTime(featuredUpdatedAt, now)}
                      </div>
                    </div>
                    <RecommendationBox view={featured} title="Best play" size="hero" className="hidden w-full sm:w-auto sm:min-w-[260px] md:block md:min-w-[290px]" />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 md:hidden">
                    <CompactMetric label="Model gap" value={gapRead(featured.edge)} compact />
                    <CompactMetric label="Confidence" value={featured.conf == null ? '-' : pct(featured.conf, 0)} compact />
                  </div>

                  <div className="mt-4 hidden grid-cols-2 gap-2.5 sm:mt-5 sm:gap-3 md:grid xl:grid-cols-4">
                    <Stat
                      dense
                      label="Line to play"
                      value={featured.live == null ? (featured.fair == null ? '-' : n(featured.fair)) : n(featured.live)}
                      kind={featured.live == null ? featured.fairKind : featured.liveLineKind}
                      note={featured.live != null ? 'Current consensus number' : featured.fair != null ? 'Model fair line fallback' : 'Waiting for line'}
                      showKind={false}
                    />
                    <Stat dense label="Projection" value={featured.proj == null ? '-' : n(featured.proj)} kind={featured.projKind} note="Tonight projection" showKind={false} />
                    <Stat dense label="Model gap" value={gapRead(featured.edge)} kind={featured.edgeKind} note={gapNote(featured)} showKind={false} />
                    <Stat dense label="Confidence" value={featured.conf == null ? '-' : pct(featured.conf, 0)} kind={featured.confKind} note="Payload confidence" showKind={false} />
                  </div>

                  <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3 text-sm leading-6 text-[var(--text-2)] md:hidden">
                    <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Why it leads</div>
                    <div className="mt-2">{featuredLeadReason}</div>
                  </div>

                  <div className="mt-5 hidden items-start gap-4 md:grid lg:grid-cols-[1.15fr_0.85fr]">
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Why it matters</div>
                      <div className="mt-3 flex items-start gap-3 rounded-xl bg-[var(--surface)] px-3.5 py-3">
                        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="text-sm leading-6 text-[var(--text)]">{featuredWhyItMatters}</div>
                          {featuredWhySupport ? (
                            <div className="mt-1.5 text-xs text-[var(--text-2)]">{featuredWhySupport}</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Recent shape</div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <CompactMetric label={`L10 ${MARKET_LABELS[featured.market]}`} value={n(featuredMarketAverageLast10, 1)} />
                        <CompactMetric label={`Season ${MARKET_LABELS[featured.market]}`} value={n(featuredMarketAverageSeason, 1)} />
                        <CompactMetric label="Trend" value={signed(featuredMarketTrend, 1)} />
                        <CompactMetric label="Opp delta" value={signed(featuredMarketOpponentDelta, 1)} />
                      </div>
                      <div className="mt-4 rounded-xl bg-[var(--surface)] px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Recent 5</div>
                          <div className="text-[11px] text-[var(--muted)]">Oldest to newest</div>
                        </div>
                        {featuredRecentValues.length ? (
                          <>
                            <div className="mt-2.5 grid grid-cols-5 gap-2">
                              {featuredRecentValues.map((value, index) => (
                                <div
                                  key={`${featured.row.playerId}-${featured.market}-recent-${index}`}
                                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2.5 text-center"
                                >
                                  <div className="text-base font-semibold text-[var(--text)]">{n(value, 0)}</div>
                                </div>
                              ))}
                            </div>
                            <div className="mt-2.5 text-xs text-[var(--text-2)]">
                              Avg {n(featuredRecentAverage, 1)} over the last five results.
                            </div>
                          </>
                        ) : (
                          <div className="mt-2.5 text-sm text-[var(--text-2)]">
                            Recent game logs will fill in here as soon as the slate data resolves.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 md:mt-5">
                    <button
                      type="button"
                      onClick={() => setResearch(featured.row.playerId)}
                      className={`${ACTION_CLASS} inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] sm:w-auto`}
                    >
                      Open player
                    </button>
                    <button
                      type="button"
                      onClick={() => activateTab('tracking')}
                      className={`${ACTION_CLASS} hidden min-h-11 items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-medium text-[var(--text)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)] sm:inline-flex`}
                    >
                      Compare lines
                    </button>
                  </div>
                </div>
              ) : (
                <EmptyState
                  eyebrow="Featured signal"
                  title={hasBoardRows ? 'The board has not surfaced a featured signal yet.' : 'Waiting for board data to load.'}
                  detail={
                    hasBoardRows
                      ? 'As soon as a precision-card entry or high-signal live market is available, the lead recommendation will anchor here.'
                      : 'The board will promote the strongest slate recommendation here once SnapshotBoardData finishes loading.'
                  }
                  actionLabel="Refresh slate"
                  onAction={refreshSlate}
                />
              )}
            </div>

            <div className="hidden md:block xl:col-span-5">
              <BoardPulseCard
                boardRefresh={ts(data.lastUpdatedAt)}
                featuredUpdate={ts(latestBoardFeedEvent?.createdAt ?? featuredUpdatedAt)}
                liveLines={n(liveCount, 0)}
                feedItems={n(boardFeedEvents.length, 0)}
                strongestMarket={featured ? `${featured.row.playerName} ${featured.label}` : '-'}
                bestAlternative={topOpportunities[1] ? `${topOpportunities[1].row.playerName} ${topOpportunities[1].label}` : 'Waiting for a second live card'}
                mostActiveGame={selectedMatchup?.label ?? data.matchups[0]?.label ?? '-'}
                booksLive={liveBookDepth == null ? '-' : n(liveBookDepth)}
                note={boardPulseNote}
              />
            </div>
          </section>

          <section ref={overviewRef} tabIndex={-1} className="mt-4 scroll-mt-28 outline-none md:mt-6 md:scroll-mt-32">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Top opportunities</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">Best live numbers on the board</h2>
                <p className="mt-1 text-sm text-[var(--text-2)]">Best actionable plays right now.</p>
              </div>
              <div className="text-xs text-[var(--text-2)] sm:text-sm">
                {topOpportunities.length ? `${n(topOpportunities.length, 0)} live cards ready to open` : 'Waiting for a broader set of live book lines'}
              </div>
            </div>
            {topOpportunities.length ? (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
                {topOpportunities.map((view, index) => (
                  <button
                    key={`${view.row.playerId}:${view.market}:top-opportunity`}
                    type="button"
                    onClick={() => setResearch(view.row.playerId)}
                    className={`h-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2.5 text-left md:p-3 ${CARD_BUTTON_CLASS}`}
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2">
                          <Badge label={`#${index + 1}`} kind="DERIVED" />
                          <Pill label={view.label} tone="amber" />
                        </div>
                        <div className="mt-1.5 text-lg font-semibold leading-tight text-[var(--text)] md:text-[1.02rem]">{view.row.playerName}</div>
                        <div className="mt-1 text-sm font-semibold text-[var(--text)] md:text-[15px]">{recommendationHeadline(view)}</div>
                        <div className="mt-1 text-[13px] text-[var(--text-2)] md:text-sm">{matchup(view.row)}</div>
                      </div>
                      <div className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-2)]">
                        {relativeTime(view.row.gameIntel.generatedAt, now)}
                      </div>
                    </div>
                    <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                      <CompactMetric label="Line" value={view.live == null ? '-' : n(view.live)} compact />
                      <CompactMetric label="Gap" value={gapRead(view.edge)} compact />
                      <CompactMetric label="Conf" value={view.conf == null ? '-' : pct(view.conf, 0)} compact />
                    </div>
                    <div className="mt-2.5 flex items-center gap-3 text-xs text-[var(--text-2)] md:text-sm">
                      <span>{booksLiveLabel(view.books) ?? 'Books pending'}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState
                  eyebrow="Top opportunities"
                  title="Live book lines have not stacked up enough to rank this strip yet."
                  detail="The board will promote live cards here as soon as more current sportsbook numbers land. Until then, the featured signal remains the quickest way into the slate."
                  actionLabel="Refresh slate"
                  onAction={refreshSlate}
                />
              </div>
            )}

            <div className="mt-4 md:hidden">
              <BoardPulseCard
                boardRefresh={ts(data.lastUpdatedAt)}
                featuredUpdate={ts(latestBoardFeedEvent?.createdAt ?? featuredUpdatedAt)}
                liveLines={n(liveCount, 0)}
                feedItems={n(boardFeedEvents.length, 0)}
                strongestMarket={featured ? `${featured.row.playerName} ${featured.label}` : '-'}
                bestAlternative={topOpportunities[1] ? `${topOpportunities[1].row.playerName} ${topOpportunities[1].label}` : 'Waiting for a second live card'}
                mostActiveGame={selectedMatchup?.label ?? data.matchups[0]?.label ?? '-'}
                booksLive={liveBookDepth == null ? '-' : n(liveBookDepth)}
                note={boardPulseNote}
              />
            </div>
          </section>

          <section ref={matchupExplorerRef} tabIndex={-1} className="mt-4 grid grid-cols-1 gap-4 scroll-mt-28 outline-none md:mt-6 md:gap-6 md:scroll-mt-32 xl:grid-cols-12">
            <div className="order-2 xl:order-1 xl:col-span-5">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Matchup explorer</div>
                    <h2 className="mt-2 text-xl font-semibold text-[var(--text)]">Game-first board scan</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => activateTab('scout')}
                    className={`${ACTION_CLASS} inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-medium text-[var(--text)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)] sm:w-auto`}
                  >
                    Open feed
                  </button>
                </div>
                {data.matchups.length ? (
                  <>
                    <div className="mt-4 flex gap-2.5 overflow-x-auto pb-1 pr-1 md:gap-3">
                      {data.matchups.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => setMatchupSelection(m.key, { highlight: true })}
                          className={`${ACTION_CLASS} shrink-0 rounded-2xl border px-4 py-3 text-left ${
                            selectedMatchupKey === m.key
                              ? 'border-[color:rgba(109,74,255,0.32)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_10px_24px_rgba(109,74,255,0.10)]'
                              : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)] hover:text-[var(--text)]'
                          } ${isMatchupHighlighted(m.key) ? 'shadow-[0_0_0_3px_rgba(109,74,255,0.14)]' : ''}`}
                        >
                          <div className="text-sm font-semibold">{m.label}</div>
                          <div className="mt-1 text-xs opacity-80">{m.gameTimeEt}</div>
                        </button>
                      ))}
                    </div>

                    {selectedMatchup ? (
                      <>
                        <div
                          className={`mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4 transition-shadow ${
                            selectedMatchup ? (isMatchupHighlighted(selectedMatchup.key) ? 'shadow-[0_0_0_3px_rgba(109,74,255,0.14)]' : '') : ''
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-lg font-semibold text-[var(--text)]">{selectedMatchup.label}</div>
                              <div className="mt-1 text-sm text-[var(--text-2)]">{selectedMatchup.gameTimeEt}</div>
                            </div>
                            {selectedMatchupFocusLabel ? <Pill label={`Focus ${selectedMatchupFocusLabel}`} tone="amber" /> : null}
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <CompactMetric
                              label={`${selectedMatchupTeamStats?.awayTeam ?? 'Away'} off L10`}
                              value={n(selectedMatchupAwayOffense, 1)}
                            />
                            <CompactMetric
                              label={`${selectedMatchupTeamStats?.homeTeam ?? 'Home'} off L10`}
                              value={n(selectedMatchupHomeOffense, 1)}
                            />
                            <CompactMetric
                              label={`${selectedMatchupTeamStats?.awayTeam ?? 'Away'} allowed`}
                              value={n(selectedMatchupAwayAllowed, 1)}
                            />
                            <CompactMetric
                              label={`${selectedMatchupTeamStats?.homeTeam ?? 'Home'} allowed`}
                              value={n(selectedMatchupHomeAllowed, 1)}
                            />
                          </div>
                          <div className="mt-4 rounded-2xl bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-2)]">
                            {selectedMatchupLead?.row.playerContext.primaryDefender?.matchupReason ??
                              selectedMatchupLead?.reasons[0] ??
                              boardModelNote ??
                              'No matchup-specific support note is available yet, but the live player spots below are ready to scan.'}
                          </div>
                        </div>

                        <div className="mt-5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-[var(--text)]">Best spots in this game</div>
                            <div className="text-sm text-[var(--text-2)]">
                              {matchupExplorerSpots.length ? `${n(matchupExplorerSpots.length, 0)} live spots` : 'No live spots yet'}
                            </div>
                          </div>
                          <div className="mt-3 flex flex-col gap-3">
                            {matchupExplorerSpots.length ? (
                              matchupExplorerSpots.map((spot) => (
                                <button
                                  key={`${spot.row.playerId}:${spot.market}:matchup-explorer`}
                                  type="button"
                                  onClick={() => setResearch(spot.row.playerId)}
                                  className={`rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-left ${CARD_BUTTON_CLASS}`}
                                >
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <div className="text-base font-semibold text-[var(--text)]">{spot.row.playerName}</div>
                                      <div className="mt-1 text-sm text-[var(--text-2)]">{spot.label}</div>
                                    </div>
                                    <div className={`rounded-full border px-3 py-1 text-sm font-semibold ${SIDE_CLASS[spot.side]}`}>
                                      {recommendationHeadline(spot)}
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2 text-sm text-[var(--text-2)]">
                                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
                                      Projection {spot.proj == null ? '-' : n(spot.proj)}
                                    </span>
                                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
                                      Edge {spot.edge == null ? '-' : signed(spot.edge)}
                                    </span>
                                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
                                      {booksLiveLabel(spot.books) ?? 'Books pending'}
                                    </span>
                                  </div>
                                </button>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--text-2)]">
                                This matchup does not have three live player spots yet. Try another game or refresh the slate.
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--text-2)]">
                        Pick a game above to lock the board on one matchup and surface its best live numbers.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mt-4">
                    <EmptyState
                      eyebrow="Matchup explorer"
                      title="No matchup windows are loaded yet."
                      detail="Once the slate payload lands, this card will let you scan the board one game at a time."
                      actionLabel="Refresh slate"
                      onAction={refreshSlate}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="order-1 xl:order-2 xl:col-span-7">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Board feed</div>
                    <h2 className="mt-2 text-xl font-semibold text-[var(--text)]">Pregame changes captured through the day</h2>
                    <p className="mt-1 text-sm text-[var(--text-2)]">Markets freeze at tipoff, so this feed stays historical instead of drifting into live-play noise.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => activateTab('scout')}
                    className={`${ACTION_CLASS} inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-medium text-[var(--text)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)] sm:w-auto`}
                  >
                    Open full feed
                  </button>
                </div>
                {liveFeedEvents.length ? (
                  <div className="mt-4 flex max-h-[480px] flex-col gap-4 overflow-auto pr-1">
                    {liveFeedBuckets.map((bucket) => (
                      <div key={bucket.label}>
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{bucket.label}</div>
                        <div className="relative ml-1 border-l-2 border-[color:rgba(109,74,255,0.18)] pl-5">
                          {bucket.events.map((event, index) => (
                            <button
                              key={event.id}
                              type="button"
                              onClick={() => setResearch(event.playerId)}
                              className={`${ACTION_CLASS} relative mb-0 w-full border-b border-[color:rgba(216,204,186,0.58)] bg-transparent px-0 pb-3 pt-0 text-left last:border-b-0 last:pb-0 hover:bg-transparent md:pb-3.5`}
                            >
                              <span className="absolute -left-[25px] top-2.5 h-3 w-3 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)]" />
                              <div className="grid gap-2 sm:grid-cols-[76px_minmax(0,1fr)] sm:gap-3">
                                <div className="pt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)] sm:text-right">
                                  {relativeTime(event.createdAt, now)}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-[var(--text)] md:text-[15px]">{feedEventTitle(event)}</div>
                                      <div className="mt-0.5 text-[13px] text-[var(--text-2)] md:text-sm">
                                        {event.playerName} | {MARKET_LABELS[event.market]} | {event.matchupKey.replace('@', ' @ ')} - {event.gameTimeEt}
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                      {index === 0 ? <Pill label="Newest" tone="amber" /> : null}
                                      <Pill label={feedStatusLabel(event)} tone={feedStatusTone(event)} />
                                    </div>
                                  </div>
                                  <div className="mt-1.5 text-sm leading-5 text-[var(--text-2)] md:leading-6">{feedReason(event)}</div>
                                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-2)] md:text-sm">
                                    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold md:text-sm ${SIDE_CLASS[event.side]}`}>
                                      {event.recommendation}
                                    </span>
                                    <span>Gap {gapRead(event.gap)}</span>
                                    <span>Conf {event.confidence == null ? '-' : pct(event.confidence, 0)}</span>
                                    <span>{booksLiveLabel(event.booksLive) ?? 'Books pending'}</span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4">
                    <EmptyState
                      eyebrow="Board feed"
                      title="No pregame feed events are logged yet."
                      detail="The feed starts filling once a pregame number surfaces, moves materially, drops, or locks at tipoff."
                      actionLabel="Refresh slate"
                      onAction={refreshSlate}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>

          <section ref={workspaceRef} tabIndex={-1} className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)] scroll-mt-28 outline-none md:p-6 md:scroll-mt-32">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Workspace</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">{workspaceCopy[tab].title}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-2)]">{workspaceCopy[tab].detail}</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">{activeWorkspace.label}</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text)]">{tabSummary[tab].detail}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="mr-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Quick switch</div>
                {TABS.map((item) => (
                  <button
                    key={`workspace:${item.id}`}
                    type="button"
                    onClick={() => activateTab(item.id)}
                    className={`${ACTION_CLASS} ${WORKSPACE_SWITCH_CLASS} ${
                      tab === item.id
                        ? ACTIVE_SWITCH_CLASS
                        : INACTIVE_SWITCH_CLASS
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={openHelp}
                  className={`${ACTION_CLASS} ${WORKSPACE_SWITCH_CLASS} ${
                    headerView === 'method'
                      ? ACTIVE_SWITCH_CLASS
                      : INACTIVE_SWITCH_CLASS
                  }`}
                >
                  Method
                </button>
              </div>
            </div>

          {tab === 'precision' ? (
            <section className="mt-5 grid gap-6 xl:items-start xl:grid-cols-[1.35fr_0.85fr]">
              <div className="space-y-4">
                {precision.length === 0 ? (
                  <EmptyState
                    eyebrow="Precision card"
                    title="No precision-card entries are loaded on this slate."
                    detail="The board still works, but the featured anchor stays in fallback mode until a valid precision card is present."
                    actionLabel="Refresh slate"
                    onAction={refreshSlate}
                  />
                ) : (
                  precision.map(({ entry, row, view }, idx) => (
                    <button
                      key={`${entry.playerId}:${entry.market}`}
                      type="button"
                      onClick={() => setResearch(row.playerId)}
                      className={`w-full rounded-[28px] border p-5 text-left ${CARD_BUTTON_CLASS} ${
                        idx === 0
                          ? 'border-cyan-400/25 bg-[linear-gradient(145deg,rgba(8,15,29,0.96),rgba(15,23,42,0.9))]'
                          : 'border-white/10 bg-zinc-900/75'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            {view.rank ? <Badge label={view.rank} kind="DERIVED" /> : null}
                            <Pill label={view.label} tone="amber" />
                            <Badge label={view.liveKind} kind={view.liveKind} />
                          </div>
                          <div className="mt-3 text-2xl font-semibold tracking-tight text-white">{row.playerName}</div>
                          <div className="mt-1 text-sm text-zinc-400">{matchup(row)}</div>
                        </div>
                        <RecommendationBox view={view} className="w-full sm:w-auto sm:min-w-[250px]" />
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Stat
                          dense
                          label="Line to play"
                          value={view.live == null ? (view.fair == null ? '-' : n(view.fair)) : n(view.live)}
                          kind={view.live == null ? view.fairKind : view.liveLineKind}
                          note={view.live != null ? 'Current consensus line behind the call' : view.fair != null ? 'Model fair line until live books land' : view.note}
                        />
                        <Stat dense label="Projection" value={view.proj == null ? '-' : n(view.proj)} kind={view.projKind} note="Tonight projection from payload" />
                        <Stat dense label="Edge" value={view.edge == null ? '-' : signed(view.edge)} kind={view.edgeKind} note="Projection minus line" />
                        <Stat dense label="Confidence" value={view.conf == null ? '-' : pct(view.conf, 1)} kind={view.confKind} note="Payload confidence or derived win probability" />
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {view.rank ? <Badge label={view.rank} kind="DERIVED" /> : null}
                        <Pill label={view.source} tone={view.live != null ? 'cyan' : 'default'} />
                        {view.precision?.selectorFamily ? <Pill label={view.precision.selectorFamily} tone="cyan" /> : null}
                        {view.precision?.selectorTier ? <Pill label={view.precision.selectorTier} tone="amber" /> : null}
                      </div>
                    </button>
                  ))
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Precision system</div>
                      <div className="mt-1 text-lg font-semibold text-white">{data.precisionSystem?.label ?? 'Unavailable'}</div>
                    </div>
                    <Badge label={data.precisionSystem ? 'LIVE' : 'PLACEHOLDER'} kind={data.precisionSystem ? 'LIVE' : 'PLACEHOLDER'} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Stat dense label="Accuracy" value={data.precisionSystem ? pct(data.precisionSystem.historicalAccuracy, 1) : '-'} kind={data.precisionSystem ? 'LIVE' : 'PLACEHOLDER'} note="Historical system rate from payload" />
                    <Stat dense label="Coverage" value={data.precisionSystem ? pct(data.precisionSystem.historicalCoveragePct, 1) : '-'} kind={data.precisionSystem ? 'LIVE' : 'PLACEHOLDER'} note="Historical pick coverage from payload" />
                    <Stat dense label="Target" value={data.precisionSystem?.targetCardCount != null ? n(data.precisionSystem.targetCardCount, 0) : '-'} kind={data.precisionSystem?.targetCardCount != null ? 'LIVE' : 'PLACEHOLDER'} note="Card slots expected" />
                    <Stat dense label="Selected" value={n(selected, 0)} kind={data.precisionCardSummary?.selectedCount != null ? 'LIVE' : 'DERIVED'} note="Entries on the card" />
                  </div>
                  {data.precisionSystem?.note ? <div className="mt-4 rounded-2xl border border-cyan-400/15 bg-cyan-400/8 px-4 py-3 text-sm text-cyan-50/90">{data.precisionSystem.note}</div> : null}
                  {gap > 0 ? <div className="mt-3 rounded-2xl border border-amber-400/15 bg-amber-400/8 px-4 py-3 text-sm text-amber-50/90">Precision card is under target by {gap} slot{gap === 1 ? '' : 's'}.</div> : null}
                </div>

                <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Card mix</div>
                      <div className="mt-1 text-lg font-semibold text-white">How the current precision card is built</div>
                    </div>
                    <Badge label={precision.length ? 'DERIVED' : 'PLACEHOLDER'} kind={precision.length ? 'DERIVED' : 'PLACEHOLDER'} />
                  </div>
                  {precision.length ? (
                    <>
                      <div className="mt-4 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Markets on card</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {precisionMarketMix.map((item) => (
                          <Badge key={item.market} label={`${MARKET_LABELS[item.market]} ${item.count}`} kind="DERIVED" />
                        ))}
                      </div>
                      <div className="mt-4 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Games covered</div>
                      <div className="mt-3 space-y-2">
                        {precisionMatchupMix.map((item) => (
                          <div key={item.matchupKey} className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm">
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-white">{item.label}</div>
                              <div className="mt-1 text-xs text-zinc-400">
                                {item.matchupKey === selectedMatchupKey ? 'Currently selected in the matchup lens' : 'Visible in the current precision card'}
                              </div>
                            </div>
                            <Badge label={`${item.count} slot${item.count === 1 ? '' : 's'}`} kind={item.matchupKey === selectedMatchupKey ? 'LIVE' : 'DERIVED'} />
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-4 text-sm text-zinc-400">
                      Card-mix detail appears when the precision card has at least one live or derived entry.
                    </div>
                  )}
                </div>

                <MatchupsCard
                  matchups={data.matchups}
                  selectedKey={selectedMatchupKey}
                  highlightedKey={highlightTarget?.kind === 'matchup' ? highlightTarget.key : null}
                  onSelect={(matchupKey) => setMatchupSelection(matchupKey, { highlight: true })}
                />
              </div>
            </section>
          ) : null}
          {tab === 'research' ? (
            <section className="mt-5 grid gap-6 xl:items-start xl:grid-cols-[0.95fr_1.55fr]">
              <div className="space-y-3">
                <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Slate player search</div>
                      <div className="mt-1 text-sm text-zinc-300">
                        Search the current slate only, then open live and derived player stats in the dossier.
                      </div>
                    </div>
                    <Badge
                      label={
                        deferredSearchQuery
                          ? `${n(searchResults.length, 0)} match${searchResults.length === 1 ? '' : 'es'}`
                          : `${n(slatePlayers.length, 0)} players`
                      }
                      kind={deferredSearchQuery ? (searchResults.length ? 'LIVE' : 'PLACEHOLDER') : 'LIVE'}
                    />
                  </div>
                  <div className="mt-4 flex gap-2">
                    <input
                      ref={searchInputRef}
                      type="search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search player, team, opponent, or matchup"
                      className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-cyan-400/30 focus:bg-black/35"
                    />
                    {searchQuery ? (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-200 hover:border-white/20 hover:bg-white/10"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 text-xs text-zinc-400">
                    {deferredSearchQuery
                      ? searchResults.length
                        ? 'Showing matching players from the active slate.'
                        : 'No player on the current slate matched that search.'
                      : 'Featured and highest-completeness players stay pinned below until you search.'}
                  </div>
                </div>
                {researchListCards.length ? (
                  researchListCards.map(({ row, leadView }) => {
                    const picked = row.playerId === researchRow?.playerId;
                    return (
                      <button
                        key={row.playerId}
                        type="button"
                        onClick={() => setResearch(row.playerId)}
                        className={`w-full rounded-[24px] border p-4 text-left ${CARD_BUTTON_CLASS} ${
                          picked
                            ? 'border-[color:rgba(109,74,255,0.34)] bg-[linear-gradient(145deg,rgba(35,28,58,0.96),rgba(15,23,42,0.94))] shadow-[0_14px_32px_rgba(109,74,255,0.12)]'
                            : 'border-white/10 bg-zinc-900/75'
                        } ${isPlayerHighlighted(row.playerId) ? 'shadow-[0_0_0_3px_rgba(109,74,255,0.20)]' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap gap-2">
                              {picked ? <Badge label="Selected" kind="DERIVED" /> : <Pill label="Player" />}
                              <Pill label={leadView?.label ?? 'No lead market'} tone="amber" />
                              {leadView ? <Badge label={leadView.liveKind} kind={leadView.liveKind} /> : null}
                            </div>
                            <div className="mt-3 text-xl font-semibold text-white">{row.playerName}</div>
                            <div className="mt-1 text-sm text-zinc-400">{matchup(row)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Completeness</div>
                            <div className="mt-2 text-xl font-semibold text-white">{pct(row.dataCompleteness.score, 0)}</div>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Pill label={`${row.teamCode}${row.position ? ` ${row.position}` : ''}`} tone="cyan" />
                          <Badge
                            label={
                              leadView
                                ? `${leadView.label} ${leadView.edge == null ? n(leadView.proj, 1) : signed(leadView.edge, 1)}`
                                : 'No lead read'
                            }
                            kind={leadView ? (leadView.edge != null ? leadView.edgeKind : leadView.projKind) : 'PLACEHOLDER'}
                          />
                          <Badge
                            label={
                              leadView
                                ? leadView.conf == null
                                  ? 'Conf -'
                                  : `Conf ${pct(leadView.conf, 0)}`
                                : 'Conf -'
                            }
                            kind={leadView ? leadView.confKind : 'PLACEHOLDER'}
                          />
                          <Badge label={`Proj min ${n(row.playerContext.projectedMinutes, 1)}`} kind={row.playerContext.projectedMinutes == null ? 'PLACEHOLDER' : 'LIVE'} />
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <EmptyState
                    eyebrow="Slate player search"
                    title={deferredSearchQuery ? 'No players on the current slate matched that search.' : 'Active-slate players will appear here as soon as the board loads.'}
                    detail={
                      deferredSearchQuery
                        ? 'Try a team code, opponent, matchup, or clear the search to fall back to the featured research queue.'
                        : 'Once the slate rows are available, this rail will stay anchored to the featured queue until you search.'
                    }
                    actionLabel={searchQuery ? 'Clear search' : undefined}
                    onAction={searchQuery ? () => setSearchQuery('') : undefined}
                  />
                )}
              </div>

              <div className="space-y-4">
                {researchRow ? (
                  <>
                    <div
                      ref={researchDossierRef}
                      tabIndex={-1}
                      className={`rounded-[28px] border bg-zinc-900/75 p-5 outline-none transition-shadow ${
                        isPlayerHighlighted(researchRow.playerId)
                          ? 'border-[color:rgba(109,74,255,0.34)] shadow-[0_0_0_3px_rgba(109,74,255,0.20)]'
                          : 'border-white/10'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <Badge label="Research dossier" kind="LIVE" />
                            {pickedPlayer === researchRow.playerId ? <Pill label="Selected player" tone="cyan" /> : null}
                            {researchTopPrecision?.entry.rank ? <Badge label={`Precision ${researchTopPrecision.entry.rank}`} kind="DERIVED" /> : null}
                            {researchLeadView ? <Pill label={`Lead ${researchLeadView.label}`} tone="amber" /> : null}
                          </div>
                          <h3 className="mt-4 text-3xl font-semibold tracking-tight text-white">{researchRow.playerName}</h3>
                          <p className="mt-1 text-sm text-zinc-400">{matchup(researchRow)}</p>
                          <p className="mt-4 max-w-4xl text-sm leading-7 text-zinc-300">{researchWhyInteresting}</p>
                        </div>
                        <div className={`rounded-2xl border px-4 py-3 text-right ${SIDE_CLASS[researchLeadView?.side ?? 'NEUTRAL']}`}>
                          <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">Best market</div>
                          <div className="mt-2 flex justify-end">
                            {researchLeadView ? <Side side={researchLeadView.side} kind={researchLeadView.sideKind} /> : <Badge label="NEUTRAL" kind="PLACEHOLDER" />}
                          </div>
                          <div className="mt-1 text-xs opacity-80">{researchLeadView?.note ?? 'No market context available'}</div>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                        <Stat dense label="Projected minutes" value={n(researchRow.playerContext.projectedMinutes, 1)} kind={researchRow.playerContext.projectedMinutes == null ? 'PLACEHOLDER' : 'LIVE'} note={`Floor ${n(researchRow.playerContext.projectedMinutesFloor, 1)} / ceiling ${n(researchRow.playerContext.projectedMinutesCeiling, 1)}`} />
                        <Stat dense label="Lineup status" value={researchRow.playerContext.lineupStatus ?? '-'} kind={researchRow.playerContext.lineupStatus ? 'LIVE' : 'PLACEHOLDER'} note={researchRow.playerContext.projectedStarter} />
                        <Stat dense label="Rotation rank" value={researchRow.playerContext.rotationRank == null ? '-' : n(researchRow.playerContext.rotationRank, 0)} kind={researchRow.playerContext.rotationRank == null ? 'PLACEHOLDER' : 'LIVE'} note="Depth chart position" />
                        <Stat dense label="Completeness" value={pct(researchRow.dataCompleteness.score, 0)} kind="LIVE" note={researchRow.dataCompleteness.tier} />
                        <Stat dense label="Lead edge" value={researchLeadView?.edge == null ? '-' : signed(researchLeadView.edge)} kind={researchLeadView?.edgeKind ?? 'PLACEHOLDER'} note={researchLeadView ? `${researchLeadView.label} vs current basis` : 'Lead market not available'} />
                        <Stat dense label="Lead confidence" value={researchLeadView?.conf == null ? '-' : pct(researchLeadView.conf, 1)} kind={researchLeadView?.confKind ?? 'PLACEHOLDER'} note={researchLeadView ? researchLeadView.source : 'Confidence unavailable'} />
                        <Stat dense label="Primary defender" value={researchRow.playerContext.primaryDefender?.playerName ?? '-'} kind={researchRow.playerContext.primaryDefender ? 'LIVE' : 'PLACEHOLDER'} note={researchRow.playerContext.primaryDefender?.matchupReason ?? 'No defender context'} />
                      </div>
                      <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                        <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Model vs line</div>
                              <div className="mt-1 text-sm font-semibold text-white">How the board is framing the lead market</div>
                            </div>
                            <Badge label={researchLeadView?.live != null ? 'LIVE' : researchLeadView ? 'DERIVED' : 'PLACEHOLDER'} kind={researchLeadView?.live != null ? 'LIVE' : researchLeadView ? 'DERIVED' : 'PLACEHOLDER'} />
                          </div>
                          <p className="mt-3 text-sm leading-6 text-zinc-300">{researchModelVsLineExplanation}</p>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <Stat dense label="Live line" value={researchLeadView?.live == null ? '-' : n(researchLeadView.live)} kind={researchLeadView?.liveLineKind ?? 'PLACEHOLDER'} note={researchLeadView ? `${researchLeadView.label} market line` : 'Lead market unavailable'} />
                            <Stat dense label="Fair line" value={researchLeadView?.fair == null ? '-' : n(researchLeadView.fair)} kind={researchLeadView?.fairKind ?? 'PLACEHOLDER'} note="Board fair line" />
                            <Stat dense label="Projection" value={researchLeadView?.proj == null ? '-' : n(researchLeadView.proj)} kind={researchLeadView?.projKind ?? 'PLACEHOLDER'} note="Board projection" />
                            <Stat dense label="Recent 5" value={researchLeadRecentFive} kind={researchLeadView ? (researchRow.last5[researchLeadView.market].length ? 'LIVE' : 'PLACEHOLDER') : 'PLACEHOLDER'} note="Recent sample for the lead market" />
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Confidence signal</div>
                              <div className="mt-1 text-sm font-semibold text-white">How much trust the current board supports</div>
                            </div>
                            <Badge label={researchLeadView?.precision?.qualified ? 'DERIVED' : researchLeadView ? 'LIVE' : 'PLACEHOLDER'} kind={researchLeadView?.precision?.qualified ? 'DERIVED' : researchLeadView ? 'LIVE' : 'PLACEHOLDER'} />
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {researchLeadView ? <Pill label={marketRead(researchLeadView)} tone={researchLeadView.live != null ? 'cyan' : 'default'} /> : null}
                            {researchLeadView?.precision?.selectorFamily ? <Pill label={researchLeadView.precision.selectorFamily} tone="cyan" /> : null}
                            {researchLeadView?.precision?.selectorTier ? <Pill label={researchLeadView.precision.selectorTier} tone="amber" /> : null}
                            {researchLeadView?.books != null ? <Badge label={`${n(researchLeadView.books, 0)} books`} kind={researchLeadView.booksKind} /> : <Badge label="Books -" kind="PLACEHOLDER" />}
                            <Badge label={researchLeadView?.precision?.qualified ? 'Precision-qualified' : 'Board read'} kind={researchLeadView?.precision?.qualified ? 'DERIVED' : 'LIVE'} />
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <Stat dense label="Trend vs season" value={signed(researchLeadTrend, 1)} kind={researchLeadTrend == null ? 'PLACEHOLDER' : 'DERIVED'} note={researchLeadView ? trendRead(researchLeadTrend) : 'Lead market unavailable'} />
                            <Stat dense label="Opponent delta" value={signed(researchLeadOpponentDelta, 1)} kind={researchLeadOpponentDelta == null ? 'PLACEHOLDER' : 'LIVE'} note={researchLeadView ? `${researchLeadView.label} matchup context` : 'Lead market unavailable'} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Market matrix</div>
                          <div className="mt-1 text-lg font-semibold text-white">All markets for the selected player</div>
                        </div>
                        <Pill label="Live payload + board math" />
                      </div>
                      {researchLiveViews.length ? (
                        <div className="mt-4 overflow-x-auto rounded-[22px] border border-white/10">
                          <table className="min-w-full text-sm">
                            <thead className="bg-white/5 text-zinc-400">
                              <tr>
                                <th className="px-3 py-3 text-left font-medium">Market</th>
                                <th className="px-3 py-3 text-left font-medium">Live line</th>
                                <th className="px-3 py-3 text-left font-medium">Fair</th>
                                <th className="px-3 py-3 text-left font-medium">Proj</th>
                                <th className="px-3 py-3 text-left font-medium">Edge</th>
                                <th className="px-3 py-3 text-left font-medium">Conf</th>
                                <th className="px-3 py-3 text-left font-medium">Side</th>
                                <th className="px-3 py-3 text-left font-medium">Books</th>
                                <th className="px-3 py-3 text-left font-medium">Read</th>
                              </tr>
                            </thead>
                            <tbody>
                              {researchLiveViews.map((v) => (
                                <tr
                                  key={`${v.row.playerId}:${v.market}`}
                                  className={`border-t border-white/8 ${researchLeadView?.market === v.market ? 'bg-cyan-400/5' : ''}`}
                                >
                                  <td className="px-3 py-3">
                                    <div className="font-semibold text-white">{v.label}</div>
                                    <div className="text-xs text-zinc-500">{v.source}</div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex flex-col gap-1"><span className="text-white">{n(v.live)}</span><Badge label={v.liveLineKind} kind={v.liveLineKind} /></div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex flex-col gap-1"><span className="text-white">{v.fair == null ? '-' : n(v.fair)}</span><Badge label={v.fairKind} kind={v.fairKind} /></div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex flex-col gap-1"><span className="text-white">{v.proj == null ? '-' : n(v.proj)}</span><Badge label={v.projKind} kind={v.projKind} /></div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex flex-col gap-1"><span className="text-white">{v.edge == null ? '-' : signed(v.edge)}</span><Badge label={v.edgeKind} kind={v.edgeKind} /></div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex flex-col gap-1"><span className="text-white">{v.conf == null ? '-' : pct(v.conf, 1)}</span><Badge label={v.confKind} kind={v.confKind} /></div>
                                  </td>
                                  <td className="px-3 py-3"><Side side={v.side} kind={v.sideKind} /></td>
                                  <td className="px-3 py-3">
                                    <div className="flex flex-col gap-1"><span className="text-white">{v.books == null ? '-' : n(v.books, 0)}</span><Badge label={v.booksKind} kind={v.booksKind} /></div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="text-white">{marketRead(v)}</div>
                                    <div className="mt-1 text-xs text-zinc-500">
                                      {v.precision?.qualified ? 'Precision-qualified' : 'Live board read'}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="mt-4 rounded-[22px] border border-dashed border-white/15 bg-black/25 px-4 py-4 text-sm text-zinc-400">
                          No live player prop lines are available for this player right now. Model-only rows stay hidden until a real book line lands.
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Why this is interesting</div>
                            <div className="mt-1 text-lg font-semibold text-white">Support for a deeper look</div>
                          </div>
                          <Badge label={researchSupportDrivers.length ? 'DERIVED' : 'PLACEHOLDER'} kind={researchSupportDrivers.length ? 'DERIVED' : 'PLACEHOLDER'} />
                        </div>
                        <p className="mt-3 text-sm leading-6 text-zinc-300">{researchWhyInteresting}</p>
                        <div className="mt-4 space-y-3">
                          {researchSupportDrivers.length ? (
                            researchSupportDrivers.map((driver) => (
                              <div key={driver} className="rounded-2xl border border-emerald-400/15 bg-emerald-400/8 px-4 py-3 text-sm text-emerald-50/90">
                                {driver}
                              </div>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-4 text-sm text-zinc-400">
                              The board does not yet have strong support drivers beyond the current visible market read.
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Confidence and caution</div>
                            <div className="mt-1 text-lg font-semibold text-white">What should keep the read grounded</div>
                          </div>
                          <Badge label={researchCautionDrivers.length ? 'DERIVED' : 'LIVE'} kind={researchCautionDrivers.length ? 'DERIVED' : 'LIVE'} />
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <Stat dense label="Completeness" value={pct(researchRow.dataCompleteness.score, 0)} kind="LIVE" note={researchRow.dataCompleteness.tier} />
                          <Stat dense label="Lead confidence" value={researchLeadView?.conf == null ? '-' : pct(researchLeadView.conf, 1)} kind={researchLeadView?.confKind ?? 'PLACEHOLDER'} note={researchLeadView?.live != null ? 'Live confidence in payload' : 'Derived from board math or precision history'} />
                          <Stat dense label="Books" value={researchLeadView?.books == null ? '-' : n(researchLeadView.books, 0)} kind={researchLeadView?.booksKind ?? 'PLACEHOLDER'} note={researchLeadView?.live != null ? 'Live line depth' : 'No live consensus line'} />
                          <Stat dense label="Minutes band" value={researchMinutesBandWidth == null ? '-' : n(researchMinutesBandWidth, 1)} kind={researchMinutesBandWidth == null ? 'PLACEHOLDER' : researchMinutesBandWidth >= 6 ? 'DERIVED' : 'LIVE'} note={researchMinutesBandWidth == null ? 'Floor/ceiling missing' : `${n(researchRow.playerContext.projectedMinutesFloor, 1)} to ${n(researchRow.playerContext.projectedMinutesCeiling, 1)}`} />
                        </div>
                        <div className="mt-4 space-y-3">
                          {researchCautionDrivers.length ? (
                            researchCautionDrivers.map((driver) => (
                              <div key={driver} className="rounded-2xl border border-amber-400/15 bg-amber-400/8 px-4 py-3 text-sm text-amber-50/90">
                                {driver}
                              </div>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/8 px-4 py-4 text-sm text-emerald-50/90">
                              No major caution flags are surfacing beyond normal slate variance in the current payload.
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Recent form interpretation</div>
                            <div className="mt-1 text-lg font-semibold text-white">Season baseline versus the current sample</div>
                          </div>
                          <Badge label={researchRecentReads.length ? 'DERIVED' : 'PLACEHOLDER'} kind={researchRecentReads.length ? 'DERIVED' : 'PLACEHOLDER'} />
                        </div>
                        <div className="mt-4 space-y-3">
                          {researchRecentReads.length ? (
                            researchRecentReads.map((item) => (
                              <div key={item.view.market} className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="flex flex-wrap gap-2">
                                    <Pill label={item.view.label} tone="amber" />
                                    <Badge label={item.kind} kind={item.kind} />
                                  </div>
                                  <div className="text-right text-xs text-zinc-500">{item.view.source}</div>
                                </div>
                                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                  <Stat dense label="L10 avg" value={n(item.recentAverage, 1)} kind={item.recentAverage == null ? 'PLACEHOLDER' : 'LIVE'} note="Current sample" />
                                  <Stat dense label="Season avg" value={n(item.seasonAverage, 1)} kind={item.seasonAverage == null ? 'PLACEHOLDER' : 'LIVE'} note="Season baseline" />
                                  <Stat dense label="Trend" value={signed(item.trend, 1)} kind={item.trend == null ? 'PLACEHOLDER' : 'DERIVED'} note={item.note} />
                                  <Stat dense label="Opp delta" value={signed(item.opponentDelta, 1)} kind={item.opponentDelta == null ? 'PLACEHOLDER' : 'LIVE'} note="Opponent-specific context" />
                                </div>
                                <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-300">
                                  Recent 5: <span className="font-mono text-xs text-zinc-200">{item.recentFive}</span>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-4 text-sm text-zinc-400">
                              Recent-form interpretation appears once the dossier has enough live or derived market context to rank.
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Matchup and role context</div>
                            <div className="mt-1 text-lg font-semibold text-white">Opponent read, defender note, and teammate context</div>
                          </div>
                          <Badge label={teamMatchup ? 'LIVE' : 'PLACEHOLDER'} kind={teamMatchup ? 'LIVE' : 'PLACEHOLDER'} />
                        </div>
                        <p className="mt-3 text-sm leading-6 text-zinc-300">{researchMatchupRead}</p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <Stat dense label="Team L10" value={n(researchTeamMarketLast10, 1)} kind={researchTeamMarketLast10 == null ? 'PLACEHOLDER' : 'LIVE'} note={researchLeadView ? `${researchRow.teamCode} ${researchLeadView.label}` : 'Team sample'} />
                          <Stat dense label="Opp allowed L10" value={n(researchOpponentMarketAllowedLast10, 1)} kind={researchOpponentMarketAllowedLast10 == null ? 'PLACEHOLDER' : 'LIVE'} note={researchLeadView ? `${researchRow.opponentCode} ${researchLeadView.label} allowed` : 'Opponent sample'} />
                          <Stat dense label="Season record" value={researchSeasonRecord ?? '-'} kind={researchSeasonRecord ? 'LIVE' : 'PLACEHOLDER'} note={`${researchRow.teamCode} overall`} />
                          <Stat dense label="Last10 record" value={researchLast10Record ?? '-'} kind={researchLast10Record ? 'LIVE' : 'PLACEHOLDER'} note={`${researchRow.teamCode} recent`} />
                        </div>
                        <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-zinc-300">
                          Teammates: {researchRow.playerContext.teammateCore.length ? researchRow.playerContext.teammateCore.slice(0, 3).map((mate) => `${mate.playerName} (${n(mate.avgMinutesLast10, 1)})`).join(' | ') : '-'}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    eyebrow="Research dossier"
                    title={hasActiveSearch ? 'No player on the current slate matched that search.' : 'No research row is selected.'}
                    detail={
                      hasActiveSearch
                        ? 'Try another player, team code, or matchup, or clear the search to restore the featured research queue.'
                        : 'Pick a player from the left rail or use the active-slate search to open a full dossier.'
                    }
                    actionLabel={hasActiveSearch ? 'Clear search' : 'Search Active Players'}
                    onAction={hasActiveSearch ? () => setSearchQuery('') : openResearchSearch}
                  />
                )}
              </div>
            </section>
          ) : null}
          {tab === 'scout' ? (
            <section className="mt-5 grid gap-6 xl:items-start xl:grid-cols-[1.35fr_0.85fr]">
              <div className="space-y-3">
                {boardFeedEvents.length === 0 ? (
                  <EmptyState
                    eyebrow="Board feed"
                    title="No pregame board events are available yet."
                    detail="This workspace fills as playable numbers surface, move materially, drop, and then lock at tipoff."
                    actionLabel="Refresh slate"
                    onAction={refreshSlate}
                  />
                ) : (
                  boardFeedEvents.map((event, i) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => setResearch(event.playerId)}
                      className={`w-full rounded-[28px] border border-white/10 bg-zinc-900/75 p-5 text-left ${CARD_BUTTON_CLASS}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <Badge label={`#${i + 1}`} kind="DERIVED" />
                            <Pill label={feedEventTitle(event)} tone="amber" />
                            <Pill label={feedStatusLabel(event)} tone={feedStatusTone(event)} />
                          </div>
                          <div className="mt-3 text-2xl font-semibold tracking-tight text-white">{event.playerName}</div>
                          <div className="mt-1 text-sm text-zinc-400">
                            {MARKET_LABELS[event.market]} | {event.matchupKey.replace('@', ' @ ')} - {event.gameTimeEt}
                          </div>
                          <div className="mt-2 text-sm text-zinc-300">{feedReason(event)}</div>
                        </div>
                        <div className={`w-full rounded-[20px] border px-4 py-3 text-left sm:w-auto sm:min-w-[250px] ${SIDE_CLASS[event.side]}`}>
                          <div className="text-[10px] uppercase tracking-[0.18em] opacity-60">Pregame snapshot</div>
                          <div className="mt-2 text-xl font-semibold tracking-tight">{event.recommendation}</div>
                          <div className="mt-1 text-xs opacity-80">{relativeTime(event.createdAt, now)}</div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <Stat
                          dense
                          label="Line to play"
                          value={event.line == null ? (event.fairLine == null ? '-' : n(event.fairLine)) : n(event.line)}
                          kind={event.line == null ? (event.fairLine == null ? 'PLACEHOLDER' : 'MODEL') : 'LIVE'}
                          note={event.line != null ? 'Last tracked pregame line' : event.fairLine != null ? 'Model fair line fallback' : 'No pregame line captured'}
                        />
                        <Stat dense label="Projection" value={event.projection == null ? '-' : n(event.projection)} kind={event.projection == null ? 'PLACEHOLDER' : 'MODEL'} note="Projection saved with the event" />
                        <Stat dense label="Gap" value={event.gap == null ? '-' : gapRead(event.gap)} kind={event.gap == null ? 'PLACEHOLDER' : 'DERIVED'} note="Projection vs pregame line" />
                        <Stat dense label="Confidence" value={event.confidence == null ? '-' : pct(event.confidence, 0)} kind={event.confidence == null ? 'PLACEHOLDER' : 'DERIVED'} note="Confidence at the time of the event" />
                        <Stat dense label="Books live" value={booksLiveLabel(event.booksLive) ?? '-'} kind={event.booksLive == null ? 'PLACEHOLDER' : 'LIVE'} note="Consensus books seen pregame" />
                      </div>
                    </button>
                  ))
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Feed summary</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Stat dense label="Events" value={n(boardFeedEvents.length, 0)} kind={boardFeedEvents.length ? 'LIVE' : 'PLACEHOLDER'} note="Pregame events stored today" />
                    <Stat dense label="Surfaced" value={n(boardFeedSummary.surfaced, 0)} kind={boardFeedSummary.surfaced ? 'DERIVED' : 'PLACEHOLDER'} note="New pregame numbers tracked" />
                    <Stat dense label="Moved" value={n(boardFeedSummary.moved, 0)} kind={boardFeedSummary.moved ? 'DERIVED' : 'PLACEHOLDER'} note="Material pregame changes" />
                    <Stat dense label="Locked" value={n(boardFeedSummary.locked, 0)} kind={boardFeedSummary.locked ? 'LIVE' : 'PLACEHOLDER'} note="Markets frozen at tipoff" />
                  </div>
                </div>
                <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Feed context</div>
                      <div className="mt-1 text-lg font-semibold text-white">Selected matchup pulse</div>
                    </div>
                    <Badge label={selectedMatchup ? 'DERIVED' : 'PLACEHOLDER'} kind={selectedMatchup ? 'DERIVED' : 'PLACEHOLDER'} />
                  </div>
                  {selectedMatchup ? (
                    <>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Pill label={selectedMatchup.label} tone="cyan" />
                        <Pill label={selectedMatchup.gameTimeEt} />
                        {selectedMatchupFocusLabel ? <Pill label={`Focus ${selectedMatchupFocusLabel}`} tone="amber" /> : null}
                      </div>
                      <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-zinc-300">
                        {selectedMatchupLead
                          ? `${selectedMatchupLead.row.playerName} ${selectedMatchupLead.label} is still the clearest current board lead for this matchup. Feed history beside it stays frozen once tipoff hits.`
                          : 'No clear lead spot is surfaced for the selected game yet.'}
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <Stat dense label="Player rows" value={n(selectedMatchupRows.length, 0)} kind={selectedMatchupRows.length ? 'LIVE' : 'PLACEHOLDER'} note="Rows in the selected game" />
                        <Stat dense label="Live lines" value={n(matchupLiveCount, 0)} kind={matchupLiveCount ? 'LIVE' : 'PLACEHOLDER'} note="Markets currently priced" />
                        <Stat dense label="Pregame events" value={n(boardFeedEvents.filter((event) => event.matchupKey === selectedMatchup.key).length, 0)} kind={boardFeedEvents.some((event) => event.matchupKey === selectedMatchup.key) ? 'DERIVED' : 'PLACEHOLDER'} note="Events stored for this matchup" />
                        <Stat dense label="Last event" value={ts(latestBoardFeedEvent?.createdAt)} kind={latestBoardFeedEvent ? 'LIVE' : 'PLACEHOLDER'} note="Most recent stored feed event" />
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-4 text-sm text-zinc-400">
                      Select a matchup in the lens above to keep this sidebar anchored to one game while you scan the board feed.
                    </div>
                  )}
                </div>
                <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Support note</div>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">
                    The board feed is now stored across refreshes and only tracks pregame changes. Once a game tips,
                    that player-market locks and stays historical instead of mutating off live-play movement.
                  </p>
                </div>
                <MatchupsCard
                  matchups={data.matchups}
                  selectedKey={selectedMatchupKey}
                  highlightedKey={highlightTarget?.kind === 'matchup' ? highlightTarget.key : null}
                  onSelect={(matchupKey) => setMatchupSelection(matchupKey, { highlight: true })}
                />
              </div>
            </section>
          ) : null}
          {tab === 'tracking' ? (
            <section className="mt-5 grid gap-6 xl:items-start xl:grid-cols-[1.55fr_0.85fr]">
              <div className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-900/75">
                <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Line tracking</div>
                    <div className="mt-1 text-lg font-semibold text-white">Current line vs fair line and recent production</div>
                  </div>
                  <Pill label="Current board snapshot" />
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-white/5 text-zinc-400">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Player / market</th>
                        <th className="px-4 py-3 text-left font-medium">Live line</th>
                        <th className="px-4 py-3 text-left font-medium">Fair</th>
                        <th className="px-4 py-3 text-left font-medium">Proj</th>
                        <th className="px-4 py-3 text-left font-medium">Edge</th>
                        <th className="px-4 py-3 text-left font-medium">Conf</th>
                        <th className="px-4 py-3 text-left font-medium">Trend</th>
                        <th className="px-4 py-3 text-left font-medium">Recent 5</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trackViews.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-6 text-sm text-zinc-400">
                            No line-tracking rows are available yet. Refresh the slate or return to the precision card while live lines load.
                          </td>
                        </tr>
                      ) : (
                        trackViews.map((v, i) => (
                          <tr key={`${v.row.playerId}:${v.market}`} className="border-t border-white/8 hover:bg-white/5">
                            <td className="px-4 py-4">
                              <button type="button" onClick={() => setResearch(v.row.playerId)} className="text-left">
                                <div className="flex items-center gap-2">
                                  <Badge label={`#${i + 1}`} kind="DERIVED" />
                                  <span className="font-semibold text-white">{v.row.playerName}</span>
                                </div>
                                <div className="mt-1 text-xs text-zinc-500">
                                  {v.row.matchupKey} - {v.label}
                                </div>
                              </button>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-col gap-1">
                                <span className="text-white">{v.live == null ? '-' : n(v.live)}</span>
                                <Badge label={v.liveLineKind} kind={v.liveLineKind} />
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-col gap-1">
                                <span className="text-white">{v.fair == null ? '-' : n(v.fair)}</span>
                                <Badge label={v.fairKind} kind={v.fairKind} />
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-col gap-1">
                                <span className="text-white">{v.proj == null ? '-' : n(v.proj)}</span>
                                <Badge label={v.projKind} kind={v.projKind} />
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-col gap-1">
                                <span className="text-white">{v.edge == null ? '-' : signed(v.edge)}</span>
                                <Badge label={v.edgeKind} kind={v.edgeKind} />
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-col gap-1">
                                <span className="text-white">{v.conf == null ? '-' : pct(v.conf, 1)}</span>
                                <Badge label={v.confKind} kind={v.confKind} />
                              </div>
                            </td>
                            <td className="px-4 py-4 text-zinc-300">{signed(v.row.trendVsSeason[v.market], 1)}</td>
                            <td className="px-4 py-4 font-mono text-xs text-zinc-300">{lineList(v.row.last5[v.market])}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Tracking summary</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Stat dense label="Live rows" value={n(data.rows.length, 0)} kind="LIVE" note="Board rows in play" />
                    <Stat dense label="Market views" value={n(allViews.length, 0)} kind="DERIVED" note="All row-market contexts" />
                    <Stat dense label="Live lines" value={n(liveCount, 0)} kind="LIVE" note="Markets with sportsbook lines" />
                    <Stat dense label="Qualified" value={n(qualifiedCount, 0)} kind="DERIVED" note="Precision-ready views" />
                  </div>
                </div>
                <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Tracking context</div>
                      <div className="mt-1 text-lg font-semibold text-white">Selected matchup pulse</div>
                    </div>
                    <Badge label={selectedMatchup ? 'DERIVED' : 'PLACEHOLDER'} kind={selectedMatchup ? 'DERIVED' : 'PLACEHOLDER'} />
                  </div>
                  {selectedMatchup ? (
                    <>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Pill label={selectedMatchup.label} tone="cyan" />
                        {selectedMatchupLead ? <Pill label={`${selectedMatchupLead.row.playerName} ${selectedMatchupLead.label}`} tone="amber" /> : null}
                        {!selectedMatchupLead && selectedMatchupFocusLabel ? <Pill label={`Focus ${selectedMatchupFocusLabel}`} tone="amber" /> : null}
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <Stat dense label="Player rows" value={n(selectedMatchupRows.length, 0)} kind={selectedMatchupRows.length ? 'LIVE' : 'PLACEHOLDER'} note="Rows in the selected game" />
                        <Stat dense label="Live lines" value={n(matchupLiveCount, 0)} kind={matchupLiveCount ? 'LIVE' : 'PLACEHOLDER'} note="Markets priced right now" />
                        <Stat dense label="Qualified" value={n(matchupQualifiedCount, 0)} kind={matchupQualifiedCount ? 'DERIVED' : 'PLACEHOLDER'} note="Precision-ready views" />
                        <Stat dense label="Last refresh" value={ts(data.lastUpdatedAt)} kind={data.lastUpdatedAt ? 'LIVE' : 'PLACEHOLDER'} note={boardRefreshRelative} />
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-4 text-sm text-zinc-400">
                      Select a matchup in the lens above to keep the tracking tab centered on one game while you compare lines.
                    </div>
                  )}
                </div>
                <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Current limitation</div>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">
                    SnapshotBoardData does not include full historical sportsbook movement. This tab therefore tracks the
                    current live line, the payload fair line, and recent production snapshots instead of fabricating a
                    movement history.
                  </p>
                </div>
                <MatchupsCard
                  matchups={data.matchups}
                  selectedKey={selectedMatchupKey}
                  highlightedKey={highlightTarget?.kind === 'matchup' ? highlightTarget.key : null}
                  onSelect={(matchupKey) => setMatchupSelection(matchupKey, { highlight: true })}
                />
              </div>
            </section>
          ) : null}
          </section>

          <section ref={helpRef} id="methodology" tabIndex={-1} className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_8px_30px_rgba(20,16,35,0.06)] scroll-mt-28 outline-none md:scroll-mt-32">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Method</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">How the board labels its numbers</h2>
              </div>
              <Badge label="Support" kind="DERIVED" />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <div className="text-sm font-semibold text-[var(--text)]">Live</div>
                <p className="mt-2 text-sm leading-6 text-[var(--text-2)]">Board date, matchup windows, player rows, live consensus lines, sportsbook counts, and supporting context read directly from SnapshotBoardData.</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <div className="text-sm font-semibold text-[var(--text)]">Derived</div>
                <p className="mt-2 text-sm leading-6 text-[var(--text-2)]">Client-side edges, board averages, ranking order, selector fallback picks, and confidence values converted from the raw payload live here.</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <div className="text-sm font-semibold text-[var(--text)]">Missing values</div>
                <p className="mt-2 text-sm leading-6 text-[var(--text-2)]">Unsupported values stay as dashes. Historical sportsbook movement is not present in SnapshotBoardData, so the board shows the current live number instead of inventing a line history.</p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}



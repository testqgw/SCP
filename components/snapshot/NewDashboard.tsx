'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SnapshotBoardFeedItem,
  SnapshotBoardViewData,
  SnapshotPrecisionAuditEntry,
  SnapshotDashboardPrecisionSignal,
  SnapshotDashboardRow,
  SnapshotDashboardSignal,
  SnapshotMarket,
  SnapshotModelSide,
  SnapshotPropSignalGrade,
  SnapshotPrecisionCardEntry,
  SnapshotPrecisionPickSignal,
} from '@/lib/types/snapshot';
import { getMeaningfulHistoricalAccuracy, resolvePickConfidenceRating } from '@/lib/snapshot/confidenceRating';
import {
  RUBBING_HANDS_115_ALL_WINDOW_LANE,
  RUBBING_HANDS_115_ALL_WINDOW_CONFIDENCE_PCT,
  RUBBING_HANDS_115_RESEARCH_LANE,
  RUBBING_HANDS_115_RESEARCH_CONFIDENCE_PCT,
  RUBBING_HANDS_115_RESEARCH_MARKETS,
  RUBBING_HANDS_115_RESEARCH_RANK_MAX,
  RUBBING_HANDS_115_WALK_FORWARD_LANE,
  getRubbingHands115Player,
} from '@/lib/snapshot/rubbingHands115Model';
import {
  TOP_PLAYER_200_SAMPLE_CONFIDENCE_PCT,
  TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_ACCURACY_PCT,
  TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_LANE,
  TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_MARKETS,
  TOP_PLAYER_200_SAMPLE_CURRENT_SLATE_DATE_ET,
  TOP_PLAYER_200_SAMPLE_META_ACCURACY_PCT,
  TOP_PLAYER_200_SAMPLE_META_CONFIDENCE_PCT,
  TOP_PLAYER_200_SAMPLE_META_MIN_HGB_CONFIDENCE_PCT,
  TOP_PLAYER_200_SAMPLE_MIN_SAMPLES,
  TOP_PLAYER_200_SAMPLE_MODEL_GENERATED_AT,
  TOP_PLAYER_200_SAMPLE_MODEL_LABEL,
  TOP_PLAYER_200_SAMPLE_POOL_SIZE,
  TOP_PLAYER_200_SAMPLE_QUALIFIED_COUNT,
  TOP_PLAYER_200_SAMPLE_RECENT_FORM_ACCURACY_PCT,
  TOP_PLAYER_200_SAMPLE_RECENT_FORM_LANE,
  TOP_PLAYER_200_SAMPLE_RECENT_FORM_MARKETS,
  TOP_PLAYER_200_SAMPLE_RUNTIME_ACCURACY_PCT,
  TOP_PLAYER_200_SAMPLE_TOP6_ACCURACY_PCT,
  TOP_PLAYER_200_SAMPLE_TOP6_LANE,
  TOP_PLAYER_200_SAMPLE_TOP6_MIN_HGB_CONFIDENCE_PCT,
  TOP_PLAYER_200_SAMPLE_TOP6_PICK_COUNT,
  TOP_PLAYER_200_SAMPLE_VOLUME_CONFIDENCE_PCT,
  TOP_PLAYER_200_SAMPLE_VOLUME_RUNTIME_ACCURACY_PCT,
  getTopPlayer200SampleCurrentSlateScore,
  getTopPlayer200SamplePropPlayer,
} from '@/lib/snapshot/topPlayer200SamplePropModel';

type Tab = 'overview' | 'precision' | 'rubbing' | 'research' | 'scout' | 'tracking';
type ViewKey = 'overview' | 'precision' | 'rubbing' | 'players' | 'feed' | 'tracker' | 'method';
type RubbingSort = 'confidence' | 'edge' | 'books';
type RubbingPickFilter =
  | 'all'
  | 'allWindow'
  | 'research'
  | 'sample200'
  | 'sample200Volume'
  | 'sample200Meta'
  | 'sample200Top6'
  | 'sample200Coverage'
  | 'sample200Recent';
type TrackerSort = 'gap' | 'confidence' | 'books';
type TrackerStatusFilter = 'all' | 'pregame' | 'locked' | 'fair';
type TrackerBooksFilter = 'all' | '3plus' | '5plus';
type Kind = 'LIVE' | 'DERIVED' | 'PLACEHOLDER' | 'MODEL';
type HighlightTarget = { kind: 'player' | 'matchup'; key: string } | null;

const TRACKER_PAGE_SIZE = 18;
const RUBBING_PAGE_SIZE = 24;
const RUBBING_DEFAULT_PICK_FILTER: RubbingPickFilter = 'sample200Coverage';
const RUBBING_115_MIN_LIVE_BOOKS = 3;
const RUBBING_115_ALL_WINDOW_REPLAY_LANE = RUBBING_HANDS_115_ALL_WINDOW_LANE ?? RUBBING_HANDS_115_WALK_FORWARD_LANE;
const RUBBING_115_RESEARCH_MARKET_SET = new Set<SnapshotMarket>(RUBBING_HANDS_115_RESEARCH_MARKETS as SnapshotMarket[]);
const TOP_PLAYER_200_RECENT_FORM_MARKET_SET = new Set<SnapshotMarket>(
  TOP_PLAYER_200_SAMPLE_RECENT_FORM_MARKETS as SnapshotMarket[],
);
const TOP_PLAYER_200_COVERAGE_FRONTIER_MARKET_SET = new Set<SnapshotMarket>(
  TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_MARKETS as SnapshotMarket[],
);

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
  { id: 'overview', label: 'Overview', hint: 'Best board setups' },
  { id: 'precision', label: 'Precision Picks', hint: 'Promoted model picks' },
  { id: 'rubbing', label: 'Rubbing Hands', hint: '200+ sample model' },
  { id: 'research', label: 'Players', hint: 'Player dossiers' },
  { id: 'scout', label: 'Feed', hint: 'Live board signals' },
  { id: 'tracking', label: 'Tracker', hint: 'Sortable market tracker' },
];

const TAB_TO_VIEW: Record<Tab, ViewKey> = {
  overview: 'overview',
  precision: 'precision',
  rubbing: 'rubbing',
  research: 'players',
  scout: 'feed',
  tracking: 'tracker',
};

const VIEW_TO_TAB: Partial<Record<ViewKey, Tab>> = {
  overview: 'overview',
  precision: 'precision',
  rubbing: 'rubbing',
  players: 'research',
  feed: 'scout',
  tracker: 'tracking',
};

const TOP_NAV: Array<{ label: string; tab?: Tab; action?: 'help' }> = [
  { label: 'Overview', tab: 'overview' },
  { label: 'Precision Picks', tab: 'precision' },
  { label: 'Rubbing Hands', tab: 'rubbing' },
  { label: 'Players', tab: 'research' },
  { label: 'Feed', tab: 'scout' },
  { label: 'Tracker', tab: 'tracking' },
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

const SURFACE_TONE_CLASS: Record<'default' | 'cyan' | 'amber', string> = {
  default: 'border-[var(--border)] bg-[var(--surface-2)]',
  cyan: 'border-[color:rgba(109,74,255,0.18)] bg-[var(--accent-soft)]',
  amber: 'border-[color:rgba(183,129,44,0.22)] bg-[color:rgba(183,129,44,0.10)]',
};

const SIDE_CLASS: Record<SnapshotModelSide, string> = {
  OVER: 'border-[color:rgba(47,125,90,0.20)] bg-[color:rgba(47,125,90,0.10)] text-[var(--positive)]',
  UNDER: 'border-[color:rgba(180,74,74,0.20)] bg-[color:rgba(180,74,74,0.10)] text-[var(--negative)]',
  NEUTRAL: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]',
};

const ACTION_CLASS =
  'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(109,74,255,0.35)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]';

const CARD_BUTTON_CLASS = `${ACTION_CLASS} hover:-translate-y-0.5 hover:border-[color:rgba(109,74,255,0.24)] hover:shadow-[0_10px_24px_rgba(29,26,34,0.06)]`;
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

type PrecisionConfidenceLike = {
  side?: SnapshotModelSide | null;
  qualified?: boolean;
  historicalAccuracy?: number | null;
  projectionWinProbability?: number | null;
  projectionPriceEdge?: number | null;
  absLineGap?: number | null;
  selectionScore?: number | null;
};

function normalizePrecisionSignal(
  precision: SnapshotDashboardPrecisionSignal | SnapshotPrecisionPickSignal | null | undefined,
): SnapshotDashboardPrecisionSignal | null {
  if (!precision) return null;
  return {
    side: precision.side,
    qualified: precision.qualified,
    historicalAccuracy: meaningfulHistoricalAccuracy(precision),
    projectionWinProbability: precision.projectionWinProbability ?? null,
    projectionPriceEdge: precision.projectionPriceEdge ?? null,
    absLineGap: precision.absLineGap ?? null,
    selectionScore: precision.selectionScore ?? null,
    selectorFamily: precision.selectorFamily ?? null,
    selectorTier: precision.selectorTier ?? null,
    reasons: precision.reasons,
  };
}

function meaningfulHistoricalAccuracy(precision: PrecisionConfidenceLike | null | undefined) {
  return getMeaningfulHistoricalAccuracy(precision);
}

function resolveViewConfidence(
  precision: PrecisionConfidenceLike | null | undefined,
  liveSignal: SnapshotDashboardSignal | null | undefined,
) {
  return resolvePickConfidenceRating({ precisionSignal: precision, liveSignal });
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
  signalGrade: SnapshotPropSignalGrade | null;
  precision: SnapshotDashboardPrecisionSignal | null;
};

type PrecisionStateSummary = {
  label: 'Precision pick' | 'Precision qualified' | 'Board read only';
  tone: 'default' | 'cyan' | 'amber';
  kind: Kind;
  summary: string;
  detail: string | null;
  reasons: string[];
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

function signalGradeValue(signalGrade: SnapshotPropSignalGrade | null | undefined) {
  if (!signalGrade) return '-';
  return `${signalGrade.grade} / ${n(signalGrade.scorePct, 0)}%`;
}

function signalGradeNote(signalGrade: SnapshotPropSignalGrade | null | undefined) {
  if (!signalGrade) {
    return 'General signal tracking is only available for PTS, REB, and AST when enough live context is present.';
  }
  const leadReason = signalGrade.reasons[0];
  return leadReason ? `${signalGrade.summary} ${leadReason}` : signalGrade.summary;
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

function cleanReasonLine(value: string | null | undefined) {
  const sentence = firstSentence(value);
  if (!sentence) return null;
  return sentence.length > 150 ? `${sentence.slice(0, 147).trimEnd()}...` : sentence;
}

function precisionQualificationReasons(view: View, promoted = false) {
  const reasons: string[] = [];
  const basisLabel = view.live != null ? 'live line' : view.fair != null ? 'board fair line' : 'current board basis';

  if (promoted) {
    reasons.push('This is the current promoted board selection.');
  }
  if (view.edge != null) {
    reasons.push(`Projection sits ${gapRead(view.edge)} the ${basisLabel}.`);
  }
  if (view.books != null) {
    reasons.push(`${booksCountLabel(view.books)} are contributing to the current number.`);
  }
  if (view.conf != null) {
    reasons.push(`Confidence is ${pct(view.conf, 0)} on ${view.label}.`);
  }

  const precisionReason = cleanReasonLine((view.precision?.reasons ?? [])[0] ?? null);
  if (precisionReason) {
    reasons.push(precisionReason);
  }

  return reasons.slice(0, 4);
}

function precisionAuditLabel(entry: SnapshotPrecisionAuditEntry | null | undefined) {
  if (!entry) return 'Pending board audit';
  if (entry.status === 'ACTIVE') return 'Active';
  if (entry.status === 'LOCKED') return 'Locked at tipoff';
  if (entry.outcome === 'WIN') return 'Settled win';
  if (entry.outcome === 'LOSS') return 'Settled loss';
  if (entry.outcome === 'PUSH') return 'Settled push';
  return 'Settled';
}

function precisionAuditTone(entry: SnapshotPrecisionAuditEntry | null | undefined): 'default' | 'cyan' | 'amber' {
  if (!entry) return 'default';
  if (entry.status === 'ACTIVE') return 'cyan';
  if (entry.status === 'LOCKED') return 'amber';
  return 'default';
}

function precisionAuditRead(entry: SnapshotPrecisionAuditEntry | null | undefined, market: SnapshotMarket) {
  if (!entry) return 'This promoted pick is waiting for its first audit update.';
  if (entry.status === 'ACTIVE') {
    return 'Pregame-safe and still tracking before tipoff.';
  }
  if (entry.status === 'LOCKED') {
    return 'Pregame tracking froze at tipoff. Settlement will post after the final stat closes.';
  }
  if (entry.actualValue == null) {
    return 'The game settled, but the final stat has not posted into the board yet.';
  }
  const actualLabel = `${MARKET_LABELS[market]} ${n(entry.actualValue, 1)}`;
  if (entry.outcome === 'WIN') {
    return `${actualLabel} cleared the promoted precision line.`;
  }
  if (entry.outcome === 'LOSS') {
    return `${actualLabel} missed the promoted precision line.`;
  }
  if (entry.outcome === 'PUSH') {
    return `${actualLabel} landed exactly on the promoted precision line.`;
  }
  return `${actualLabel} is posted for audit review.`;
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

function feedEventTypeLabel(eventType: SnapshotBoardFeedItem['eventType']) {
  if (eventType === 'SURFACED') return 'Surfaced';
  if (eventType === 'LOCKED') return 'Locked';
  if (eventType === 'DROPPED') return 'Dropped';
  return 'Moved';
}

function feedEventTypeTone(eventType: SnapshotBoardFeedItem['eventType']): 'default' | 'cyan' | 'amber' {
  if (eventType === 'SURFACED') return 'cyan';
  if (eventType === 'LOCKED') return 'amber';
  return 'default';
}

function trackerRowKey(view: Pick<View, 'row' | 'market'>) {
  return `${view.row.playerId}:${view.market}`;
}

function trackerStatusLabel(status: TrackerStatusFilter) {
  if (status === 'locked') return 'Locked';
  if (status === 'fair') return 'Fair only';
  return 'Pregame';
}

function trackerStatusTone(status: TrackerStatusFilter): 'default' | 'cyan' | 'amber' {
  if (status === 'locked') return 'amber';
  if (status === 'pregame') return 'cyan';
  return 'default';
}

function isAvailabilityRemoved(row: SnapshotDashboardRow) {
  const status = row.playerContext.availabilityStatus;
  if (status === 'OUT' || status === 'DOUBTFUL') return true;
  if ((row.playerContext.availabilityPercentPlay ?? 100) <= 0) return true;
  return false;
}

function isAvailabilityWatch(row: SnapshotDashboardRow) {
  const status = row.playerContext.availabilityStatus;
  if (!status || status === 'ACTIVE') return false;
  if (isAvailabilityRemoved(row)) return false;
  return status === 'QUESTIONABLE' || (row.playerContext.availabilityPercentPlay ?? 100) < 85;
}

function rubbingAvailabilityLabel(row: SnapshotDashboardRow) {
  const availability = availabilityRead(row.playerContext);
  if (availability) return availability;
  if (row.playerContext.lineupStarter === true) return 'Starter confirmed';
  if (row.playerContext.lineupStarter === false) return row.playerContext.lineupStatus ?? 'Bench or role watch';
  return row.playerContext.lineupStatus ?? 'No injury flag';
}

function rubbingAvailabilityTone(row: SnapshotDashboardRow): 'default' | 'cyan' | 'amber' {
  if (isAvailabilityRemoved(row) || isAvailabilityWatch(row)) return 'amber';
  if (row.playerContext.lineupStarter === true) return 'cyan';
  return 'default';
}

function rubbingPropStatusLabel(row: SnapshotDashboardRow) {
  if (isAvailabilityRemoved(row)) return 'Removed by injury';
  if (isAvailabilityWatch(row)) return 'Injury watch';
  return 'Active prop';
}

function rubbingPropStatusTone(row: SnapshotDashboardRow): 'default' | 'cyan' | 'amber' {
  if (isAvailabilityRemoved(row) || isAvailabilityWatch(row)) return 'amber';
  return 'cyan';
}

function isDirectionalSide(side: SnapshotModelSide | null | undefined): side is Exclude<SnapshotModelSide, 'NEUTRAL'> {
  return side === 'OVER' || side === 'UNDER';
}

function rubbingHands115Player(view: View) {
  return getRubbingHands115Player({ playerId: view.row.playerId, playerName: view.row.playerName });
}

function topPlayer200SamplePlayer(view: View) {
  return getTopPlayer200SamplePropPlayer({ playerId: view.row.playerId, playerName: view.row.playerName });
}

function topPlayer200SampleScore(view: View, dateEt: string) {
  return getTopPlayer200SampleCurrentSlateScore({ dateEt, playerId: view.row.playerId, market: view.market });
}

function rubbingHands115Side(view: View): SnapshotModelSide {
  const runtimeSide = marketRuntimeFor(view.row, view.market)?.finalSide;
  if (isDirectionalSide(runtimeSide)) return runtimeSide;
  if (view.precision?.qualified && isDirectionalSide(view.precision.side)) return view.precision.side;
  return isDirectionalSide(view.side) ? view.side : 'NEUTRAL';
}

function topPlayer200SampleSide(view: View, dateEt: string): SnapshotModelSide {
  const score = topPlayer200SampleScore(view, dateEt);
  if (score?.wfSide === 'OVER' || score?.wfSide === 'UNDER') return score.wfSide;
  return rubbingHands115Side(view);
}

function rubbingHands115Headline(view: View) {
  return recommendationHeadline({ ...view, side: rubbingHands115Side(view) });
}

function topPlayer200SampleHeadline(view: View, dateEt: string) {
  return recommendationHeadline({ ...view, side: topPlayer200SampleSide(view, dateEt) });
}

function rubbingHands115SideSource(view: View) {
  const runtime = marketRuntimeFor(view.row, view.market);
  if (isDirectionalSide(runtime?.finalSide)) {
    if (runtime?.source === 'player_override') return 'Player override side';
    if (runtime?.source === 'universal_qualified') return 'Universal model side';
    if (runtime?.source === 'baseline') return 'Baseline side';
    return 'Runtime side';
  }
  if (view.precision?.qualified && isDirectionalSide(view.precision.side)) return 'Precision side';
  return 'Projection side';
}

function rubbingProjectionLeanLabel(view: View, modelSide: SnapshotModelSide = rubbingHands115Side(view)) {
  const projectionSide = isDirectionalSide(view.side) ? view.side : null;
  if (!projectionSide) return null;
  return projectionSide === modelSide ? 'Projection agrees' : `Projection leans ${projectionSide}`;
}

function rubbingHands115PlayerKey(view: View) {
  return rubbingHands115Player(view)?.playerId ?? view.row.playerId ?? view.row.playerName;
}

function topPlayer200SamplePlayerKey(view: View) {
  return topPlayer200SamplePlayer(view)?.playerId ?? view.row.playerId ?? view.row.playerName;
}

function compareRubbingHands115Views(a: View, b: View) {
  const confidence = (b.conf ?? -1) - (a.conf ?? -1);
  if (confidence !== 0) return confidence;
  const edge = Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0);
  if (edge !== 0) return edge;
  const score = b.score - a.score;
  if (score !== 0) return score;
  const books = (b.books ?? -1) - (a.books ?? -1);
  if (books !== 0) return books;
  return (rubbingHands115Player(a)?.qualityRank ?? 999) - (rubbingHands115Player(b)?.qualityRank ?? 999);
}

function isTopPlayer200SampleFilter(filter: RubbingPickFilter) {
  return (
    filter === 'sample200' ||
    filter === 'sample200Volume' ||
    filter === 'sample200Meta' ||
    filter === 'sample200Top6' ||
    filter === 'sample200Coverage' ||
    filter === 'sample200Recent'
  );
}

function isTopPlayer200HgbFilter(filter: RubbingPickFilter) {
  return filter === 'sample200' || filter === 'sample200Volume' || filter === 'sample200Meta' || filter === 'sample200Top6';
}

function isTopPlayer200RecentFormFilter(filter: RubbingPickFilter) {
  return filter === 'sample200Recent';
}

function isTopPlayer200CoverageFilter(filter: RubbingPickFilter) {
  return filter === 'sample200Coverage';
}

function projectionSideFromEdge(edge: number | null | undefined): SnapshotModelSide {
  if (edge == null || Number.isNaN(edge)) return 'NEUTRAL';
  if (edge > 0) return 'OVER';
  if (edge < 0) return 'UNDER';
  return 'NEUTRAL';
}

function topPlayer200SampleHgbConfidencePct(view: View, dateEt: string) {
  const score = topPlayer200SampleScore(view, dateEt);
  return score ? score.wfConfidence * 100 : null;
}

function topPlayer200SampleMetaConfidencePct(view: View, dateEt: string) {
  const score = topPlayer200SampleScore(view, dateEt);
  return score?.metaProbCorrect != null ? score.metaProbCorrect * 100 : null;
}

function topPlayer200SampleLaneConfidencePct(view: View, dateEt: string, filter: RubbingPickFilter = RUBBING_DEFAULT_PICK_FILTER) {
  if (filter === 'sample200Coverage' || filter === 'sample200Recent') return view.conf;
  if (filter === 'sample200Meta') return topPlayer200SampleMetaConfidencePct(view, dateEt);
  return topPlayer200SampleHgbConfidencePct(view, dateEt);
}

function compareTopPlayer200SampleViews(a: View, b: View, dateEt: string, filter: RubbingPickFilter = 'sample200') {
  const confidence =
    (topPlayer200SampleLaneConfidencePct(b, dateEt, filter) ?? -1) -
    (topPlayer200SampleLaneConfidencePct(a, dateEt, filter) ?? -1);
  if (confidence !== 0) return confidence;
  if (filter === 'sample200Meta') {
    const hgbConfidence = (topPlayer200SampleHgbConfidencePct(b, dateEt) ?? -1) - (topPlayer200SampleHgbConfidencePct(a, dateEt) ?? -1);
    if (hgbConfidence !== 0) return hgbConfidence;
  }
  const edge = Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0);
  if (edge !== 0) return edge;
  const score = b.score - a.score;
  if (score !== 0) return score;
  const books = (b.books ?? -1) - (a.books ?? -1);
  if (books !== 0) return books;
  return (topPlayer200SamplePlayer(a)?.sampleRank ?? 999) - (topPlayer200SamplePlayer(b)?.sampleRank ?? 999);
}

function compareTopPlayer200RecentFormViews(a: View, b: View) {
  const edge = Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0);
  if (edge !== 0) return edge;
  const minutes =
    (b.row.playerContext.projectedMinutes ?? Number.NEGATIVE_INFINITY) -
    (a.row.playerContext.projectedMinutes ?? Number.NEGATIVE_INFINITY);
  if (minutes !== 0) return minutes;
  const confidence = (b.conf ?? -1) - (a.conf ?? -1);
  if (confidence !== 0) return confidence;
  const books = (b.books ?? -1) - (a.books ?? -1);
  if (books !== 0) return books;
  return (topPlayer200SamplePlayer(a)?.sampleRank ?? 999) - (topPlayer200SamplePlayer(b)?.sampleRank ?? 999);
}

function isRubbingModelPick(view: View) {
  const modelPlayer = rubbingHands115Player(view);
  const modelSide = rubbingHands115Side(view);
  const hasUsableLine = view.live != null && (view.books ?? 0) >= RUBBING_115_MIN_LIVE_BOOKS;
  const hasProjection = view.proj != null;
  const hasDirection = modelSide !== 'NEUTRAL';
  const hasConfidence = view.conf != null;
  return Boolean(modelPlayer && hasUsableLine && hasProjection && hasDirection && hasConfidence);
}

function isTopPlayer200SampleModelPick(view: View, dateEt: string) {
  const modelPlayer = topPlayer200SamplePlayer(view);
  const score = topPlayer200SampleScore(view, dateEt);
  const modelSide = topPlayer200SampleSide(view, dateEt);
  const hasUsableLine = view.live != null && (view.books ?? 0) >= RUBBING_115_MIN_LIVE_BOOKS;
  const hasProjection = view.proj != null;
  const hasDirection = modelSide !== 'NEUTRAL';
  const hasConfidence = score?.wfConfidence != null;
  return Boolean(modelPlayer && score && hasUsableLine && hasProjection && hasDirection && hasConfidence);
}

function selectRubbingHands115Views(views: View[]) {
  const bestByPlayer = new Map<string, View>();
  views.forEach((view) => {
    if (!isRubbingModelPick(view)) return;
    const key = rubbingHands115PlayerKey(view);
    const current = bestByPlayer.get(key);
    if (!current || compareRubbingHands115Views(view, current) < 0) {
      bestByPlayer.set(key, view);
    }
  });
  return Array.from(bestByPlayer.values()).sort(compareRubbingHands115Views);
}

function selectTopPlayer200SampleViews(views: View[], dateEt: string, filter: RubbingPickFilter = 'sample200') {
  const bestByPlayer = new Map<string, View>();
  views.forEach((view) => {
    if (!isTopPlayer200SampleModelPick(view, dateEt)) return;
    const key = topPlayer200SamplePlayerKey(view);
    const current = bestByPlayer.get(key);
    if (!current || compareTopPlayer200SampleViews(view, current, dateEt, filter) < 0) {
      bestByPlayer.set(key, view);
    }
  });
  return Array.from(bestByPlayer.values()).sort((a, b) => compareTopPlayer200SampleViews(a, b, dateEt, filter));
}

function isTopPlayer200RecentFormLanePick(view: View) {
  const runtime = marketRuntimeFor(view.row, view.market);
  const modelPlayer = topPlayer200SamplePlayer(view);
  const projectionSide = projectionSideFromEdge(view.edge);
  const modelSide = rubbingHands115Side(view);
  const projectedMinutes = view.row.playerContext.projectedMinutes;
  return Boolean(
    modelPlayer &&
      TOP_PLAYER_200_RECENT_FORM_MARKET_SET.has(view.market) &&
      view.live != null &&
      (view.books ?? 0) >= RUBBING_115_MIN_LIVE_BOOKS &&
      view.proj != null &&
      runtime?.source === TOP_PLAYER_200_SAMPLE_RECENT_FORM_LANE.requiredSource &&
      modelSide === TOP_PLAYER_200_SAMPLE_RECENT_FORM_LANE.requiredSide &&
      projectionSide === TOP_PLAYER_200_SAMPLE_RECENT_FORM_LANE.requiredProjectionSide &&
      (view.edge ?? 0) >= TOP_PLAYER_200_SAMPLE_RECENT_FORM_LANE.minAbsLineGap &&
      projectedMinutes != null &&
      projectedMinutes >= TOP_PLAYER_200_SAMPLE_RECENT_FORM_LANE.minProjectedMinutes,
  );
}

function selectTopPlayer200RecentFormViews(views: View[]) {
  const bestByPlayer = new Map<string, View>();
  views.forEach((view) => {
    if (!isTopPlayer200RecentFormLanePick(view)) return;
    const key = topPlayer200SamplePlayerKey(view);
    const current = bestByPlayer.get(key);
    if (!current || compareTopPlayer200RecentFormViews(view, current) < 0) {
      bestByPlayer.set(key, view);
    }
  });
  return Array.from(bestByPlayer.values()).sort(compareTopPlayer200RecentFormViews);
}

function isTopPlayer200CoverageFrontierLanePick(view: View) {
  const runtime = marketRuntimeFor(view.row, view.market);
  const modelPlayer = topPlayer200SamplePlayer(view);
  const projectionSide = projectionSideFromEdge(view.edge);
  const modelSide = rubbingHands115Side(view);
  const projectedMinutes = view.row.playerContext.projectedMinutes;
  return Boolean(
    modelPlayer &&
      TOP_PLAYER_200_COVERAGE_FRONTIER_MARKET_SET.has(view.market) &&
      view.live != null &&
      (view.books ?? 0) >= RUBBING_115_MIN_LIVE_BOOKS &&
      view.proj != null &&
      runtime?.source === TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_LANE.requiredSource &&
      modelSide !== 'NEUTRAL' &&
      projectionSide !== 'NEUTRAL' &&
      modelSide !== projectionSide &&
      (view.edge ?? 0) !== 0 &&
      Math.abs(view.edge ?? 0) >= TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_LANE.minAbsLineGap &&
      projectedMinutes != null &&
      projectedMinutes >= TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_LANE.minProjectedMinutes,
  );
}

function selectTopPlayer200CoverageFrontierViews(views: View[]) {
  const bestByPlayer = new Map<string, View>();
  views.forEach((view) => {
    if (!isTopPlayer200CoverageFrontierLanePick(view)) return;
    const key = topPlayer200SamplePlayerKey(view);
    const current = bestByPlayer.get(key);
    if (!current || compareTopPlayer200RecentFormViews(view, current) < 0) {
      bestByPlayer.set(key, view);
    }
  });
  return Array.from(bestByPlayer.values()).sort(compareTopPlayer200RecentFormViews);
}

function isRubbingHands115AllWindowPick(view: View) {
  return (view.conf ?? -1) >= RUBBING_HANDS_115_ALL_WINDOW_CONFIDENCE_PCT;
}

function isTopPlayer200SampleLanePick(view: View, dateEt: string, filter: RubbingPickFilter = 'sample200') {
  if (filter === 'sample200Meta') {
    return (
      topPlayer200SamplePlayer(view) != null &&
      (topPlayer200SampleMetaConfidencePct(view, dateEt) ?? -1) >= TOP_PLAYER_200_SAMPLE_META_CONFIDENCE_PCT &&
      (topPlayer200SampleHgbConfidencePct(view, dateEt) ?? -1) >= TOP_PLAYER_200_SAMPLE_META_MIN_HGB_CONFIDENCE_PCT
    );
  }
  if (filter === 'sample200Top6') {
    return (
      topPlayer200SamplePlayer(view) != null &&
      (topPlayer200SampleHgbConfidencePct(view, dateEt) ?? -1) >= TOP_PLAYER_200_SAMPLE_TOP6_MIN_HGB_CONFIDENCE_PCT
    );
  }
  const threshold = filter === 'sample200Volume' ? TOP_PLAYER_200_SAMPLE_VOLUME_CONFIDENCE_PCT : TOP_PLAYER_200_SAMPLE_CONFIDENCE_PCT;
  return topPlayer200SamplePlayer(view) != null && (topPlayer200SampleHgbConfidencePct(view, dateEt) ?? -1) >= threshold;
}

function isRubbingHands115ResearchPick(view: View) {
  const modelPlayer = rubbingHands115Player(view);
  return (
    (modelPlayer?.qualityRank ?? Number.POSITIVE_INFINITY) <= RUBBING_HANDS_115_RESEARCH_RANK_MAX &&
    RUBBING_115_RESEARCH_MARKET_SET.has(view.market) &&
    (view.conf ?? -1) >= RUBBING_HANDS_115_RESEARCH_CONFIDENCE_PCT
  );
}

function rubbingLaneLabel(view: View, filter: RubbingPickFilter = RUBBING_DEFAULT_PICK_FILTER, dateEt = '') {
  if (filter === 'sample200Coverage' && isTopPlayer200CoverageFrontierLanePick(view)) return `${n(TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_ACCURACY_PCT, 2)}% expanded lane`;
  if (filter === 'sample200Recent' && isTopPlayer200RecentFormLanePick(view)) return `${n(TOP_PLAYER_200_SAMPLE_RECENT_FORM_ACCURACY_PCT, 2)}% recent-form lane`;
  if (filter === 'sample200Top6' && isTopPlayer200SampleLanePick(view, dateEt, filter)) return `${n(TOP_PLAYER_200_SAMPLE_TOP6_ACCURACY_PCT, 2)}% 200+ top-6 lane`;
  if (filter === 'sample200Meta' && isTopPlayer200SampleLanePick(view, dateEt, filter)) return `${n(TOP_PLAYER_200_SAMPLE_META_ACCURACY_PCT, 2)}% 200+ meta lane`;
  if (filter === 'sample200Volume' && isTopPlayer200SampleLanePick(view, dateEt, filter)) return `${n(TOP_PLAYER_200_SAMPLE_VOLUME_RUNTIME_ACCURACY_PCT, 2)}% 200+ volume lane`;
  if (filter === 'sample200' && isTopPlayer200SampleLanePick(view, dateEt, filter)) return `${n(TOP_PLAYER_200_SAMPLE_RUNTIME_ACCURACY_PCT, 2)}% 200+ strict lane`;
  if (isRubbingHands115ResearchPick(view)) return `${n(RUBBING_HANDS_115_RESEARCH_LANE?.accuracyPct ?? null, 2)}% research lane`;
  if (isRubbingHands115AllWindowPick(view)) return `${n(RUBBING_115_ALL_WINDOW_REPLAY_LANE.accuracyPct, 2)}% all-window lane`;
  return 'Legacy 115-player lane';
}

function rubbingPickFilterLabel(value: RubbingPickFilter) {
  if (value === 'sample200Coverage') return `${n(TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_ACCURACY_PCT, 2)}% expanded picks`;
  if (value === 'sample200Recent') return `${n(TOP_PLAYER_200_SAMPLE_RECENT_FORM_ACCURACY_PCT, 2)}% recent-form picks`;
  if (value === 'sample200Top6') return `${n(TOP_PLAYER_200_SAMPLE_TOP6_ACCURACY_PCT, 2)}% 200+ top-6 picks`;
  if (value === 'sample200Meta') return `${n(TOP_PLAYER_200_SAMPLE_META_ACCURACY_PCT, 2)}% 200+ meta picks`;
  if (value === 'sample200') return `${n(TOP_PLAYER_200_SAMPLE_RUNTIME_ACCURACY_PCT, 2)}% 200+ strict picks`;
  if (value === 'sample200Volume') return `${n(TOP_PLAYER_200_SAMPLE_VOLUME_RUNTIME_ACCURACY_PCT, 2)}% 200+ volume picks`;
  if (value === 'allWindow') return `${n(RUBBING_115_ALL_WINDOW_REPLAY_LANE.accuracyPct, 2)}% all-window picks`;
  if (value === 'research') return `${n(RUBBING_HANDS_115_RESEARCH_LANE?.accuracyPct ?? null, 2)}% research picks`;
  return 'legacy 115-player picks';
}

function rubbingPoolLabel(value: RubbingPickFilter) {
  if (isTopPlayer200SampleFilter(value)) return '200+ sample eligible rows';
  if (value === 'allWindow') return 'all-window eligible rows';
  if (value === 'research') return 'research eligible rows';
  return 'legacy 115-player eligible rows';
}

function rubbingExternalNote(view: View) {
  const notes: string[] = [];
  const modelPlayer = rubbingHands115Player(view);
  const samplePlayer = topPlayer200SamplePlayer(view);
  if (modelPlayer) notes.push(`#${n(modelPlayer.qualityRank, 0)} in 115-player quality pool`);
  if (samplePlayer) notes.push(`#${n(samplePlayer.sampleRank, 0)} in 200+ sample pool; ${n(samplePlayer.samples, 0)} rows`);
  const context = view.row.playerContext;
  const availability = availabilityRead(context);
  if (availability) notes.push(availability);
  if (context.projectedMinutes != null) notes.push(`${n(context.projectedMinutes, 1)} projected min`);
  if (view.books != null) notes.push(booksLiveLabel(view.books) ?? `${n(view.books, 0)} books`);

  const synergy = context.teammateSynergies?.find(
    (item) => item.targetMarket === view.market && item.likelyActiveTrigger && item.activeToday,
  );
  if (synergy) {
    const sign = synergy.delta >= 0 ? '+' : '';
    notes.push(`${synergy.teammateName} ${synergy.triggerLabel}: ${sign}${n(synergy.delta, 1)} ${MARKET_LABELS[view.market]}`);
  }

  if (context.primaryDefender?.matchupReason) {
    notes.push(`Defender: ${context.primaryDefender.matchupReason}`);
  }

  if (view.row.dataCompleteness.score != null) {
    notes.push(`Data ${pct(view.row.dataCompleteness.score, 0)} ${view.row.dataCompleteness.tier}`);
  }

  return notes.slice(0, 4).join(' | ') || 'No extra context in current payload';
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

function marketRuntimeFor(row: SnapshotDashboardRow, market: SnapshotMarket) {
  return row.marketRuntime?.[market] ?? null;
}

function viewFor(
  row: SnapshotDashboardRow,
  market: SnapshotMarket,
  entry: SnapshotPrecisionCardEntry | null = null,
): View {
  const liveSignal = signal(row, market);
  const precision = normalizePrecisionSignal(entry?.precisionSignal ?? row.precisionSignals?.[market] ?? null);
  const runtime = marketRuntimeFor(row, market);
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
  const usesDerivedConfidence = precision != null;
  const conf = resolveViewConfidence(precision, liveSignal);
  const usesDerivedEdge = proj != null && basis != null;
  const edge = usesDerivedEdge ? Number((proj - basis).toFixed(1)) : precision?.projectionPriceEdge ?? null;
  const liveBooks = live != null && (liveSignal?.sportsbookCount ?? 0) > 0 ? (liveSignal?.sportsbookCount ?? null) : null;
  const reasons = [...(precision?.reasons ?? []).slice(0, 2), ...(liveSignal?.passReasons ?? []).slice(0, 2)].filter(Boolean);
  const signalGrade = runtime?.signalGrade ?? null;
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
    source: entry
      ? `Precision rank #${entry.rank}`
      : live != null
        ? 'Live consensus'
        : fair != null
          ? 'Fair line only'
          : 'No line yet',
    note: live != null
      ? `${liveBooks ?? 0} books live`
      : fair != null
        ? 'Fair line only until live consensus lands'
        : 'No market line available yet',
    score,
    reasons,
    signalGrade,
    precision,
  };
}

function trendRead(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return 'Recent-versus-season trend is not available yet.';
  if (value >= 1.5) return `Running clearly above season baseline at ${signed(value, 1)}.`;
  if (value <= -1.5) return `Running clearly below season baseline at ${signed(value, 1)}.`;
  if (value > 0.4) return `Running modestly above season baseline at ${signed(value, 1)}.`;
  if (value < -0.4) return `Running modestly below season baseline at ${signed(value, 1)}.`;
  return 'Tracking close to season baseline right now.';
}

function availabilityRead(playerContext: SnapshotDashboardRow['playerContext']) {
  const status = playerContext.availabilityStatus;
  if (!status || status === 'ACTIVE') return null;
  if (playerContext.availabilityPercentPlay != null && status !== 'OUT') {
    return `${status} (${n(playerContext.availabilityPercentPlay, 0)}% to play)`;
  }
  return status;
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
  if (value === 'precision' || value === 'rubbing' || value === 'players' || value === 'feed' || value === 'tracker' || value === 'method') return value;
  if (value === 'lines') return 'tracker';
  return 'overview';
}

function viewKeepsPlayerParam(view: ViewKey) {
  return view === 'players';
}

function viewKeepsMatchupParam(view: ViewKey) {
  return view === 'overview' || view === 'rubbing' || view === 'players' || view === 'feed' || view === 'tracker';
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

function resolveInitialPlayerId(rows: SnapshotDashboardRow[], value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  return rows.find((row) => row.playerId.toLowerCase() === normalized || slugifyParam(row.playerName) === normalized)?.playerId ?? null;
}

function resolveInitialMatchupKey(matchups: SnapshotBoardViewData['matchups'], value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  return (
    matchups.find(
      (matchupItem) =>
        matchupItem.key.toLowerCase() === normalized ||
        slugifyParam(matchupItem.key) === normalized ||
        slugifyParam(matchupItem.label) === normalized,
    )?.key ?? null
  );
}

export default function NewDashboard({
  data: initialData,
  initialViewParam = null,
  initialPlayerParam = null,
  initialMatchupParam = null,
}: {
  data: SnapshotBoardViewData;
  initialViewParam?: string | null;
  initialPlayerParam?: string | null;
  initialMatchupParam?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialView = parseViewParam(initialViewParam);
  const initialTab = VIEW_TO_TAB[initialView] ?? 'overview';
  const initialPlayerId = resolveInitialPlayerId(initialData.rows, initialPlayerParam);
  const initialPlayerRow = initialPlayerId
    ? initialData.rows.find((row) => row.playerId === initialPlayerId) ?? null
    : null;
  const resolvedInitialMatchupKey =
    resolveInitialMatchupKey(initialData.matchups, initialMatchupParam) ??
    initialPlayerRow?.matchupKey ??
    initialData.matchups[0]?.key ??
    null;
  const initialPinnedMatchupKey = viewKeepsMatchupParam(initialView) ? resolvedInitialMatchupKey : null;
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [headerView, setHeaderView] = useState<ViewKey>(initialView);
  const [pickedPlayer, setPickedPlayer] = useState<string | null>(viewKeepsPlayerParam(initialView) ? initialPlayerId : null);
  const [pinnedMatchupKey, setPinnedMatchupKey] = useState<string | null>(initialPinnedMatchupKey);
  const [selectedMatchupKey, setSelectedMatchupKey] = useState<string | null>(initialPinnedMatchupKey ?? initialData.matchups[0]?.key ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [urlReady, setUrlReady] = useState(false);
  const [highlightTarget, setHighlightTarget] = useState<HighlightTarget>(null);
  const [trackerSort, setTrackerSort] = useState<TrackerSort>('gap');
  const [trackerSearchQuery, setTrackerSearchQuery] = useState('');
  const [trackerMarketFilter, setTrackerMarketFilter] = useState<'ALL' | SnapshotMarket>('ALL');
  const [trackerStatusFilter, setTrackerStatusFilter] = useState<TrackerStatusFilter>('all');
  const [trackerBooksFilter, setTrackerBooksFilter] = useState<TrackerBooksFilter>('all');
  const [trackerPage, setTrackerPage] = useState(0);
  const [expandedTrackerKey, setExpandedTrackerKey] = useState<string | null>(null);
  const [rubbingSort, setRubbingSort] = useState<RubbingSort>('confidence');
  const [rubbingSearchQuery, setRubbingSearchQuery] = useState('');
  const [rubbingMarketFilter, setRubbingMarketFilter] = useState<'ALL' | SnapshotMarket>('ALL');
  const [rubbingPickFilter, setRubbingPickFilter] = useState<RubbingPickFilter>(RUBBING_DEFAULT_PICK_FILTER);
  const [rubbingPage, setRubbingPage] = useState(0);
  const [showResearchContext, setShowResearchContext] = useState(false);
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
  const deferredTrackerSearchQuery = useDeferredValue(trackerSearchQuery.trim().toLowerCase());
  const deferredRubbingSearchQuery = useDeferredValue(rubbingSearchQuery.trim().toLowerCase());

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

  const universalSystem = data.universalSystem ?? null;
  const allRowById = useMemo(() => new Map(data.rows.map((row) => [row.playerId, row] as const)), [data.rows]);
  const boardRows = data.rows;
  const rowById = useMemo(() => new Map(boardRows.map((row) => [row.playerId, row] as const)), [boardRows]);
  const precision = useMemo(
    () =>
      (data.precisionCard ?? [])
        .map((entry) => {
          const row = allRowById.get(entry.playerId);
          return row ? { entry, row, view: viewFor(row, entry.market, entry) } : null;
        })
        .filter((x): x is { entry: SnapshotPrecisionCardEntry; row: SnapshotDashboardRow; view: View } => x !== null)
        .sort((a, b) => a.entry.rank - b.entry.rank || (b.entry.selectionScore ?? 0) - (a.entry.selectionScore ?? 0)),
    [allRowById, data.precisionCard],
  );
  const precisionDashboard = data.precisionDashboard ?? null;
  const precisionAuditByKey = useMemo(
    () =>
      new Map(
        (precisionDashboard?.entries ?? []).map((entry) => [`${entry.playerId}:${entry.market}`, entry] as const),
      ),
    [precisionDashboard],
  );
  const allViews = useMemo(
    () =>
      boardRows.flatMap((row) =>
        MARKETS.map((market) => viewFor(row, market, null)),
      ),
    [boardRows],
  );
  const rubbingBaseViews = useMemo(
    () => selectRubbingHands115Views(allViews),
    [allViews],
  );
  const topPlayer200SampleStrictBaseViews = useMemo(
    () => selectTopPlayer200SampleViews(allViews, data.dateEt, 'sample200'),
    [allViews, data.dateEt],
  );
  const topPlayer200SampleVolumeBaseViews = useMemo(
    () => selectTopPlayer200SampleViews(allViews, data.dateEt, 'sample200Volume'),
    [allViews, data.dateEt],
  );
  const topPlayer200SampleMetaBaseViews = useMemo(
    () => selectTopPlayer200SampleViews(allViews, data.dateEt, 'sample200Meta'),
    [allViews, data.dateEt],
  );
  const topPlayer200SampleRecentBaseViews = useMemo(
    () => selectTopPlayer200RecentFormViews(allViews),
    [allViews],
  );
  const topPlayer200SampleCoverageBaseViews = useMemo(
    () => selectTopPlayer200CoverageFrontierViews(allViews),
    [allViews],
  );
  const topPlayer200SampleBaseViews =
    rubbingPickFilter === 'sample200Coverage'
      ? topPlayer200SampleCoverageBaseViews
      : rubbingPickFilter === 'sample200Recent'
      ? topPlayer200SampleRecentBaseViews
      : rubbingPickFilter === 'sample200Meta'
      ? topPlayer200SampleMetaBaseViews
      : rubbingPickFilter === 'sample200Volume'
        ? topPlayer200SampleVolumeBaseViews
        : topPlayer200SampleStrictBaseViews;
  const rubbingRemovedViews = useMemo(
    () => rubbingBaseViews.filter((view) => isAvailabilityRemoved(view.row)),
    [rubbingBaseViews],
  );
  const topPlayer200SampleRemovedViews = useMemo(
    () => topPlayer200SampleBaseViews.filter((view) => isAvailabilityRemoved(view.row)),
    [topPlayer200SampleBaseViews],
  );
  const rubbingActiveBaseViews = useMemo(
    () => rubbingBaseViews.filter((view) => !isAvailabilityRemoved(view.row)),
    [rubbingBaseViews],
  );
  const topPlayer200SampleActiveBaseViews = useMemo(
    () => topPlayer200SampleBaseViews.filter((view) => !isAvailabilityRemoved(view.row)),
    [topPlayer200SampleBaseViews],
  );
  const rubbingPoolViews = useMemo(() => {
    return rubbingActiveBaseViews.filter((view) => {
      if (rubbingMarketFilter !== 'ALL' && view.market !== rubbingMarketFilter) return false;
      if (!deferredRubbingSearchQuery) return true;
      return [view.row.playerName, view.row.teamCode, view.row.opponentCode, view.row.matchupKey, view.label]
        .join(' ')
        .toLowerCase()
        .includes(deferredRubbingSearchQuery);
    });
  }, [deferredRubbingSearchQuery, rubbingActiveBaseViews, rubbingMarketFilter]);
  const topPlayer200SamplePoolViews = useMemo(() => {
    return topPlayer200SampleActiveBaseViews.filter((view) => {
      if (rubbingMarketFilter !== 'ALL' && view.market !== rubbingMarketFilter) return false;
      if (!deferredRubbingSearchQuery) return true;
      return [view.row.playerName, view.row.teamCode, view.row.opponentCode, view.row.matchupKey, view.label]
        .join(' ')
        .toLowerCase()
        .includes(deferredRubbingSearchQuery);
    });
  }, [deferredRubbingSearchQuery, topPlayer200SampleActiveBaseViews, rubbingMarketFilter]);
  const rubbingFilteredViews = useMemo(() => {
    const sourceViews = isTopPlayer200SampleFilter(rubbingPickFilter) ? topPlayer200SamplePoolViews : rubbingPoolViews;
    const views = sourceViews.filter((view) => {
      if (isTopPlayer200CoverageFilter(rubbingPickFilter)) {
        return isTopPlayer200CoverageFrontierLanePick(view);
      }
      if (isTopPlayer200RecentFormFilter(rubbingPickFilter)) {
        return isTopPlayer200RecentFormLanePick(view);
      }
      if (isTopPlayer200HgbFilter(rubbingPickFilter)) {
        return isTopPlayer200SampleLanePick(view, data.dateEt, rubbingPickFilter);
      }
      if (rubbingPickFilter === 'allWindow') return isRubbingHands115AllWindowPick(view);
      if (rubbingPickFilter === 'research') return isRubbingHands115ResearchPick(view);
      return true;
    });

    views.sort((a, b) => {
      if (isTopPlayer200CoverageFilter(rubbingPickFilter)) {
        if (rubbingSort === 'books') {
          return (b.books ?? -1) - (a.books ?? -1) || compareTopPlayer200RecentFormViews(a, b);
        }
        return compareTopPlayer200RecentFormViews(a, b);
      }
      if (isTopPlayer200RecentFormFilter(rubbingPickFilter)) {
        if (rubbingSort === 'books') {
          return (b.books ?? -1) - (a.books ?? -1) || compareTopPlayer200RecentFormViews(a, b);
        }
        return compareTopPlayer200RecentFormViews(a, b);
      }
      if (isTopPlayer200HgbFilter(rubbingPickFilter)) {
        const confidence =
          (topPlayer200SampleLaneConfidencePct(b, data.dateEt, rubbingPickFilter) ?? -1) -
          (topPlayer200SampleLaneConfidencePct(a, data.dateEt, rubbingPickFilter) ?? -1);
        if (confidence !== 0) return confidence;
      }
      if (rubbingSort === 'edge') {
        return Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0) || (b.conf ?? -1) - (a.conf ?? -1) || b.score - a.score;
      }
      if (rubbingSort === 'books') {
        return (b.books ?? -1) - (a.books ?? -1) || (b.conf ?? -1) - (a.conf ?? -1) || Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0);
      }
      return (b.conf ?? -1) - (a.conf ?? -1) || Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0) || b.score - a.score;
    });

    if (rubbingPickFilter === 'sample200Top6') {
      return views.slice(0, TOP_PLAYER_200_SAMPLE_TOP6_PICK_COUNT);
    }

    return views;
  }, [data.dateEt, rubbingPickFilter, rubbingPoolViews, rubbingSort, topPlayer200SamplePoolViews]);
  const rubbingDisplayedRemovedViews = isTopPlayer200SampleFilter(rubbingPickFilter) ? topPlayer200SampleRemovedViews : rubbingRemovedViews;
  const rubbingDisplayedActiveBaseViews =
    isTopPlayer200SampleFilter(rubbingPickFilter) ? topPlayer200SampleActiveBaseViews : rubbingActiveBaseViews;
  const rubbingPageCount = Math.max(1, Math.ceil(rubbingFilteredViews.length / RUBBING_PAGE_SIZE));
  const rubbingViews = useMemo(() => {
    const start = rubbingPage * RUBBING_PAGE_SIZE;
    return rubbingFilteredViews.slice(start, start + RUBBING_PAGE_SIZE);
  }, [rubbingFilteredViews, rubbingPage]);
  const rubbingRangeStart = rubbingFilteredViews.length === 0 ? 0 : rubbingPage * RUBBING_PAGE_SIZE + 1;
  const rubbingRangeEnd = rubbingFilteredViews.length === 0 ? 0 : rubbingRangeStart + rubbingViews.length - 1;
  const rubbingPageDisplay = rubbingFilteredViews.length === 0 ? 0 : rubbingPage + 1;
  const rubbingPageTotalDisplay = rubbingFilteredViews.length === 0 ? 0 : rubbingPageCount;
  const rubbingAverageConfidence = useMemo(() => {
    const values = rubbingFilteredViews
      .map((view) =>
        isTopPlayer200SampleFilter(rubbingPickFilter)
          ? topPlayer200SampleLaneConfidencePct(view, data.dateEt, rubbingPickFilter)
          : view.conf,
      )
      .filter((value): value is number => value != null && !Number.isNaN(value));
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [data.dateEt, rubbingFilteredViews, rubbingPickFilter]);
  const rubbingWatchCount = useMemo(
    () => rubbingFilteredViews.filter((view) => isAvailabilityWatch(view.row)).length,
    [rubbingFilteredViews],
  );
  const rubbingAllWindowPickCount = useMemo(
    () => rubbingPoolViews.filter((view) => isRubbingHands115AllWindowPick(view)).length,
    [rubbingPoolViews],
  );
  const rubbingResearchPickCount = useMemo(
    () => rubbingPoolViews.filter((view) => isRubbingHands115ResearchPick(view)).length,
    [rubbingPoolViews],
  );
  const topPlayer200SamplePickCount = useMemo(
    () => topPlayer200SampleStrictBaseViews.filter((view) => !isAvailabilityRemoved(view.row) && isTopPlayer200SampleLanePick(view, data.dateEt, 'sample200')).length,
    [data.dateEt, topPlayer200SampleStrictBaseViews],
  );
  const topPlayer200SampleVolumePickCount = useMemo(
    () => topPlayer200SampleVolumeBaseViews.filter((view) => !isAvailabilityRemoved(view.row) && isTopPlayer200SampleLanePick(view, data.dateEt, 'sample200Volume')).length,
    [data.dateEt, topPlayer200SampleVolumeBaseViews],
  );
  const topPlayer200SampleMetaPickCount = useMemo(
    () => topPlayer200SampleMetaBaseViews.filter((view) => !isAvailabilityRemoved(view.row) && isTopPlayer200SampleLanePick(view, data.dateEt, 'sample200Meta')).length,
    [data.dateEt, topPlayer200SampleMetaBaseViews],
  );
  const topPlayer200SampleTop6PickCount = useMemo(
    () =>
      topPlayer200SampleStrictBaseViews
        .filter((view) => !isAvailabilityRemoved(view.row) && isTopPlayer200SampleLanePick(view, data.dateEt, 'sample200Top6'))
        .slice(0, TOP_PLAYER_200_SAMPLE_TOP6_PICK_COUNT).length,
    [data.dateEt, topPlayer200SampleStrictBaseViews],
  );
  const topPlayer200SampleRecentPickCount = useMemo(
    () => topPlayer200SampleRecentBaseViews.filter((view) => !isAvailabilityRemoved(view.row)).length,
    [topPlayer200SampleRecentBaseViews],
  );
  const topPlayer200SampleCoveragePickCount = useMemo(
    () => topPlayer200SampleCoverageBaseViews.filter((view) => !isAvailabilityRemoved(view.row)).length,
    [topPlayer200SampleCoverageBaseViews],
  );
  const rubbingHasManualFilter = Boolean(deferredRubbingSearchQuery) || rubbingMarketFilter !== 'ALL';
  const rubbingUsesCurrentHgbScores = data.dateEt === TOP_PLAYER_200_SAMPLE_CURRENT_SLATE_DATE_ET;
  const rubbingUsesHgbScores = isTopPlayer200HgbFilter(rubbingPickFilter);
  const rubbingCurrentThreshold =
    rubbingPickFilter === 'sample200Top6'
      ? TOP_PLAYER_200_SAMPLE_TOP6_MIN_HGB_CONFIDENCE_PCT
      : rubbingPickFilter === 'sample200Meta'
      ? TOP_PLAYER_200_SAMPLE_META_CONFIDENCE_PCT
      : rubbingPickFilter === 'sample200Volume'
        ? TOP_PLAYER_200_SAMPLE_VOLUME_CONFIDENCE_PCT
        : TOP_PLAYER_200_SAMPLE_CONFIDENCE_PCT;
  const rubbingEmptyTitle =
    rubbingUsesHgbScores && !rubbingUsesCurrentHgbScores
      ? `Current 200+ model scores are for ${TOP_PLAYER_200_SAMPLE_CURRENT_SLATE_DATE_ET}, not ${data.dateEt}.`
      : rubbingUsesHgbScores && !rubbingHasManualFilter
        ? `No ${rubbingPickFilterLabel(rubbingPickFilter)} cleared the ${pct(rubbingCurrentThreshold, 0)} model-confidence gate for this slate.`
      : isTopPlayer200CoverageFilter(rubbingPickFilter) && !rubbingHasManualFilter
        ? `No ${rubbingPickFilterLabel(rubbingPickFilter)} matched the expanded disagreement rule for this slate.`
      : isTopPlayer200RecentFormFilter(rubbingPickFilter) && !rubbingHasManualFilter
        ? `No ${rubbingPickFilterLabel(rubbingPickFilter)} matched the recent-form rule for this slate.`
      : `No ${rubbingPickFilterLabel(rubbingPickFilter)} match the current filters.`;
  const rubbingEmptyDetail =
    rubbingUsesHgbScores && !rubbingUsesCurrentHgbScores
      ? 'Regenerate the current-slate HGB score artifact before using this lane on a different slate date.'
      : rubbingUsesHgbScores && !rubbingHasManualFilter
        ? 'The eligible 200+ sample pool is loaded, but no player cleared this model-confidence threshold.'
      : isTopPlayer200CoverageFilter(rubbingPickFilter) && !rubbingHasManualFilter
        ? 'The eligible 200+ sample pool is loaded, but no player matched the player-override, projection-disagreement, minutes, and gap requirements.'
      : isTopPlayer200RecentFormFilter(rubbingPickFilter) && !rubbingHasManualFilter
        ? 'The eligible 200+ sample pool is loaded, but no player matched the player-override, projection-fade, minutes, and gap requirements.'
      : 'Clear the search, choose all markets, or switch the pick type to restore the model-selected board.';
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
    boardRows
      .slice()
      .sort((a, b) => b.dataCompleteness.score - a.dataCompleteness.score || a.playerName.localeCompare(b.playerName))
      .forEach((row) => {
        if (!ids.has(row.playerId)) {
          ids.add(row.playerId);
          out.push(row);
        }
      });
    return out;
  }, [boardRows, precision]);
  const researchRows = useMemo(() => slatePlayers.slice(0, 12), [slatePlayers]);
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
  const researchListRows = deferredSearchQuery ? searchResults : slatePlayers;
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
        const views = rankViews(MARKETS.map((market) => viewFor(row, market, null)));
        return {
          row,
          leadView: leadViewFromViews(views),
        };
      }).sort(
        (a, b) =>
          (b.leadView?.score ?? -1) - (a.leadView?.score ?? -1) ||
          (b.leadView?.conf ?? -1) - (a.leadView?.conf ?? -1) ||
          a.row.playerName.localeCompare(b.row.playerName),
      ),
    [researchListRows],
  );
  const researchViews = useMemo(
    () =>
      researchRow
        ? rankViews(MARKETS.map((market) => viewFor(researchRow, market, null)))
        : [],
    [researchRow],
  );
  const researchLiveViews = useMemo(() => researchViews.filter((view) => view.live != null), [researchViews]);
  const researchLeadView = useMemo(() => leadViewFromViews(researchViews), [researchViews]);
  const researchTopPrecision = useMemo(
    () => (researchRow ? precision.find((item) => item.row.playerId === researchRow.playerId) ?? null : null),
    [precision, researchRow],
  );
  const researchQualifiedView = useMemo(
    () => (researchRow ? researchTopPrecision?.view ?? researchViews.find((view) => view.precision?.qualified) ?? null : null),
    [researchRow, researchTopPrecision, researchViews],
  );
  const teamMatchup = useMemo(
    () => (researchRow ? data.teamMatchups.find((m) => m.matchupKey === researchRow.matchupKey) ?? null : null),
    [data.teamMatchups, researchRow],
  );
  const scoutViews = useMemo(
    () => allViews.filter((v) => isActionableView(v)).sort((a, b) => b.score - a.score).slice(0, 8),
    [allViews],
  );
  const trackerBaseViews = useMemo(() => {
    const views = allViews.filter((v) => v.live != null || v.fair != null || v.edge != null);
    views.sort((a, b) => {
      if (trackerSort === 'confidence') {
        return (b.conf ?? -1) - (a.conf ?? -1) || Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0) || b.score - a.score;
      }
      if (trackerSort === 'books') {
        return (b.books ?? -1) - (a.books ?? -1) || Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0) || b.score - a.score;
      }
      return Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0) || (b.conf ?? -1) - (a.conf ?? -1) || b.score - a.score;
    });
    return views;
  }, [allViews, trackerSort]);
  const selectedMatchup = useMemo(
    () => (selectedMatchupKey ? data.matchups.find((m) => m.key === selectedMatchupKey) ?? null : null),
    [data.matchups, selectedMatchupKey],
  );
  const selectedMatchupTeamStats = useMemo(
    () => (selectedMatchupKey ? data.teamMatchups.find((m) => m.matchupKey === selectedMatchupKey) ?? null : null),
    [data.teamMatchups, selectedMatchupKey],
  );
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
  const liveCount = allViews.filter((v) => v.live != null).length;
  const qualifiedCount = allViews.filter((v) => v.precision?.qualified).length;
  const hasBoardRows = boardRows.length > 0;
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
  const boardModelNote = firstSentence(universalSystem?.note);
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
  const researchLeadRecentValues = researchRow && researchLeadView ? researchRow.last5[researchLeadView.market].slice(-5) : [];
  const researchLeadRecentAverage = researchLeadRecentValues.length
    ? researchLeadRecentValues.reduce((sum, value) => sum + value, 0) / researchLeadRecentValues.length
    : null;
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
  const boardModeLabel = 'Full board';
  const boardModeDetail = universalSystem
    ? `Honest 14d ${pct(universalSystem.honest14dRawAccuracy, 2)} | Honest 30d ${pct(universalSystem.honest30dRawAccuracy, 2)} | Latest fold ${pct(universalSystem.latestFoldRawAccuracy, 2)}`
    : 'Honest recent holdout metrics are not loaded for the board yet.';
  const boardModeCountLabel = `${n(allViews.length, 0)} current full-board views`;
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
  const researchShortWhy = useMemo(() => {
    if (!researchLeadView) {
      return 'Select a player and the board will surface the clearest reason to keep that dossier open.';
    }
    return conciseLeadReason(researchLeadView, researchWhyInteresting);
  }, [researchLeadView, researchWhyInteresting]);
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
  const researchPrecisionState = useMemo<PrecisionStateSummary>(() => {
    if (!researchRow || !researchLeadView) {
      return {
        label: 'Board read only',
        tone: 'default',
        kind: 'LIVE',
        summary: 'Open a player and the board will show whether the current read is promoted, qualified, or just a broader board lean.',
        detail: null,
        reasons: [],
      };
    }

    const precisionView = researchQualifiedView;
    const focusView = precisionView ?? researchLeadView;
    const basisLabel = focusView.live != null ? 'live line' : focusView.fair != null ? 'board fair line' : 'current board basis';
    const reasonSet = new Set<string>();
    if (focusView.edge != null) {
      reasonSet.add(`Gap is ${gapRead(focusView.edge)} the ${basisLabel}.`);
    }
    if (focusView.books != null && focusView.books > 0) {
      reasonSet.add(`${booksCountLabel(focusView.books)} are contributing to the current number.`);
    }
    if (focusView.conf != null) {
      reasonSet.add(`Confidence is ${pct(focusView.conf, 0)} on ${focusView.label}.`);
    }
    const precisionReason = cleanReasonLine((focusView.precision?.reasons ?? [])[0]);
    if (precisionReason) {
      reasonSet.add(precisionReason);
    }
    const reasons = Array.from(reasonSet).slice(0, 3);
    const precisionDetail =
      precisionView && precisionView.market !== researchLeadView.market
        ? `Precision market: ${recommendationHeadline(precisionView)}`
        : `Current board lead: ${recommendationHeadline(researchLeadView)}`;

    if (researchTopPrecision?.entry.rank === 1) {
      return {
        label: 'Precision pick',
        tone: 'cyan',
        kind: 'MODEL',
        summary:
          precisionView && precisionView.market !== researchLeadView.market
            ? `${recommendationHeadline(precisionView)} is the promoted precision market for this player right now.`
            : 'This player is the promoted board selection right now.',
        detail: precisionDetail,
        reasons,
      };
    }

    if (precisionView) {
      return {
        label: 'Precision qualified',
        tone: 'amber',
        kind: 'DERIVED',
        summary:
          precisionView.market !== researchLeadView.market
            ? `${recommendationHeadline(precisionView)} clears the precision rules, even though ${researchLeadView.label} is the broader player read.`
            : 'This lead market clears the current precision rules, but it is not the promoted board pick.',
        detail: precisionDetail,
        reasons,
      };
    }

    return {
      label: 'Board read only',
      tone: 'default',
      kind: 'LIVE',
      summary: 'This player has a usable board read, but the current lead market is not one of the promoted precision spots right now.',
      detail: precisionDetail,
      reasons,
    };
  }, [researchLeadView, researchQualifiedView, researchRow, researchTopPrecision]);
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

  useEffect(() => {
    setShowResearchContext(false);
  }, [researchRow?.playerId]);
  const tabSummary: Record<Tab, { detail: string; kind: Kind }> = {
    overview: {
      detail: featured ? `${featured.row.playerName} ${featured.label}` : 'Waiting for board read',
      kind: featured ? 'LIVE' : 'PLACEHOLDER',
    },
    precision: {
      detail: precisionDashboard
        ? `${n(precisionDashboard.promotedCount, 0)} promoted | ${n(precisionDashboard.pendingCount, 0)} pending`
        : precision.length
          ? `${n(precision.length, 0)} promoted picks`
          : 'No board picks yet',
      kind: precision.length ? 'LIVE' : 'PLACEHOLDER',
    },
    rubbing: {
      detail: rubbingDisplayedActiveBaseViews.length
        ? `${n(rubbingFilteredViews.length, 0)} shown / ${n(rubbingDisplayedActiveBaseViews.length, 0)} ${rubbingPoolLabel(rubbingPickFilter)} | ${n(rubbingDisplayedRemovedViews.length, 0)} removed`
        : 'No Rubbing Hands picks loaded',
      kind: rubbingDisplayedActiveBaseViews.length ? 'LIVE' : 'PLACEHOLDER',
    },
    research: {
      detail: slatePlayers.length ? `${n(slatePlayers.length, 0)} slate players` : 'Slate not loaded',
      kind: slatePlayers.length ? 'LIVE' : 'PLACEHOLDER',
    },
    scout: {
      detail: data.boardFeed?.events?.length ? `${n(data.boardFeed.events.length, 0)} pregame events` : 'Waiting for feed events',
      kind: data.boardFeed?.events?.length ? 'DERIVED' : 'PLACEHOLDER',
    },
    tracking: {
      detail: trackerBaseViews.length ? `${n(trackerBaseViews.length, 0)} tracker rows` : 'No tracker rows yet',
      kind: trackerBaseViews.length ? 'DERIVED' : 'PLACEHOLDER',
    },
  };
  const liveBookDepth = useMemo(() => {
    const liveBookViews = allViews.filter((view) => view.live != null && view.books != null);
    if (!liveBookViews.length) return null;
    return Number((liveBookViews.reduce((sum, view) => sum + (view.books ?? 0), 0) / liveBookViews.length).toFixed(1));
  }, [allViews]);
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
  const latestBoardFeedEventByKey = useMemo(() => {
    const map = new Map<string, SnapshotBoardFeedItem>();
    boardFeedEvents.forEach((event) => {
      const key = `${event.playerId}:${event.market}`;
      if (!map.has(key)) {
        map.set(key, event);
      }
    });
    return map;
  }, [boardFeedEvents]);
  const trackerFilteredViews = useMemo(() => {
    return trackerBaseViews
      .filter((view) => {
        if (trackerMarketFilter !== 'ALL' && view.market !== trackerMarketFilter) {
          return false;
        }
        if (trackerBooksFilter === '3plus' && (view.books ?? 0) < 3) {
          return false;
        }
        if (trackerBooksFilter === '5plus' && (view.books ?? 0) < 5) {
          return false;
        }
        const latestEvent = latestBoardFeedEventByKey.get(trackerRowKey(view)) ?? null;
        const trackerStatus: TrackerStatusFilter =
          latestEvent?.status === 'LOCKED' || latestEvent?.status === 'FINAL'
            ? 'locked'
            : view.live != null
              ? 'pregame'
              : 'fair';
        if (trackerStatusFilter !== 'all' && trackerStatus !== trackerStatusFilter) {
          return false;
        }
        if (!deferredTrackerSearchQuery) {
          return true;
        }
        return [view.row.playerName, view.row.teamCode, view.row.opponentCode, view.row.matchupKey, view.label]
          .join(' ')
          .toLowerCase()
          .includes(deferredTrackerSearchQuery);
      });
  }, [
    deferredTrackerSearchQuery,
    latestBoardFeedEventByKey,
    trackerBaseViews,
    trackerBooksFilter,
    trackerMarketFilter,
    trackerStatusFilter,
  ]);
  const trackerPageCount = Math.max(1, Math.ceil(trackerFilteredViews.length / TRACKER_PAGE_SIZE));
  const trackViews = useMemo(() => {
    const start = trackerPage * TRACKER_PAGE_SIZE;
    return trackerFilteredViews.slice(start, start + TRACKER_PAGE_SIZE);
  }, [trackerFilteredViews, trackerPage]);
  const trackerRangeStart = trackerFilteredViews.length === 0 ? 0 : trackerPage * TRACKER_PAGE_SIZE + 1;
  const trackerRangeEnd = trackerFilteredViews.length === 0 ? 0 : trackerRangeStart + trackViews.length - 1;
  const trackerPageDisplay = trackerFilteredViews.length === 0 ? 0 : trackerPage + 1;
  const trackerPageTotalDisplay = trackerFilteredViews.length === 0 ? 0 : trackerPageCount;
  const trackerSummary = useMemo(() => {
    const summary = { live: 0, locked: 0, fair: 0 };
    trackerFilteredViews.forEach((view) => {
      const latestEvent = latestBoardFeedEventByKey.get(trackerRowKey(view)) ?? null;
      if (latestEvent?.status === 'LOCKED' || latestEvent?.status === 'FINAL') {
        summary.locked += 1;
        return;
      }
      if (view.live != null) {
        summary.live += 1;
        return;
      }
      summary.fair += 1;
    });
    return summary;
  }, [latestBoardFeedEventByKey, trackerFilteredViews]);
  useEffect(() => {
    setTrackerPage(0);
  }, [deferredTrackerSearchQuery, trackerBooksFilter, trackerMarketFilter, trackerSort, trackerStatusFilter]);
  useEffect(() => {
    setTrackerPage((current) => Math.min(current, Math.max(trackerPageCount - 1, 0)));
  }, [trackerPageCount]);
  useEffect(() => {
    setRubbingPage(0);
  }, [deferredRubbingSearchQuery, rubbingMarketFilter, rubbingPickFilter, rubbingSort]);
  useEffect(() => {
    setRubbingPage((current) => Math.min(current, Math.max(rubbingPageCount - 1, 0)));
  }, [rubbingPageCount]);
  useEffect(() => {
    if (!expandedTrackerKey) return;
    if (!trackViews.some((view) => trackerRowKey(view) === expandedTrackerKey)) {
      setExpandedTrackerKey(null);
    }
  }, [expandedTrackerKey, trackViews]);
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
    return parts.length ? parts.slice(0, 3).join(' | ') : null;
  }, [featured]);
  const precisionCardKeys = useMemo(
    () => new Set(precision.map(({ row, view }) => `${row.playerId}:${view.market}`)),
    [precision],
  );
  const nextBestNumbers = useMemo(() => {
    const seen = new Set<string>();
    const candidates = [...scoutViews, ...selectedMatchupViews, ...allViews].filter((view) => {
      if (view.live == null) return false;
      const key = `${view.row.playerId}:${view.market}`;
      if (precisionCardKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return rankViews(candidates).slice(0, 6);
  }, [allViews, precisionCardKeys, scoutViews, selectedMatchupViews]);
  const promotedPrecisionLiveCount = useMemo(
    () => precision.filter(({ view }) => view.live != null).length,
    [precision],
  );
  const qualifiedPlayerCount = useMemo(
    () => new Set(allViews.filter((view) => view.precision?.qualified).map((view) => view.row.playerId)).size,
    [allViews],
  );
  const precisionStatus = useMemo(() => {
    if (!precision.length) {
      return {
        label: 'Waiting for picks',
        tone: 'default' as const,
        summary: 'No promoted precision selections are loaded yet.',
        detail: 'The board will promote a precision pick as soon as enough qualifying pregame-safe numbers are available.',
      };
    }

    if (promotedPrecisionLiveCount === precision.length) {
      return {
        label: 'Active',
        tone: 'cyan' as const,
        summary: `${n(precision.length, 0)} promoted precision selections are loaded and every promoted pick still has a live number.`,
        detail: `${n(qualifiedCount, 0)} qualified player-markets across ${n(qualifiedPlayerCount, 0)} players are active on the board right now.`,
      };
    }

    if (promotedPrecisionLiveCount > 0) {
      return {
        label: 'Partial live',
        tone: 'amber' as const,
        summary: `${n(promotedPrecisionLiveCount, 0)} of ${n(precision.length, 0)} promoted precision selections still have live pricing.`,
        detail: `${n(qualifiedCount, 0)} qualified player-markets remain tracked while the rest wait on live book depth.`,
      };
    }

    return {
      label: 'Qualified only',
      tone: 'amber' as const,
      summary: `${n(precision.length, 0)} promoted precision selections are loaded, but live book lines are thin right now.`,
      detail: `${n(qualifiedCount, 0)} qualified player-markets are still in the precision pool while live pricing catches up.`,
    };
  }, [precision, promotedPrecisionLiveCount, qualifiedCount, qualifiedPlayerCount]);
  const precisionPerformanceNote =
    precisionDashboard?.units != null
      ? 'Flat units assume 1u stakes at -110 once a promoted pick settles.'
      : 'Performance fills in as promoted picks settle after tipoff.';
  const workspaceCopy: Record<Tab, { title: string; detail: string }> = {
    overview: {
      title: 'Overview workspace',
      detail: 'Best pick, next best numbers, matchup shortcuts, and the day-long board feed stay grouped here.',
    },
    precision: {
      title: 'Precision Picks',
      detail: 'Only the promoted model-qualified picks live here, with audit status and current-slate performance.',
    },
    rubbing: {
      title: 'Rubbing Hands',
      detail: 'The 200+ sample top-player model, reduced to one live market per player with injury-aware availability.',
    },
    research: {
      title: 'Player research',
      detail: 'Search the slate on the left, then keep one selected player dossier open on the right.',
    },
    scout: {
      title: 'Board feed',
      detail: 'The feed stays focused on persistent pregame changes and lock timing through the day.',
    },
    tracking: {
      title: 'Market tracker',
      detail: 'Use the tracker to sort the market numerically instead of jumping between card views.',
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
      const focusTarget = focusRef?.current ?? element;
      if (Math.abs(window.scrollY - top) > 12) {
        window.scrollTo({ top, behavior });
      }
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
    if (nextTab === tab && headerView === TAB_TO_VIEW[nextTab]) {
      setHeaderSearchOpen(false);
      return;
    }
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
    const shouldScroll = options?.scroll ?? (tab !== 'research' || headerView !== 'players');
    if (shouldScroll) {
      scrollToView('players');
    }
  };
  const openMatchup = (matchupKey: string) => {
    urlNavigationModeRef.current = 'push';
    setMatchupSelection(matchupKey, { highlight: true });
    setHeaderView('overview');
    setTab('overview');
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

          <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)]">
            <div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Board accuracy</div>
                <div className="mt-1 text-sm font-semibold text-[var(--text)]">{boardModeLabel}</div>
                <div className="mt-1 text-sm text-[var(--text-2)]">{boardModeDetail}</div>
                <div className="mt-1 text-xs text-[var(--muted)]">{boardModeCountLabel}</div>
              </div>
            </div>
          </section>

          {tab === 'overview' ? (
            <>
          <section ref={overviewRef} tabIndex={-1} className="mt-4 grid grid-cols-1 gap-4 scroll-mt-28 outline-none md:mt-6 md:gap-6 md:scroll-mt-32 xl:grid-cols-12">
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

                  <div className="mt-3 grid grid-cols-3 gap-2 md:hidden">
                    <CompactMetric label="Model gap" value={gapRead(featured.edge)} compact />
                    <CompactMetric label="Signal" value={signalGradeValue(featured.signalGrade)} compact />
                    <CompactMetric label="Confidence" value={featured.conf == null ? '-' : pct(featured.conf, 0)} compact />
                  </div>

                  <div className="mt-4 hidden grid-cols-2 gap-2.5 sm:mt-5 sm:gap-3 md:grid xl:grid-cols-5">
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
                    <Stat dense label="Signal grade" value={signalGradeValue(featured.signalGrade)} kind={featured.signalGrade ? 'DERIVED' : 'PLACEHOLDER'} note={signalGradeNote(featured.signalGrade)} showKind={false} />
                    <Stat dense label="Confidence" value={featured.conf == null ? '-' : pct(featured.conf, 0)} kind={featured.confKind} note="Pick confidence" showKind={false} />
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
                      Open tracker
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
                bestAlternative={nextBestNumbers[0] ? `${nextBestNumbers[0].row.playerName} ${nextBestNumbers[0].label}` : 'Waiting for the next live card'}
                mostActiveGame={selectedMatchup?.label ?? data.matchups[0]?.label ?? '-'}
                booksLive={liveBookDepth == null ? '-' : n(liveBookDepth)}
                note={boardPulseNote}
              />
            </div>
          </section>

          <div className="mt-4 md:hidden">
            <BoardPulseCard
              boardRefresh={ts(data.lastUpdatedAt)}
              featuredUpdate={ts(latestBoardFeedEvent?.createdAt ?? featuredUpdatedAt)}
              liveLines={n(liveCount, 0)}
              feedItems={n(boardFeedEvents.length, 0)}
              strongestMarket={featured ? `${featured.row.playerName} ${featured.label}` : '-'}
              bestAlternative={nextBestNumbers[0] ? `${nextBestNumbers[0].row.playerName} ${nextBestNumbers[0].label}` : 'Waiting for the next live card'}
              mostActiveGame={selectedMatchup?.label ?? data.matchups[0]?.label ?? '-'}
              booksLive={liveBookDepth == null ? '-' : n(liveBookDepth)}
              note={boardPulseNote}
            />
          </div>

          <section className="mt-4 scroll-mt-28 outline-none md:mt-6 md:scroll-mt-32">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Next best numbers</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">Good board reads outside the promoted precision group</h2>
                <p className="mt-1 text-sm text-[var(--text-2)]">Actionable live numbers that still deserve a look even though they are not the current promoted precision picks.</p>
              </div>
              <div className="text-xs text-[var(--text-2)] sm:text-sm">
                {nextBestNumbers.length ? `${n(nextBestNumbers.length, 0)} live cards ready to open` : 'Waiting for a broader set of non-promoted live numbers'}
              </div>
            </div>
            {nextBestNumbers.length ? (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
                {nextBestNumbers.map((view, index) => (
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
                          <Pill label={view.precision?.qualified ? 'Precision qualified' : 'Board read only'} tone={view.precision?.qualified ? 'amber' : 'default'} />
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
                  eyebrow="Next best numbers"
                  title="The board has not surfaced additional non-promoted live numbers yet."
                  detail="As more live prices settle, this strip will separate the broader board reads from the promoted precision group above."
                  actionLabel="Refresh slate"
                  onAction={refreshSlate}
                />
              </div>
            )}
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
            </>
          ) : null}

          {tab !== 'overview' ? (
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
            </div>
          {tab === 'precision' ? (
            <section className="mt-5 space-y-5">
              <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-2)] p-5 shadow-[0_8px_30px_rgba(20,16,35,0.05)] sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Precision Picks</div>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">Only the promoted picks that cleared the precision rules</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-2)]">
                      {precisionDashboard?.note ??
                        'Only picks that passed the precision selection rules. No general board reads, no fallback picks, and no non-qualified players.'}
                    </p>
                    <div className="mt-3 text-sm text-[var(--text-2)]">
                      Pregame only. Picks freeze at tipoff.
                    </div>
                  </div>
                  <Pill label={precisionStatus.label} tone={precisionStatus.tone} />
                </div>
                <p className="mt-4 text-sm leading-6 text-[var(--text)]">{precisionStatus.summary}</p>
                <p className="mt-1 text-sm leading-6 text-[var(--text-2)]">{precisionStatus.detail}</p>
                <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-2)]">
                  <span className="font-semibold text-[var(--text)]">Audit note:</span> {precisionDashboard?.auditNote ?? 'Promoted picks come only from the precision selection pipeline and freeze at tipoff.'}
                </div>
                <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-2)]">
                  Lead precision pick:{' '}
                  <span className="font-semibold text-[var(--text)]">
                    {precision[0] ? `${precision[0].row.playerName} ${recommendationHeadline(precision[0].view)}` : 'Waiting for promoted lead'}
                  </span>
                  {' '}| Last board refresh {ts(data.lastUpdatedAt)}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-10">
                <Stat dense label="Active picks" value={n(precisionDashboard?.activeCount ?? precision.length, 0)} kind={(precisionDashboard?.activeCount ?? precision.length) ? 'LIVE' : 'PLACEHOLDER'} note="Pregame promoted picks still tracking" />
                <Stat dense label="Pending" value={n(precisionDashboard?.pendingCount ?? precision.length, 0)} kind={(precisionDashboard?.pendingCount ?? precision.length) ? 'DERIVED' : 'PLACEHOLDER'} note="Promoted picks waiting on settlement" />
                <Stat dense label="Settled" value={n(precisionDashboard?.settledCount ?? 0, 0)} kind={precisionDashboard?.settledCount ? 'LIVE' : 'PLACEHOLDER'} note="Promoted picks already graded today" />
                <Stat dense label="Wins" value={n(precisionDashboard?.wins ?? 0, 0)} kind={precisionDashboard?.wins ? 'LIVE' : 'PLACEHOLDER'} note="Settled promoted picks that cleared" />
                <Stat dense label="Losses" value={n(precisionDashboard?.losses ?? 0, 0)} kind={precisionDashboard?.losses ? 'DERIVED' : 'PLACEHOLDER'} note="Settled promoted picks that missed" />
                <Stat dense label="Hit rate" value={precisionDashboard?.hitRate == null ? '-' : pct(precisionDashboard.hitRate, 1)} kind={precisionDashboard?.hitRate == null ? 'PLACEHOLDER' : 'MODEL'} note="Wins / losses on graded promoted picks" />
                <Stat dense label="Flat units" value={precisionDashboard?.units == null ? '-' : signed(precisionDashboard.units, 2)} kind={precisionDashboard?.units == null ? 'PLACEHOLDER' : precisionDashboard.units >= 0 ? 'LIVE' : 'DERIVED'} note={precisionPerformanceNote} />
                <Stat dense label="ROI" value={precisionDashboard?.roiPct == null ? '-' : pct(precisionDashboard.roiPct, 1)} kind={precisionDashboard?.roiPct == null ? 'PLACEHOLDER' : precisionDashboard.roiPct >= 0 ? 'LIVE' : 'DERIVED'} note="Flat-stake ROI on settled promoted picks" />
                <Stat dense label="Avg confidence" value={precisionDashboard?.averageConfidence == null ? '-' : pct(precisionDashboard.averageConfidence, 1)} kind={precisionDashboard?.averageConfidence == null ? 'PLACEHOLDER' : 'MODEL'} note="Current promoted pool average" />
                <Stat dense label="Avg books live" value={precisionDashboard?.averageBooksLive == null ? '-' : n(precisionDashboard.averageBooksLive)} kind={precisionDashboard?.averageBooksLive == null ? 'PLACEHOLDER' : 'LIVE'} note="Average book depth across promoted picks" />
              </div>

              <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-6">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Active precision picks</div>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">Promoted picks with visible audit status</h3>
                    <p className="mt-1 text-sm text-[var(--text-2)]">Each card shows the promoted recommendation, why it qualified, and whether it is still active, locked at tipoff, or already settled.</p>
                  </div>
                  <div className="text-sm text-[var(--text-2)]">
                    {precision.length ? `${n(precision.length, 0)} promoted pick${precision.length === 1 ? '' : 's'} in the pool` : 'Waiting for the first promoted pick'}
                  </div>
                </div>
                {precision.length ? (
                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {precision.map(({ entry, row, view }) => {
                      const audit = precisionAuditByKey.get(`${entry.playerId}:${entry.market}`) ?? null;
                      const cardReasons = precisionQualificationReasons(view, false);
                      return (
                        <button
                          key={`${entry.playerId}:${entry.market}:precision-page`}
                          type="button"
                          onClick={() => setResearch(row.playerId)}
                          className={`rounded-3xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-left sm:p-5 ${CARD_BUTTON_CLASS}`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap gap-2">
                                <Badge label={`#${entry.rank}`} kind="DERIVED" />
                                <Pill label="Precision pick" tone="cyan" />
                                <Pill label={view.label} tone="amber" />
                                <Pill label={precisionAuditLabel(audit)} tone={precisionAuditTone(audit)} />
                              </div>
                              <div className="mt-3 text-xl font-semibold tracking-tight text-[var(--text)]">{row.playerName}</div>
                              <div className="mt-1 text-sm text-[var(--text-2)]">{matchup(row)}</div>
                              <div className="mt-2 text-base font-semibold text-[var(--text)]">{recommendationHeadline(view)}</div>
                            </div>
                            <div className="text-right text-xs text-[var(--text-2)]">
                              <div>{booksLiveLabel(view.books) ?? 'Books pending'}</div>
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
                            <CompactMetric label="Line" value={audit?.line == null ? (view.live == null ? (view.fair == null ? '-' : n(view.fair)) : n(view.live)) : n(audit.line)} compact />
                            <CompactMetric label="Projection" value={view.proj == null ? '-' : n(view.proj)} compact />
                            <CompactMetric label="Gap" value={gapRead(view.edge)} compact />
                            <CompactMetric label="Signal" value={signalGradeValue(view.signalGrade)} compact />
                            <CompactMetric label="Conf" value={view.conf == null ? '-' : pct(view.conf, 0)} compact />
                            <CompactMetric label="Books" value={view.books == null ? '-' : n(view.books, 0)} compact />
                            <CompactMetric label={audit?.status === 'SETTLED' ? 'Actual' : 'Status'} value={audit?.status === 'SETTLED' ? (audit.actualValue == null ? '-' : n(audit.actualValue, 1)) : precisionAuditLabel(audit)} compact />
                          </div>

                          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-sm leading-6 text-[var(--text-2)]">
                            {precisionAuditRead(audit, view.market)}
                          </div>

                          <div className="mt-4">
                            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Why it qualified</div>
                            <div className="mt-2 grid gap-2">
                              {cardReasons.map((reason) => (
                                <div key={reason} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-sm leading-5 text-[var(--text-2)]">
                                  {reason}
                                </div>
                              ))}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4">
                    <EmptyState
                      eyebrow="Precision Picks"
                      title="No promoted precision picks are loaded yet."
                      detail="As soon as the pipeline has enough qualifying pregame-safe numbers, the promoted picks will appear here with their audit status."
                      actionLabel="Refresh slate"
                      onAction={refreshSlate}
                    />
                  </div>
                )}
              </div>
            </section>
          ) : tab === 'rubbing' ? (
            <section className="mt-5 space-y-5">
              <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-2)] p-5 shadow-[0_8px_30px_rgba(20,16,35,0.05)] sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Rubbing Hands</div>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">{TOP_PLAYER_200_SAMPLE_MODEL_LABEL}</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-2)]">
                      This section now opens on the 200+ sample top-player prop model, not the regular board filter. It keeps the fixed high-sample player pool, requires live book depth, selects one strongest market per player, and removes confirmed OUT, DOUBTFUL, and 0% availability players from the actionable list.
                    </p>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                      The default Rubbing Hands pick type now uses the expanded projection-disagreement lane: top-200 sample players, PTS/REB/AST, player-override sides that disagree with the board projection, gap at least {n(TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_LANE.minAbsLineGap, 1)}, and projected minutes at least {n(TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_LANE.minProjectedMinutes, 0)}.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-2)]">
                    Last board refresh <span className="font-semibold text-[var(--text)]">{boardRefreshRelative}</span>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-[var(--text-2)]">
                  Rubbing Hands default generated {TOP_PLAYER_200_SAMPLE_MODEL_GENERATED_AT}: expanded lane {n(TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_ACCURACY_PCT, 2)}% season-wide on {n(TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_LANE.playerDays, 0)} player-days, last 30 {n(TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_LANE.last30AccuracyPct, 2)}%, last 14 {n(TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_LANE.last14AccuracyPct, 2)}%; tighter recent-form lane {n(TOP_PLAYER_200_SAMPLE_RECENT_FORM_ACCURACY_PCT, 2)}% season-wide, last 30 {n(TOP_PLAYER_200_SAMPLE_RECENT_FORM_LANE.last30AccuracyPct, 2)}%, last 14 {n(TOP_PLAYER_200_SAMPLE_RECENT_FORM_LANE.last14AccuracyPct, 2)}%; top-6 HGB lane {n(TOP_PLAYER_200_SAMPLE_TOP6_ACCURACY_PCT, 2)}% season-wide, last 30 {n(TOP_PLAYER_200_SAMPLE_TOP6_LANE.last30AccuracyPct, 2)}%, last 14 {n(TOP_PLAYER_200_SAMPLE_TOP6_LANE.last14AccuracyPct, 2)}%. HGB current slate scores are for {TOP_PLAYER_200_SAMPLE_CURRENT_SLATE_DATE_ET}. Injury and external context still comes through the live board payload.
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-10">
                <Stat dense label="Shown picks" value={n(rubbingFilteredViews.length, 0)} kind={rubbingFilteredViews.length ? 'LIVE' : 'PLACEHOLDER'} note={`${rubbingPickFilterLabel(rubbingPickFilter)}; one per player`} />
                <Stat dense label="Removed picks" value={n(rubbingDisplayedRemovedViews.length, 0)} kind={rubbingDisplayedRemovedViews.length ? 'DERIVED' : 'PLACEHOLDER'} note="OUT, DOUBTFUL, or 0% to play" />
                <Stat dense label="Injury watch" value={n(rubbingWatchCount, 0)} kind={rubbingWatchCount ? 'DERIVED' : 'PLACEHOLDER'} note="Questionable or reduced availability" />
                <Stat dense label="200+ pool" value={n(TOP_PLAYER_200_SAMPLE_POOL_SIZE, 0)} kind="MODEL" note={`${n(TOP_PLAYER_200_SAMPLE_RUNTIME_ACCURACY_PCT, 2)}% runtime-side replay`} />
                <Stat dense label="Qualified" value={n(TOP_PLAYER_200_SAMPLE_QUALIFIED_COUNT, 0)} kind="MODEL" note={`${n(TOP_PLAYER_200_SAMPLE_MIN_SAMPLES, 0)}+ samples this season`} />
                <Stat dense label="Expanded" value={pct(TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_ACCURACY_PCT, 1)} kind="MODEL" note={`${n(topPlayer200SampleCoveragePickCount, 0)} current picks`} />
                <Stat dense label="Recent form" value={pct(TOP_PLAYER_200_SAMPLE_RECENT_FORM_ACCURACY_PCT, 1)} kind="MODEL" note={`${n(topPlayer200SampleRecentPickCount, 0)} current picks`} />
                <Stat dense label="Top-6 gate" value={pct(TOP_PLAYER_200_SAMPLE_TOP6_MIN_HGB_CONFIDENCE_PCT, 0)} kind="MODEL" note={`${n(topPlayer200SampleTop6PickCount, 0)} current picks`} />
                <Stat dense label="Meta gate" value={pct(TOP_PLAYER_200_SAMPLE_META_CONFIDENCE_PCT, 1)} kind="MODEL" note={`${n(topPlayer200SampleMetaPickCount, 0)} current picks`} />
                <Stat dense label="Strict gate" value={pct(TOP_PLAYER_200_SAMPLE_CONFIDENCE_PCT, 0)} kind="MODEL" note={`${n(topPlayer200SamplePickCount, 0)} current picks`} />
                <Stat dense label="Volume gate" value={pct(TOP_PLAYER_200_SAMPLE_VOLUME_CONFIDENCE_PCT, 0)} kind="MODEL" note={`${n(topPlayer200SampleVolumePickCount, 0)} current picks`} />
                <Stat dense label="All-window picks" value={n(rubbingAllWindowPickCount, 0)} kind={rubbingAllWindowPickCount ? 'MODEL' : 'PLACEHOLDER'} note={`${n(RUBBING_115_ALL_WINDOW_REPLAY_LANE.accuracyPct, 2)}% replay lane`} />
                <Stat dense label="Research picks" value={n(rubbingResearchPickCount, 0)} kind={rubbingResearchPickCount ? 'MODEL' : 'PLACEHOLDER'} note={`${n(RUBBING_HANDS_115_RESEARCH_LANE?.accuracyPct ?? null, 2)}% replay lane`} />
                <Stat dense label="Avg confidence" value={rubbingAverageConfidence == null ? '-' : pct(rubbingAverageConfidence, 1)} kind={rubbingAverageConfidence == null ? 'PLACEHOLDER' : 'MODEL'} note="Current filtered board" />
              </div>

              <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-5">
                <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.2fr)_repeat(3,minmax(0,0.8fr))]">
                  <label className="flex flex-col gap-2 text-sm text-[var(--text-2)]">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Search player</span>
                    <input
                      value={rubbingSearchQuery}
                      onChange={(event) => setRubbingSearchQuery(event.target.value)}
                      placeholder="Search player, team, matchup, or market"
                      className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[color:rgba(109,74,255,0.28)] focus:bg-[var(--surface)]"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-[var(--text-2)]">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Pick type</span>
                    <select
                      value={rubbingPickFilter}
                      onChange={(event) => setRubbingPickFilter(event.target.value as RubbingPickFilter)}
                      className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[color:rgba(109,74,255,0.28)] focus:bg-[var(--surface)]"
                    >
                      <option value="sample200Coverage">{n(TOP_PLAYER_200_SAMPLE_COVERAGE_FRONTIER_ACCURACY_PCT, 2)}% expanded lane</option>
                      <option value="sample200Recent">{n(TOP_PLAYER_200_SAMPLE_RECENT_FORM_ACCURACY_PCT, 2)}% recent-form lane</option>
                      <option value="sample200Top6">{n(TOP_PLAYER_200_SAMPLE_TOP6_ACCURACY_PCT, 2)}% 200+ top-6 lane</option>
                      <option value="sample200Meta">{n(TOP_PLAYER_200_SAMPLE_META_ACCURACY_PCT, 2)}% 200+ meta lane</option>
                      <option value="sample200">{n(TOP_PLAYER_200_SAMPLE_RUNTIME_ACCURACY_PCT, 2)}% 200+ strict lane</option>
                      <option value="sample200Volume">{n(TOP_PLAYER_200_SAMPLE_VOLUME_RUNTIME_ACCURACY_PCT, 2)}% 200+ volume lane</option>
                      <option value="all">Legacy 115-player picks</option>
                      <option value="allWindow">{n(RUBBING_115_ALL_WINDOW_REPLAY_LANE.accuracyPct, 2)}% all-window lane</option>
                      <option value="research">{n(RUBBING_HANDS_115_RESEARCH_LANE?.accuracyPct ?? null, 2)}% research lane</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-[var(--text-2)]">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Sort</span>
                    <select
                      value={rubbingSort}
                      onChange={(event) => setRubbingSort(event.target.value as RubbingSort)}
                      className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[color:rgba(109,74,255,0.28)] focus:bg-[var(--surface)]"
                    >
                      <option value="confidence">Highest confidence</option>
                      <option value="edge">Biggest model gap</option>
                      <option value="books">Most books live</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-[var(--text-2)]">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Market</span>
                    <select
                      value={rubbingMarketFilter}
                      onChange={(event) => setRubbingMarketFilter(event.target.value as 'ALL' | SnapshotMarket)}
                      className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[color:rgba(109,74,255,0.28)] focus:bg-[var(--surface)]"
                    >
                      <option value="ALL">All markets</option>
                      {MARKETS.map((market) => (
                        <option key={market} value={market}>
                          {MARKET_LABELS[market]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_30px_rgba(20,16,35,0.06)]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
                  <div className="text-sm text-[var(--text-2)]">
                    {rubbingFilteredViews.length === 0
                      ? rubbingEmptyTitle
                      : `Showing ${n(rubbingRangeStart, 0)}-${n(rubbingRangeEnd, 0)} of ${n(rubbingFilteredViews.length, 0)} ${rubbingPickFilterLabel(rubbingPickFilter)}.`}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRubbingPage((current) => Math.max(current - 1, 0))}
                      disabled={rubbingPage === 0 || rubbingFilteredViews.length === 0}
                      className={`${ACTION_CLASS} inline-flex min-h-10 items-center rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium ${
                        rubbingPage === 0 || rubbingFilteredViews.length === 0
                          ? 'cursor-not-allowed bg-[var(--surface-2)] text-[var(--muted)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      Previous 24
                    </button>
                    <div className="min-w-[88px] text-center text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                      Page {n(rubbingPageDisplay, 0)} / {n(rubbingPageTotalDisplay, 0)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setRubbingPage((current) => Math.min(current + 1, rubbingPageCount - 1))}
                      disabled={rubbingPage >= rubbingPageCount - 1 || rubbingFilteredViews.length === 0}
                      className={`${ACTION_CLASS} inline-flex min-h-10 items-center rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium ${
                        rubbingPage >= rubbingPageCount - 1 || rubbingFilteredViews.length === 0
                          ? 'cursor-not-allowed bg-[var(--surface-2)] text-[var(--muted)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      Next 24
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-[var(--surface-2)] text-[var(--text-2)]">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Player</th>
                        <th className="px-4 py-3 text-left font-medium">Model pick</th>
                        <th className="px-4 py-3 text-right font-medium">Line</th>
                        <th className="px-4 py-3 text-right font-medium">Board projection</th>
                        <th className="px-4 py-3 text-right font-medium">Proj gap</th>
                        <th className="px-4 py-3 text-right font-medium">Confidence</th>
                        <th className="px-4 py-3 text-left font-medium">Availability</th>
                        <th className="px-4 py-3 text-left font-medium">External context</th>
                        <th className="px-4 py-3 text-right font-medium">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rubbingViews.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-6">
                            <EmptyState
                              eyebrow="Rubbing Hands"
                              title={rubbingEmptyTitle}
                              detail={rubbingEmptyDetail}
                              actionLabel="Refresh slate"
                              onAction={refreshSlate}
                            />
                          </td>
                        </tr>
                      ) : (
                        rubbingViews.map((v, index) => {
                          const rowRank = rubbingRangeStart + index;
                          const isSample200Row = isTopPlayer200SampleFilter(rubbingPickFilter);
                          const isHgbRow = isTopPlayer200HgbFilter(rubbingPickFilter);
                          const isCoverageRow = isTopPlayer200CoverageFilter(rubbingPickFilter);
                          const isRecentRow = isTopPlayer200RecentFormFilter(rubbingPickFilter);
                          const isMetaRow = rubbingPickFilter === 'sample200Meta';
                          const sampleScore = isHgbRow ? topPlayer200SampleScore(v, data.dateEt) : null;
                          const modelSide = sampleScore ? topPlayer200SampleSide(v, data.dateEt) : rubbingHands115Side(v);
                          const projectionLean = rubbingProjectionLeanLabel(v, modelSide);
                          const displayConfidence = isHgbRow ? topPlayer200SampleLaneConfidencePct(v, data.dateEt, rubbingPickFilter) : v.conf;
                          return (
                            <tr key={`${trackerRowKey(v)}:rubbing`} className="border-t border-[color:rgba(216,204,186,0.68)] transition hover:bg-[var(--surface-2)]">
                              <td className="px-4 py-4 align-top">
                                <div className="flex items-start gap-3">
                                  <Badge label={`#${rowRank}`} kind="DERIVED" />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-[var(--text)]">{v.row.playerName}</div>
                                    <div className="mt-1 text-xs text-[var(--text-2)]">
                                      {v.row.matchupKey.replace('@', ' @ ')} | {v.row.gameTimeEt}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-4 align-top">
                                <div className="font-semibold text-[var(--text)]">{sampleScore ? topPlayer200SampleHeadline(v, data.dateEt) : rubbingHands115Headline(v)}</div>
                                <div className="mt-1 flex flex-wrap gap-2">
                                  <Pill label={isCoverageRow ? '200+ expanded model' : isRecentRow ? '200+ recent-form model' : isMetaRow ? '200+ HGB+meta model' : isSample200Row ? '200+ HGB model' : '115 model'} tone="cyan" />
                                  <Pill label={isCoverageRow ? 'Projection-disagreement override' : isRecentRow ? 'Projection-fade override' : isMetaRow ? 'Meta reliability gate' : sampleScore ? 'HGB model side' : rubbingHands115SideSource(v)} tone="default" />
                                  <Pill label={rubbingLaneLabel(v, rubbingPickFilter, data.dateEt)} tone={isRubbingHands115AllWindowPick(v) || (isCoverageRow && isTopPlayer200CoverageFrontierLanePick(v)) || (isRecentRow && isTopPlayer200RecentFormLanePick(v)) || (isHgbRow && isTopPlayer200SampleLanePick(v, data.dateEt, rubbingPickFilter)) ? 'cyan' : 'amber'} />
                                  {projectionLean ? (
                                    <Pill
                                      label={projectionLean}
                                      tone={projectionLean === 'Projection agrees' ? 'cyan' : 'amber'}
                                    />
                                  ) : null}
                                  <Pill label={MARKET_LABELS[v.market]} tone="amber" />
                                </div>
                              </td>
                              <td className="px-4 py-4 text-right align-top text-[var(--text)]">
                                <div>{v.live == null ? (v.fair == null ? '-' : n(v.fair)) : n(v.live)}</div>
                                <div className="mt-1 text-xs text-[var(--text-2)]">{v.live == null ? 'Fair fallback' : 'Live consensus'}</div>
                              </td>
                              <td className="px-4 py-4 text-right align-top text-[var(--text)]">{v.proj == null ? '-' : n(v.proj)}</td>
                              <td className={`px-4 py-4 text-right align-top ${v.edge == null ? 'text-[var(--muted)]' : 'text-[var(--text)]'}`}>
                                {v.edge == null ? '-' : gapRead(v.edge)}
                              </td>
                              <td className="px-4 py-4 text-right align-top text-[var(--text)]">
                                <div className="font-semibold">{displayConfidence == null ? '-' : pct(displayConfidence, 0)}</div>
                                <div className="mt-1 text-xs text-[var(--text-2)]">{isCoverageRow || isRecentRow ? signalGradeValue(v.signalGrade) : isMetaRow ? 'Meta reliability' : sampleScore ? 'HGB score' : signalGradeValue(v.signalGrade)}</div>
                                {isMetaRow && sampleScore ? (
                                  <div className="mt-1 text-xs text-[var(--text-2)]">HGB {pct(sampleScore.wfConfidence * 100, 0)}</div>
                                ) : null}
                              </td>
                              <td className="px-4 py-4 align-top">
                                <div className="flex flex-wrap gap-2">
                                  <Pill label={rubbingPropStatusLabel(v.row)} tone={rubbingPropStatusTone(v.row)} />
                                  <Pill label={rubbingAvailabilityLabel(v.row)} tone={rubbingAvailabilityTone(v.row)} />
                                </div>
                              </td>
                              <td className="max-w-[360px] px-4 py-4 align-top text-sm leading-6 text-[var(--text-2)]">
                                {rubbingExternalNote(v)}
                              </td>
                              <td className="px-4 py-4 text-right align-top">
                                <button
                                  type="button"
                                  onClick={() => setResearch(v.row.playerId)}
                                  className={`${ACTION_CLASS} rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)]`}
                                >
                                  Dossier
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : tab === 'research' ? (
            <section className="mt-5 grid gap-6 xl:items-start xl:grid-cols-[0.92fr_1.58fr]">
              <div className="space-y-4">
                <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Player lookup</div>
                      <div className="mt-1 text-sm text-[var(--text-2)]">Search the slate and open one clean dossier at a time.</div>
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
                      className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[color:rgba(109,74,255,0.28)] focus:bg-[var(--surface)]"
                    />
                    {searchQuery ? (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className={`${ACTION_CLASS} rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm font-medium text-[var(--text)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)]`}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 text-xs text-[var(--text-2)]">
                    {deferredSearchQuery
                      ? searchResults.length
                        ? 'Showing matching players from the active slate.'
                        : 'No player on the current slate matched that search.'
                      : 'Top slate players stay in the rail until you search for a specific name or matchup.'}
                  </div>
                </div>

                <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-3">
                  {researchListCards.length ? (
                    <div className="max-h-[68vh] space-y-2 overflow-auto pr-1 xl:max-h-[calc(100vh-16rem)]">
                      {researchListCards.map(({ row, leadView }) => {
                        const picked = row.playerId === researchRow?.playerId;
                        return (
                          <button
                            key={row.playerId}
                            type="button"
                            onClick={() => setResearch(row.playerId)}
                            className={`w-full rounded-[22px] border px-4 py-3.5 text-left ${CARD_BUTTON_CLASS} ${
                              picked
                                ? 'border-[color:rgba(109,74,255,0.30)] bg-[var(--accent-soft)] shadow-[0_12px_28px_rgba(109,74,255,0.10)]'
                                : 'border-[var(--border)] bg-[var(--surface-2)]'
                            } ${isPlayerHighlighted(row.playerId) ? 'shadow-[0_0_0_3px_rgba(109,74,255,0.16)]' : ''}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-base font-semibold text-[var(--text)] sm:text-lg">{row.playerName}</div>
                                <div className="mt-1 text-xs leading-5 text-[var(--text-2)] sm:text-sm">{matchup(row)}</div>
                              </div>
                              {picked ? (
                                <span className="inline-flex items-center rounded-full border border-[color:rgba(109,74,255,0.22)] bg-white/65 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
                                  Selected
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-3 grid grid-cols-[1fr_auto] gap-3">
                              <div>
                                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Best market</div>
                                <div className="mt-1 text-sm font-medium text-[var(--text)]">
                                  {leadView ? recommendationHeadline(leadView) : 'Waiting for market context'}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Confidence</div>
                                <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                                  {leadView?.conf == null ? '-' : pct(leadView.conf, 0)}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState
                      eyebrow="Slate player search"
                      title={deferredSearchQuery ? 'No players on the current slate matched that search.' : 'Active-slate players will appear here as soon as the board loads.'}
                      detail={
                        deferredSearchQuery
                          ? 'Try a player name, team code, or matchup, or clear the search to fall back to the strongest slate rows.'
                          : 'Once the slate rows are available, this rail will stay anchored to the strongest player reads.'
                      }
                      actionLabel={searchQuery ? 'Clear search' : undefined}
                      onAction={searchQuery ? () => setSearchQuery('') : undefined}
                    />
                  )}
                </div>
              </div>

              <div className="space-y-4">
                {researchRow ? (
                  <>
                    <div
                      ref={researchDossierRef}
                      tabIndex={-1}
                      className={`rounded-[28px] border bg-[var(--surface)] p-5 outline-none transition-shadow ${
                        isPlayerHighlighted(researchRow.playerId)
                          ? 'border-[color:rgba(109,74,255,0.30)] shadow-[0_0_0_3px_rgba(109,74,255,0.16)]'
                          : 'border-[var(--border)]'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Player dossier</div>
                            {pickedPlayer === researchRow.playerId ? <Pill label="Selected player" tone="cyan" /> : null}
                          </div>
                          <h3 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text)]">{researchRow.playerName}</h3>
                          <p className="mt-1 text-sm text-[var(--text-2)]">{matchup(researchRow)}</p>
                          <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--text-2)]">{researchShortWhy}</p>
                        </div>
                        {researchLeadView ? (
                          <RecommendationBox
                            view={researchLeadView}
                            title="Best market"
                            align="right"
                            size="compact"
                            className="w-full sm:max-w-[280px]"
                          />
                        ) : (
                          <div className="w-full rounded-[24px] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--text-2)] sm:max-w-[280px]">
                            Lead market unavailable until the board has enough player pricing context.
                          </div>
                        )}
                      </div>

                      <div className={`mt-5 rounded-[24px] border p-4 sm:p-5 ${SURFACE_TONE_CLASS[researchPrecisionState.tone]}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Precision state</div>
                            <div
                              className={`mt-2 text-xl font-semibold tracking-tight ${
                                researchPrecisionState.tone === 'cyan'
                                  ? 'text-[var(--accent)]'
                                  : researchPrecisionState.tone === 'amber'
                                    ? 'text-[var(--warning)]'
                                    : 'text-[var(--text)]'
                              }`}
                            >
                              {researchPrecisionState.label}
                            </div>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-2)]">{researchPrecisionState.summary}</p>
                            {researchPrecisionState.detail ? (
                              <div className="mt-2 text-xs font-medium text-[var(--text-2)]">{researchPrecisionState.detail}</div>
                            ) : null}
                          </div>
                          <Badge
                            label={
                              researchPrecisionState.kind === 'MODEL'
                                ? 'PROMOTED'
                                : researchPrecisionState.kind === 'DERIVED'
                                  ? 'QUALIFIED'
                                  : 'BOARD READ'
                            }
                            kind={researchPrecisionState.kind}
                          />
                        </div>
                        {researchPrecisionState.reasons.length ? (
                          <div className="mt-4 grid gap-2 sm:grid-cols-3">
                            {researchPrecisionState.reasons.map((reason) => (
                              <div key={reason} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-sm leading-5 text-[var(--text-2)]">
                                {reason}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
                        <Stat
                          dense
                          showKind={false}
                          label="Line to play"
                          value={researchLeadView?.live == null ? (researchLeadView?.fair == null ? '-' : n(researchLeadView.fair)) : n(researchLeadView.live)}
                          kind={researchLeadView?.live == null ? (researchLeadView?.fairKind ?? 'PLACEHOLDER') : researchLeadView.liveLineKind}
                          note={researchLeadView ? `${researchLeadView.label} market basis` : 'Lead market unavailable'}
                        />
                        <Stat
                          dense
                          showKind={false}
                          label="Projection"
                          value={researchLeadView?.proj == null ? '-' : n(researchLeadView.proj)}
                          kind={researchLeadView?.projKind ?? 'PLACEHOLDER'}
                          note="Board projection for the lead market"
                        />
                        <Stat
                          dense
                          showKind={false}
                          label="Model gap"
                          value={researchLeadView?.edge == null ? '-' : gapRead(researchLeadView.edge)}
                          kind={researchLeadView?.edgeKind ?? 'PLACEHOLDER'}
                          note={researchLeadView ? gapNote(researchLeadView) : 'Lead market unavailable'}
                        />
                        <Stat
                          dense
                          showKind={false}
                          label="Confidence"
                          value={researchLeadView?.conf == null ? '-' : pct(researchLeadView.conf, 0)}
                          kind={researchLeadView?.confKind ?? 'PLACEHOLDER'}
                          note={researchLeadView ? researchLeadView.source : 'Confidence unavailable'}
                        />
                        <Stat
                          dense
                          showKind={false}
                          label="Signal grade"
                          value={signalGradeValue(researchLeadView?.signalGrade)}
                          kind={researchLeadView?.signalGrade ? 'DERIVED' : 'PLACEHOLDER'}
                          note={signalGradeNote(researchLeadView?.signalGrade)}
                        />
                        <Stat
                          dense
                          showKind={false}
                          label="Books live"
                          value={researchLeadView?.books == null ? '-' : n(researchLeadView.books, 0)}
                          kind={researchLeadView?.booksKind ?? 'PLACEHOLDER'}
                          note={researchLeadView ? `${researchLeadView.label} market depth` : 'Book depth unavailable'}
                        />
                        <Stat
                          dense
                          showKind={false}
                          label="Lineup status"
                          value={availabilityRead(researchRow.playerContext) ?? researchRow.playerContext.lineupStatus ?? '-'}
                          kind={availabilityRead(researchRow.playerContext) || researchRow.playerContext.lineupStatus ? 'LIVE' : 'PLACEHOLDER'}
                          note={
                            availabilityRead(researchRow.playerContext)
                              ? `${researchRow.playerContext.lineupStatus ?? 'Lineup pending'} / ${researchRow.playerContext.projectedStarter}`
                              : researchRow.playerContext.projectedStarter ?? 'Starter note unavailable'
                          }
                        />
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-5">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">All markets</div>
                        <div className="mt-1 text-lg font-semibold text-[var(--text)]">Every live player market stays open by default</div>
                        <p className="mt-3 text-sm leading-6 text-[var(--text-2)]">
                          Compare the full live player-market table without opening another panel first.
                        </p>
                      </div>
                      {researchLiveViews.length ? (
                        <div className="mt-4 overflow-x-auto rounded-[22px] border border-[var(--border)] bg-[var(--surface)]">
                          <table className="min-w-full text-sm">
                            <thead className="bg-[var(--surface-2)] text-[var(--text-2)]">
                              <tr>
                                <th className="px-4 py-3 text-left font-medium">Market</th>
                                <th className="px-4 py-3 text-right font-medium">Line</th>
                                <th className="px-4 py-3 text-right font-medium">Projection</th>
                                <th className="px-4 py-3 text-right font-medium">Gap</th>
                                <th className="px-4 py-3 text-right font-medium">Confidence</th>
                                <th className="px-4 py-3 text-right font-medium">Signal</th>
                                <th className="px-4 py-3 text-right font-medium">Books</th>
                                <th className="px-4 py-3 text-left font-medium">Precision</th>
                              </tr>
                            </thead>
                            <tbody>
                              {researchLiveViews.map((v) => (
                                <tr
                                  key={`${v.row.playerId}:${v.market}`}
                                  className={`border-t border-[var(--border)] ${
                                    researchLeadView?.market === v.market ? 'bg-[color:rgba(109,74,255,0.06)]' : 'bg-[var(--surface)]'
                                  }`}
                                >
                                  <td className="px-4 py-3">
                                    <div className="font-semibold text-[var(--text)]">{v.label}</div>
                                    <div className="text-xs text-[var(--text-2)]">
                                      {researchLeadView?.market === v.market ? 'Lead market' : marketRead(v)}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-right font-medium text-[var(--text)]">{v.live == null ? '-' : n(v.live)}</td>
                                  <td className="px-4 py-3 text-right font-medium text-[var(--text)]">{v.proj == null ? '-' : n(v.proj)}</td>
                                  <td className="px-4 py-3 text-right font-medium text-[var(--text)]">{v.edge == null ? '-' : gapRead(v.edge)}</td>
                                  <td className="px-4 py-3 text-right font-medium text-[var(--text)]">{v.conf == null ? '-' : pct(v.conf, 0)}</td>
                                  <td className="px-4 py-3 text-right font-medium text-[var(--text)]">{signalGradeValue(v.signalGrade)}</td>
                                  <td className="px-4 py-3 text-right font-medium text-[var(--text)]">{v.books == null ? '-' : n(v.books, 0)}</td>
                                  <td className="px-4 py-3 text-[var(--text-2)]">
                                    {researchTopPrecision?.entry.market === v.market
                                      ? 'Precision pick'
                                      : v.precision?.qualified
                                        ? 'Precision qualified'
                                        : 'Board read only'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="mt-4 rounded-[22px] border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--text-2)]">
                          No live player prop lines are available for this player right now. Model-only rows stay hidden until a real book line lands.
                        </div>
                      )}
                    </div>

                    <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">More context</div>
                          <div className="mt-1 text-lg font-semibold text-[var(--text)]">Open the deeper model, matchup, and recent-form read only when you need it</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowResearchContext((value) => !value)}
                          className={`${ACTION_CLASS} inline-flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-medium text-[var(--text)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)]`}
                        >
                          {showResearchContext ? 'Hide context' : 'Show context'}
                        </button>
                      </div>
                      {showResearchContext ? (
                        <div className="mt-4 grid gap-4 xl:grid-cols-2">
                          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-2)] p-4">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Support and caution</div>
                            <div className="mt-1 text-lg font-semibold text-[var(--text)]">What is helping and what still needs restraint</div>
                            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                              <div>
                                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Support</div>
                                <div className="mt-3 space-y-2">
                                  {researchSupportDrivers.length ? (
                                    researchSupportDrivers.map((driver) => (
                                      <div key={driver} className="rounded-2xl border border-[color:rgba(47,125,90,0.16)] bg-[color:rgba(47,125,90,0.08)] px-3.5 py-3 text-sm leading-5 text-[var(--text)]">
                                        {driver}
                                      </div>
                                    ))
                                  ) : (
                                    <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-sm text-[var(--text-2)]">
                                      The board does not yet have strong support drivers beyond the current visible market read.
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Caution</div>
                                <div className="mt-3 space-y-2">
                                  {researchCautionDrivers.length ? (
                                    researchCautionDrivers.map((driver) => (
                                      <div key={driver} className="rounded-2xl border border-[color:rgba(180,74,74,0.16)] bg-[color:rgba(180,74,74,0.08)] px-3.5 py-3 text-sm leading-5 text-[var(--text)]">
                                        {driver}
                                      </div>
                                    ))
                                  ) : (
                                    <div className="rounded-2xl border border-[color:rgba(47,125,90,0.16)] bg-[color:rgba(47,125,90,0.08)] px-3.5 py-3 text-sm text-[var(--text)]">
                                      No major caution flags are surfacing beyond normal slate variance in the current payload.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-2)] p-4">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Model vs line</div>
                            <div className="mt-1 text-lg font-semibold text-[var(--text)]">How the board is framing the lead market</div>
                            <p className="mt-3 text-sm leading-6 text-[var(--text-2)]">{researchModelVsLineExplanation}</p>
                            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                              <Stat dense showKind={false} label="Live line" value={researchLeadView?.live == null ? '-' : n(researchLeadView.live)} kind={researchLeadView?.liveLineKind ?? 'PLACEHOLDER'} note={researchLeadView ? `${researchLeadView.label} market line` : 'Lead market unavailable'} />
                              <Stat dense showKind={false} label="Fair line" value={researchLeadView?.fair == null ? '-' : n(researchLeadView.fair)} kind={researchLeadView?.fairKind ?? 'PLACEHOLDER'} note="Board fair line" />
                              <Stat dense showKind={false} label="Projection" value={researchLeadView?.proj == null ? '-' : n(researchLeadView.proj)} kind={researchLeadView?.projKind ?? 'PLACEHOLDER'} note="Board projection" />
                            </div>
                          </div>

                          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-2)] p-4">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Recent pattern</div>
                            <div className="mt-1 text-lg font-semibold text-[var(--text)]">Season baseline versus the current sample</div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                              <Stat dense showKind={false} label="L10 avg" value={n(researchLeadView ? researchRow.last10Average[researchLeadView.market] : null, 1)} kind={researchLeadView ? 'LIVE' : 'PLACEHOLDER'} note="Current sample" />
                              <Stat dense showKind={false} label="Season avg" value={n(researchLeadView ? researchRow.seasonAverage[researchLeadView.market] : null, 1)} kind={researchLeadView ? 'LIVE' : 'PLACEHOLDER'} note="Season baseline" />
                              <Stat dense showKind={false} label="Trend" value={signed(researchLeadTrend, 1)} kind={researchLeadTrend == null ? 'PLACEHOLDER' : 'DERIVED'} note={trendRead(researchLeadTrend)} />
                              <Stat dense showKind={false} label="Opp delta" value={signed(researchLeadOpponentDelta, 1)} kind={researchLeadOpponentDelta == null ? 'PLACEHOLDER' : 'LIVE'} note="Opponent-specific context" />
                            </div>
                            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Recent 5</div>
                                <div className="text-xs font-medium text-[var(--text-2)]">
                                  Avg {researchLeadRecentAverage == null ? '-' : n(researchLeadRecentAverage, 1)}
                                </div>
                              </div>
                              {researchLeadRecentValues.length ? (
                                <div className="mt-3 grid grid-cols-5 gap-2">
                                  {researchLeadRecentValues.map((value, index) => (
                                    <div key={`${researchRow.playerId}:${researchLeadView?.market ?? 'lead'}:${index}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-center text-sm font-semibold text-[var(--text)]">
                                      {n(value, 0)}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="mt-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-sm text-[var(--text-2)]">
                                  Recent-game values are not available for the current lead market yet.
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-2)] p-4">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Matchup and role</div>
                            <div className="mt-1 text-lg font-semibold text-[var(--text)]">Opponent read, defender note, and teammate context</div>
                            <p className="mt-3 text-sm leading-6 text-[var(--text-2)]">{researchMatchupRead}</p>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                              <Stat dense showKind={false} label="Team L10" value={n(researchTeamMarketLast10, 1)} kind={researchTeamMarketLast10 == null ? 'PLACEHOLDER' : 'LIVE'} note={researchLeadView ? `${researchRow.teamCode} ${researchLeadView.label}` : 'Team sample'} />
                              <Stat dense showKind={false} label="Opp allowed L10" value={n(researchOpponentMarketAllowedLast10, 1)} kind={researchOpponentMarketAllowedLast10 == null ? 'PLACEHOLDER' : 'LIVE'} note={researchLeadView ? `${researchRow.opponentCode} ${researchLeadView.label} allowed` : 'Opponent sample'} />
                              <Stat dense showKind={false} label="Season record" value={researchSeasonRecord ?? '-'} kind={researchSeasonRecord ? 'LIVE' : 'PLACEHOLDER'} note={`${researchRow.teamCode} overall`} />
                              <Stat dense showKind={false} label="Last 10 record" value={researchLast10Record ?? '-'} kind={researchLast10Record ? 'LIVE' : 'PLACEHOLDER'} note={`${researchRow.teamCode} recent`} />
                            </div>
                            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-[var(--text-2)]">
                              Teammates:{' '}
                              {researchRow.playerContext.teammateCore.length
                                ? researchRow.playerContext.teammateCore
                                    .slice(0, 3)
                                    .map((mate) => `${mate.playerName} (${n(mate.avgMinutesLast10, 1)})`)
                                    .join(' | ')
                                : '-'}
                            </div>
                            <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-[var(--text-2)]">
                              Synergy:{' '}
                              {researchRow.playerContext.teammateSynergies?.length
                                ? researchRow.playerContext.teammateSynergies
                                    .slice(0, 3)
                                    .map((synergy) => {
                                      const sign = synergy.delta >= 0 ? '+' : '';
                                      const active = synergy.activeToday ? '' : ' inactive';
                                      const likely = synergy.likelyActiveTrigger ? '' : ' watch';
                                      return `${synergy.teammateName} ${synergy.triggerLabel} -> ${synergy.targetMarket} ${sign}${n(synergy.delta, 1)} (${synergy.confidence}, n=${synergy.withSample}${active}${likely})`;
                                    })
                                    .join(' | ')
                                : '-'}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm leading-6 text-[var(--text-2)]">
                          Keep the dossier focused on the recommendation until you want the fuller matchup, trend, and model explanation.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <EmptyState
                    eyebrow="Player dossier"
                    title={hasActiveSearch ? 'No player on the current slate matched that search.' : 'No research row is selected.'}
                    detail={
                      hasActiveSearch
                        ? 'Try another player, team code, or matchup, or clear the search to restore the strongest slate rows.'
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
            <section className="mt-5 space-y-5">
              <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Board feed</div>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">Persistent pregame changes only</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-2)]">
                      The feed stores surfaced, moved, dropped, and locked events through the day. Once tipoff hits, the market freezes and stays historical.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--text-2)]">
                    Latest event <span className="font-semibold text-[var(--text)]">{latestBoardFeedEvent ? relativeTime(latestBoardFeedEvent.createdAt, now) : 'Waiting for feed activity'}</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat dense label="Events today" value={n(boardFeedEvents.length, 0)} kind={boardFeedEvents.length ? 'LIVE' : 'PLACEHOLDER'} note="Persistent pregame events stored today" />
                <Stat dense label="Surfaced" value={n(boardFeedSummary.surfaced, 0)} kind={boardFeedSummary.surfaced ? 'DERIVED' : 'PLACEHOLDER'} note="New playable numbers" />
                <Stat dense label="Moved" value={n(boardFeedSummary.moved, 0)} kind={boardFeedSummary.moved ? 'DERIVED' : 'PLACEHOLDER'} note="Material pregame changes" />
                <Stat dense label="Locked" value={n(boardFeedSummary.locked, 0)} kind={boardFeedSummary.locked ? 'LIVE' : 'PLACEHOLDER'} note="Frozen at tipoff" />
              </div>

              <div className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_30px_rgba(20,16,35,0.06)]">
                <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Timeline</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--text)]">Newest pregame events first</div>
                    </div>
                    <div className="text-sm text-[var(--text-2)]">
                      {boardFeedEvents.length ? `${n(boardFeedEvents.length, 0)} logged event${boardFeedEvents.length === 1 ? '' : 's'}` : 'Waiting for the first event'}
                    </div>
                  </div>
                </div>
                {boardFeedEvents.length === 0 ? (
                  <div className="p-5 sm:p-6">
                    <EmptyState
                      eyebrow="Board feed"
                      title="No pregame board events are available yet."
                      detail="This workspace fills as playable numbers surface, move materially, drop, and then lock at tipoff."
                      actionLabel="Refresh slate"
                      onAction={refreshSlate}
                    />
                  </div>
                ) : (
                  <div className="relative max-h-[920px] overflow-auto px-4 py-2 sm:px-6">
                    <div className="absolute bottom-0 left-[72px] top-0 hidden w-px bg-[color:rgba(109,74,255,0.18)] sm:block" />
                    {boardFeedEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => setResearch(event.playerId)}
                        className={`${ACTION_CLASS} relative grid w-full gap-3 border-b border-[color:rgba(216,204,186,0.68)] px-0 py-4 text-left last:border-b-0 sm:grid-cols-[56px_18px_minmax(0,1fr)] sm:items-start sm:gap-4`}
                      >
                        <div className="pt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)] sm:text-right">
                          {relativeTime(event.createdAt, now)}
                        </div>
                        <div className="relative hidden h-full sm:block">
                          <span className="absolute left-1/2 top-1.5 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)]" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Pill label={feedEventTypeLabel(event.eventType)} tone={feedEventTypeTone(event.eventType)} />
                                <Pill label={feedStatusLabel(event)} tone={feedStatusTone(event)} />
                              </div>
                              <div className="mt-2 text-base font-semibold text-[var(--text)] sm:text-lg">{feedEventTitle(event)}</div>
                              <div className="mt-1 text-sm text-[var(--text-2)]">
                                {event.playerName} | {MARKET_LABELS[event.market]} | {event.matchupKey.replace('@', ' @ ')} - {event.gameTimeEt}
                              </div>
                            </div>
                            <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${SIDE_CLASS[event.side]}`}>
                              {event.recommendation}
                            </span>
                          </div>
                          <div className="mt-2 text-sm leading-6 text-[var(--text-2)]">{feedReason(event)}</div>
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--text-2)]">
                            <span>Line {event.line == null ? (event.fairLine == null ? '-' : n(event.fairLine)) : n(event.line)}</span>
                            <span>Projection {event.projection == null ? '-' : n(event.projection)}</span>
                            <span>Gap {event.gap == null ? '-' : gapRead(event.gap)}</span>
                            <span>Conf {event.confidence == null ? '-' : pct(event.confidence, 0)}</span>
                            <span>{booksLiveLabel(event.booksLive) ?? 'Books pending'}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </section>
          ) : null}
          {tab === 'tracking' ? (
            <section className="mt-5 space-y-5">
              <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Market tracker</div>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">Sort live numbers numerically</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-2)]">
                      Compare the current line, board projection, gap, confidence, and book depth in one table. Click any row to open the recommendation, context, and saved pregame state inline.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--text-2)]">
                    Last board refresh <span className="font-semibold text-[var(--text)]">{boardRefreshRelative}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_30px_rgba(20,16,35,0.06)] sm:p-5">
                <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.2fr)_repeat(4,minmax(0,0.8fr))]">
                  <label className="flex flex-col gap-2 text-sm text-[var(--text-2)]">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Search player</span>
                    <input
                      value={trackerSearchQuery}
                      onChange={(event) => setTrackerSearchQuery(event.target.value)}
                      placeholder="Search player, team, or matchup"
                      className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[color:rgba(109,74,255,0.28)] focus:bg-[var(--surface)]"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-[var(--text-2)]">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Sort</span>
                    <select
                      value={trackerSort}
                      onChange={(event) => setTrackerSort(event.target.value as TrackerSort)}
                      className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[color:rgba(109,74,255,0.28)] focus:bg-[var(--surface)]"
                    >
                      <option value="gap">Biggest gap</option>
                      <option value="confidence">Highest confidence</option>
                      <option value="books">Most books live</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-[var(--text-2)]">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Market</span>
                    <select
                      value={trackerMarketFilter}
                      onChange={(event) => setTrackerMarketFilter(event.target.value as 'ALL' | SnapshotMarket)}
                      className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[color:rgba(109,74,255,0.28)] focus:bg-[var(--surface)]"
                    >
                      <option value="ALL">All markets</option>
                      {MARKETS.map((market) => (
                        <option key={market} value={market}>
                          {MARKET_LABELS[market]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-[var(--text-2)]">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Status</span>
                    <select
                      value={trackerStatusFilter}
                      onChange={(event) => setTrackerStatusFilter(event.target.value as TrackerStatusFilter)}
                      className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[color:rgba(109,74,255,0.28)] focus:bg-[var(--surface)]"
                    >
                      <option value="all">All statuses</option>
                      <option value="pregame">Pregame</option>
                      <option value="locked">Locked</option>
                      <option value="fair">Fair only</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-[var(--text-2)]">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Books</span>
                    <select
                      value={trackerBooksFilter}
                      onChange={(event) => setTrackerBooksFilter(event.target.value as TrackerBooksFilter)}
                      className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[color:rgba(109,74,255,0.28)] focus:bg-[var(--surface)]"
                    >
                      <option value="all">All books</option>
                      <option value="3plus">3+ books</option>
                      <option value="5plus">5+ books</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <Stat
                  dense
                  label="Matched rows"
                  value={n(trackerFilteredViews.length, 0)}
                  kind={trackerFilteredViews.length ? 'LIVE' : 'PLACEHOLDER'}
                  note={
                    trackerFilteredViews.length
                      ? `Showing ${n(trackerRangeStart, 0)}-${n(trackerRangeEnd, 0)} on page ${n(trackerPageDisplay, 0)} of ${n(trackerPageTotalDisplay, 0)}`
                      : 'Rows after current filters'
                  }
                />
                <Stat dense label="Pregame" value={n(trackerSummary.live, 0)} kind={trackerSummary.live ? 'LIVE' : 'PLACEHOLDER'} note="Live-priced tracker rows" />
                <Stat dense label="Locked" value={n(trackerSummary.locked, 0)} kind={trackerSummary.locked ? 'DERIVED' : 'PLACEHOLDER'} note="Rows frozen at tipoff" />
                <Stat dense label="Fair only" value={n(trackerSummary.fair, 0)} kind={trackerSummary.fair ? 'MODEL' : 'PLACEHOLDER'} note="Projection vs fair line fallback" />
                <Stat dense label="Avg books live" value={liveBookDepth == null ? '-' : n(liveBookDepth)} kind={liveBookDepth == null ? 'PLACEHOLDER' : 'LIVE'} note="Across currently priced board views" />
              </div>

              <div className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_30px_rgba(20,16,35,0.06)]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
                  <div className="text-sm text-[var(--text-2)]">
                    {trackerFilteredViews.length === 0
                      ? 'No tracker rows match the current filters.'
                      : `Showing ${n(trackerRangeStart, 0)}-${n(trackerRangeEnd, 0)} of ${n(trackerFilteredViews.length, 0)} tracker rows.`}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTrackerPage((current) => Math.max(current - 1, 0))}
                      disabled={trackerPage === 0 || trackerFilteredViews.length === 0}
                      className={`${ACTION_CLASS} inline-flex min-h-10 items-center rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium ${
                        trackerPage === 0 || trackerFilteredViews.length === 0
                          ? 'cursor-not-allowed bg-[var(--surface-2)] text-[var(--muted)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      Previous 18
                    </button>
                    <div className="min-w-[88px] text-center text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                      Page {n(trackerPageDisplay, 0)} / {n(trackerPageTotalDisplay, 0)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setTrackerPage((current) => Math.min(current + 1, trackerPageCount - 1))}
                      disabled={trackerPage >= trackerPageCount - 1 || trackerFilteredViews.length === 0}
                      className={`${ACTION_CLASS} inline-flex min-h-10 items-center rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium ${
                        trackerPage >= trackerPageCount - 1 || trackerFilteredViews.length === 0
                          ? 'cursor-not-allowed bg-[var(--surface-2)] text-[var(--muted)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] hover:border-[color:rgba(109,74,255,0.24)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      Next 18
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-[var(--surface-2)] text-[var(--text-2)]">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Player</th>
                        <th className="px-4 py-3 text-left font-medium">Market</th>
                        <th className="px-4 py-3 text-right font-medium">Current line</th>
                        <th className="px-4 py-3 text-right font-medium">Projection</th>
                        <th className="px-4 py-3 text-right font-medium">Gap</th>
                        <th className="px-4 py-3 text-right font-medium">Confidence</th>
                        <th className="px-4 py-3 text-right font-medium">Books</th>
                        <th className="px-4 py-3 text-right font-medium">Updated</th>
                        <th className="px-4 py-3 text-right font-medium">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trackViews.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-6">
                            <EmptyState
                              eyebrow="Market tracker"
                              title="No tracker rows match the current filters."
                              detail="Try clearing the search or widening the market and status filters."
                              actionLabel="Refresh slate"
                              onAction={refreshSlate}
                            />
                          </td>
                        </tr>
                      ) : (
                        trackViews.map((v, i) => {
                          const rowKey = trackerRowKey(v);
                          const trackerRank = trackerRangeStart + i;
                          const latestEvent = latestBoardFeedEventByKey.get(rowKey) ?? null;
                          const rowStatus: TrackerStatusFilter =
                            latestEvent?.status === 'LOCKED' || latestEvent?.status === 'FINAL'
                              ? 'locked'
                              : v.live != null
                                ? 'pregame'
                                : 'fair';
                          const rowExpanded = expandedTrackerKey === rowKey;
                          const updatedAt = v.row.gameIntel.generatedAt ?? data.lastUpdatedAt ?? null;
                          const rowReason = latestEvent ? feedReason(latestEvent) : conciseLeadReason(v, v.reasons[0] ?? v.note);
                          const rowTrend = v.row.trendVsSeason[v.market];

                          return (
                            <Fragment key={rowKey}>
                              <tr
                                tabIndex={0}
                                aria-expanded={rowExpanded}
                                onClick={() => setExpandedTrackerKey((current) => (current === rowKey ? null : rowKey))}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setExpandedTrackerKey((current) => (current === rowKey ? null : rowKey));
                                  }
                                }}
                                className={`cursor-pointer border-t border-[color:rgba(216,204,186,0.68)] transition ${
                                  rowExpanded ? 'bg-[color:rgba(109,74,255,0.06)]' : 'hover:bg-[var(--surface-2)]'
                                }`}
                              >
                                <td className="px-4 py-4 align-top">
                                  <div className="flex items-start gap-3">
                                    <Badge label={`#${trackerRank}`} kind="DERIVED" />
                                    <div className="min-w-0">
                                      <div className="font-semibold text-[var(--text)]">{v.row.playerName}</div>
                                      <div className="mt-1 text-xs text-[var(--text-2)]">
                                        {v.row.matchupKey.replace('@', ' @ ')} | {v.row.gameTimeEt}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-top">
                                  <div className="font-semibold text-[var(--text)]">{v.label}</div>
                                  <div className="mt-1 flex flex-wrap gap-2">
                                    <Pill label={trackerStatusLabel(rowStatus)} tone={trackerStatusTone(rowStatus)} />
                                  </div>
                                </td>
                                <td className="px-4 py-4 text-right align-top text-[var(--text)]">
                                  <div>{v.live == null ? (v.fair == null ? '-' : n(v.fair)) : n(v.live)}</div>
                                  <div className="mt-1 text-xs text-[var(--text-2)]">{v.live == null ? 'Fair fallback' : 'Live consensus'}</div>
                                </td>
                                <td className="px-4 py-4 text-right align-top text-[var(--text)]">{v.proj == null ? '-' : n(v.proj)}</td>
                                <td className={`px-4 py-4 text-right align-top ${v.edge == null ? 'text-[var(--muted)]' : v.edge > 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}>
                                  {v.edge == null ? '-' : gapRead(v.edge)}
                                </td>
                                <td className="px-4 py-4 text-right align-top text-[var(--text)]">{v.conf == null ? '-' : pct(v.conf, 0)}</td>
                                <td className="px-4 py-4 text-right align-top text-[var(--text)]">{v.books == null ? '-' : n(v.books, 0)}</td>
                                <td className="px-4 py-4 text-right align-top text-[var(--text)]">
                                  <div>{relativeTime(updatedAt, now)}</div>
                                  <div className="mt-1 text-xs text-[var(--text-2)]">{ts(updatedAt)}</div>
                                </td>
                                <td className="px-4 py-4 text-right align-top text-[var(--text-2)]">{rowExpanded ? '−' : '+'}</td>
                              </tr>
                              {rowExpanded ? (
                                <tr className="border-t border-[color:rgba(216,204,186,0.38)] bg-[color:rgba(109,74,255,0.05)]">
                                  <td colSpan={9} className="px-4 py-4 sm:px-5">
                                    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                                      <div className="space-y-4">
                                        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <Pill label={recommendationHeadline(v)} tone={v.side === 'UNDER' ? 'amber' : 'cyan'} />
                                            {latestEvent ? <Pill label={feedEventTypeLabel(latestEvent.eventType)} tone={feedEventTypeTone(latestEvent.eventType)} /> : null}
                                          </div>
                                          <div className="mt-3 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Recommendation</div>
                                          <p className="mt-2 text-sm leading-6 text-[var(--text-2)]">{rowReason}</p>
                                        </div>
                                        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                                          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Context</div>
                                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
                                              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">Matchup</div>
                                              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{v.row.matchupKey.replace('@', ' @ ')}</div>
                                            </div>
                                            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
                                              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">Lineup status</div>
                                              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{availabilityRead(v.row.playerContext) ?? v.row.playerContext.lineupStatus ?? 'Waiting for lineup note'}</div>
                                            </div>
                                            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
                                              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">Trend</div>
                                              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{signed(rowTrend, 1)}</div>
                                            </div>
                                            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
                                              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">Status</div>
                                              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{trackerStatusLabel(rowStatus)}</div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                      <div className="space-y-4">
                                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                          <CompactMetric label="Current line" value={v.live == null ? (v.fair == null ? '-' : n(v.fair)) : n(v.live)} />
                                          <CompactMetric label="Fair line" value={v.fair == null ? '-' : n(v.fair)} />
                                          <CompactMetric label="Projection" value={v.proj == null ? '-' : n(v.proj)} />
                                          <CompactMetric label="Gap" value={v.edge == null ? '-' : gapRead(v.edge)} />
                                          <CompactMetric label="Signal" value={signalGradeValue(v.signalGrade)} />
                                          <CompactMetric label="Books" value={booksLiveLabel(v.books) ?? '-'} />
                                          <CompactMetric label="Updated" value={relativeTime(updatedAt, now)} />
                                        </div>
                                        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                                          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Signal tracker</div>
                                          <p className="mt-2 text-sm leading-6 text-[var(--text-2)]">
                                            {signalGradeNote(v.signalGrade)}
                                          </p>
                                          <p className="mt-2 text-sm leading-6 text-[var(--text-2)]">
                                            This expanded row uses the saved pregame event status, current live consensus or fair fallback, and the board projection. Book-by-book line history is not stored in SnapshotBoardData yet, so the table stays honest about that limitation.
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(20,16,35,0.06)]">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Current limitation</div>
                <p className="mt-3 text-sm leading-6 text-[var(--text-2)]">
                  SnapshotBoardData does not include full sportsbook tape or book-by-book history. The tracker is intentionally limited to the current live line, fair fallback, projection, gap, confidence, and stored pregame feed state.
                </p>
              </div>
            </section>
          ) : null}
          </section>
          ) : null}

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



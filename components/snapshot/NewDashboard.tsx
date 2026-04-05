'use client';

import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SnapshotBoardViewData,
  SnapshotDashboardPrecisionSignal,
  SnapshotDashboardRow,
  SnapshotDashboardSignal,
  SnapshotMarket,
  SnapshotModelSide,
  SnapshotPrecisionCardEntry,
} from '@/lib/types/snapshot';

type Tab = 'precision' | 'research' | 'scout' | 'tracking';
type Kind = 'LIVE' | 'DERIVED' | 'PLACEHOLDER';

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
  { id: 'precision', label: 'Precision Card', hint: 'Top curated edges' },
  { id: 'research', label: 'Research Center', hint: 'Player dossiers' },
  { id: 'scout', label: 'Scout Feed', hint: 'Live signal stream' },
  { id: 'tracking', label: 'Line Tracking', hint: 'Current line vs fair' },
];

const TOP_NAV: Array<{ label: string; tab?: Tab; action?: 'help' }> = [
  { label: 'Board', tab: 'precision' },
  { label: 'Research', tab: 'research' },
  { label: 'Scout Feed', tab: 'scout' },
  { label: 'Methodology', action: 'help' },
];

const KIND_CLASS: Record<Kind, string> = {
  LIVE: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
  DERIVED: 'border-amber-400/20 bg-amber-400/10 text-amber-100',
  PLACEHOLDER: 'border-slate-400/20 bg-slate-500/10 text-slate-200',
};

const PILL_CLASS: Record<'default' | 'cyan' | 'amber', string> = {
  default: 'border-white/10 bg-white/5 text-zinc-200',
  cyan: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100',
  amber: 'border-amber-400/20 bg-amber-400/10 text-amber-100',
};

const SIDE_CLASS: Record<SnapshotModelSide, string> = {
  OVER: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100',
  UNDER: 'border-amber-400/20 bg-amber-400/10 text-amber-100',
  NEUTRAL: 'border-slate-400/20 bg-slate-500/10 text-slate-200',
};

const ACTION_CLASS =
  'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950';

const CARD_BUTTON_CLASS = `${ACTION_CLASS} hover:-translate-y-0.5 hover:border-cyan-400/25 hover:bg-zinc-900/90`;

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

function firstSentence(v: string | null | undefined) {
  if (!v) return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^.*?[.!?](?:\s|$)/);
  return (match?.[0] ?? trimmed).trim();
}

function hasValue<T>(value: T | null | undefined): value is T {
  return value != null;
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
}: {
  label: string;
  value: string;
  kind: Kind;
  note?: string;
  dense?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-black/25 ${dense ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
        <Badge label={kind} kind={kind} />
      </div>
      <div className={`mt-2 font-semibold tracking-tight text-white ${dense ? 'text-lg' : 'text-2xl'}`}>{value}</div>
      {note ? <div className="mt-1 text-xs text-zinc-400">{note}</div> : null}
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
    <div className="rounded-[28px] border border-dashed border-white/15 bg-black/25 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{eyebrow}</div>
          <div className="mt-2 text-base font-semibold text-white sm:text-lg">{title}</div>
        </div>
        <Badge label={kind} kind={kind} />
      </div>
      <div className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{detail}</div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className={`${ACTION_CLASS} mt-4 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:border-white/20 hover:bg-white/10`}
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
  onSelect,
}: {
  matchups: SnapshotBoardViewData['matchups'];
  selectedKey?: string | null;
  onSelect?: (matchupKey: string) => void;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Top matchups</div>
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
                  ? 'border-cyan-400/25 bg-cyan-400/10'
                  : onSelect
                    ? 'border-white/8 bg-black/20 hover:border-white/15 hover:bg-black/30'
                    : 'border-white/8 bg-black/20'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{m.label}</div>
                  <div className="mt-1 text-xs text-zinc-400">{m.gameTimeEt}</div>
                </div>
                {selectedKey === m.key ? <Badge label="Selected" kind="DERIVED" /> : null}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/25 px-4 py-4 text-sm text-zinc-400">
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
  return views.find((view) => isActionableView(view)) ?? views[0] ?? null;
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
    books: liveSignal?.sportsbookCount ?? null,
    side,
    liveKind: live != null ? 'LIVE' : 'PLACEHOLDER',
    fairKind: fair != null ? 'LIVE' : 'PLACEHOLDER',
    projKind: proj != null ? 'LIVE' : 'PLACEHOLDER',
    edgeKind: edge != null ? (usesDerivedEdge ? 'DERIVED' : 'LIVE') : 'PLACEHOLDER',
    confKind: conf != null ? (usesDerivedConfidence ? 'DERIVED' : 'LIVE') : 'PLACEHOLDER',
    booksKind: liveSignal?.sportsbookCount != null ? 'LIVE' : 'PLACEHOLDER',
    sideKind: usesComputedSide ? 'DERIVED' : 'LIVE',
    rank: entry ? `#${entry.rank}` : null,
    source: entry ? `Precision rank #${entry.rank}` : live != null ? 'Live signal' : 'Model view',
    note: live != null ? `${liveSignal?.sportsbookCount ?? 0} books live` : fair != null ? 'No live consensus line in payload' : 'No market line available yet',
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
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<Tab>('precision');
  const [pickedPlayer, setPickedPlayer] = useState<string | null>(null);
  const [selectedMatchupKey, setSelectedMatchupKey] = useState<string | null>(initialData.matchups[0]?.key ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const helpRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
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
  const researchLeadView = useMemo(() => leadViewFromViews(researchViews), [researchViews]);
  const researchInterestingViews = useMemo(() => {
    const actionable = researchViews.filter((view) => isActionableView(view));
    return (actionable.length ? actionable : researchViews).slice(0, 3);
  }, [researchViews]);
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
  const avgCompleteness = data.rows.length ? Math.round((data.rows.reduce((s, r) => s + r.dataCompleteness.score, 0) / data.rows.length) * 10) / 10 : null;
  const target = data.precisionSystem?.targetCardCount ?? data.precisionCardSummary?.targetCardCount ?? precision.length;
  const selected = data.precisionCardSummary?.selectedCount ?? precision.length;
  const gap = Math.max(target - selected, 0);
  const hasBoardRows = data.rows.length > 0;
  const featuredUpdatedAt = featured?.row.gameIntel.generatedAt ?? data.lastUpdatedAt ?? null;
  const boardRefreshRelative = relativeTime(data.lastUpdatedAt, now);
  const featuredRefreshRelative = relativeTime(featuredUpdatedAt, now);
  const selectedMatchupLead = matchupBestSpots[0] ?? null;
  const boardModelNote = firstSentence(data.universalSystem?.note);
  const featuredMarketAverageLast10 = featured ? featured.row.last10Average[featured.market] : null;
  const featuredMarketAverageSeason = featured ? featured.row.seasonAverage[featured.market] : null;
  const featuredMarketTrend = featured ? featured.row.trendVsSeason[featured.market] : null;
  const featuredMarketOpponentDelta = featured ? featured.row.opponentAllowanceDelta[featured.market] : null;
  const featuredMarketRecentFive = featured ? lineList(featured.row.last5[featured.market]) : '-';
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

    return researchInterestingViews.map<ResearchRecentRead>((view) => {
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
  }, [researchInterestingViews, researchRow]);
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
  const hasPrecisionTarget = target > 0;
  const precisionSlotsValue = hasPrecisionTarget ? `${n(selected, 0)} / ${n(target, 0)}` : '-';
  const precisionSlotsKind: Kind = hasPrecisionTarget ? 'DERIVED' : 'PLACEHOLDER';
  const precisionSlotsNote = hasPrecisionTarget
    ? gap > 0
      ? `${gap} slot${gap === 1 ? '' : 's'} open`
      : 'Filled to target'
    : 'Awaiting card target';
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
  const openHelp = () => helpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const openResearchSearch = () => {
    setTab('research');
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };
  const setResearch = (playerId: string) => {
    const row = rowById.get(playerId);
    if (row?.matchupKey) {
      setSelectedMatchupKey(row.matchupKey);
    }
    setPickedPlayer(playerId);
    setTab('research');
  };

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
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.10),transparent_24%),linear-gradient(180deg,rgba(2,6,23,1)_0%,rgba(9,9,11,1)_42%,rgba(3,7,18,1)_100%)]" />
      <div className="relative">
        <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-xl">
          <div className="mx-auto max-w-[1520px] px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start justify-between gap-4 xl:flex-1">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-300/80">ULTOPS / Snapshot</div>
                  <div className="mt-1 text-sm text-zinc-400">NBA prop intelligence board</div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={refreshSlate}
                    disabled={isRefreshing}
                    className={`${ACTION_CLASS} rounded-full border px-4 py-2 text-sm font-semibold ${
                      isRefreshing
                        ? 'cursor-wait border-amber-400/20 bg-amber-400/10 text-amber-100'
                        : 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15'
                    }`}
                  >
                    {isRefreshing ? 'Refreshing slate...' : 'Refresh slate'}
                  </button>
                  <Badge label={isRefreshing ? 'Refreshing' : 'LIVE'} kind={isRefreshing ? 'DERIVED' : 'LIVE'} />
                  <div className="grid gap-3 text-right sm:grid-cols-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Board date</div>
                      <div className="text-sm font-medium text-white">{data.dateEt}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Last refresh</div>
                      <div className="text-sm font-medium text-white">{ts(data.lastUpdatedAt)}</div>
                      <div className="mt-1 text-[11px] text-zinc-500">{boardRefreshRelative}</div>
                    </div>
                  </div>
                </div>
              </div>
              <nav className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 xl:mx-0 xl:px-0 xl:pb-0">
                {TOP_NAV.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => (item.action === 'help' ? openHelp() : setTab(item.tab!))}
                    className={`${ACTION_CLASS} shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${
                      item.tab && tab === item.tab
                        ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]'
                        : 'border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1520px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <section className="grid gap-6 xl:items-start xl:grid-cols-[minmax(0,1.16fr)_minmax(360px,0.84fr)] 2xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.88fr)]">
            <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,rgba(9,9,11,0.94),rgba(15,23,42,0.88))] p-5 shadow-2xl shadow-black/25 sm:p-6">
              <div className="flex flex-wrap gap-2">
                <Pill label="Live NBA prop board" tone="cyan" />
                <Pill label="Featured precision card" tone="amber" />
                <Pill label="Research + line context" />
              </div>
              <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:mt-5 sm:text-5xl">
                Track the live NBA prop slate without leaving the board.
              </h1>
              <p className="mt-4 max-w-2xl text-base text-zinc-300 sm:text-lg">
                Start with the featured pick, search any active player, and refresh the board when new lineups or prices
                land. The live, derived, and placeholder labels stay visible all the way through the dashboard.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setTab('precision')}
                  className={`${ACTION_CLASS} rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/15`}
                >
                  Open Precision Card
                </button>
                <button
                  type="button"
                  onClick={openResearchSearch}
                  className={`${ACTION_CLASS} rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:border-white/20 hover:bg-white/10`}
                >
                  Search Active Players
                </button>
                <button
                  type="button"
                  onClick={openHelp}
                  className={`${ACTION_CLASS} rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-400/15`}
                >
                  Methodology
                </button>
              </div>
              {refreshNotice ? (
                <div
                  className={`mt-4 rounded-2xl border p-4 ${
                    refreshNotice.kind === 'LIVE'
                      ? 'border-emerald-400/20 bg-emerald-400/8'
                      : refreshNotice.kind === 'DERIVED'
                        ? 'border-amber-400/20 bg-amber-400/8'
                        : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge label={refreshNotice.kind} kind={refreshNotice.kind} />
                    <div className="text-sm font-semibold text-white">{refreshNotice.title}</div>
                  </div>
                  <div className="mt-2 text-sm text-zinc-300">{refreshNotice.detail}</div>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                <span className="rounded-full border border-emerald-400/15 bg-emerald-400/8 px-3 py-1.5">Live values come from SnapshotBoardData</span>
                <span className="rounded-full border border-amber-400/15 bg-amber-400/8 px-3 py-1.5">Derived values are computed on the board</span>
                <span className="rounded-full border border-slate-400/15 bg-slate-500/8 px-3 py-1.5">Placeholders only show when data is missing</span>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 transition-colors duration-200 hover:border-white/15 hover:bg-black/30">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Board</div>
                  <div className="mt-2 text-sm leading-6 text-zinc-300">Curated edge ranking for the current slate with a clear featured lead pick.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 transition-colors duration-200 hover:border-white/15 hover:bg-black/30">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Research</div>
                  <div className="mt-2 text-sm leading-6 text-zinc-300">Player dossier, matchup context, and the all-market matrix stay in one dossier view.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 transition-colors duration-200 hover:border-white/15 hover:bg-black/30">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Scout + Tracking</div>
                  <div className="mt-2 text-sm leading-6 text-zinc-300">Signal stream and current line snapshots stay readable without inventing book history.</div>
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Matchups" value={n(data.matchups.length, 0)} kind="LIVE" note="Game windows loaded" />
                <Stat label="Live lines" value={n(liveCount, 0)} kind="LIVE" note="Markets with consensus data" />
                <Stat
                  label="Precision accuracy"
                  value={data.precisionSystem ? pct(data.precisionSystem.historicalAccuracy, 1) : '-'}
                  kind={data.precisionSystem ? 'LIVE' : 'PLACEHOLDER'}
                  note={data.precisionSystem ? `${n(data.precisionSystem.historicalPicks, 0)} picks tracked` : 'System summary unavailable'}
                />
                <Stat
                  label="Last refresh"
                  value={ts(data.lastUpdatedAt)}
                  kind={data.lastUpdatedAt ? 'LIVE' : 'PLACEHOLDER'}
                  note={data.lastUpdatedAt ? `Board payload ${boardRefreshRelative}` : 'Waiting for board timestamp'}
                />
              </div>

              <div className="mt-6 grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Board briefing</div>
                      <div className="mt-1 text-lg font-semibold text-white">Refresh health</div>
                    </div>
                    <Badge label={data.lastUpdatedAt ? 'LIVE' : 'PLACEHOLDER'} kind={data.lastUpdatedAt ? 'LIVE' : 'PLACEHOLDER'} />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Stat dense label="Board refresh" value={ts(data.lastUpdatedAt)} kind={data.lastUpdatedAt ? 'LIVE' : 'PLACEHOLDER'} note={boardRefreshRelative} />
                    <Stat dense label="Featured update" value={ts(featuredUpdatedAt)} kind={hasValue(featuredUpdatedAt) ? 'LIVE' : 'PLACEHOLDER'} note={featuredRefreshRelative} />
                  </div>
                  <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-zinc-300">
                    {refreshNotice ? refreshNotice.detail : 'Manual refresh stays available from the header whenever you want to pull a fresher slate snapshot.'}
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Board briefing</div>
                      <div className="mt-1 text-lg font-semibold text-white">Selected game context</div>
                    </div>
                    <Badge label={selectedMatchup ? 'DERIVED' : 'PLACEHOLDER'} kind={selectedMatchup ? 'DERIVED' : 'PLACEHOLDER'} />
                  </div>
                  {selectedMatchup ? (
                    <>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Pill label={selectedMatchup.label} tone="cyan" />
                        <Pill label={selectedMatchup.gameTimeEt} />
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                        <Stat dense label="Player rows" value={n(selectedMatchupRows.length, 0)} kind={selectedMatchupRows.length ? 'LIVE' : 'PLACEHOLDER'} note="Board rows in this game" />
                        <Stat dense label="Live lines" value={n(matchupLiveCount, 0)} kind={matchupLiveCount ? 'LIVE' : 'PLACEHOLDER'} note="Markets priced right now" />
                        <Stat dense label="Qualified" value={n(matchupQualifiedCount, 0)} kind={matchupQualifiedCount ? 'DERIVED' : 'PLACEHOLDER'} note="Precision-ready views" />
                      </div>
                      <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-zinc-300">
                        {selectedMatchupLead
                          ? `${selectedMatchupLead.row.playerName} ${selectedMatchupLead.label} is the current lead spot for this game, showing ${selectedMatchupLead.side} with ${selectedMatchupLead.edge == null ? 'no clear edge yet' : `an edge of ${signed(selectedMatchupLead.edge)}`}.`
                          : 'This matchup is selected, but the board does not yet have a clear live or derived lead spot for it.'}
                      </div>
                    </>
                  ) : (
                    <EmptyState
                      eyebrow="Selected game"
                      title="Choose a matchup to anchor the board context."
                      detail="The board briefing and matchup lens will stay in sync so it is faster to read what matters for one game."
                    />
                  )}
                </div>

                <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Board briefing</div>
                      <div className="mt-1 text-lg font-semibold text-white">Board model context</div>
                    </div>
                    <Badge label={data.universalSystem ? 'LIVE' : 'PLACEHOLDER'} kind={data.universalSystem ? 'LIVE' : 'PLACEHOLDER'} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Pill label={data.universalSystem?.label ?? 'Board model unavailable'} tone={data.universalSystem ? 'cyan' : 'default'} />
                    {data.precisionSystem?.label ? <Pill label={data.precisionSystem.label} tone="amber" /> : null}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Stat dense label="WF raw" value={data.universalSystem ? pct(data.universalSystem.walkForwardRawAccuracy, 1) : '-'} kind={data.universalSystem ? 'LIVE' : 'PLACEHOLDER'} note="Board-level walk-forward accuracy" />
                    <Stat dense label="WF coverage" value={data.universalSystem ? pct(data.universalSystem.walkForwardCoveragePct, 1) : '-'} kind={data.universalSystem ? 'LIVE' : 'PLACEHOLDER'} note="Walk-forward coverage" />
                    <Stat dense label="Replay raw" value={data.universalSystem ? pct(data.universalSystem.replayRawAccuracy, 1) : '-'} kind={data.universalSystem ? 'LIVE' : 'PLACEHOLDER'} note="Board replay accuracy" />
                    <Stat dense label="Precision" value={data.precisionSystem ? pct(data.precisionSystem.historicalAccuracy, 1) : '-'} kind={data.precisionSystem ? 'LIVE' : 'PLACEHOLDER'} note={data.precisionSystem ? 'Precision selector accuracy' : 'Precision summary unavailable'} />
                  </div>
                  <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-zinc-300">
                    {boardModelNote ?? 'The board model summary is missing from the payload, so the board is relying only on the visible player-market rows.'}
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-4 rounded-[32px] border border-white/10 bg-zinc-900/75 p-5 backdrop-blur xl:self-start">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Board state</div>
                  <h2 className="mt-1 text-xl font-semibold text-white">What the current slate is saying</h2>
                </div>
                <Badge
                  label={featured ? (featured.live != null ? 'LIVE' : 'DERIVED') : 'PLACEHOLDER'}
                  kind={featured ? (featured.live != null ? 'LIVE' : 'DERIVED') : 'PLACEHOLDER'}
                />
              </div>
              {featured ? (
                <div className="rounded-[28px] border border-white/10 bg-black/30 p-4 sm:p-5">
                  <div className="flex flex-wrap gap-2">
                    {featured.rank ? <Badge label={featured.rank} kind="DERIVED" /> : null}
                    <Pill label={featured.source} tone={featured.source === 'Live signal' ? 'cyan' : 'default'} />
                    <Pill label={MARKET_LABELS[featured.market]} tone="amber" />
                    <Badge label={featured.live != null ? 'Live candidate' : 'Derived candidate'} kind={featured.live != null ? 'LIVE' : 'DERIVED'} />
                  </div>
                  <div className="mt-4 grid gap-5">
                    <div>
                      <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">{featured.row.playerName}</h3>
                      <p className="mt-1 text-sm leading-6 text-zinc-400">
                        {matchup(featured.row)} - {MARKET_LABELS[featured.market]}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Side side={featured.side} kind={featured.sideKind} />
                        <Badge label={featured.sideKind} kind={featured.sideKind} />
                        {featured.precision?.selectorFamily ? <Pill label={featured.precision.selectorFamily} tone="cyan" /> : null}
                        {featured.precision?.selectorTier ? <Pill label={featured.precision.selectorTier} tone="amber" /> : null}
                      </div>
                      <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Why it leads the slate</div>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
                          {featured.precision?.reasons?.length
                            ? featured.precision.reasons.slice(0, 2).join(' • ')
                            : featured.reasons.length
                              ? featured.reasons.slice(0, 2).join(' • ')
                              : 'No extra reasons surfaced by the current payload.'}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Stat dense label="Live line" value={featured.live == null ? '-' : n(featured.live)} kind={featured.liveKind} note="Consensus market line" />
                      <Stat dense label="Fair line" value={featured.fair == null ? '-' : n(featured.fair)} kind={featured.fairKind} note="Model fair line from payload" />
                      <Stat dense label="Projection" value={featured.proj == null ? '-' : n(featured.proj)} kind={featured.projKind} note="Tonight projection from payload" />
                      <Stat dense label="Edge" value={featured.edge == null ? '-' : signed(featured.edge)} kind={featured.edgeKind} note="Projection minus line" />
                      <Stat dense label="Confidence" value={featured.conf == null ? '-' : pct(featured.conf, 1)} kind={featured.confKind} note="Win probability or historical accuracy" />
                      <Stat
                        dense
                        label="Updated"
                        value={ts(featuredUpdatedAt)}
                        kind={hasValue(featuredUpdatedAt) ? 'LIVE' : 'PLACEHOLDER'}
                        note={hasValue(featuredUpdatedAt) ? `Most recent board or dossier timestamp, ${featuredRefreshRelative}` : 'Most recent board or dossier timestamp'}
                      />
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Stat
                      dense
                      label={`L10 ${MARKET_LABELS[featured.market]}`}
                      value={n(featuredMarketAverageLast10, 1)}
                      kind={featuredMarketAverageLast10 == null ? 'PLACEHOLDER' : 'LIVE'}
                      note="Recent production average"
                    />
                    <Stat
                      dense
                      label={`Season ${MARKET_LABELS[featured.market]}`}
                      value={n(featuredMarketAverageSeason, 1)}
                      kind={featuredMarketAverageSeason == null ? 'PLACEHOLDER' : 'LIVE'}
                      note="Season baseline"
                    />
                    <Stat
                      dense
                      label="Trend vs season"
                      value={signed(featuredMarketTrend, 1)}
                      kind={featuredMarketTrend == null ? 'PLACEHOLDER' : 'DERIVED'}
                      note="Recent form versus season baseline"
                    />
                    <Stat
                      dense
                      label="Opp delta"
                      value={signed(featuredMarketOpponentDelta, 1)}
                      kind={featuredMarketOpponentDelta == null ? 'PLACEHOLDER' : 'LIVE'}
                      note="Opponent allowance delta in payload"
                    />
                  </div>
                  <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Recent 5</div>
                      <Badge label={featured.row.last5[featured.market].length ? 'LIVE' : 'PLACEHOLDER'} kind={featured.row.last5[featured.market].length ? 'LIVE' : 'PLACEHOLDER'} />
                    </div>
                    <div className="mt-2 font-mono text-sm text-zinc-200">{featuredMarketRecentFive}</div>
                    <div className="mt-2 text-xs text-zinc-400">
                      {featured.edge == null
                        ? 'The board has not surfaced a clear edge yet, but the featured card is still the strongest visible anchor for this slate.'
                        : `${MARKET_LABELS[featured.market]} is running ${signed(featured.edge)} versus the current board basis, with ${featured.side} showing as the current lean.`}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Pill label={featured.note} tone={featured.live != null ? 'cyan' : 'default'} />
                    <Badge label={`Books ${featured.books == null ? '-' : n(featured.books, 0)}`} kind={featured.booksKind} />
                  </div>
                </div>
              ) : (
                <EmptyState
                  eyebrow="Featured pick"
                  title={hasBoardRows ? 'No valid featured pick is available yet.' : 'Waiting for board data to load a featured pick.'}
                  detail={
                    hasBoardRows
                      ? 'Once the board has a precision-card entry or a live market-led candidate, the featured anchor will render here.'
                      : 'As soon as SnapshotBoardData returns rows for the slate, this card will promote the best available featured pick.'
                  }
                  actionLabel={hasBoardRows ? 'Open Precision Card' : 'Refresh slate'}
                  onAction={hasBoardRows ? () => setTab('precision') : refreshSlate}
                />
              )}
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  dense
                  label="Completeness"
                  value={avgCompleteness == null ? '-' : pct(avgCompleteness, 0)}
                  kind={avgCompleteness == null ? 'PLACEHOLDER' : 'DERIVED'}
                  note="Average row score"
                />
                <Stat
                  dense
                  label="Precision slots"
                  value={precisionSlotsValue}
                  kind={precisionSlotsKind}
                  note={precisionSlotsNote}
                />
                <Stat dense label="Scout items" value={n(scoutViews.length, 0)} kind="DERIVED" note="Top current signal rows" />
                <Stat dense label="Tracking rows" value={n(trackViews.length, 0)} kind="DERIVED" note="Current line vs fair" />
              </div>
            </div>
          </section>
          <section className="mt-6 rounded-[28px] border border-white/10 bg-black/50 p-2 backdrop-blur-xl">
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`${ACTION_CLASS} rounded-2xl border px-4 py-3 text-left ${
                    tab === item.id
                      ? 'border-cyan-400/30 bg-cyan-400/10 text-white'
                      : 'border-transparent bg-white/0 text-zinc-400 hover:border-white/10 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[10px] uppercase tracking-[0.18em]">{item.label}</div>
                    <Badge label={tabSummary[item.id].kind} kind={tabSummary[item.id].kind} />
                  </div>
                  <div className="mt-1 text-xs text-current/70">{item.hint}</div>
                  <div className="mt-2 text-[11px] font-medium text-current/80">{tabSummary[item.id].detail}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-6 rounded-[28px] border border-white/10 bg-zinc-900/65 p-5 backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Matchup lens</div>
                <h2 className="mt-1 text-xl font-semibold text-white">Select a game and see what is best on that board</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
                  Pick any live matchup to surface the strongest player spots for that game, along with the latest board refresh time and team context.
                </p>
              </div>
              <Badge
                label={selectedMatchup ? (matchupBestSpots.length ? 'LIVE' : 'DERIVED') : data.matchups.length ? 'DERIVED' : 'PLACEHOLDER'}
                kind={selectedMatchup ? (matchupBestSpots.length ? 'LIVE' : 'DERIVED') : data.matchups.length ? 'DERIVED' : 'PLACEHOLDER'}
              />
            </div>

            {data.matchups.length ? (
              <>
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                  {data.matchups.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setSelectedMatchupKey(m.key)}
                      className={`${ACTION_CLASS} shrink-0 rounded-2xl border px-4 py-3 text-left ${
                        selectedMatchupKey === m.key
                          ? 'border-cyan-400/30 bg-cyan-400/10 text-white'
                          : 'border-white/10 bg-black/20 text-zinc-300 hover:border-white/20 hover:bg-black/30'
                      }`}
                    >
                      <div className="text-sm font-semibold">{m.label}</div>
                      <div className="mt-1 text-xs text-current/70">{m.gameTimeEt}</div>
                    </button>
                  ))}
                </div>

                {selectedMatchup ? (
                  <div className="mt-5 grid gap-4 xl:items-start xl:grid-cols-[1.05fr_0.95fr]">
                    <div className="rounded-[24px] border border-white/10 bg-black/25 p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <Badge label="Selected matchup" kind="LIVE" />
                            <Pill label={selectedMatchup.gameTimeEt} />
                          </div>
                          <div className="mt-4 text-2xl font-semibold tracking-tight text-white">{selectedMatchup.label}</div>
                          <div className="mt-1 text-sm text-zinc-400">
                            Game-level view of the strongest player markets currently on the board.
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Lead spot</div>
                          <div className="mt-2 text-sm font-semibold text-white">
                            {matchupBestSpots[0] ? `${matchupBestSpots[0].row.playerName} ${matchupBestSpots[0].label}` : '-'}
                          </div>
                          <div className="mt-1 text-xs text-zinc-400">
                            {matchupBestSpots[0]
                              ? `${matchupBestSpots[0].side} ${matchupBestSpots[0].edge == null ? 'No edge yet' : signed(matchupBestSpots[0].edge)}`
                              : 'Waiting for actionable spots'}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Stat
                          dense
                          label="Player rows"
                          value={n(selectedMatchupRows.length, 0)}
                          kind={selectedMatchupRows.length ? 'LIVE' : 'PLACEHOLDER'}
                          note="Rows in this game"
                        />
                        <Stat
                          dense
                          label="Live lines"
                          value={n(matchupLiveCount, 0)}
                          kind={matchupLiveCount ? 'LIVE' : 'PLACEHOLDER'}
                          note="Markets priced right now"
                        />
                        <Stat
                          dense
                          label="Qualified"
                          value={n(matchupQualifiedCount, 0)}
                          kind={matchupQualifiedCount ? 'DERIVED' : 'PLACEHOLDER'}
                          note="Precision-ready views"
                        />
                        <Stat
                          dense
                          label="Last refresh"
                          value={ts(data.lastUpdatedAt)}
                          kind={data.lastUpdatedAt ? 'LIVE' : 'PLACEHOLDER'}
                          note={boardRefreshRelative}
                        />
                      </div>

                      {selectedMatchupTeamStats ? (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <Stat dense label={`${selectedMatchupTeamStats.awayTeam} off L10`} value={n(selectedMatchupTeamStats.awayLast10For.PTS, 1)} kind="LIVE" note="PTS basis" />
                          <Stat dense label={`${selectedMatchupTeamStats.homeTeam} off L10`} value={n(selectedMatchupTeamStats.homeLast10For.PTS, 1)} kind="LIVE" note="PTS basis" />
                          <Stat dense label={`${selectedMatchupTeamStats.awayTeam} allowed L10`} value={n(selectedMatchupTeamStats.awayLast10Allowed.PTS, 1)} kind="LIVE" note="PTS basis" />
                          <Stat dense label={`${selectedMatchupTeamStats.homeTeam} allowed L10`} value={n(selectedMatchupTeamStats.homeLast10Allowed.PTS, 1)} kind="LIVE" note="PTS basis" />
                        </div>
                      ) : (
                        <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-3 text-sm text-zinc-400">
                          Team-vs-team context is not available for this matchup yet, but the player-level spots below are still live.
                        </div>
                      )}
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-black/25 p-4 sm:p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Best spots in this game</div>
                          <div className="mt-1 text-lg font-semibold text-white">Tap any player to open the full dossier</div>
                        </div>
                        <Badge
                          label={matchupBestSpots.length ? `${n(matchupBestSpots.length, 0)} spots` : '0 spots'}
                          kind={matchupBestSpots.length ? 'DERIVED' : 'PLACEHOLDER'}
                        />
                      </div>

                      {matchupBestSpots.length ? (
                        <div className="mt-4 space-y-3">
                          {matchupBestSpots.map((spot, index) => (
                            <button
                              key={`${spot.row.playerId}:${spot.market}:matchup-lens`}
                              type="button"
                              onClick={() => setResearch(spot.row.playerId)}
                              className={`w-full rounded-[22px] border border-white/10 bg-zinc-900/75 p-4 text-left ${CARD_BUTTON_CLASS}`}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="flex flex-wrap gap-2">
                                    <Badge label={`#${index + 1}`} kind="DERIVED" />
                                    <Pill label={spot.label} tone="amber" />
                                    <Badge label={spot.liveKind} kind={spot.liveKind} />
                                  </div>
                                  <div className="mt-3 text-lg font-semibold text-white">{spot.row.playerName}</div>
                                  <div className="mt-1 text-sm text-zinc-400">{matchup(spot.row)}</div>
                                </div>
                                <div className={`rounded-2xl border px-4 py-3 text-right ${SIDE_CLASS[spot.side]}`}>
                                  <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">Recommendation</div>
                                  <div className="mt-2 flex justify-end">
                                    <Side side={spot.side} kind={spot.sideKind} />
                                  </div>
                                </div>
                              </div>
                              <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-300">
                                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                                  Live {spot.live == null ? '-' : n(spot.live)}
                                </span>
                                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                                  Edge {spot.edge == null ? '-' : signed(spot.edge)}
                                </span>
                                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                                  Conf {spot.conf == null ? '-' : pct(spot.conf, 1)}
                                </span>
                                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">{spot.note}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <EmptyState
                          eyebrow="Matchup spots"
                          title="No strong spots are available for this game yet."
                          detail="Try another matchup or refresh the slate if you expect fresh line or lineup movement."
                          actionLabel="Refresh slate"
                          onAction={refreshSlate}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    eyebrow="Matchup lens"
                    title="Select a matchup to inspect the best spots for that game."
                    detail="As soon as a matchup is selected, the board will narrow to the strongest players and markets for that slate window."
                  />
                )}
              </>
            ) : (
              <EmptyState
                eyebrow="Matchup lens"
                title="No matchup windows are loaded yet."
                detail="Once the slate payload is available, you will be able to select a game and inspect its strongest spots."
                actionLabel="Refresh slate"
                onAction={refreshSlate}
              />
            )}
          </section>

          {tab === 'precision' ? (
            <section className="mt-6 grid gap-6 xl:items-start xl:grid-cols-[1.35fr_0.85fr]">
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
                        <div className={`rounded-2xl border px-4 py-3 text-right ${SIDE_CLASS[view.side]}`}>
                          <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">Recommendation</div>
                          <div className="mt-2 flex justify-end">
                            <Side side={view.side} kind={view.sideKind} />
                          </div>
                          <div className="mt-1 text-xs opacity-80">{view.note}</div>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Stat dense label="Live line" value={view.live == null ? '-' : n(view.live)} kind={view.liveKind} note={view.note} />
                        <Stat dense label="Fair line" value={view.fair == null ? '-' : n(view.fair)} kind={view.fairKind} note="Model fair line from payload" />
                        <Stat dense label="Edge" value={view.edge == null ? '-' : signed(view.edge)} kind={view.edgeKind} note="Projection minus line" />
                        <Stat dense label="Confidence" value={view.conf == null ? '-' : pct(view.conf, 1)} kind={view.confKind} note="Payload confidence or derived win probability" />
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {view.rank ? <Badge label={view.rank} kind="DERIVED" /> : null}
                        <Pill label={view.source} tone={view.source === 'Live signal' ? 'cyan' : 'default'} />
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

                <MatchupsCard matchups={data.matchups} selectedKey={selectedMatchupKey} onSelect={setSelectedMatchupKey} />
              </div>
            </section>
          ) : null}
          {tab === 'research' ? (
            <section className="mt-6 grid gap-6 xl:items-start xl:grid-cols-[0.95fr_1.55fr]">
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
                            ? 'border-cyan-400/25 bg-[linear-gradient(145deg,rgba(8,15,29,0.96),rgba(15,23,42,0.9))]'
                            : 'border-white/10 bg-zinc-900/75'
                        }`}
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
                    <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <Badge label="Research dossier" kind="LIVE" />
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
                            <Stat dense label="Live line" value={researchLeadView?.live == null ? '-' : n(researchLeadView.live)} kind={researchLeadView?.liveKind ?? 'PLACEHOLDER'} note={researchLeadView ? `${researchLeadView.label} market line` : 'Lead market unavailable'} />
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
                      <div className="mt-4 overflow-x-auto rounded-[22px] border border-white/10">
                        <table className="min-w-full text-sm">
                          <thead className="bg-white/5 text-zinc-400">
                            <tr>
                              <th className="px-3 py-3 text-left font-medium">Market</th>
                              <th className="px-3 py-3 text-left font-medium">Live</th>
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
                            {researchViews.map((v) => (
                              <tr
                                key={`${v.row.playerId}:${v.market}`}
                                className={`border-t border-white/8 ${researchLeadView?.market === v.market ? 'bg-cyan-400/5' : ''}`}
                              >
                                <td className="px-3 py-3">
                                  <div className="font-semibold text-white">{v.label}</div>
                                  <div className="text-xs text-zinc-500">{v.source}</div>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex flex-col gap-1"><span className="text-white">{v.live == null ? '-' : n(v.live)}</span><Badge label={v.liveKind} kind={v.liveKind} /></div>
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
                                    {v.precision?.qualified ? 'Precision-qualified' : v.live != null ? 'Live board read' : 'Model-only read'}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
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
            <section className="mt-6 grid gap-6 xl:items-start xl:grid-cols-[1.35fr_0.85fr]">
              <div className="space-y-3">
                {scoutViews.length === 0 ? (
                  <EmptyState
                    eyebrow="Scout feed"
                    title="No scout feed items are available yet."
                    detail="Once live line or precision data lands, the feed will populate with actionable signal rows."
                    actionLabel="Refresh slate"
                    onAction={refreshSlate}
                  />
                ) : (
                  scoutViews.map((v, i) => (
                    <button
                      key={`${v.row.playerId}:${v.market}`}
                      type="button"
                      onClick={() => setResearch(v.row.playerId)}
                      className={`w-full rounded-[28px] border border-white/10 bg-zinc-900/75 p-5 text-left ${CARD_BUTTON_CLASS}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <Badge label={`#${i + 1}`} kind="DERIVED" />
                            <Pill label={v.label} tone="amber" />
                            <Badge label={v.liveKind} kind={v.liveKind} />
                          </div>
                          <div className="mt-3 text-2xl font-semibold tracking-tight text-white">{v.row.playerName}</div>
                          <div className="mt-1 text-sm text-zinc-400">{matchup(v.row)}</div>
                        </div>
                        <div className={`rounded-2xl border px-4 py-3 text-right ${SIDE_CLASS[v.side]}`}>
                          <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">Recommendation</div>
                          <div className="mt-2 flex justify-end">
                            <Side side={v.side} kind={v.sideKind} />
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <Stat dense label="Live line" value={v.live == null ? '-' : n(v.live)} kind={v.liveKind} note={v.note} />
                        <Stat dense label="Fair line" value={v.fair == null ? '-' : n(v.fair)} kind={v.fairKind} note="Fair line from payload" />
                        <Stat dense label="Edge" value={v.edge == null ? '-' : signed(v.edge)} kind={v.edgeKind} note="Projection minus line" />
                        <Stat dense label="Confidence" value={v.conf == null ? '-' : pct(v.conf, 1)} kind={v.confKind} note="Payload confidence or derived win probability" />
                        <Stat dense label="Books" value={v.books == null ? '-' : n(v.books, 0)} kind={v.booksKind} note="Consensus books currently seen" />
                      </div>

                      {v.reasons.length ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {v.reasons.map((r) => (
                            <Pill key={r} label={r} />
                          ))}
                        </div>
                      ) : null}
                    </button>
                  ))
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Scout summary</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Stat dense label="Live lines" value={n(liveCount, 0)} kind="LIVE" note="Markets with live line data" />
                    <Stat dense label="Qualified" value={n(qualifiedCount, 0)} kind="DERIVED" note="Precision-ready market views" />
                    <Stat dense label="Completeness" value={avgCompleteness == null ? '-' : pct(avgCompleteness, 0)} kind={avgCompleteness == null ? 'PLACEHOLDER' : 'DERIVED'} note="Board-wide score" />
                    <Stat dense label="Updated" value={ts(data.lastUpdatedAt)} kind={data.lastUpdatedAt ? 'LIVE' : 'PLACEHOLDER'} note="ET timestamp" />
                  </div>
                </div>
                <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Scout context</div>
                      <div className="mt-1 text-lg font-semibold text-white">Selected matchup pulse</div>
                    </div>
                    <Badge label={selectedMatchup ? 'DERIVED' : 'PLACEHOLDER'} kind={selectedMatchup ? 'DERIVED' : 'PLACEHOLDER'} />
                  </div>
                  {selectedMatchup ? (
                    <>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Pill label={selectedMatchup.label} tone="cyan" />
                        <Pill label={selectedMatchup.gameTimeEt} />
                      </div>
                      <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-zinc-300">
                        {selectedMatchupLead
                          ? `${selectedMatchupLead.row.playerName} ${selectedMatchupLead.label} is the live lead spot for this game on the current board.`
                          : 'No clear lead spot is surfaced for the selected game yet.'}
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <Stat dense label="Player rows" value={n(selectedMatchupRows.length, 0)} kind={selectedMatchupRows.length ? 'LIVE' : 'PLACEHOLDER'} note="Rows in the selected game" />
                        <Stat dense label="Live lines" value={n(matchupLiveCount, 0)} kind={matchupLiveCount ? 'LIVE' : 'PLACEHOLDER'} note="Markets currently priced" />
                        <Stat dense label="Qualified" value={n(matchupQualifiedCount, 0)} kind={matchupQualifiedCount ? 'DERIVED' : 'PLACEHOLDER'} note="Precision-ready views" />
                        <Stat dense label="Last refresh" value={ts(data.lastUpdatedAt)} kind={data.lastUpdatedAt ? 'LIVE' : 'PLACEHOLDER'} note={boardRefreshRelative} />
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-4 text-sm text-zinc-400">
                      Select a matchup in the lens above to keep this sidebar anchored to one game while you scan the scout feed.
                    </div>
                  )}
                </div>
                <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Support note</div>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">
                    The scout feed is built from the current board payload. It shows live line data when present, then
                    falls back to derived confidence and projection context. It does not invent book movement that is not
                    present in SnapshotBoardData.
                  </p>
                </div>
                <MatchupsCard matchups={data.matchups} selectedKey={selectedMatchupKey} onSelect={setSelectedMatchupKey} />
              </div>
            </section>
          ) : null}
          {tab === 'tracking' ? (
            <section className="mt-6 grid gap-6 xl:items-start xl:grid-cols-[1.55fr_0.85fr]">
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
                        <th className="px-4 py-3 text-left font-medium">Live</th>
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
                                <Badge label={v.liveKind} kind={v.liveKind} />
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
                <MatchupsCard matchups={data.matchups} selectedKey={selectedMatchupKey} onSelect={setSelectedMatchupKey} />
              </div>
            </section>
          ) : null}

          <section ref={helpRef} id="methodology" className="mt-8 rounded-[28px] border border-white/10 bg-black/55 p-6 backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-300/80">Methodology / Support</div>
                <h2 className="mt-1 text-2xl font-semibold text-white">Value labels and remaining stubs</h2>
              </div>
              <Badge label="Support" kind="DERIVED" />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold text-white">Live</div>
                <p className="mt-2 text-sm leading-6 text-zinc-300">Board date, matchup windows, player rows, model fair lines, projections, ranks, context fields, live consensus lines, and sportsbook counts read directly from SnapshotBoardData.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold text-white">Derived</div>
                <p className="mt-2 text-sm leading-6 text-zinc-300">Client-side edges, board averages, slot gaps, tab ordering, selector fallback picks, and confidence values converted from raw win-probability fields.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold text-white">Placeholder</div>
                <p className="mt-2 text-sm leading-6 text-zinc-300">Missing live lines or unsupported values stay as em dashes. Historical sportsbook movement is not present in SnapshotBoardData, so the line-tracking tab stays current-line based.</p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}



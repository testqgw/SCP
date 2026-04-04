'use client';

import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SnapshotBoardData,
  SnapshotMarket,
  SnapshotModelSide,
  SnapshotPrecisionCardEntry,
  SnapshotPrecisionPickSignal,
  SnapshotPtsSignal,
  SnapshotRow,
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
  { label: 'Methodology / Support', action: 'help' },
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

function matchup(row: SnapshotRow) {
  return `${row.matchupKey.replace('@', ' @ ')} - ${row.gameTimeEt}`;
}

function hasValue<T>(value: T | null | undefined): value is T {
  return value != null;
}

function signal(row: SnapshotRow, market: SnapshotMarket): SnapshotPtsSignal | null {
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

function MatchupsCard({ matchups }: { matchups: SnapshotBoardData['matchups'] }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
      <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Top matchups</div>
      {matchups.length ? (
        <div className="mt-4 space-y-3">
          {matchups.slice(0, 4).map((m) => (
            <div key={m.key} className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
              <div className="text-sm font-semibold text-white">{m.label}</div>
              <div className="mt-1 text-xs text-zinc-400">{m.gameTimeEt}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/25 px-4 py-4 text-sm text-zinc-400">
          Matchup windows will appear here as soon as the slate loads.
        </div>
      )}
    </div>
  );
}

type View = {
  row: SnapshotRow;
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
  precision: SnapshotPrecisionPickSignal | null;
};

type BoardResponse = { ok: true; result: SnapshotBoardData } | { ok: false; error: string };

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

function viewFor(row: SnapshotRow, market: SnapshotMarket, entry: SnapshotPrecisionCardEntry | null = null): View {
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

function playerSearchKey(row: SnapshotRow) {
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

export default function NewDashboard({ data: initialData }: { data: SnapshotBoardData }) {
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<Tab>('precision');
  const [pickedPlayer, setPickedPlayer] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | null>(null);
  const helpRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  const rowById = useMemo(() => new Map(data.rows.map((row) => [row.playerId, row] as const)), [data.rows]);
  const precision = useMemo(
    () =>
      (data.precisionCard ?? [])
        .map((entry) => {
          const row = rowById.get(entry.playerId);
          return row ? { entry, row, view: viewFor(row, entry.market, entry) } : null;
        })
        .filter((x): x is { entry: SnapshotPrecisionCardEntry; row: SnapshotRow; view: View } => x !== null)
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
    const out: SnapshotRow[] = [];
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
  const researchListRows = deferredSearchQuery ? searchResults : researchRows;
  const searchLeadRow = deferredSearchQuery ? searchResults[0] ?? null : null;
  const researchRow = useMemo(
    () => (pickedPlayer ? rowById.get(pickedPlayer) ?? null : searchLeadRow ?? featured?.row ?? researchRows[0] ?? null),
    [featured?.row, pickedPlayer, researchRows, rowById, searchLeadRow],
  );
  const researchViews = useMemo(
    () => (researchRow ? MARKETS.map((market) => viewFor(researchRow, market)).sort((a, b) => b.score - a.score || a.market.localeCompare(b.market)) : []),
    [researchRow],
  );
  const researchTopPrecision = useMemo(
    () => (researchRow ? precision.find((item) => item.row.playerId === researchRow.playerId) ?? null : null),
    [precision, researchRow],
  );
  const teamMatchup = useMemo(
    () => (researchRow ? data.teamMatchups.find((m) => m.matchupKey === researchRow.matchupKey) ?? null : null),
    [data.teamMatchups, researchRow],
  );
  const scoutViews = useMemo(
    () => allViews.filter((v) => v.live != null || v.precision?.qualified || v.conf != null || v.reasons.length > 0).sort((a, b) => b.score - a.score).slice(0, 8),
    [allViews],
  );
  const trackViews = useMemo(
    () => allViews.filter((v) => v.live != null || v.fair != null || v.edge != null).sort((a, b) => Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0) || b.score - a.score).slice(0, 8),
    [allViews],
  );
  const liveCount = allViews.filter((v) => v.live != null).length;
  const qualifiedCount = allViews.filter((v) => v.precision?.qualified).length;
  const avgCompleteness = data.rows.length ? Math.round((data.rows.reduce((s, r) => s + r.dataCompleteness.score, 0) / data.rows.length) * 10) / 10 : null;
  const target = data.precisionSystem?.targetCardCount ?? data.precisionCardSummary?.targetCardCount ?? precision.length;
  const selected = data.precisionCardSummary?.selectedCount ?? precision.length;
  const gap = Math.max(target - selected, 0);
  const hasBoardRows = data.rows.length > 0;
  const featuredUpdatedAt = featured?.row.gameIntel.generatedAt ?? data.lastUpdatedAt ?? null;
  const hasPrecisionTarget = target > 0;
  const precisionSlotsValue = hasPrecisionTarget ? `${n(selected, 0)} / ${n(target, 0)}` : '-';
  const precisionSlotsKind: Kind = hasPrecisionTarget ? 'DERIVED' : 'PLACEHOLDER';
  const precisionSlotsNote = hasPrecisionTarget
    ? gap > 0
      ? `${gap} slot${gap === 1 ? '' : 's'} open`
      : 'Filled to target'
    : 'Awaiting card target';
  const openHelp = () => helpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const openResearchSearch = () => {
    setTab('research');
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };
  const setResearch = (playerId: string) => {
    setPickedPlayer(playerId);
    setTab('research');
  };

  useEffect(() => {
    if (pickedPlayer && !rowById.has(pickedPlayer)) {
      setPickedPlayer(null);
    }
  }, [pickedPlayer, rowById]);

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
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 md:gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-300/80">ULTOPS / Snapshot</div>
                <div className="mt-1 text-sm text-zinc-400">NBA prop intelligence board</div>
              </div>
              <div className="hidden h-10 w-px bg-white/10 md:block" />
              <nav className="flex flex-wrap items-center gap-2">
                {TOP_NAV.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => (item.action === 'help' ? openHelp() : setTab(item.tab!))}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${
                      item.tab && tab === item.tab
                        ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100'
                        : 'border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={refreshSlate}
                disabled={isRefreshing}
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                  isRefreshing
                    ? 'cursor-wait border-amber-400/20 bg-amber-400/10 text-amber-100'
                    : 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15'
                }`}
              >
                {isRefreshing ? 'Refreshing slate...' : 'Refresh slate'}
              </button>
              <Badge label={isRefreshing ? 'Refreshing' : 'LIVE'} kind={isRefreshing ? 'DERIVED' : 'LIVE'} />
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Board date</div>
                <div className="text-sm font-medium text-white">{data.dateEt}</div>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <section className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
            <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,rgba(9,9,11,0.94),rgba(15,23,42,0.88))] p-6 shadow-2xl shadow-black/25">
              <div className="flex flex-wrap gap-2">
                <Pill label="Live NBA prop board" tone="cyan" />
                <Pill label="Featured precision card" tone="amber" />
                <Pill label="Research + line context" />
              </div>
              <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                The live NBA prop board that shows the best edges first.
              </h1>
              <p className="mt-4 max-w-2xl text-base text-zinc-300 sm:text-lg">
                Start with the featured pick, search any player on the current slate, and refresh the board when new
                lineups or prices land without leaving the dashboard.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setTab('precision')}
                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/15"
                >
                  Focus the Board
                </button>
                <button
                  type="button"
                  onClick={openResearchSearch}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:border-white/20 hover:bg-white/10"
                >
                  Search Slate Players
                </button>
                <button
                  type="button"
                  onClick={openHelp}
                  className="rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-400/15"
                >
                  Methodology / Support
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
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Board</div>
                  <div className="mt-2 text-sm text-zinc-300">Curated edge ranking for the current slate with a featured lead pick.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Research</div>
                  <div className="mt-2 text-sm text-zinc-300">Player dossier, matchup context, and all-market matrix in one view.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Scout + Tracking</div>
                  <div className="mt-2 text-sm text-zinc-300">Signal stream and current line versus fair snapshots without inventing book history.</div>
                </div>
              </div>
              <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Matchups" value={n(data.matchups.length, 0)} kind="LIVE" note="Game windows loaded" />
                <Stat label="Live lines" value={n(liveCount, 0)} kind="LIVE" note="Markets with consensus data" />
                <Stat
                  label="Precision accuracy"
                  value={data.precisionSystem ? pct(data.precisionSystem.historicalAccuracy, 1) : '-'}
                  kind={data.precisionSystem ? 'LIVE' : 'PLACEHOLDER'}
                  note={data.precisionSystem ? `${n(data.precisionSystem.historicalPicks, 0)} picks tracked` : 'System summary unavailable'}
                />
                <Stat label="Updated" value={ts(data.lastUpdatedAt)} kind={data.lastUpdatedAt ? 'LIVE' : 'PLACEHOLDER'} note="ET timestamp" />
              </div>
            </div>
            <div className="space-y-4 rounded-[32px] border border-white/10 bg-zinc-900/75 p-5 backdrop-blur">
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
                <div className="rounded-[28px] border border-white/10 bg-black/30 p-4">
                  <div className="flex flex-wrap gap-2">
                    {featured.rank ? <Badge label={featured.rank} kind="DERIVED" /> : null}
                    <Pill label={featured.source} tone={featured.source === 'Live signal' ? 'cyan' : 'default'} />
                    <Pill label={MARKET_LABELS[featured.market]} tone="amber" />
                    <Badge label={featured.live != null ? 'Live candidate' : 'Derived candidate'} kind={featured.live != null ? 'LIVE' : 'DERIVED'} />
                  </div>
                  <div className="mt-4 grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                    <div>
                      <h3 className="text-2xl font-semibold tracking-tight text-white">{featured.row.playerName}</h3>
                      <p className="mt-1 text-sm text-zinc-400">
                        {matchup(featured.row)} - {MARKET_LABELS[featured.market]}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Side side={featured.side} kind={featured.sideKind} />
                        <Badge label={featured.sideKind} kind={featured.sideKind} />
                        {featured.precision?.selectorFamily ? <Pill label={featured.precision.selectorFamily} tone="cyan" /> : null}
                        {featured.precision?.selectorTier ? <Pill label={featured.precision.selectorTier} tone="amber" /> : null}
                      </div>
                      <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-300">
                        {featured.precision?.reasons?.length
                          ? featured.precision.reasons.slice(0, 2).join(' • ')
                          : featured.reasons.length
                            ? featured.reasons.slice(0, 2).join(' • ')
                            : 'No extra reasons surfaced by the current payload.'}
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Stat dense label="Live line" value={featured.live == null ? '-' : n(featured.live)} kind={featured.liveKind} note="Consensus market line" />
                      <Stat dense label="Fair line" value={featured.fair == null ? '-' : n(featured.fair)} kind={featured.fairKind} note="Model fair line from payload" />
                      <Stat dense label="Projection" value={featured.proj == null ? '-' : n(featured.proj)} kind={featured.projKind} note="Tonight projection from payload" />
                      <Stat dense label="Edge" value={featured.edge == null ? '-' : signed(featured.edge)} kind={featured.edgeKind} note="Projection minus line" />
                      <Stat dense label="Confidence" value={featured.conf == null ? '-' : pct(featured.conf, 1)} kind={featured.confKind} note="Win probability or historical accuracy" />
                      <Stat dense label="Updated" value={ts(featuredUpdatedAt)} kind={hasValue(featuredUpdatedAt) ? 'LIVE' : 'PLACEHOLDER'} note="Most recent board or dossier timestamp" />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Pill label={featured.note} tone={featured.live != null ? 'cyan' : 'default'} />
                    <Badge label={`Books ${featured.books == null ? '-' : n(featured.books, 0)}`} kind={featured.booksKind} />
                  </div>
                </div>
              ) : (
                <div className="rounded-[28px] border border-dashed border-white/15 bg-black/25 p-5">
                  <div className="text-sm font-semibold text-white">{hasBoardRows ? 'No valid featured pick is available yet.' : 'Waiting for board data to load a featured pick.'}</div>
                  <div className="mt-2 text-sm text-zinc-400">
                    {hasBoardRows
                      ? 'Once the board has a precision card entry or a live market-led candidate, the featured anchor will render here.'
                      : 'As soon as SnapshotBoardData returns rows for the slate, this card will promote the best available featured pick.'}
                  </div>
                </div>
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
            <div className="grid gap-2 md:grid-cols-4">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`rounded-2xl border px-4 py-3 text-left ${
                    tab === item.id
                      ? 'border-cyan-400/30 bg-cyan-400/10 text-white'
                      : 'border-transparent bg-white/0 text-zinc-400 hover:border-white/10 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-[0.18em]">{item.label}</div>
                  <div className="mt-1 text-xs text-current/70">{item.hint}</div>
                </button>
              ))}
            </div>
          </section>

          {tab === 'precision' ? (
            <section className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
              <div className="space-y-4">
                {precision.length === 0 ? (
                  <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-6">
                    <div className="text-lg font-semibold text-white">No precision-card entries are loaded on this slate.</div>
                    <div className="mt-2 text-sm text-zinc-400">
                      The board still works, but the featured anchor remains in fallback mode until a valid card is present.
                    </div>
                  </div>
                ) : (
                  precision.map(({ entry, row, view }, idx) => (
                    <button
                      key={`${entry.playerId}:${entry.market}`}
                      type="button"
                      onClick={() => setResearch(row.playerId)}
                      className={`w-full rounded-[28px] border p-5 text-left transition hover:-translate-y-0.5 hover:border-cyan-400/25 hover:bg-zinc-900/90 ${
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

                <MatchupsCard matchups={data.matchups} />
              </div>
            </section>
          ) : null}
          {tab === 'research' ? (
            <section className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.55fr]">
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
                {researchListRows.length ? (
                  researchListRows.map((row) => {
                    const v = viewFor(row, 'PTS');
                    const picked = row.playerId === researchRow?.playerId;
                    return (
                      <button
                        key={row.playerId}
                        type="button"
                        onClick={() => setPickedPlayer(row.playerId)}
                        className={`w-full rounded-[24px] border p-4 text-left ${
                          picked
                            ? 'border-cyan-400/25 bg-[linear-gradient(145deg,rgba(8,15,29,0.96),rgba(15,23,42,0.9))]'
                            : 'border-white/10 bg-zinc-900/75'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap gap-2">
                              {picked ? <Badge label="Selected" kind="DERIVED" /> : <Pill label="Player" />}
                              <Pill label={v.label} tone="amber" />
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
                          <Badge label={`L10 PTS ${n(row.last10Average.PTS, 1)}`} kind={row.last10Average.PTS == null ? 'PLACEHOLDER' : 'LIVE'} />
                          <Badge label={`Trend ${signed(row.trendVsSeason.PTS, 1)}`} kind="DERIVED" />
                          <Badge label={`Proj min ${n(row.playerContext.projectedMinutes, 1)}`} kind={row.playerContext.projectedMinutes == null ? 'PLACEHOLDER' : 'LIVE'} />
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-[24px] border border-dashed border-white/15 bg-black/25 p-4 text-sm text-zinc-400">
                    Search results will populate here for players on the active slate.
                  </div>
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
                          </div>
                          <h3 className="mt-4 text-3xl font-semibold tracking-tight text-white">{researchRow.playerName}</h3>
                          <p className="mt-1 text-sm text-zinc-400">{matchup(researchRow)}</p>
                        </div>
                        <div className={`rounded-2xl border px-4 py-3 text-right ${SIDE_CLASS[researchViews[0]?.side ?? 'NEUTRAL']}`}>
                          <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">Best market</div>
                          <div className="mt-2 flex justify-end">
                            {researchViews[0] ? <Side side={researchViews[0].side} kind={researchViews[0].sideKind} /> : <Badge label="NEUTRAL" kind="PLACEHOLDER" />}
                          </div>
                          <div className="mt-1 text-xs opacity-80">{researchViews[0]?.note ?? 'No market context available'}</div>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <Stat dense label="Projected minutes" value={n(researchRow.playerContext.projectedMinutes, 1)} kind={researchRow.playerContext.projectedMinutes == null ? 'PLACEHOLDER' : 'LIVE'} note={`Floor ${n(researchRow.playerContext.projectedMinutesFloor, 1)} / ceiling ${n(researchRow.playerContext.projectedMinutesCeiling, 1)}`} />
                        <Stat dense label="Lineup status" value={researchRow.playerContext.lineupStatus ?? '-'} kind={researchRow.playerContext.lineupStatus ? 'LIVE' : 'PLACEHOLDER'} note={researchRow.playerContext.projectedStarter} />
                        <Stat dense label="Rotation rank" value={researchRow.playerContext.rotationRank == null ? '-' : n(researchRow.playerContext.rotationRank, 0)} kind={researchRow.playerContext.rotationRank == null ? 'PLACEHOLDER' : 'LIVE'} note="Depth chart position" />
                        <Stat dense label="Completeness" value={pct(researchRow.dataCompleteness.score, 0)} kind="LIVE" note={researchRow.dataCompleteness.tier} />
                        <Stat dense label="Primary defender" value={researchRow.playerContext.primaryDefender?.playerName ?? '-'} kind={researchRow.playerContext.primaryDefender ? 'LIVE' : 'PLACEHOLDER'} note={researchRow.playerContext.primaryDefender?.matchupReason ?? 'No defender context'} />
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
                            </tr>
                          </thead>
                          <tbody>
                            {researchViews.map((v) => (
                              <tr key={`${v.row.playerId}:${v.market}`} className="border-t border-white/8">
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
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Player context</div>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <Stat dense label="Season PTS" value={n(researchRow.seasonAverage.PTS, 1)} kind={researchRow.seasonAverage.PTS == null ? 'PLACEHOLDER' : 'LIVE'} note={`Trend ${signed(researchRow.trendVsSeason.PTS, 1)}`} />
                          <Stat dense label="Season REB" value={n(researchRow.seasonAverage.REB, 1)} kind={researchRow.seasonAverage.REB == null ? 'PLACEHOLDER' : 'LIVE'} note={`Opp delta ${signed(researchRow.opponentAllowanceDelta.REB, 1)}`} />
                          <Stat dense label="Season AST" value={n(researchRow.seasonAverage.AST, 1)} kind={researchRow.seasonAverage.AST == null ? 'PLACEHOLDER' : 'LIVE'} note={`Opp delta ${signed(researchRow.opponentAllowanceDelta.AST, 1)}`} />
                          <Stat dense label="Minutes trend" value={signed(researchRow.playerContext.minutesTrend, 1)} kind={researchRow.playerContext.minutesTrend == null ? 'PLACEHOLDER' : 'LIVE'} note={`Volatility ${n(researchRow.playerContext.minutesVolatility, 1)}`} />
                        </div>
                        <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-zinc-300">
                          Teammates: {researchRow.playerContext.teammateCore.length ? researchRow.playerContext.teammateCore.slice(0, 3).map((mate) => `${mate.playerName} (${n(mate.avgMinutesLast10, 1)})`).join(' | ') : '-'}
                        </div>
                      </div>
                      {teamMatchup ? (
                        <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Team matchup</div>
                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <Stat dense label="Offense L10" value={n(teamMatchup.awayTeam === researchRow.teamCode ? teamMatchup.awayLast10For.PTS : teamMatchup.homeLast10For.PTS, 1)} kind="LIVE" note="PTS basis" />
                            <Stat dense label="Allowed L10" value={n(teamMatchup.awayTeam === researchRow.teamCode ? teamMatchup.homeLast10Allowed.PTS : teamMatchup.awayLast10Allowed.PTS, 1)} kind="LIVE" note="PTS basis" />
                            <Stat dense label="Season record" value={teamMatchup.awayTeam === researchRow.teamCode ? `${teamMatchup.awaySeasonRecord.wins}-${teamMatchup.awaySeasonRecord.losses}` : `${teamMatchup.homeSeasonRecord.wins}-${teamMatchup.homeSeasonRecord.losses}`} kind="LIVE" note="Team record" />
                            <Stat dense label="Last10 record" value={teamMatchup.awayTeam === researchRow.teamCode ? `${teamMatchup.awayLast10Record.wins}-${teamMatchup.awayLast10Record.losses}` : `${teamMatchup.homeLast10Record.wins}-${teamMatchup.homeLast10Record.losses}`} kind="LIVE" note="Recent form" />
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-[28px] border border-dashed border-white/15 bg-black/25 p-5 text-sm text-zinc-400">
                          No team matchup summary is available for this player yet.
                        </div>
                      )}
                    </div>

                    {researchTopPrecision?.entry.precisionSignal?.reasons?.length ? (
                      <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-5">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Precision reasons</div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {researchTopPrecision.entry.precisionSignal.reasons.slice(0, 4).map((r) => (
                            <Badge key={r} label={r} kind="DERIVED" />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-6">
                    <div className="text-lg font-semibold text-white">No research row is selected.</div>
                    <div className="mt-2 text-sm text-zinc-400">Pick a player from the left rail to open a full dossier.</div>
                  </div>
                )}
              </div>
            </section>
          ) : null}
          {tab === 'scout' ? (
            <section className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
              <div className="space-y-3">
                {scoutViews.length === 0 ? (
                  <div className="rounded-[28px] border border-white/10 bg-zinc-900/75 p-6">
                    <div className="text-lg font-semibold text-white">No scout feed items are available yet.</div>
                    <div className="mt-2 text-sm text-zinc-400">
                      Once live line or precision data lands, the feed will populate with actionable signal rows.
                    </div>
                  </div>
                ) : (
                  scoutViews.map((v, i) => (
                    <button
                      key={`${v.row.playerId}:${v.market}`}
                      type="button"
                      onClick={() => setResearch(v.row.playerId)}
                      className="w-full rounded-[28px] border border-white/10 bg-zinc-900/75 p-5 text-left hover:-translate-y-0.5 hover:border-cyan-400/25 hover:bg-zinc-900/90"
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
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Support note</div>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">
                    The scout feed is built from the current board payload. It shows live line data when present, then
                    falls back to derived confidence and projection context. It does not invent book movement that is not
                    present in SnapshotBoardData.
                  </p>
                </div>
                <MatchupsCard matchups={data.matchups} />
              </div>
            </section>
          ) : null}
          {tab === 'tracking' ? (
            <section className="mt-6 grid gap-6 xl:grid-cols-[1.55fr_0.85fr]">
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
                          <td colSpan={8} className="px-4 py-6 text-zinc-400">No line tracking rows are available yet.</td>
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
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Current limitation</div>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">
                    SnapshotBoardData does not include full historical sportsbook movement. This tab therefore tracks the
                    current live line, the payload fair line, and recent production snapshots instead of fabricating a
                    movement history.
                  </p>
                </div>
                <MatchupsCard matchups={data.matchups} />
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



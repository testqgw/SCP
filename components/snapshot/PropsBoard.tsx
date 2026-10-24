'use client';

import Link from 'next/link';
import { ChevronDown, Search } from 'lucide-react';
import { Fragment, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { SnapshotMarket, SnapshotStatLog } from '@/lib/types/snapshot';
import {
  PROPS_BOARD_MARKETS,
  PROPS_BOARD_MARKET_LABELS,
  lineHitSummary,
  seasonStartDate,
  statForMarket,
  type PropsBoardData,
  type PropsBoardEntry,
  type PropsBoardGame,
} from '@/lib/snapshot/propsBoard';

type SortKey = 'game' | 'edge' | 'hot' | 'cold' | 'books';
type LogsState = { status: 'loading' } | { status: 'ready'; logs: SnapshotStatLog[] } | { status: 'error'; error: string };

const SORT_LABELS: Record<SortKey, string> = {
  game: 'Game time',
  edge: 'Biggest projection gap',
  hot: 'Most overs, last 5',
  cold: 'Most unders, last 5',
  books: 'Most books',
};

const NAV = [
  { label: 'Board', href: '/' },
  { label: 'Props', href: '/props' },
  { label: 'Research', href: '/?view=players' },
  { label: 'WNBA', href: '/wnba' },
];

const ACTION_CLASS =
  'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]';

const CHIP_CLASS = `${ACTION_CLASS} shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium tracking-wide`;
const CHIP_ON = 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]';
const CHIP_OFF = 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:text-[var(--text)]';

const SELECT_CLASS =
  'h-8 rounded-lg border border-[var(--border)] bg-zinc-900/70 px-2.5 text-xs text-[var(--text)] outline-none hover:border-zinc-700 focus:border-[var(--accent-border)]';

const MARKET_ORDER = new Map(PROPS_BOARD_MARKETS.map((market, index) => [market, index]));

function n(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return '—';
  return Number(value.toFixed(digits)).toString();
}

// Books split between two lines produce a quarter-point consensus such as 3.75.
function isSplitLine(line: number) {
  return Math.abs((line * 2) % 1) > 1e-9;
}

function SplitLineHint({ line }: { line: number }) {
  if (!isSplitLine(line)) return null;
  return (
    <span className="ml-1 text-[10px] font-normal text-[var(--muted)]" title="Books are split between two lines; this is the consensus midpoint">
      split
    </span>
  );
}

function signed(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${n(value, digits)}`;
}

function price(value: number | null) {
  if (value == null) return '—';
  return value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`;
}

function pctLabel(value: number | null) {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

function relativeTime(iso: string | null, now: number) {
  if (!iso) return 'not refreshed yet';
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function boardDateLabel(dateEt: string) {
  const date = new Date(`${dateEt}T12:00:00Z`);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function logDateLabel(gameDateEt: string, seasonStart: string) {
  const date = new Date(`${gameDateEt}T12:00:00Z`);
  const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return gameDateEt >= seasonStart ? label : `${label} '${gameDateEt.slice(2, 4)}`;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function averageLabel(values: number[]) {
  return values.length ? `${n(average(values))} (${values.length} g)` : 'No games';
}

function tipTime(gameTimeEt: string) {
  return gameTimeEt.replace(/^[A-Z][a-z]{2} \d{1,2}, /, '');
}

function roleLabel(entry: PropsBoardEntry) {
  if (entry.starter === true) return 'Starter';
  if (entry.starter === false) return 'Bench';
  return null;
}

function availabilityLabel(entry: PropsBoardEntry) {
  const status = entry.availabilityStatus;
  if (!status) return null;
  const label = status === 'UNKNOWN' ? 'Status unclear' : status.charAt(0) + status.slice(1).toLowerCase();
  return entry.availabilityPercentPlay != null ? `${label} ${Math.round(entry.availabilityPercentPlay)}%` : label;
}

function edgeClass(edge: number | null) {
  if (edge == null || edge === 0) return 'text-[var(--text-2)]';
  return edge > 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]';
}

function hitChipClass(value: number, line: number) {
  if (value > line) return 'border-[var(--positive-border)] bg-[var(--positive-soft)] text-[var(--positive)]';
  if (value < line) return 'border-[var(--negative-border)] bg-[var(--negative-soft)] text-[var(--negative)]';
  return 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]';
}

function leanPill(entry: PropsBoardEntry) {
  if (entry.lean === 'NEUTRAL') return null;
  const over = entry.lean === 'OVER';
  return (
    <span
      className={`rounded border px-1.5 py-px text-[10px] font-semibold ${
        over
          ? 'border-[var(--positive-border)] bg-[var(--positive-soft)] text-[var(--positive)]'
          : 'border-[var(--negative-border)] bg-[var(--negative-soft)] text-[var(--negative)]'
      }`}
      title="Model side for this line"
    >
      {over ? 'Lean O' : 'Lean U'}
    </span>
  );
}

function compareEntries(sort: SortKey, gameStart: Map<string, number>) {
  const byGameThenPlayer = (a: PropsBoardEntry, b: PropsBoardEntry) =>
    (gameStart.get(a.matchupKey) ?? Infinity) - (gameStart.get(b.matchupKey) ?? Infinity) ||
    a.matchupKey.localeCompare(b.matchupKey) ||
    (b.projectedMinutes ?? -1) - (a.projectedMinutes ?? -1) ||
    a.playerName.localeCompare(b.playerName) ||
    (MARKET_ORDER.get(a.market) ?? 0) - (MARKET_ORDER.get(b.market) ?? 0);

  switch (sort) {
    case 'edge':
      return (a: PropsBoardEntry, b: PropsBoardEntry) =>
        Math.abs(b.edge ?? -Infinity) - Math.abs(a.edge ?? -Infinity) || byGameThenPlayer(a, b);
    case 'hot':
      return (a: PropsBoardEntry, b: PropsBoardEntry) =>
        b.last5Over / Math.max(b.last5.length, 1) - a.last5Over / Math.max(a.last5.length, 1) ||
        b.last5.length - a.last5.length ||
        byGameThenPlayer(a, b);
    case 'cold':
      return (a: PropsBoardEntry, b: PropsBoardEntry) =>
        a.last5Over / Math.max(a.last5.length, 1) - b.last5Over / Math.max(b.last5.length, 1) ||
        b.last5.length - a.last5.length ||
        byGameThenPlayer(a, b);
    case 'books':
      return (a: PropsBoardEntry, b: PropsBoardEntry) => b.books - a.books || byGameThenPlayer(a, b);
    default:
      return byGameThenPlayer;
  }
}

function LastFive({ entry }: { entry: PropsBoardEntry }) {
  if (!entry.last5.length) return <span className="text-xs text-[var(--muted)]">—</span>;
  return (
    <div className="flex items-center gap-1" title="Last 5 games, newest first">
      {entry.last5.map((value, index) => (
        <span
          key={index}
          className={`min-w-[26px] rounded border px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums ${hitChipClass(value, entry.line)}`}
        >
          {n(value, 0)}
        </span>
      ))}
    </div>
  );
}

function HitTile({ label, values, line }: { label: string; values: number[]; line: number }) {
  const summary = lineHitSummary(values, line);
  const decided = summary.over + summary.under;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">{label}</div>
      {summary.games ? (
        <>
          <div className="mt-1 text-sm font-semibold tabular-nums text-[var(--text)]">
            {summary.over}/{summary.games} over
          </div>
          <div className="text-[11px] tabular-nums text-[var(--text-2)]">
            {decided ? `${Math.round((summary.over / decided) * 100)}%` : '—'}
            {summary.push ? ` · ${summary.push} push` : ''}
          </div>
        </>
      ) : (
        <div className="mt-1 text-sm text-[var(--muted)]">No games</div>
      )}
    </div>
  );
}

function ContextLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--border)] py-1.5 text-xs last:border-b-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="text-right text-[var(--text)]">{value}</span>
    </div>
  );
}

function PropDetail({ entry, dateEt, logs }: { entry: PropsBoardEntry; dateEt: string; logs: LogsState | undefined }) {
  const played = useMemo(
    () => (logs?.status === 'ready' ? logs.logs.filter((log) => log.played !== false && log.minutes > 0) : []),
    [logs],
  );
  const seasonStart = seasonStartDate(dateEt);
  const lastSeasonStart = seasonStartDate(`${Number(seasonStart.slice(0, 4)) - 1}-10-01`);
  const values = played.map((log) => statForMarket(log, entry.market));
  const thisSeason = played.filter((log) => log.gameDateEt >= seasonStart).map((log) => statForMarket(log, entry.market));
  const lastSeason = played
    .filter((log) => log.gameDateEt >= lastSeasonStart && log.gameDateEt < seasonStart)
    .map((log) => statForMarket(log, entry.market));
  const vsOpponent = played.filter((log) => log.opponent === entry.opponentCode).map((log) => statForMarket(log, entry.market));
  const label = PROPS_BOARD_MARKET_LABELS[entry.market];
  const minutes =
    entry.projectedMinutes == null
      ? null
      : `${n(entry.projectedMinutes)}${entry.minutesFloor != null && entry.minutesCeiling != null ? ` (${n(entry.minutesFloor)}–${n(entry.minutesCeiling)})` : ''}`;

  return (
    <div className="grid gap-4 border-t border-[var(--border)] bg-[var(--surface-2)]/60 px-3 py-4 sm:px-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
          {label} vs {n(entry.line, 2)} — recent games
        </div>
        {logs?.status === 'loading' || !logs ? (
          <div className="mt-3 text-xs text-[var(--text-2)]">Loading game log…</div>
        ) : logs.status === 'error' ? (
          <div className="mt-3 text-xs text-[var(--text-2)]">{logs.error}</div>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              <HitTile label="L5" values={values.slice(0, 5)} line={entry.line} />
              <HitTile label="L10" values={values.slice(0, 10)} line={entry.line} />
              <HitTile label="L20" values={values.slice(0, 20)} line={entry.line} />
              <HitTile label="This season" values={thisSeason} line={entry.line} />
              <HitTile label="Last season" values={lastSeason} line={entry.line} />
              <HitTile label={`vs ${entry.opponentCode}`} values={vsOpponent} line={entry.line} />
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[340px] text-xs tabular-nums">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                    <th className="py-1 pr-2 font-medium">Date</th>
                    <th className="py-1 pr-2 font-medium">Opp</th>
                    <th className="py-1 pr-2 text-right font-medium">Min</th>
                    <th className="py-1 pr-2 text-right font-medium">{label}</th>
                    <th className="py-1 text-right font-medium">vs line</th>
                  </tr>
                </thead>
                <tbody>
                  {played.slice(0, 10).map((log) => {
                    const value = statForMarket(log, entry.market);
                    return (
                      <tr key={log.gameDateEt} className="border-t border-[var(--border)]">
                        <td className="py-1.5 pr-2 text-[var(--text-2)]">{logDateLabel(log.gameDateEt, seasonStart)}</td>
                        <td className="py-1.5 pr-2 text-[var(--text-2)]">
                          {log.isHome === false ? '@' : 'vs'} {log.opponent ?? '—'}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-[var(--text-2)]">{n(log.minutes, 0)}</td>
                        <td className="py-1.5 pr-2 text-right font-semibold text-[var(--text)]">{n(value, 0)}</td>
                        <td className="py-1.5 text-right">
                          <span className={`rounded border px-1.5 py-px text-[10px] font-semibold ${hitChipClass(value, entry.line)}`}>
                            {value > entry.line ? 'Over' : value < entry.line ? 'Under' : 'Push'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Context</div>
        <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
          <ContextLine label="Projection" value={entry.projection == null ? null : `${n(entry.projection)} (${signed(entry.edge)} vs line)`} />
          {logs?.status === 'ready' ? (
            <>
              <ContextLine label="Avg this season" value={averageLabel(thisSeason)} />
              <ContextLine label="Avg last season" value={averageLabel(lastSeason)} />
            </>
          ) : null}
          <ContextLine label="Avg L10 / all loaded games" value={`${n(entry.last10Average)} / ${n(entry.allGamesAverage)}`} />
          <ContextLine label="Projected minutes" value={minutes} />
          <ContextLine label="Role" value={entry.roleLabel} />
          <ContextLine label="Availability" value={availabilityLabel(entry)} />
          <ContextLine label={`${entry.opponentCode} allows vs avg`} value={entry.opponentDelta == null ? null : `${signed(entry.opponentDelta)} ${label}`} />
          <ContextLine label="Primary defender" value={entry.primaryDefender} />
          <ContextLine label="Over / under price" value={`${price(entry.overPrice)} / ${price(entry.underPrice)}`} />
          <ContextLine label="No-vig over chance" value={pctLabel(entry.overProbability)} />
          <ContextLine label="Books quoting" value={`${entry.books}`} />
          <ContextLine
            label="Model lean"
            value={entry.lean === 'NEUTRAL' ? 'None' : `${entry.lean === 'OVER' ? 'Over' : 'Under'}${entry.grade ? ` · grade ${entry.grade.grade}` : ''}`}
          />
        </div>
        {entry.grade || entry.passReasons.length ? (
          <ul className="mt-2 space-y-1 text-xs text-[var(--text-2)]">
            {entry.grade ? <li>{entry.grade.summary}</li> : null}
            {entry.passReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
        <Link
          href={`/?view=players&player=${encodeURIComponent(entry.playerId)}`}
          className={`${ACTION_CLASS} mt-3 inline-flex rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent)]`}
        >
          Open {entry.playerName} in Research
        </Link>
      </div>
    </div>
  );
}

function PropRow({
  entry,
  showMatchup,
  expanded,
  onToggle,
  dateEt,
  logs,
}: {
  entry: PropsBoardEntry;
  showMatchup: boolean;
  expanded: boolean;
  onToggle: () => void;
  dateEt: string;
  logs: LogsState | undefined;
}) {
  const role = roleLabel(entry);
  const availability = availabilityLabel(entry);
  const meta = [`${entry.teamCode} ${entry.isHome ? 'vs' : '@'} ${entry.opponentCode}`, entry.position, role].filter(Boolean).join(' · ');
  const label = PROPS_BOARD_MARKET_LABELS[entry.market];

  return (
    <div className="border-t border-[var(--border)] first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`${ACTION_CLASS} w-full px-3 py-2.5 text-left hover:bg-[var(--surface-2)] sm:px-4 ${expanded ? 'bg-[var(--surface-2)]' : ''}`}
      >
        {/* Phone layout */}
        <div className="md:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--text)]">{entry.playerName}</div>
              <div className="truncate text-[11px] text-[var(--text-2)]">
                {meta}
                {availability ? <span className="text-[var(--warning)]"> · {availability}</span> : null}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums text-[var(--text)]">
                {label} {n(entry.line, 2)}
                <SplitLineHint line={entry.line} />
              </div>
              <div className="text-[11px] tabular-nums text-[var(--text-2)]">
                O {price(entry.overPrice)} · U {price(entry.underPrice)}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <LastFive entry={entry} />
            <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-[var(--text-2)]">
              <span>
                Proj {n(entry.projection)} <span className={edgeClass(entry.edge)}>({signed(entry.edge)})</span>
              </span>
              {leanPill(entry)}
            </div>
          </div>
        </div>

        {/* Desktop layout */}
        <div className="hidden items-center gap-3 md:grid md:grid-cols-[minmax(0,1.6fr)_56px_52px_96px_88px_minmax(150px,1fr)_88px_44px_16px]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-[var(--text)]">{entry.playerName}</span>
              {availability ? (
                <span className="shrink-0 rounded border border-[var(--gold-border)] bg-[var(--gold-soft)] px-1.5 py-px text-[10px] font-medium text-[var(--warning)]">
                  {availability}
                </span>
              ) : null}
            </div>
            <div className="truncate text-[11px] text-[var(--text-2)]">
              {meta}
              {showMatchup ? ` · ${tipTime(entry.gameTimeEt)}` : ''}
            </div>
          </div>
          <div className="text-xs font-semibold text-[var(--accent)]">{label}</div>
          <div className="text-sm font-semibold tabular-nums text-[var(--text)]">
            {n(entry.line, 2)}
            <SplitLineHint line={entry.line} />
          </div>
          <div className="text-xs tabular-nums text-[var(--text-2)]">
            <span className="text-[var(--muted)]">O</span> {price(entry.overPrice)}{' '}
            <span className="text-[var(--muted)]">U</span> {price(entry.underPrice)}
          </div>
          <div className="text-xs tabular-nums">
            <div className="text-[var(--text)]">{n(entry.projection)}</div>
            <div className={edgeClass(entry.edge)}>{signed(entry.edge)}</div>
          </div>
          <LastFive entry={entry} />
          <div className="text-xs tabular-nums text-[var(--text-2)]">
            <div>
              <span className="text-[var(--muted)]">L10</span> {n(entry.last10Average)}
            </div>
            <div title="Average over every game the board has loaded for this player (last few seasons)">
              <span className="text-[var(--muted)]">All</span> {n(entry.allGamesAverage)}
            </div>
          </div>
          <div className="flex flex-col items-start gap-1 text-[11px] tabular-nums text-[var(--text-2)]">
            <span title="Books quoting this line">{entry.books} bk</span>
            {leanPill(entry)}
          </div>
          <ChevronDown aria-hidden="true" className={`h-4 w-4 text-[var(--muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {expanded ? <PropDetail entry={entry} dateEt={dateEt} logs={logs} /> : null}
    </div>
  );
}

function ColumnHeader() {
  return (
    <div className="hidden gap-3 border-b border-[var(--border)] px-4 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)] md:grid md:grid-cols-[minmax(0,1.6fr)_56px_52px_96px_88px_minmax(150px,1fr)_88px_44px_16px]">
      <div>Player</div>
      <div>Prop</div>
      <div>Line</div>
      <div>Odds</div>
      <div>Proj / gap</div>
      <div>Last 5 (newest first)</div>
      <div>Averages</div>
      <div>Books</div>
      <div />
    </div>
  );
}

function GameHeader({ game, count, started }: { game: PropsBoardGame; count: number; started: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-semibold text-[var(--text)]">
          {game.awayTeam} @ {game.homeTeam}
        </span>
        <span className="text-xs text-[var(--text-2)]">{tipTime(game.gameTimeEt)} ET</span>
        {started ? (
          <span className="rounded border border-[var(--gold-border)] bg-[var(--gold-soft)] px-1.5 py-px text-[10px] font-medium text-[var(--warning)]">
            Started · pregame lines
          </span>
        ) : null}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-[var(--text-2)]">
        {count} prop{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

export default function PropsBoard({ data, renderedAt }: { data: PropsBoardData; renderedAt: number }) {
  const [now, setNow] = useState(renderedAt);
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState<'ALL' | SnapshotMarket>('ALL');
  const [game, setGame] = useState<string>('ALL');
  const [sort, setSort] = useState<SortKey>('game');
  // Late at night every game has tipped; show the whole slate instead of an empty page.
  const [hideStarted, setHideStarted] = useState(() =>
    data.games.some((item) => item.propCount > 0 && (item.startMs == null || item.startMs > renderedAt)),
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [logsByPlayer, setLogsByPlayer] = useState<Record<string, LogsState>>({});
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const gameStart = useMemo(() => new Map(data.games.map((item) => [item.key, item.startMs ?? Infinity])), [data.games]);
  const startedGames = useMemo(
    () => new Set(data.games.filter((item) => item.startMs != null && now >= item.startMs).map((item) => item.key)),
    [data.games, now],
  );
  const upcomingCount = data.games.length - startedGames.size;

  // Props that pass every filter except the market chips, so the chips can show counts.
  const scoped = useMemo(
    () =>
      data.props.filter((entry) => {
        if (hideStarted && startedGames.has(entry.matchupKey)) return false;
        if (game !== 'ALL' && entry.matchupKey !== game) return false;
        if (!deferredQuery) return true;
        return (
          entry.playerName.toLowerCase().includes(deferredQuery) ||
          entry.teamCode.toLowerCase() === deferredQuery ||
          entry.matchupKey.toLowerCase().includes(deferredQuery)
        );
      }),
    [data.props, deferredQuery, game, hideStarted, startedGames],
  );

  const marketCounts = useMemo(() => {
    const counts = new Map<SnapshotMarket, number>();
    for (const entry of scoped) counts.set(entry.market, (counts.get(entry.market) ?? 0) + 1);
    return counts;
  }, [scoped]);

  const visible = useMemo(
    () => scoped.filter((entry) => market === 'ALL' || entry.market === market).sort(compareEntries(sort, gameStart)),
    [gameStart, market, scoped, sort],
  );

  const sections = useMemo(() => {
    if (sort !== 'game') return null;
    const byGame = new Map<string, PropsBoardEntry[]>();
    for (const entry of visible) {
      const list = byGame.get(entry.matchupKey) ?? [];
      list.push(entry);
      byGame.set(entry.matchupKey, list);
    }
    return data.games.filter((item) => byGame.has(item.key)).map((item) => ({ game: item, entries: byGame.get(item.key) ?? [] }));
  }, [data.games, sort, visible]);

  const playerCount = useMemo(() => new Set(visible.map((entry) => entry.playerId)).size, [visible]);

  function toggle(entry: PropsBoardEntry) {
    const opening = expandedKey !== entry.key;
    setExpandedKey(opening ? entry.key : null);
    if (!opening || logsByPlayer[entry.playerId]) return;
    setLogsByPlayer((current) => ({ ...current, [entry.playerId]: { status: 'loading' } }));
    fetch(`/api/snapshot/player/logs?date=${data.dateEt}&playerId=${encodeURIComponent(entry.playerId)}`)
      .then(async (response) => {
        const payload = (await response.json()) as
          | { ok: true; result: { analysisLogs: SnapshotStatLog[] } }
          | { ok: false; error?: string };
        if (!payload.ok) throw new Error(payload.error ?? 'Game log failed to load.');
        setLogsByPlayer((current) => ({ ...current, [entry.playerId]: { status: 'ready', logs: payload.result.analysisLogs } }));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Game log failed to load.';
        setLogsByPlayer((current) => ({ ...current, [entry.playerId]: { status: 'error', error: message } }));
      });
  }

  const renderRow = (entry: PropsBoardEntry, showMatchup: boolean) => (
    <PropRow
      key={entry.key}
      entry={entry}
      showMatchup={showMatchup}
      expanded={expandedKey === entry.key}
      onToggle={() => toggle(entry)}
      dateEt={data.dateEt}
      logs={logsByPlayer[entry.playerId]}
    />
  );

  return (
    <div className="relative min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_35%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.06),transparent_30%)]" />
      <div className="relative">
        <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-zinc-950/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-3 py-2 sm:gap-6 sm:px-6 xl:px-8">
            <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#22d3ee_0%,#0891b2_55%,#f59e0b_140%)] text-[11px] font-extrabold text-zinc-950 shadow-[0_0_18px_rgba(34,211,238,0.25)] sm:h-8 sm:w-8 sm:rounded-xl sm:text-xs">
                U
              </div>
              <div className="hidden text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--text)] sm:block">
                ULTOPS <span className="text-[var(--accent)]">/</span> SNAPSHOT
              </div>
            </Link>
            <nav aria-label="Primary" className="no-scrollbar flex items-center gap-0.5 overflow-x-auto whitespace-nowrap sm:gap-1.5">
              {NAV.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`${ACTION_CLASS} rounded-md border px-2.5 py-1 text-[11px] font-medium tracking-wide sm:px-3 sm:py-1.5 sm:text-xs ${
                    item.href === '/props'
                      ? 'border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-transparent text-[var(--text-soft)] hover:bg-zinc-900/40 hover:text-[var(--text)]'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-5 sm:px-6 xl:px-8">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--muted)]">NBA props · {boardDateLabel(data.dateEt)}</div>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--text)] sm:text-2xl">Every player prop on the board</h1>
            </div>
            <div className="text-xs tabular-nums text-[var(--text-2)]">
              {data.props.length} lines · {data.games.length} games · refreshed {relativeTime(data.lastUpdatedAt, now)}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  aria-label="Search player or team"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search player or team"
                  className="h-8 w-full rounded-lg border border-[var(--border)] bg-zinc-900/70 pl-8 pr-2.5 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted)] hover:border-zinc-700 focus:border-[var(--accent-border)] sm:max-w-[280px]"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Game" value={game} onChange={(event) => setGame(event.target.value)} className={SELECT_CLASS}>
                  <option value="ALL">All games</option>
                  {data.games
                    .filter((item) => !hideStarted || !startedGames.has(item.key))
                    .map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.awayTeam} @ {item.homeTeam} · {tipTime(item.gameTimeEt)} ({item.propCount})
                      </option>
                    ))}
                </select>
                <select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className={SELECT_CLASS}>
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                    <option key={key} value={key}>
                      Sort: {SORT_LABELS[key]}
                    </option>
                  ))}
                </select>
                <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-zinc-900/70 px-2.5 text-xs text-[var(--text-2)]">
                  <input
                    type="checkbox"
                    checked={hideStarted}
                    onChange={(event) => {
                      setHideStarted(event.target.checked);
                      if (event.target.checked && startedGames.has(game)) setGame('ALL');
                    }}
                    className="accent-[var(--accent)]"
                  />
                  Hide started games
                </label>
              </div>
            </div>
            <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:px-0">
              <button type="button" onClick={() => setMarket('ALL')} className={`${CHIP_CLASS} ${market === 'ALL' ? CHIP_ON : CHIP_OFF}`}>
                All props <span className="tabular-nums opacity-70">{scoped.length}</span>
              </button>
              {PROPS_BOARD_MARKETS.filter((item) => marketCounts.has(item) || market === item).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMarket(item)}
                  className={`${CHIP_CLASS} ${market === item ? CHIP_ON : CHIP_OFF}`}
                >
                  {PROPS_BOARD_MARKET_LABELS[item]} <span className="tabular-nums opacity-70">{marketCounts.get(item) ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 text-xs tabular-nums text-[var(--text-2)]">
            Showing {visible.length} prop{visible.length === 1 ? '' : 's'} for {playerCount} player{playerCount === 1 ? '' : 's'}
            {hideStarted && startedGames.size ? ` · ${startedGames.size} started game${startedGames.size === 1 ? '' : 's'} hidden` : ''}. Tap a
            row for the game log and hit rates against that line.
          </div>

          <div className="mt-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <ColumnHeader />
            {visible.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[var(--text-2)]">
                {data.props.length === 0
                  ? 'No sportsbook lines are on the board yet. Lines usually post the morning of the game.'
                  : hideStarted && upcomingCount === 0
                    ? 'Every game on this slate has started.'
                    : 'No props match these filters.'}
                {hideStarted && startedGames.size && data.props.length ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setHideStarted(false)}
                      className={`${CHIP_CLASS} ${CHIP_OFF}`}
                    >
                      Show started games
                    </button>
                  </div>
                ) : null}
              </div>
            ) : sections ? (
              sections.map(({ game: item, entries }) => (
                <Fragment key={item.key}>
                  <GameHeader game={item} count={entries.length} started={startedGames.has(item.key)} />
                  {entries.map((entry) => renderRow(entry, false))}
                </Fragment>
              ))
            ) : (
              visible.map((entry) => renderRow(entry, true))
            )}
          </div>

          <p className="mt-4 max-w-3xl text-[11px] leading-5 text-[var(--muted)]">
            Lines and odds are the median across books at the last board refresh; odds that are not a valid American price are left
            blank. Projection, gap and lean come from the board model. Across every line on the board, model sides have graded close
            to a coin flip, so treat them as one input next to the game log, not as picks.
          </p>
        </main>
      </div>
    </div>
  );
}

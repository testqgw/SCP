"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  SnapshotDetailResponse,
  SnapshotFiltersResponse,
  SnapshotRow,
  SnapshotTodayResponse,
} from "@/lib/types/snapshot";

const CONFIDENCE_OPTIONS = ["A", "B", "C"];

function getTodayEtDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fmtRate(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

function fmtOdds(value: number | null): string {
  if (value == null) {
    return "-";
  }
  return value > 0 ? `+${value}` : `${value}`;
}

type FilterState = {
  date: string;
  market: string;
  book: string;
  confidence: string;
  team: string;
  player: string;
};

export function SnapshotDashboard(): React.ReactElement {
  const [filters, setFilters] = useState<FilterState>({
    date: getTodayEtDate(),
    market: "",
    book: "",
    confidence: "",
    team: "",
    player: "",
  });
  const [filterMeta, setFilterMeta] = useState<SnapshotFiltersResponse | null>(null);
  const [payload, setPayload] = useState<SnapshotTodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SnapshotRow | null>(null);
  const [detail, setDetail] = useState<SnapshotDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("date", filters.date);
    if (filters.market) params.set("market", filters.market);
    if (filters.book) params.set("book", filters.book);
    if (filters.confidence) params.set("confidence", filters.confidence);
    if (filters.team) params.set("team", filters.team);
    if (filters.player.trim()) params.set("player", filters.player.trim());
    params.set("limit", "150");
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let cancelled = false;

    async function loadFilterMeta(): Promise<void> {
      try {
        const response = await fetch(`/api/snapshot/filters?date=${filters.date}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Failed to load filters (${response.status})`);
        }
        const json = (await response.json()) as SnapshotFiltersResponse;
        if (!cancelled) {
          setFilterMeta(json);
          const teamStillValid = json.teams.some((team) => team.code === filters.team);
          if (filters.team && !teamStillValid) {
            setFilters((prev) => ({ ...prev, team: "" }));
          }
        }
      } catch {
        if (!cancelled) {
          setFilterMeta(null);
        }
      }
    }

    void loadFilterMeta();
    return () => {
      cancelled = true;
    };
  }, [filters.date, filters.team]);

  useEffect(() => {
    let cancelled = false;

    async function loadRows(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/snapshot/today?${queryString}`, { cache: "no-store" });
        const json = (await response.json()) as SnapshotTodayResponse;
        if (!response.ok && response.status !== 503) {
          throw new Error(`Failed to load snapshot (${response.status})`);
        }
        if (!cancelled) {
          setPayload(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load snapshot.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRows();
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const selectedRow = selected;
    let cancelled = false;

    async function loadDetail(): Promise<void> {
      setDetailLoading(true);
      try {
        const response = await fetch(
          `/api/snapshot/player/${selectedRow.playerId}?market=${selectedRow.market}&book=${selectedRow.sportsbook}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(`Failed to load player detail (${response.status})`);
        }
        const json = (await response.json()) as SnapshotDetailResponse;
        if (!cancelled) {
          setDetail(json);
        }
      } catch {
        if (!cancelled) {
          setDetail(null);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function lock(): Promise<void> {
    await fetch("/api/auth/lock", { method: "POST" });
    window.location.href = "/unlock";
  }

  const qualityBlocked = payload?.qualityStatus === "BLOCKED";
  const qualityIssues = payload?.qualityIssues ?? filterMeta?.qualityIssues ?? [];

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-10">
      <section className="glass rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">NBA Prop Snapshot</p>
            <h1 className="title-font mt-2 text-3xl uppercase text-white sm:text-4xl">Today&apos;s Edge Board</h1>
            <p className="mt-2 text-sm text-slate-300">
              Last updated: {payload?.lastUpdatedAt ? new Date(payload.lastUpdatedAt).toLocaleString() : "No data"}
              {payload?.stale ? " (stale >15 min)" : ""}
            </p>
          </div>
          <button
            onClick={lock}
            className="rounded-xl border border-slate-300/25 bg-slate-950/50 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-100/40"
          >
            Lock
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
          <input
            value={filters.date}
            onChange={(event) => setFilters((prev) => ({ ...prev, date: event.target.value }))}
            type="date"
            className="rounded-xl border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
          />
          <select
            value={filters.team}
            onChange={(event) => setFilters((prev) => ({ ...prev, team: event.target.value }))}
            className="rounded-xl border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
          >
            <option value="">All Teams</option>
            {(filterMeta?.teams ?? []).map((team) => (
              <option key={team.code} value={team.code}>
                {team.label}
              </option>
            ))}
          </select>
          <input
            value={filters.player}
            onChange={(event) => setFilters((prev) => ({ ...prev, player: event.target.value }))}
            placeholder="Search player"
            className="rounded-xl border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
          />
          <select
            value={filters.market}
            onChange={(event) => setFilters((prev) => ({ ...prev, market: event.target.value }))}
            className="rounded-xl border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
          >
            <option value="">All Markets</option>
            {(filterMeta?.markets ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={filters.book}
            onChange={(event) => setFilters((prev) => ({ ...prev, book: event.target.value }))}
            className="rounded-xl border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
          >
            <option value="">All Books</option>
            {(filterMeta?.books ?? []).map((book) => (
              <option key={book.key} value={book.key}>
                {book.name}
              </option>
            ))}
          </select>
          <select
            value={filters.confidence}
            onChange={(event) => setFilters((prev) => ({ ...prev, confidence: event.target.value }))}
            className="rounded-xl border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
          >
            <option value="">A/B/C</option>
            {CONFIDENCE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mt-5">
        {loading ? (
          <div className="glass rounded-2xl p-6 text-sm text-slate-300">Loading snapshot...</div>
        ) : error ? (
          <div className="glass rounded-2xl border border-orange-300/40 p-6 text-sm text-orange-200">{error}</div>
        ) : qualityBlocked ? (
          <div className="glass rounded-2xl border border-red-300/35 bg-red-950/25 p-6 text-sm text-red-100">
            <p className="font-semibold uppercase tracking-[0.12em]">Snapshot blocked by data quality gate.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-red-100/95">
              {qualityIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : payload?.rows.length ? (
          <>
            <div className="hidden overflow-hidden rounded-2xl border border-slate-300/15 bg-[#0f1734] lg:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#162249] text-xs uppercase tracking-[0.12em] text-slate-200/80">
                  <tr>
                    <th className="px-4 py-3">Player</th>
                    <th className="px-4 py-3">Matchup</th>
                    <th className="px-4 py-3">Book</th>
                    <th className="px-4 py-3">Market</th>
                    <th className="px-4 py-3">Line</th>
                    <th className="px-4 py-3">Pick</th>
                    <th className="px-4 py-3">Edge</th>
                    <th className="px-4 py-3">L5 Over</th>
                    <th className="px-4 py-3">Bounce</th>
                    <th className="px-4 py-3">Opp Delta</th>
                    <th className="px-4 py-3">Move 24h</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.rows.map((row) => (
                    <tr
                      key={row.edgeId}
                      onClick={() => setSelected(row)}
                      className="cursor-pointer border-t border-slate-300/10 text-slate-100 transition hover:bg-cyan-300/8"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">{row.playerName}</div>
                        <div className="text-xs text-slate-300">{row.gameTimeEt}</div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {row.teamCodeCanonical} vs {row.opponentCodeCanonical}
                      </td>
                      <td className="px-4 py-3">{row.sportsbookName}</td>
                      <td className="px-4 py-3">{row.market}</td>
                      <td className="px-4 py-3">
                        {row.line} ({fmtOdds(row.overPrice)} / {fmtOdds(row.underPrice)})
                      </td>
                      <td className="px-4 py-3 font-bold text-amber-300">{row.recommendedSide}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-cyan-300/20 px-2 py-1 text-xs font-bold text-cyan-100">
                          {row.edgeScore.toFixed(1)} {row.confidence}
                        </span>
                      </td>
                      <td className="px-4 py-3">{fmtRate(row.last5OverRate)}</td>
                      <td className="px-4 py-3">{row.bounceBackFlag ? "YES" : "NO"}</td>
                      <td className="px-4 py-3">{row.opponentAllowanceDelta.toFixed(2)}</td>
                      <td className="px-4 py-3">{row.lineMove24h.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 lg:hidden">
              {payload.rows.map((row) => (
                <article
                  key={row.edgeId}
                  onClick={() => setSelected(row)}
                  className="glass cursor-pointer rounded-2xl p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">{row.playerName}</h2>
                      <p className="text-xs text-slate-300">
                        {row.teamCodeCanonical} vs {row.opponentCodeCanonical} - {row.gameTimeEt}
                      </p>
                    </div>
                    <span className="rounded-full bg-cyan-300/20 px-2 py-1 text-xs font-bold text-cyan-100">
                      {row.edgeScore.toFixed(1)} {row.confidence}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-100">
                    <div>Book: {row.sportsbookName}</div>
                    <div>Market: {row.market}</div>
                    <div>Pick: {row.recommendedSide}</div>
                    <div>L5 Over: {fmtRate(row.last5OverRate)}</div>
                    <div>Bounce: {row.bounceBackFlag ? "YES" : "NO"}</div>
                    <div>Opp Delta: {row.opponentAllowanceDelta.toFixed(2)}</div>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="glass rounded-2xl p-6 text-sm text-slate-300">
            No snapshot rows for selected filters.
          </div>
        )}
      </section>

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="glass max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="title-font text-2xl uppercase text-white">{selected.playerName}</h2>
                <p className="text-sm text-slate-300">
                  {selected.teamCodeCanonical} vs {selected.opponentCodeCanonical} - {selected.market} - {selected.sportsbookName}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded-lg border border-slate-300/30 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800/40"
              >
                Close
              </button>
            </div>

            {detailLoading ? <p className="mt-5 text-sm text-slate-300">Loading player detail...</p> : null}

            {detail ? (
              <div className="mt-5 space-y-6">
                <section>
                  <h3 className="text-xs uppercase tracking-[0.16em] text-cyan-200">Edge Components</h3>
                  {detail.markets.map((marketRow) => (
                    <div key={marketRow.edgeId} className="mt-2 rounded-xl border border-slate-300/15 bg-[#101a38] p-3">
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="font-semibold">{marketRow.market}</span>
                        <span>{marketRow.sportsbookName}</span>
                        <span>{marketRow.recommendedSide}</span>
                        <span>
                          Score {marketRow.edgeScore.toFixed(1)} ({marketRow.confidence})
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-200 sm:grid-cols-4">
                        {Object.entries(marketRow.componentScores).map(([key, value]) => (
                          <div key={key} className="rounded-lg bg-[#182448] px-2 py-1">
                            <span className="block text-[10px] uppercase text-slate-300">{key}</span>
                            <span className="font-semibold">{Number(value).toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-[0.16em] text-cyan-200">Last 10 Games</h3>
                  <div className="mt-2 overflow-hidden rounded-xl border border-slate-300/15">
                    <table className="w-full text-xs">
                      <thead className="bg-[#162249] text-slate-200/80">
                        <tr>
                          <th className="px-2 py-2 text-left">Date</th>
                          <th className="px-2 py-2 text-left">Opp</th>
                          <th className="px-2 py-2 text-left">PTS</th>
                          <th className="px-2 py-2 text-left">REB</th>
                          <th className="px-2 py-2 text-left">AST</th>
                          <th className="px-2 py-2 text-left">MIN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.trends.last10.map((game) => (
                          <tr key={`${game.gameDateEt}-${game.opponent ?? "NA"}`} className="border-t border-slate-300/10">
                            <td className="px-2 py-2">{game.gameDateEt}</td>
                            <td className="px-2 py-2">{game.opponent ?? "-"}</td>
                            <td className="px-2 py-2">{game.points ?? "-"}</td>
                            <td className="px-2 py-2">{game.rebounds ?? "-"}</td>
                            <td className="px-2 py-2">{game.assists ?? "-"}</td>
                            <td className="px-2 py-2">{game.minutes ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-slate-300">
                    Home PTS Avg: {detail.trends.homeAwaySplit.homeAveragePoints ?? "-"} | Away PTS Avg:{" "}
                    {detail.trends.homeAwaySplit.awayAveragePoints ?? "-"}
                  </p>
                </section>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

"use client";

import { useMemo, useState } from "react";
import type { SnapshotBoardData, SnapshotMarket, SnapshotRow } from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

type SnapshotDashboardProps = {
  data: SnapshotBoardData;
  initialMarket: SnapshotMarket;
  initialMatchup: string;
  initialPlayerSearch: string;
};

const MARKET_OPTIONS: Array<{ value: SnapshotMarket; label: string }> = [
  { value: "PTS", label: "Points (PTS)" },
  { value: "REB", label: "Rebounds (REB)" },
  { value: "AST", label: "Assists (AST)" },
  { value: "THREES", label: "3PT Made (THREES)" },
];

function formatStat(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatAverage(value: number | null, withSign = false): string {
  if (value == null) return "-";
  const text = formatStat(value);
  return withSign && value > 0 ? `+${text}` : text;
}

function parseLine(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function valuesByMarket(row: SnapshotRow, market: SnapshotMarket, span: "L5" | "L10"): number[] {
  return span === "L5" ? row.last5[market] : row.last10[market];
}

function hitCounts(values: number[], line: number): { over: number; under: number; push: number } {
  let over = 0;
  let under = 0;
  let push = 0;
  values.forEach((value) => {
    if (value > line) over += 1;
    else if (value < line) under += 1;
    else push += 1;
  });
  return { over, under, push };
}

function lastNAverage(values: number[], n: number): number | null {
  const window = values.slice(0, n);
  if (window.length === 0) return null;
  return round(window.reduce((sum, value) => sum + value, 0) / window.length, 2);
}

export function SnapshotDashboard({
  data,
  initialMarket,
  initialMatchup,
  initialPlayerSearch,
}: SnapshotDashboardProps): React.ReactElement {
  const [matchup, setMatchup] = useState(
    initialMatchup && data.matchups.some((option) => option.key === initialMatchup) ? initialMatchup : "",
  );
  const [market, setMarket] = useState<SnapshotMarket>(initialMarket);
  const [playerSearch, setPlayerSearch] = useState(initialPlayerSearch);
  const [lineMap, setLineMap] = useState<Record<string, string>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<SnapshotRow | null>(null);

  const filteredRows = useMemo(() => {
    const search = playerSearch.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (matchup && row.matchupKey !== matchup) return false;
      if (search && !row.playerName.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [data.rows, matchup, playerSearch]);

  return (
    <main className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6 lg:px-10">
      <section className="glass rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">NBA Data Snapshot</p>
          <h1 className="title-font text-3xl uppercase text-white sm:text-4xl">Today&apos;s Player Data Board</h1>
          <p className="text-sm text-slate-300">
            Unique matchup filter + deeper context for manual bets. No auto picks.
          </p>
          <p className="text-sm text-slate-300">
            Last refresh: {data.lastUpdatedAt ? new Date(data.lastUpdatedAt).toLocaleString() : "No refresh yet"}
          </p>
        </div>

        <form method="GET" className="mt-5 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-col gap-1 text-xs uppercase tracking-[0.12em] text-slate-300/80">
            Date (ET)
            <input
              name="date"
              type="date"
              defaultValue={data.dateEt}
              className="rounded-xl border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
            />
          </label>
          <button
            type="submit"
            className="h-[42px] rounded-xl border border-cyan-300/40 bg-cyan-500/20 px-4 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/30"
          >
            Load Date
          </button>
        </form>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <select
            value={matchup}
            onChange={(event) => setMatchup(event.target.value)}
            className="rounded-xl border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
          >
            <option value="">All Matchups</option>
            {data.matchups.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={market}
            onChange={(event) => setMarket(event.target.value as SnapshotMarket)}
            className="rounded-xl border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
          >
            {MARKET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <input
            value={playerSearch}
            onChange={(event) => setPlayerSearch(event.target.value)}
            placeholder="Search player"
            className="rounded-xl border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
          />
        </div>
      </section>

      <section className="mt-5">
        {filteredRows.length === 0 ? (
          <div className="glass rounded-2xl p-6 text-sm text-slate-300">
            No data found for {data.dateEt}. Try another date.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-300/15 bg-[#0f1734]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1400px] text-left text-sm">
                <thead className="bg-[#162249] text-xs uppercase tracking-[0.12em] text-slate-200/80">
                  <tr>
                    <th className="px-4 py-3">Player</th>
                    <th className="px-4 py-3">Matchup</th>
                    <th className="px-4 py-3">L5</th>
                    <th className="px-4 py-3">L10 Avg</th>
                    <th className="px-4 py-3">Season Avg</th>
                    <th className="px-4 py-3">Home/Away Avg</th>
                    <th className="px-4 py-3">L3 vs Season</th>
                    <th className="px-4 py-3">Opp Allow +/-</th>
                    <th className="px-4 py-3">Your Line</th>
                    <th className="px-4 py-3">L5 O/U</th>
                    <th className="px-4 py-3">L10 O/U</th>
                    <th className="px-4 py-3">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const l5Values = valuesByMarket(row, market, "L5");
                    const l10Values = valuesByMarket(row, market, "L10");
                    const lineKey = `${row.playerId}:${market}`;
                    const lineValue = parseLine(lineMap[lineKey] ?? "");
                    const l5Hits = lineValue == null ? null : hitCounts(l5Values, lineValue);
                    const l10Hits = lineValue == null ? null : hitCounts(l10Values, lineValue);

                    return (
                      <tr key={row.playerId} className="border-t border-slate-300/10 text-slate-100">
                        <td className="px-4 py-3 font-semibold">
                          <div>{row.playerName}</div>
                          <div className="text-xs text-slate-400">{row.position ?? "N/A"}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div>
                            {row.teamCode} vs {row.opponentCode} ({row.isHome ? "Home" : "Away"})
                          </div>
                          <div className="text-slate-400">{row.gameTimeEt}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {l5Values.length ? l5Values.map((value) => formatStat(value)).join(", ") : "No logs"}
                        </td>
                        <td className="px-4 py-3">{formatAverage(row.last10Average[market])}</td>
                        <td className="px-4 py-3">{formatAverage(row.seasonAverage[market])}</td>
                        <td className="px-4 py-3">{formatAverage(row.homeAwayAverage[market])}</td>
                        <td className="px-4 py-3">{formatAverage(row.trendVsSeason[market], true)}</td>
                        <td className="px-4 py-3">{formatAverage(row.opponentAllowanceDelta[market], true)}</td>
                        <td className="px-4 py-3">
                          <input
                            value={lineMap[lineKey] ?? ""}
                            onChange={(event) =>
                              setLineMap((current) => ({
                                ...current,
                                [lineKey]: event.target.value,
                              }))
                            }
                            inputMode="decimal"
                            placeholder="24.5"
                            className="w-20 rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1 text-sm text-white outline-none focus:border-cyan-300/60"
                          />
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {lineValue == null || !l5Hits
                            ? "-"
                            : `${l5Hits.over}/${l5Values.length} O | ${l5Hits.under}/${l5Values.length} U`}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {lineValue == null || !l10Hits
                            ? "-"
                            : `${l10Hits.over}/${l10Values.length} O | ${l10Hits.under}/${l10Values.length} U`}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setSelectedPlayer(row)}
                            className="rounded-lg border border-slate-300/25 px-2 py-1 text-xs text-slate-100 hover:bg-slate-800/35"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {selectedPlayer ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="glass max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="title-font text-2xl uppercase text-white">{selectedPlayer.playerName}</h2>
                <p className="text-sm text-slate-300">
                  {selectedPlayer.teamCode} vs {selectedPlayer.opponentCode} ({selectedPlayer.isHome ? "Home" : "Away"})
                </p>
              </div>
              <button
                onClick={() => setSelectedPlayer(null)}
                className="rounded-lg border border-slate-300/30 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800/40"
              >
                Close
              </button>
            </div>

            <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              {MARKET_OPTIONS.map((option) => {
                const marketKey = option.value;
                const l10Vals = selectedPlayer.last10[marketKey];
                return (
                  <article key={marketKey} className="rounded-xl border border-slate-300/20 bg-[#101938] p-3 text-xs">
                    <p className="text-slate-300">{option.label}</p>
                    <p className="mt-1 text-white">L3 Avg: {formatAverage(selectedPlayer.last3Average[marketKey])}</p>
                    <p className="text-white">L10 Avg: {formatAverage(selectedPlayer.last10Average[marketKey])}</p>
                    <p className="text-white">Season: {formatAverage(selectedPlayer.seasonAverage[marketKey])}</p>
                    <p className="text-white">H/A Avg: {formatAverage(selectedPlayer.homeAwayAverage[marketKey])}</p>
                    <p className="text-white">Trend: {formatAverage(selectedPlayer.trendVsSeason[marketKey], true)}</p>
                    <p className="text-white">Opp +/-: {formatAverage(selectedPlayer.opponentAllowanceDelta[marketKey], true)}</p>
                    <p className="mt-1 text-slate-300">
                      L10: {l10Vals.length ? l10Vals.map((value) => formatStat(value)).join(", ") : "No logs"}
                    </p>
                  </article>
                );
              })}
            </section>

            <section className="mt-5">
              <h3 className="text-xs uppercase tracking-[0.16em] text-cyan-200">Last 10 Completed Games</h3>
              {selectedPlayer.recentLogs.length === 0 ? (
                <p className="mt-3 text-sm text-slate-300">No completed-game logs available yet.</p>
              ) : (
                <div className="mt-2 overflow-hidden rounded-xl border border-slate-300/15">
                  <table className="w-full text-xs">
                    <thead className="bg-[#162249] text-slate-200/80">
                      <tr>
                        <th className="px-2 py-2 text-left">Date</th>
                        <th className="px-2 py-2 text-left">Opp</th>
                        <th className="px-2 py-2 text-left">Site</th>
                        <th className="px-2 py-2 text-left">Min</th>
                        <th className="px-2 py-2 text-left">PTS</th>
                        <th className="px-2 py-2 text-left">REB</th>
                        <th className="px-2 py-2 text-left">AST</th>
                        <th className="px-2 py-2 text-left">3PM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPlayer.recentLogs.map((log, index) => (
                        <tr key={`${log.gameDateEt}-${index}`} className="border-t border-slate-300/10">
                          <td className="px-2 py-2">{log.gameDateEt}</td>
                          <td className="px-2 py-2">{log.opponent ?? "-"}</td>
                          <td className="px-2 py-2">{log.isHome ? "Home" : "Away"}</td>
                          <td className="px-2 py-2">{formatStat(log.minutes)}</td>
                          <td className="px-2 py-2">{formatStat(log.points)}</td>
                          <td className="px-2 py-2">{formatStat(log.rebounds)}</td>
                          <td className="px-2 py-2">{formatStat(log.assists)}</td>
                          <td className="px-2 py-2">{formatStat(log.threes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mt-4 text-xs text-slate-300">
              <p>
                Quick read: L5 avg {formatAverage(lastNAverage(selectedPlayer.last5[market], 5))} | L10 avg{" "}
                {formatAverage(selectedPlayer.last10Average[market])} | Trend{" "}
                {formatAverage(selectedPlayer.trendVsSeason[market], true)} | Opp +/-{" "}
                {formatAverage(selectedPlayer.opponentAllowanceDelta[market], true)}
              </p>
            </section>
          </div>
        </div>
      ) : null}
    </main>
  );
}

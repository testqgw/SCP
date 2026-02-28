"use client";

import { useMemo, useState } from "react";
import type { SnapshotBoardData, SnapshotMarket, SnapshotRow } from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

type SnapshotDashboardProps = {
  data: SnapshotBoardData;
  initialMarket: SnapshotMarket;
  initialTeam: string;
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

function formatAverage(value: number | null): string {
  return value == null ? "-" : formatStat(value);
}

function parseLine(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMarketValues(row: SnapshotRow, market: SnapshotMarket): number[] {
  return row.last5[market];
}

export function SnapshotDashboard({
  data,
  initialMarket,
  initialTeam,
  initialPlayerSearch,
}: SnapshotDashboardProps): React.ReactElement {
  const [team, setTeam] = useState(
    initialTeam && data.teams.some((option) => option.code === initialTeam) ? initialTeam : "",
  );
  const [market, setMarket] = useState<SnapshotMarket>(initialMarket);
  const [playerSearch, setPlayerSearch] = useState(initialPlayerSearch);
  const [lineMap, setLineMap] = useState<Record<string, string>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<SnapshotRow | null>(null);

  const filteredRows = useMemo(() => {
    const search = playerSearch.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (team && row.teamCode !== team) {
        return false;
      }
      if (search && !row.playerName.toLowerCase().includes(search)) {
        return false;
      }
      return true;
    });
  }, [data.rows, playerSearch, team]);

  const marketLabel = MARKET_OPTIONS.find((option) => option.value === market)?.label ?? market;

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-10">
      <section className="glass rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">NBA Data Snapshot</p>
          <h1 className="title-font text-3xl uppercase text-white sm:text-4xl">Today&apos;s Player Data Board</h1>
          <p className="text-sm text-slate-300">
            No auto edges or picks. Enter your own line and compare against completed-game stats.
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
            value={team}
            onChange={(event) => setTeam(event.target.value)}
            className="rounded-xl border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
          >
            <option value="">All Teams Playing</option>
            {data.teams.map((option) => (
              <option key={option.code} value={option.code}>
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
          <>
            <div className="hidden overflow-hidden rounded-2xl border border-slate-300/15 bg-[#0f1734] xl:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#162249] text-xs uppercase tracking-[0.12em] text-slate-200/80">
                  <tr>
                    <th className="px-4 py-3">Player</th>
                    <th className="px-4 py-3">Matchup</th>
                    <th className="px-4 py-3">Time ET</th>
                    <th className="px-4 py-3">L5 {market}</th>
                    <th className="px-4 py-3">L5 Avg</th>
                    <th className="px-4 py-3">Season Avg</th>
                    <th className="px-4 py-3">Your Line</th>
                    <th className="px-4 py-3">L5 Over / Under</th>
                    <th className="px-4 py-3">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const statValues = getMarketValues(row, market);
                    const statAverage =
                      statValues.length > 0
                        ? round(statValues.reduce((sum, value) => sum + value, 0) / statValues.length, 2)
                        : null;
                    const seasonAverage = row.seasonAverage[market];
                    const lineKey = `${row.playerId}:${market}`;
                    const lineValue = parseLine(lineMap[lineKey] ?? "");
                    const overCount =
                      lineValue == null ? null : statValues.filter((value) => value > lineValue).length;
                    const underCount =
                      lineValue == null ? null : statValues.filter((value) => value < lineValue).length;

                    return (
                      <tr key={row.playerId} className="border-t border-slate-300/10 text-slate-100">
                        <td className="px-4 py-3 font-semibold">
                          <div>{row.playerName}</div>
                          <div className="text-xs text-slate-400">{row.position ?? "N/A"}</div>
                        </td>
                        <td className="px-4 py-3">
                          {row.teamCode} vs {row.opponentCode}
                        </td>
                        <td className="px-4 py-3">{row.gameTimeEt}</td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {statValues.length ? statValues.map((value) => formatStat(value)).join(", ") : "No logs"}
                        </td>
                        <td className="px-4 py-3">{formatAverage(statAverage)}</td>
                        <td className="px-4 py-3">{formatAverage(seasonAverage)}</td>
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
                            placeholder="e.g. 24.5"
                            className="w-24 rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1 text-sm text-white outline-none focus:border-cyan-300/60"
                          />
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {lineValue == null
                            ? "-"
                            : `${overCount ?? 0}/${statValues.length} over | ${underCount ?? 0}/${statValues.length} under`}
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

            <div className="space-y-3 xl:hidden">
              {filteredRows.map((row) => {
                const statValues = getMarketValues(row, market);
                const statAverage =
                  statValues.length > 0
                    ? round(statValues.reduce((sum, value) => sum + value, 0) / statValues.length, 2)
                    : null;
                const seasonAverage = row.seasonAverage[market];
                const lineKey = `${row.playerId}:${market}`;
                const lineValue = parseLine(lineMap[lineKey] ?? "");
                const overCount = lineValue == null ? null : statValues.filter((value) => value > lineValue).length;
                const underCount = lineValue == null ? null : statValues.filter((value) => value < lineValue).length;

                return (
                  <article key={row.playerId} className="glass rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold text-white">{row.playerName}</h2>
                        <p className="text-xs text-slate-300">
                          {row.teamCode} vs {row.opponentCode} - {row.gameTimeEt}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">{row.position ?? "N/A"}</p>
                      </div>
                      <button
                        onClick={() => setSelectedPlayer(row)}
                        className="rounded-lg border border-slate-300/25 px-2 py-1 text-xs text-slate-100"
                      >
                        View
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <p className="text-slate-300">Market: {marketLabel}</p>
                      <p className="text-slate-300">L5 Avg: {formatAverage(statAverage)}</p>
                      <p className="col-span-2 text-slate-300">
                        L5 {market}: {statValues.length ? statValues.map((value) => formatStat(value)).join(", ") : "No logs"}
                      </p>
                      <p className="text-slate-300">Season Avg: {formatAverage(seasonAverage)}</p>
                      <p className="text-slate-300">
                        Hit Count:{" "}
                        {lineValue == null
                          ? "Set your line"
                          : `${overCount ?? 0}/${statValues.length} over | ${underCount ?? 0}/${statValues.length} under`}
                      </p>
                    </div>

                    <input
                      value={lineMap[lineKey] ?? ""}
                      onChange={(event) =>
                        setLineMap((current) => ({
                          ...current,
                          [lineKey]: event.target.value,
                        }))
                      }
                      inputMode="decimal"
                      placeholder="Enter your line"
                      className="mt-3 w-full rounded-lg border border-slate-300/20 bg-[#0d1630] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                    />
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      {selectedPlayer ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="glass max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="title-font text-2xl uppercase text-white">{selectedPlayer.playerName}</h2>
                <p className="text-sm text-slate-300">
                  {selectedPlayer.teamCode} vs {selectedPlayer.opponentCode}
                </p>
              </div>
              <button
                onClick={() => setSelectedPlayer(null)}
                className="rounded-lg border border-slate-300/30 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800/40"
              >
                Close
              </button>
            </div>

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
          </div>
        </div>
      ) : null}
    </main>
  );
}

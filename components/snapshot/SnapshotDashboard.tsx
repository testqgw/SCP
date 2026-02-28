"use client";

import { useEffect, useMemo, useState } from "react";
import type { SnapshotBoardData, SnapshotMarket, SnapshotRow } from "@/lib/types/snapshot";

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
  { value: "PRA", label: "PRA" },
  { value: "PA", label: "PA" },
  { value: "PR", label: "PR" },
  { value: "RA", label: "RA" },
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

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lineKey(playerId: string, market: SnapshotMarket): string {
  return `${playerId}:${market}`;
}

function edge(offense: number | null, defenseAllowed: number | null): number | null {
  if (offense == null || defenseAllowed == null) return null;
  return offense - defenseAllowed;
}

function marketValueFromLog(
  log: SnapshotRow["recentLogs"][number],
  market: SnapshotMarket,
): number {
  if (market === "PTS") return log.points;
  if (market === "REB") return log.rebounds;
  if (market === "AST") return log.assists;
  if (market === "THREES") return log.threes;
  if (market === "PRA") return log.points + log.rebounds + log.assists;
  if (market === "PA") return log.points + log.assists;
  if (market === "PR") return log.points + log.rebounds;
  return log.rebounds + log.assists;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return "-";
  const pct = (numerator / denominator) * 100;
  return `${pct.toFixed(0)}%`;
}

function resultLabel(value: number, line: number): "OVER" | "UNDER" | "PUSH" {
  if (value > line) return "OVER";
  if (value < line) return "UNDER";
  return "PUSH";
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
  const [focusedMarket, setFocusedMarket] = useState<SnapshotMarket>(initialMarket);

  useEffect(() => {
    if (!selectedPlayer) {
      setFocusedMarket(market);
    }
  }, [selectedPlayer, market]);

  const matchupStatsByKey = useMemo(() => {
    const map = new Map<string, SnapshotBoardData["teamMatchups"][number]>();
    data.teamMatchups.forEach((item) => map.set(item.matchupKey, item));
    return map;
  }, [data.teamMatchups]);

  const filteredRows = useMemo(() => {
    const search = playerSearch.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (matchup && row.matchupKey !== matchup) return false;
      if (search && !row.playerName.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [data.rows, matchup, playerSearch]);

  const filteredTeamMatchups = useMemo(() => {
    if (!matchup) return data.teamMatchups;
    return data.teamMatchups.filter((item) => item.matchupKey === matchup);
  }, [data.teamMatchups, matchup]);

  return (
    <main className="mx-auto max-w-[1680px] px-4 py-6 sm:px-6 lg:px-10">
      <section className="glass rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">NBA Data Snapshot</p>
          <h1 className="title-font text-3xl uppercase text-white sm:text-4xl">Today&apos;s Player Data Board</h1>
          <p className="text-sm text-slate-300">
            Manual betting board: composite markets + full player detail + team matchup context.
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
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-cyan-200">Team Matchup Stats</h2>
        {filteredTeamMatchups.length === 0 ? (
          <div className="glass rounded-2xl p-5 text-sm text-slate-300">No matchup stats available.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredTeamMatchups.map((item) => {
              const awayEdge = edge(item.awayLast10For[market], item.homeLast10Allowed[market]);
              const homeEdge = edge(item.homeLast10For[market], item.awayLast10Allowed[market]);
              return (
                <article key={item.matchupKey} className="glass rounded-2xl p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-cyan-200">{item.matchupKey}</p>
                  <p className="text-xs text-slate-400">{item.gameTimeEt}</p>

                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl border border-slate-300/20 bg-[#101938] p-3">
                      <p className="font-semibold text-white">{item.awayTeam}</p>
                      <p className="text-slate-300">
                        Record: {item.awaySeasonRecord.wins}-{item.awaySeasonRecord.losses} (L10 {item.awayLast10Record.wins}-{item.awayLast10Record.losses})
                      </p>
                      <p className="text-slate-300">
                        For ({market}): {formatAverage(item.awaySeasonFor[market])} | L10 {formatAverage(item.awayLast10For[market])}
                      </p>
                      <p className="text-slate-300">
                        Allowed ({market}): {formatAverage(item.awaySeasonAllowed[market])} | L10 {formatAverage(item.awayLast10Allowed[market])}
                      </p>
                      <p className="text-slate-300">
                        Attack vs Opp D: {formatAverage(awayEdge, true)}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-300/20 bg-[#101938] p-3">
                      <p className="font-semibold text-white">{item.homeTeam}</p>
                      <p className="text-slate-300">
                        Record: {item.homeSeasonRecord.wins}-{item.homeSeasonRecord.losses} (L10 {item.homeLast10Record.wins}-{item.homeLast10Record.losses})
                      </p>
                      <p className="text-slate-300">
                        For ({market}): {formatAverage(item.homeSeasonFor[market])} | L10 {formatAverage(item.homeLast10For[market])}
                      </p>
                      <p className="text-slate-300">
                        Allowed ({market}): {formatAverage(item.homeSeasonAllowed[market])} | L10 {formatAverage(item.homeLast10Allowed[market])}
                      </p>
                      <p className="text-slate-300">
                        Attack vs Opp D: {formatAverage(homeEdge, true)}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-cyan-200">Player Snapshot</h2>
        {filteredRows.length === 0 ? (
          <div className="glass rounded-2xl p-6 text-sm text-slate-300">
            No players found for selected filters.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-300/15 bg-[#0f1734]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1300px] text-left text-sm">
                <thead className="bg-[#162249] text-xs uppercase tracking-[0.12em] text-slate-200/80">
                  <tr>
                    <th className="px-4 py-3">Player</th>
                    <th className="px-4 py-3">Matchup</th>
                    <th className="px-4 py-3">L5 {market}</th>
                    <th className="px-4 py-3">L10 Avg</th>
                    <th className="px-4 py-3">Season Avg</th>
                    <th className="px-4 py-3">Trend</th>
                    <th className="px-4 py-3">Opp +/-</th>
                    <th className="px-4 py-3">Your Line</th>
                    <th className="px-4 py-3">L10 O/U</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const l5Values = row.last5[market];
                    const l10Values = row.last10[market];
                    const currentLine = parseLine(lineMap[lineKey(row.playerId, market)] ?? "");
                    const l10Hit = currentLine == null ? null : hitCounts(l10Values, currentLine);

                    return (
                      <tr
                        key={row.playerId}
                        onClick={() => {
                          setFocusedMarket(market);
                          setSelectedPlayer(row);
                        }}
                        className="cursor-pointer border-t border-slate-300/10 text-slate-100 hover:bg-cyan-300/8"
                      >
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
                        <td className="px-4 py-3">{formatAverage(row.trendVsSeason[market], true)}</td>
                        <td className="px-4 py-3">{formatAverage(row.opponentAllowanceDelta[market], true)}</td>
                        <td className="px-4 py-3">
                          <input
                            value={lineMap[lineKey(row.playerId, market)] ?? ""}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              setLineMap((current) => ({
                                ...current,
                                [lineKey(row.playerId, market)]: event.target.value,
                              }))
                            }
                            inputMode="decimal"
                            placeholder="24.5"
                            className="w-20 rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1 text-sm text-white outline-none focus:border-cyan-300/60"
                          />
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {currentLine == null || !l10Hit
                            ? "-"
                            : `${l10Hit.over}/${l10Values.length} O | ${l10Hit.under}/${l10Values.length} U`}
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
          <div className="glass max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="title-font text-2xl uppercase text-white">{selectedPlayer.playerName}</h2>
                <p className="text-sm text-slate-300">
                  {selectedPlayer.teamCode} vs {selectedPlayer.opponentCode} ({selectedPlayer.isHome ? "Home" : "Away"})
                </p>
                <p className="text-xs text-slate-400">{selectedPlayer.gameTimeEt}</p>
              </div>
              <button
                onClick={() => setSelectedPlayer(null)}
                className="rounded-lg border border-slate-300/30 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800/40"
              >
                Close
              </button>
            </div>

            <section className="mt-5">
              <h3 className="text-xs uppercase tracking-[0.16em] text-cyan-200">All Markets Detail</h3>
              <p className="mt-1 text-xs text-slate-400">
                Click any market card to open a full breakdown against your typed line.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {MARKET_OPTIONS.map((option) => {
                  const m = option.value;
                  const l5 = selectedPlayer.last5[m];
                  const l10 = selectedPlayer.last10[m];
                  const key = lineKey(selectedPlayer.playerId, m);
                  const selectedLine = parseLine(lineMap[key] ?? "");
                  const l5Hit = selectedLine == null ? null : hitCounts(l5, selectedLine);
                  const l10Hit = selectedLine == null ? null : hitCounts(l10, selectedLine);
                  const isFocused = focusedMarket === m;
                  return (
                    <article
                      key={m}
                      onClick={() => setFocusedMarket(m)}
                      className={`cursor-pointer rounded-xl border p-3 text-xs transition ${
                        isFocused
                          ? "border-cyan-300/70 bg-cyan-400/10"
                          : "border-slate-300/20 bg-[#101938] hover:border-cyan-200/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-white">{option.label}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                            isFocused ? "bg-cyan-300/20 text-cyan-100" : "bg-slate-600/30 text-slate-300"
                          }`}
                        >
                          {isFocused ? "Selected" : "View"}
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-300">
                        <p>L3 Avg</p>
                        <p className="text-right">{formatAverage(selectedPlayer.last3Average[m])}</p>
                        <p>L10 Avg</p>
                        <p className="text-right">{formatAverage(selectedPlayer.last10Average[m])}</p>
                        <p>Season</p>
                        <p className="text-right">{formatAverage(selectedPlayer.seasonAverage[m])}</p>
                        <p>Home/Away</p>
                        <p className="text-right">{formatAverage(selectedPlayer.homeAwayAverage[m])}</p>
                        <p>Trend</p>
                        <p className="text-right">{formatAverage(selectedPlayer.trendVsSeason[m], true)}</p>
                        <p>Opp +/-</p>
                        <p className="text-right">{formatAverage(selectedPlayer.opponentAllowanceDelta[m], true)}</p>
                      </div>

                      <p className="mt-2 text-[11px] text-slate-300">
                        L5 Values: {l5.length ? l5.map((v) => formatStat(v)).join(", ") : "-"}
                      </p>

                      <input
                        value={lineMap[key] ?? ""}
                        onClick={(event) => event.stopPropagation()}
                        onFocus={() => setFocusedMarket(m)}
                        onChange={(event) =>
                          setLineMap((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        inputMode="decimal"
                        placeholder="Set line"
                        className="mt-2 w-full rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/60"
                      />

                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                        <p className="rounded-md bg-[#0d1630] px-2 py-1 text-slate-300">
                          L5 O/U:{" "}
                          {selectedLine == null || !l5Hit ? "-" : `${l5Hit.over}/${l5.length} O | ${l5Hit.under}/${l5.length} U`}
                        </p>
                        <p className="rounded-md bg-[#0d1630] px-2 py-1 text-slate-300">
                          L10 O/U:{" "}
                          {selectedLine == null || !l10Hit
                            ? "-"
                            : `${l10Hit.over}/${l10.length} O | ${l10Hit.under}/${l10.length} U`}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>

              {(() => {
                const m = focusedMarket;
                const key = lineKey(selectedPlayer.playerId, m);
                const selectedLine = parseLine(lineMap[key] ?? "");
                const l5 = selectedPlayer.last5[m];
                const l10 = selectedPlayer.last10[m];
                const l5Hit = selectedLine == null ? null : hitCounts(l5, selectedLine);
                const l10Hit = selectedLine == null ? null : hitCounts(l10, selectedLine);
                const focusedLabel = MARKET_OPTIONS.find((option) => option.value === m)?.label ?? m;
                const l3VsLine =
                  selectedLine == null || selectedPlayer.last3Average[m] == null ? null : selectedPlayer.last3Average[m] - selectedLine;
                const l10VsLine =
                  selectedLine == null || selectedPlayer.last10Average[m] == null ? null : selectedPlayer.last10Average[m] - selectedLine;
                const seasonVsLine =
                  selectedLine == null || selectedPlayer.seasonAverage[m] == null ? null : selectedPlayer.seasonAverage[m] - selectedLine;

                return (
                  <article className="mt-4 rounded-xl border border-cyan-300/30 bg-[#0c1533] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-cyan-100">{focusedLabel} Analyzer</h4>
                      <p className="text-[11px] text-slate-400">Line-based breakdown for the selected market.</p>
                    </div>

                    <div className="mt-3 grid gap-3 lg:grid-cols-[280px_1fr]">
                      <div className="rounded-lg border border-slate-300/20 bg-[#101938] p-3">
                        <label className="text-[11px] uppercase tracking-[0.12em] text-slate-300">
                          Your line
                          <input
                            value={lineMap[key] ?? ""}
                            onChange={(event) =>
                              setLineMap((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            inputMode="decimal"
                            placeholder="Set line"
                            className="mt-1 w-full rounded-lg border border-slate-300/20 bg-[#0d1630] px-2 py-1.5 text-sm text-white outline-none focus:border-cyan-300/60"
                          />
                        </label>

                        <div className="mt-3 space-y-1 text-xs text-slate-300">
                          <p className="flex items-center justify-between">
                            <span>L3 Avg</span>
                            <span>{formatAverage(selectedPlayer.last3Average[m])}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>L10 Avg</span>
                            <span>{formatAverage(selectedPlayer.last10Average[m])}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>Season Avg</span>
                            <span>{formatAverage(selectedPlayer.seasonAverage[m])}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>Home/Away Avg</span>
                            <span>{formatAverage(selectedPlayer.homeAwayAverage[m])}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>Trend vs Season</span>
                            <span>{formatAverage(selectedPlayer.trendVsSeason[m], true)}</span>
                          </p>
                          <p className="flex items-center justify-between">
                            <span>Opp +/-</span>
                            <span>{formatAverage(selectedPlayer.opponentAllowanceDelta[m], true)}</span>
                          </p>
                        </div>

                        {selectedLine == null ? (
                          <p className="mt-3 rounded-lg bg-[#0d1630] px-2 py-2 text-xs text-slate-300">
                            Enter a line to see over/under rates and per-game comparisons.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-1 rounded-lg bg-[#0d1630] px-2 py-2 text-xs text-slate-200">
                            <p>
                              L5: {l5Hit?.over ?? 0}/{l5.length} OVER ({formatPercent(l5Hit?.over ?? 0, l5.length)}) |{" "}
                              {l5Hit?.under ?? 0}/{l5.length} UNDER ({formatPercent(l5Hit?.under ?? 0, l5.length)})
                            </p>
                            <p>
                              L10: {l10Hit?.over ?? 0}/{l10.length} OVER ({formatPercent(l10Hit?.over ?? 0, l10.length)}) |{" "}
                              {l10Hit?.under ?? 0}/{l10.length} UNDER ({formatPercent(l10Hit?.under ?? 0, l10.length)})
                            </p>
                            <p>L3 Avg vs line: {formatAverage(l3VsLine, true)}</p>
                            <p>L10 Avg vs line: {formatAverage(l10VsLine, true)}</p>
                            <p>Season Avg vs line: {formatAverage(seasonVsLine, true)}</p>
                          </div>
                        )}
                      </div>

                      <div className="overflow-hidden rounded-lg border border-slate-300/20">
                        <table className="w-full text-xs">
                          <thead className="bg-[#162249] text-slate-200/80">
                            <tr>
                              <th className="px-2 py-2 text-left">Date</th>
                              <th className="px-2 py-2 text-left">Opp</th>
                              <th className="px-2 py-2 text-left">Site</th>
                              <th className="px-2 py-2 text-left">Min</th>
                              <th className="px-2 py-2 text-left">{m}</th>
                              <th className="px-2 py-2 text-left">Vs line</th>
                              <th className="px-2 py-2 text-left">Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedPlayer.recentLogs.length === 0 ? (
                              <tr className="border-t border-slate-300/10">
                                <td colSpan={7} className="px-2 py-3 text-slate-300">
                                  No completed-game logs available yet.
                                </td>
                              </tr>
                            ) : (
                              selectedPlayer.recentLogs.map((log, index) => {
                                const value = marketValueFromLog(log, m);
                                const diff = selectedLine == null ? null : value - selectedLine;
                                const result = selectedLine == null ? null : resultLabel(value, selectedLine);
                                return (
                                  <tr key={`${m}-${log.gameDateEt}-${index}`} className="border-t border-slate-300/10">
                                    <td className="px-2 py-2">{log.gameDateEt}</td>
                                    <td className="px-2 py-2">{log.opponent ?? "-"}</td>
                                    <td className="px-2 py-2">{log.isHome ? "Home" : "Away"}</td>
                                    <td className="px-2 py-2">{formatStat(log.minutes)}</td>
                                    <td className="px-2 py-2 font-semibold text-white">{formatStat(value)}</td>
                                    <td className="px-2 py-2">{diff == null ? "-" : formatAverage(diff, true)}</td>
                                    <td
                                      className={`px-2 py-2 font-semibold ${
                                        result === "OVER"
                                          ? "text-emerald-300"
                                          : result === "UNDER"
                                            ? "text-amber-300"
                                            : result === "PUSH"
                                              ? "text-cyan-200"
                                              : "text-slate-300"
                                      }`}
                                    >
                                      {result ?? "-"}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </article>
                );
              })()}
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
                        <th className="px-2 py-2 text-left">PRA</th>
                        <th className="px-2 py-2 text-left">PA</th>
                        <th className="px-2 py-2 text-left">PR</th>
                        <th className="px-2 py-2 text-left">RA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPlayer.recentLogs.map((log, index) => {
                        const pra = log.points + log.rebounds + log.assists;
                        const pa = log.points + log.assists;
                        const pr = log.points + log.rebounds;
                        const ra = log.rebounds + log.assists;
                        return (
                          <tr key={`${log.gameDateEt}-${index}`} className="border-t border-slate-300/10">
                            <td className="px-2 py-2">{log.gameDateEt}</td>
                            <td className="px-2 py-2">{log.opponent ?? "-"}</td>
                            <td className="px-2 py-2">{log.isHome ? "Home" : "Away"}</td>
                            <td className="px-2 py-2">{formatStat(log.minutes)}</td>
                            <td className="px-2 py-2">{formatStat(log.points)}</td>
                            <td className="px-2 py-2">{formatStat(log.rebounds)}</td>
                            <td className="px-2 py-2">{formatStat(log.assists)}</td>
                            <td className="px-2 py-2">{formatStat(log.threes)}</td>
                            <td className="px-2 py-2">{formatStat(pra)}</td>
                            <td className="px-2 py-2">{formatStat(pa)}</td>
                            <td className="px-2 py-2">{formatStat(pr)}</td>
                            <td className="px-2 py-2">{formatStat(ra)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mt-4 text-xs text-slate-300">
              <p>
                Quick read ({market}): L5 avg {formatAverage(average(selectedPlayer.last5[market]))} | L10 avg{" "}
                {formatAverage(selectedPlayer.last10Average[market])} | Trend {formatAverage(selectedPlayer.trendVsSeason[market], true)} | Opp +/-{" "}
                {formatAverage(selectedPlayer.opponentAllowanceDelta[market], true)}
              </p>
            </section>

            {matchupStatsByKey.has(selectedPlayer.matchupKey) ? (
              <section className="mt-4 rounded-xl border border-slate-300/20 bg-[#101938] p-3 text-xs">
                {(() => {
                  const item = matchupStatsByKey.get(selectedPlayer.matchupKey)!;
                  const teamIsAway = selectedPlayer.teamCode === item.awayTeam;
                  const teamFor = teamIsAway ? item.awayLast10For[market] : item.homeLast10For[market];
                  const oppAllowed = teamIsAway ? item.homeLast10Allowed[market] : item.awayLast10Allowed[market];
                  return (
                    <p className="text-slate-300">
                      Team context ({selectedPlayer.teamCode} {market}): L10 offense {formatAverage(teamFor)} vs opponent L10 allowed {formatAverage(oppAllowed)} | edge{" "}
                      {formatAverage(edge(teamFor, oppAllowed), true)}
                    </p>
                  );
                })()}
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

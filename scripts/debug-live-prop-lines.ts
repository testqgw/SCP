import {
  fetchDailyAstLineMap,
  fetchDailyPaLineMap,
  fetchDailyPraLineMap,
  fetchDailyPrLineMap,
  fetchDailyPtsLineMap,
  fetchDailyRaLineMap,
  fetchDailyRebLineMap,
  fetchDailyThreesLineMap,
} from "../lib/snapshot/pointsContext";
import { getTodayEtDateString } from "../lib/snapshot/time";

type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";

async function main(): Promise<void> {
  const dateEt = process.argv[2] ?? getTodayEtDateString();
  const loaders: Array<[Market, () => Promise<Map<string, { source: string }>>]> = [
    ["PTS", () => fetchDailyPtsLineMap(dateEt)],
    ["REB", () => fetchDailyRebLineMap(dateEt)],
    ["AST", () => fetchDailyAstLineMap(dateEt)],
    ["THREES", () => fetchDailyThreesLineMap(dateEt)],
    ["PRA", () => fetchDailyPraLineMap(dateEt)],
    ["PA", () => fetchDailyPaLineMap(dateEt)],
    ["PR", () => fetchDailyPrLineMap(dateEt)],
    ["RA", () => fetchDailyRaLineMap(dateEt)],
  ];

  const summary = [];
  for (const [market, loadMap] of loaders) {
    const map = await loadMap();
    const values = [...map.values()];
    const bySource = values.reduce<Record<string, number>>((acc, value) => {
      acc[value.source] = (acc[value.source] ?? 0) + 1;
      return acc;
    }, {});
    summary.push({
      market,
      count: map.size,
      bySource,
      sample: [...map.entries()].slice(0, 5).map(([key, value]) => ({
        key,
        line: (value as { line?: number }).line ?? null,
        sportsbookCount: (value as { sportsbookCount?: number }).sportsbookCount ?? null,
        source: value.source,
      })),
    });
  }

  console.log(
    JSON.stringify(
      {
        dateEt,
        summary,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

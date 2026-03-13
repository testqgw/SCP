import path from "node:path";

export const DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH = path.join("exports", "universal-archetype-side-models-live.json");
export const DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH = path.join(
  "exports",
  "universal-archetype-side-models-2025-10-23-to-2026-03-09-v16-bench-split.json",
);
export const DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH = path.join("exports", "universal-live-calibration.json");
export const DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH = path.join("exports", "projection-backtest-allplayers-with-rows-live.json");
export const DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH = path.join(
  "exports",
  "projection-backtest-allplayers-with-rows-2025-10-23-to-2026-03-09.json",
);
export const DEFAULT_UNIVERSAL_LIVE_LINES_RELATIVE_PATH = path.join(
  "exports",
  "historical-lines",
  "all-players-all-markets-live.csv",
);
export const DEFAULT_UNIVERSAL_LIVE_LINES_FALLBACK_RELATIVE_PATH = path.join(
  "exports",
  "historical-lines",
  "all-players-all-markets-2025-10-23-to-2026-03-09.csv",
);

export function resolveProjectPath(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}

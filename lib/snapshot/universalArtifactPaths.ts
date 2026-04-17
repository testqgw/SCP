import fs from "node:fs";
import path from "node:path";

export const DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH = path.join("exports", "universal-archetype-side-models-live.json");
export const DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH = path.join(
  "exports",
  "universal-archetype-side-models-2025-10-23-to-2026-03-09-v16-bench-split.json",
);
export const DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH = path.join("exports", "universal-live-calibration.json");
export const DEFAULT_UNIVERSAL_LIVE_PROJECTION_DISTRIBUTION_RELATIVE_PATH = path.join(
  "exports",
  "universal-live-projection-distribution.json",
);
export const DEFAULT_UNIVERSAL_LIVE_QUALIFICATION_SETTINGS_RELATIVE_PATH = path.join(
  "exports",
  "universal-live-qualification-settings.json",
);
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

const CURRENT_ROWS_FILE_PATTERN =
  /^projection-backtest-allplayers-with-rows-\d{4}-\d{2}-\d{2}-to-(\d{4}-\d{2}-\d{2})-current\.json$/;

export function resolvePreferredUniversalLiveRowsRelativePath(): string {
  const exportsDir = resolveProjectPath("exports");

  try {
    const currentCandidates = fs
      .readdirSync(exportsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const match = entry.name.match(CURRENT_ROWS_FILE_PATTERN);
        if (!match) return null;
        return {
          fileName: entry.name,
          endDate: match[1],
        };
      })
      .filter((entry): entry is { fileName: string; endDate: string } => entry != null)
      .sort((left, right) => left.endDate.localeCompare(right.endDate));

    const latestCurrent = currentCandidates[currentCandidates.length - 1];
    if (latestCurrent) {
      return path.join("exports", latestCurrent.fileName);
    }
  } catch {
    // Fall through to the legacy live alias when the audited current file set is unavailable.
  }

  return DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH;
}

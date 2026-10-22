// Pure schedule-source selection for NBA_DATA_SOURCE. No runtime imports so `node --test` can load it.

export type NbaDataSourceMode = "nba" | "espn" | "auto";
export type NbaDataSourceName = "nba_official" | "espn";

/** Unset or unknown values keep the original NBA CDN behaviour; ESPN is opt-in. */
export function parseNbaDataSourceMode(value: string | undefined | null): NbaDataSourceMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "espn" || normalized === "auto" || normalized === "nba") {
    return normalized;
  }
  return "nba";
}

export type ScheduleAttempt<T> = () => Promise<T>;

/**
 * Runs the schedule fetch for the configured mode. "auto" tries the NBA CDN first and falls back to
 * ESPN on any failure (cdn.nba.com 403s from Vercel); the NBA error is returned as a warning.
 */
export async function selectScheduleSource<T>(
  mode: NbaDataSourceMode,
  attempts: { nba: ScheduleAttempt<T>; espn: ScheduleAttempt<T> },
): Promise<{ result: T; source: NbaDataSourceName; warnings: string[] }> {
  if (mode === "espn") {
    return { result: await attempts.espn(), source: "espn", warnings: [] };
  }
  if (mode === "nba") {
    return { result: await attempts.nba(), source: "nba_official", warnings: [] };
  }

  try {
    return { result: await attempts.nba(), source: "nba_official", warnings: [] };
  } catch (nbaError) {
    const reason = nbaError instanceof Error ? nbaError.message : "unknown NBA schedule error";
    try {
      return {
        result: await attempts.espn(),
        source: "espn",
        warnings: [`NBA schedule unavailable; using ESPN fallback feed. ${reason}`],
      };
    } catch (espnError) {
      const espnReason = espnError instanceof Error ? espnError.message : "unknown ESPN schedule error";
      throw new Error(`NBA and ESPN schedules both unavailable. NBA: ${reason} ESPN: ${espnReason}`);
    }
  }
}

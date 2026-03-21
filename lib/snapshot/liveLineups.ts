import {
  fetchRotowireLineups,
  parseStoredRotowireLineupSnapshot,
  type RotowireLineupSnapshot,
} from "@/lib/lineups/rotowire";
import { prisma } from "@/lib/prisma";
import { getTodayEtDateString } from "@/lib/snapshot/time";

type MaybeRefreshTodayLineupSnapshotInput = {
  dateEt: string;
  currentValue: unknown;
  currentUpdatedAt: Date | null;
};

type MaybeRefreshTodayLineupSnapshotResult = {
  snapshot: RotowireLineupSnapshot | null;
  updatedAt: Date | null;
};

const TODAY_LINEUP_REFRESH_TTL_MS = (() => {
  const parsed = Number(process.env.SNAPSHOT_TODAY_LINEUP_REFRESH_TTL_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20 * 60_000;
  return Math.min(Math.max(5 * 60_000, Math.floor(parsed)), 90 * 60_000);
})();

const inFlightTodayLineupRefresh = new Map<string, Promise<MaybeRefreshTodayLineupSnapshotResult>>();

export async function maybeRefreshTodayLineupSnapshot(
  input: MaybeRefreshTodayLineupSnapshotInput,
): Promise<MaybeRefreshTodayLineupSnapshotResult> {
  const parsedSnapshot = parseStoredRotowireLineupSnapshot(input.currentValue, input.dateEt);
  if (input.dateEt !== getTodayEtDateString()) {
    return {
      snapshot: parsedSnapshot,
      updatedAt: input.currentUpdatedAt,
    };
  }

  const isFresh =
    parsedSnapshot != null &&
    input.currentUpdatedAt != null &&
    Date.now() - input.currentUpdatedAt.getTime() <= TODAY_LINEUP_REFRESH_TTL_MS;
  if (isFresh) {
    return {
      snapshot: parsedSnapshot,
      updatedAt: input.currentUpdatedAt,
    };
  }

  const existing = inFlightTodayLineupRefresh.get(input.dateEt);
  if (existing) return existing;

  const task = (async () => {
    try {
      const snapshot = await fetchRotowireLineups();
      await prisma.systemSetting.upsert({
        where: { key: "snapshot_lineups_today" },
        update: {
          value: {
            dateEt: input.dateEt,
            ...snapshot,
          },
        },
        create: {
          key: "snapshot_lineups_today",
          value: {
            dateEt: input.dateEt,
            ...snapshot,
          },
        },
      });

      return {
        snapshot,
        updatedAt: new Date(snapshot.fetchedAt),
      };
    } catch {
      return {
        snapshot: parsedSnapshot,
        updatedAt: input.currentUpdatedAt,
      };
    } finally {
      inFlightTodayLineupRefresh.delete(input.dateEt);
    }
  })();

  inFlightTodayLineupRefresh.set(input.dateEt, task);
  return task;
}

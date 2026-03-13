import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { etDateShift, getTodayEtDateString } from "@/lib/snapshot/time";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const todayEt = getTodayEtDateString();
    const yesterdayEt = etDateShift(todayEt, -1);
    const [lastRun, lastPublishableRun, lastRefreshSetting, lineupSnapshotSetting, maxLog, yesterdayLogCount, todayLogCount] =
      await Promise.all([
        prisma.refreshRun.findFirst({
          orderBy: [{ startedAt: "desc" }],
          select: {
            id: true,
            type: true,
            status: true,
            startedAt: true,
            completedAt: true,
            warningCount: true,
            errorCount: true,
            isPublishable: true,
            qualityIssues: true,
          },
        }),
        prisma.refreshRun.findFirst({
          where: { isPublishable: true },
          orderBy: [{ startedAt: "desc" }],
          select: {
            id: true,
            type: true,
            status: true,
            startedAt: true,
            completedAt: true,
            warningCount: true,
            errorCount: true,
            isPublishable: true,
            qualityIssues: true,
          },
        }),
        prisma.systemSetting.findUnique({
          where: { key: "snapshot_last_refresh" },
          select: { value: true, updatedAt: true },
        }),
        prisma.systemSetting.findUnique({
          where: { key: "snapshot_lineups_today" },
          select: { updatedAt: true },
        }),
        prisma.playerGameLog.aggregate({
          _max: {
            gameDateEt: true,
            updatedAt: true,
          },
        }),
        prisma.playerGameLog.count({
          where: { gameDateEt: yesterdayEt },
        }),
        prisma.playerGameLog.count({
          where: { gameDateEt: todayEt },
        }),
      ]);

    const maxLogDateEt = maxLog._max.gameDateEt ?? null;
    const maxLogUpdatedAt = maxLog._max.updatedAt?.toISOString() ?? null;

    return NextResponse.json({
      status: "ok",
      service: "nba-player-prop-snapshot",
      now: new Date().toISOString(),
      lastRun,
      lastPublishableRun,
      freshness: {
        todayEt,
        yesterdayEt,
        maxLogDateEt,
        maxLogUpdatedAt,
        logsForYesterday: yesterdayLogCount,
        logsForToday: todayLogCount,
        upToDateThroughYesterday: maxLogDateEt != null && maxLogDateEt >= yesterdayEt,
        snapshotLastRefreshUpdatedAt: lastRefreshSetting?.updatedAt?.toISOString() ?? null,
        snapshotLastRefresh: lastRefreshSetting?.value ?? null,
        lineupSnapshotUpdatedAt: lineupSnapshotSetting?.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        service: "nba-player-prop-snapshot",
        now: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown health check error",
      },
      { status: 503 },
    );
  }
}

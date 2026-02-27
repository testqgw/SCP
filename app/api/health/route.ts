import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const lastRun = await prisma.refreshRun.findFirst({
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
    });

    return NextResponse.json({
      status: "ok",
      service: "nba-player-prop-snapshot",
      now: new Date().toISOString(),
      lastRun,
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

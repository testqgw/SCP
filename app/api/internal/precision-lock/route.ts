import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { getSnapshotBoardData } from "@/lib/snapshot/query";
import { getSnapshotBoardDateString } from "@/lib/snapshot/time";
import {
  getPrecisionPregameLockLeadMinutes,
  getPrecisionPregameLockSettingKey,
  readPrecisionPregameLock,
} from "@/lib/snapshot/precisionPregameLock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isValidEtDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const dateEt = isValidEtDate(searchParams.get("date"))
      ? (searchParams.get("date") as string)
      : getSnapshotBoardDateString();

    const board = await getSnapshotBoardData(dateEt, true);
    const setting = await prisma.systemSetting.findUnique({
      where: { key: getPrecisionPregameLockSettingKey(dateEt) },
      select: { value: true, updatedAt: true },
    });
    const lock = readPrecisionPregameLock(setting?.value ?? null);

    const response = NextResponse.json({
      ok: true,
      dateEt,
      lockLeadMinutes: getPrecisionPregameLockLeadMinutes(),
      locked: Boolean(lock),
      lockedAt: lock?.lockedAt ?? null,
      firstGameTimeUtc: lock?.firstGameTimeUtc ?? null,
      precisionCount: lock?.precisionCard.length ?? board.precisionCard?.length ?? 0,
      boardLastUpdatedAt: board.lastUpdatedAt,
      lockSettingUpdatedAt: setting?.updatedAt?.toISOString() ?? null,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Precision pregame lock failed.";
    const response = NextResponse.json({ ok: false, error: message }, { status: 500 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

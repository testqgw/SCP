import { NextResponse } from "next/server";
import { getSnapshotBoardData } from "@/lib/snapshot/query";
import { getTodayEtDateString } from "@/lib/snapshot/time";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isValidEtDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const dateEt = isValidEtDate(searchParams.get("date")) ? (searchParams.get("date") as string) : getTodayEtDateString();
    const result = await getSnapshotBoardData(dateEt);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Board load failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { runRefresh } from "@/lib/snapshot/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RefreshRequestBody = {
  mode?: "DELTA" | "FULL" | "FAST" | "delta" | "full" | "fast";
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = ((await request.json().catch(() => ({}))) as RefreshRequestBody) ?? {};
    const normalizedMode = body.mode?.toUpperCase();
    const mode = normalizedMode === "FULL" ? "FULL" : normalizedMode === "FAST" ? "FAST" : "DELTA";
    const result = await runRefresh(mode);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

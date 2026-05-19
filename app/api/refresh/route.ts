import { NextResponse } from "next/server";
import { runRefresh } from "@/lib/snapshot/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RefreshRequestBody = {
  mode?: "DELTA" | "FULL" | "FAST" | "delta" | "full" | "fast";
  source?: "manual" | "visit" | "cron";
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = ((await request.json().catch(() => ({}))) as RefreshRequestBody) ?? {};
    const normalizedMode = body.mode?.toUpperCase();
    const mode = normalizedMode === "FULL" ? "FULL" : normalizedMode === "FAST" ? "FAST" : "DELTA";
    const result = await runRefresh(mode, { source: body.source ?? "manual" });
    const response = NextResponse.json({ ok: true, result });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    const response = NextResponse.json({ ok: false, error: message }, { status: 500 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

import { NextResponse } from "next/server";
import { runRefresh } from "@/lib/snapshot/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Manual refresh is opt-in; internal full/delta refresh stays CRON_SECRET-gated.
function isManualRefreshEnabled(): boolean {
  return process.env.SNAPSHOT_ALLOW_MANUAL_REFRESH === "true";
}

type RefreshRequestBody = {
  mode?: "DELTA" | "FULL" | "FAST" | "delta" | "full" | "fast";
  source?: "manual" | "visit" | "cron";
};

export async function POST(request: Request): Promise<NextResponse> {
  if (!isManualRefreshEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Manual refresh is disabled on this deployment." },
      { status: 403 },
    );
  }

  try {
    const body = ((await request.json().catch(() => ({}))) as RefreshRequestBody) ?? {};
    const normalizedMode = body.mode?.toUpperCase();
    const mode = normalizedMode === "FULL" ? "FULL" : normalizedMode === "FAST" ? "FAST" : "DELTA";
    const result = await runRefresh(mode, { source: body.source ?? "manual" });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

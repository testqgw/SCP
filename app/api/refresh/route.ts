import { NextResponse } from "next/server";
import { runRefresh } from "@/lib/snapshot/refresh";

export const dynamic = "force-dynamic";

type RefreshRequestBody = {
  mode?: "DELTA" | "FULL" | "delta" | "full";
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = ((await request.json().catch(() => ({}))) as RefreshRequestBody) ?? {};
    const mode = body.mode && body.mode.toUpperCase() === "FULL" ? "FULL" : "DELTA";
    const result = await runRefresh(mode);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}


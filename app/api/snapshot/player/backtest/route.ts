import { NextResponse } from "next/server";
import { getPlayerBacktestReport } from "@/lib/snapshot/playerBacktest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const player = searchParams.get("player")?.trim() ?? "";

    if (!player) {
      return NextResponse.json({ ok: false, error: "Player search is required." }, { status: 400 });
    }

    const report = await getPlayerBacktestReport(player);
    if (!report) {
      return NextResponse.json({ ok: false, error: "No player backtest report found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Player backtest lookup failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

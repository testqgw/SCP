import { NextResponse } from "next/server";
import { SportsDataClient } from "@/lib/sportsdata/client";
import { etDateShift } from "@/lib/snapshot/time";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const client = new SportsDataClient();
        const dateEt = etDateShift(new Date().toISOString(), 0);

        // Fetch directly from the legacy endpoint
        const rawData = await client.fetchLegacyPlayerPropsByDate(dateEt);

        return NextResponse.json({
            success: true,
            count: rawData.length,
            sampleOptions: rawData.slice(0, 5),
        });
    } catch (error) {
        return NextResponse.json(
            { success: false, error: String(error) },
            { status: 500 }
        );
    }
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isSessionAuthenticated } from "@/lib/auth/guard";
import { getPlayerSnapshotDetail } from "@/lib/snapshot/query";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    playerId: string;
  };
};

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authenticated = await isSessionAuthenticated(request);
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const market = request.nextUrl.searchParams.get("market") ?? undefined;
  const book = request.nextUrl.searchParams.get("book") ?? undefined;
  const detail = await getPlayerSnapshotDetail(
    context.params.playerId,
    market as Parameters<typeof getPlayerSnapshotDetail>[1],
    book as Parameters<typeof getPlayerSnapshotDetail>[2],
  );

  if (!detail) {
    return NextResponse.json({ error: "Player snapshot not found." }, { status: 404 });
  }
  return NextResponse.json(detail);
}

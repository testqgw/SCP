import { NextResponse } from 'next/server';
import { getInitialSnapshotBoardViewData, getSnapshotBoardViewData } from '@/lib/snapshot/query';
import { getTodayEtDateString } from '@/lib/snapshot/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isValidEtDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const dateEt = isValidEtDate(searchParams.get('date')) ? (searchParams.get('date') as string) : getTodayEtDateString();
    const bypassResponseCache = searchParams.has('refresh') || searchParams.has('t');
    const rebuildBoard = searchParams.get('rebuild') === '1';
    const result = rebuildBoard
      ? await getSnapshotBoardViewData(dateEt, true)
      : await getInitialSnapshotBoardViewData(dateEt);
    const response = NextResponse.json({ ok: true, result });
    if (bypassResponseCache) {
      response.headers.set('Cache-Control', 'no-store');
    } else {
      response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Board load failed.';
    const response = NextResponse.json({ ok: false, error: message }, { status: 500 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { collectCiSnapshot } from '../../../../src/lib/collectCiMetrics';

const getCachedSnapshot = unstable_cache(collectCiSnapshot, ['ci-analytics-snapshot'], {
  revalidate: 3600, // 1 hour
});

export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.get('fresh') === 'true';
  const snapshot = fresh ? await collectCiSnapshot() : await getCachedSnapshot();
  return NextResponse.json(snapshot);
}

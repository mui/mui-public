import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { z } from 'zod/v4';
import { listKeys } from '@/lib/ciReports/s3';
import { repoSchema, reportTypeSchema } from '@/lib/ciReports/schemas';
import { isTimeline, parseTimelineKeys, timelinePrefix } from '@/lib/ciReports/timeline';

// A timeline gains an upload per commit at most, so a few minutes' staleness costs nothing.
const STALE_SECONDS = 300;

const querySchema = z.object({
  repo: repoSchema,
  timeline: z.string().refine(isTimeline, 'Not a timeline: a tracked branch or @<name>'),
  reportType: reportTypeSchema,
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  cursor: z.string().optional(),
});

// Shared across visitors, unlike the response's Cache-Control, so a page view rarely reaches S3.
const listCachedKeys = unstable_cache(listKeys, ['ci-report-timeline'], {
  revalidate: STALE_SECONDS,
});

// Lists a timeline's uploads, newest first: which commits have the report. Public, like the
// reports themselves; the browser can't list the bucket on its own.
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.issues },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const { repo, timeline, reportType, limit, cursor } = parsed.data;

  const prefix = timelinePrefix(repo, timeline, reportType);
  const { keys, next } = await listCachedKeys(prefix, limit, cursor);
  return NextResponse.json(
    { entries: parseTimelineKeys(prefix, keys), cursor: next ?? null },
    { headers: { 'Cache-Control': `public, max-age=${STALE_SECONDS}` } },
  );
}

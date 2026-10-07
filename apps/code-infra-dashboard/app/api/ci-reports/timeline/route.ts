import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { z } from 'zod/v4';
import { repositories } from '@/constants';
import { listKeys } from '@/lib/ciReports/s3';
import { reportTypeSchema } from '@/lib/ciReports/schemas';
import { isTimeline, parseTimelineKeys, timelinePrefix } from '@/lib/ciReports/timeline';

// A timeline gains an upload per commit at most, so a few minutes' staleness costs nothing.
const STALE_SECONDS = 300;

const querySchema = z.object({
  // The dashboard's repositories only, so a request can't make up prefixes to list.
  repo: z.string().refine((repo) => repositories.has(repo), 'Unknown repository'),
  timeline: z.string().refine(isTimeline, 'Not a timeline: a tracked branch or @<name>'),
  reportType: reportTypeSchema,
  /** Pointers to list, which a commit uploaded more than once counts more than once in. */
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  cursor: z.string().optional(),
});

// Shared across visitors, unlike the response's Cache-Control, so a page view rarely reaches S3.
const listCachedKeys = unstable_cache(listKeys, ['ci-report-timeline'], {
  revalidate: STALE_SECONDS,
});

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Lists a timeline's uploads, newest first: which commits have the report. Public, like the
// reports themselves; the browser can't list the bucket on its own.
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return errorResponse(parsed.error.issues.map((issue) => issue.message).join('; '), 400);
  }
  const { repo, timeline, reportType, limit, cursor } = parsed.data;

  const prefix = timelinePrefix(repo, timeline, reportType);
  let listing;
  try {
    listing = await listCachedKeys(prefix, limit, cursor);
  } catch (error) {
    // What S3 answers a cursor it didn't hand out.
    if (error instanceof S3ServiceException && error.name === 'InvalidArgument') {
      return errorResponse(`Invalid listing: ${error.message}`, 400);
    }
    console.error('Listing a timeline failed:', error);
    return errorResponse('Could not list the timeline', 502);
  }
  return NextResponse.json(
    { entries: parseTimelineKeys(prefix, listing.keys), cursor: listing.next ?? null },
    { headers: { 'Cache-Control': `public, max-age=${STALE_SECONDS}` } },
  );
}

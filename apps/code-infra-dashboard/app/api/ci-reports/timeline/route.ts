import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod/v4';
import { listKeys } from '@/lib/ciReports/s3';
import {
  isTimelineName,
  parseTimelineKeys,
  reportFileName,
  timelinePrefix,
} from '@/lib/ciReports/timeline';

const querySchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format'),
  timeline: z.string().refine(isTimelineName, 'Not a timeline name'),
  reportType: z.enum(['size-snapshot', 'benchmark']),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  cursor: z.string().optional(),
});

// Lists a timeline's uploads, newest first: which commits have the report and where to fetch it.
// Public, like the reports themselves; the browser can't list the bucket on its own.
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
  const { keys, next } = await listKeys(prefix, limit, cursor);
  return NextResponse.json(
    {
      reportFileName: reportFileName(reportType, timeline),
      entries: parseTimelineKeys(prefix, keys),
      cursor: next ?? null,
    },
    // A timeline gains an upload per commit at most, so a few minutes' staleness costs nothing.
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}

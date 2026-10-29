import { NextResponse } from 'next/server';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod/v4';

interface CareerJob {
  id: string;
  title: string;
  isFutureRole: boolean;
  category: string;
  description: string;
  summary: string;
  applicationUrl: string;
}

const futureRoleMarker = /(?:\(\s*future role\s*\)|\[\s*future role\s*\]|future role)/i;

const jobBoardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      department: z.string().optional(),
      isListed: z.boolean(),
      descriptionHtml: z.string(),
      applyUrl: z.url({ protocol: /^https?$/ }),
    }),
  ),
});

function parseTitle(title: string) {
  const isFutureRole = futureRoleMarker.test(title);
  if (!isFutureRole) {
    return { title, isFutureRole };
  }

  return {
    title: title
      .replace(futureRoleMarker, '')
      .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
      .replace(/\s{2,}/g, ' '),
    isFutureRole,
  };
}

function sanitizeDescription(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: {
      '*': ['title', 'lang', 'dir', 'role', 'id', 'aria-*'],
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
      ol: ['start', 'reversed'],
      li: ['value'],
      time: ['datetime'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    // Drop active and foreign subtrees, including their text and nested HTML.
    nonTextTags: [
      'script',
      'style',
      'textarea',
      'option',
      'iframe',
      'object',
      'embed',
      'template',
      'svg',
      'math',
    ],
  });
}

export async function GET() {
  try {
    const response = await fetch('https://api.ashbyhq.com/posting-api/job-board/MUI', {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Ashby HTTP ${response.status}`);
    }

    const { jobs } = jobBoardSchema.parse(await response.json());

    const careerJobs: CareerJob[] = jobs
      .filter((job) => job.isListed)
      .map((job) => ({
        id: job.id,
        ...parseTitle(job.title),
        category: job.department || 'Other',
        description: sanitizeDescription(job.descriptionHtml),
        summary: '',
        applicationUrl: job.applyUrl,
      }));

    return NextResponse.json(
      { data: careerJobs },
      { headers: { 'Cache-Control': 'public, max-age=600' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch published jobs from Ashby' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

import { NextResponse } from 'next/server';
import { parseFragment, serialize } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { z } from 'zod/v4';

interface CareerJob {
  id: string;
  title: string;
  category: string;
  description: string;
  summary: string;
  applicationUrl: string;
}

const jobBoardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      department: z.string().optional(),
      isListed: z.boolean(),
      descriptionHtml: z.string(),
      applyUrl: z.url(),
    }),
  ),
});

// Retain attributes that carry content, navigation, or semantic meaning.
const descriptionAttributes = new Set([
  'href',
  'target',
  'rel',
  'src',
  'alt',
  'title',
  'colspan',
  'rowspan',
  'scope',
  'start',
  'reversed',
  'value',
  'datetime',
  'lang',
  'dir',
  'role',
  'id',
]);

function stripHtmlAttributes(html: string): string {
  const fragment = parseFragment(html);

  function visit(node: DefaultTreeAdapterTypes.Node) {
    if ('attrs' in node) {
      node.attrs = node.attrs.filter(
        (attribute) =>
          (descriptionAttributes.has(attribute.name) || attribute.name.startsWith('aria-')) &&
          !attribute.namespace,
      );
    }
    if ('childNodes' in node) {
      node.childNodes.forEach(visit);
    }
    if ('content' in node) {
      visit(node.content);
    }
  }

  visit(fragment);
  return serialize(fragment);
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
        title: job.title,
        category: job.department || 'Other',
        description: stripHtmlAttributes(job.descriptionHtml),
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

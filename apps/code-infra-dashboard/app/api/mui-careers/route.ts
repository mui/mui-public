import { NextResponse } from 'next/server';
import { defaultTreeAdapter, parseFragment, serialize } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import sanitizeHtml from 'sanitize-html';
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
      applyUrl: z.url({ protocol: /^https?$/ }),
    }),
  ),
});

const emptyTextTags = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'div',
  'span',
  'a',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'small',
  'blockquote',
  'pre',
  'code',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'address',
  'figure',
  'figcaption',
  'del',
  'ins',
  'mark',
  'sub',
  'sup',
  'time',
]);

function isEmpty(node: DefaultTreeAdapterTypes.Node): boolean {
  if (node.nodeName === '#text') {
    return !(node as DefaultTreeAdapterTypes.TextNode).value.trim();
  }
  if ('tagName' in node && (node.tagName === 'img' || node.tagName === 'hr')) {
    return false;
  }
  return !('childNodes' in node) || node.childNodes.every(isEmpty);
}

function replaceEmpty(node: DefaultTreeAdapterTypes.ParentNode) {
  node.childNodes = node.childNodes.map((child) => {
    if (!('tagName' in child)) {
      return child;
    }
    replaceEmpty(child);

    if (!emptyTextTags.has(child.tagName) || !isEmpty(child)) {
      return child;
    }

    const lineBreak = defaultTreeAdapter.createElement('br', child.namespaceURI, []);
    lineBreak.parentNode = node;
    return lineBreak;
  });
}

function sanitizeDescription(html: string): string {
  const sanitized = sanitizeHtml(html, {
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

  // Preserve spacing without leaving empty headings or nested formatting.
  const fragment = parseFragment(sanitized);
  replaceEmpty(fragment);
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

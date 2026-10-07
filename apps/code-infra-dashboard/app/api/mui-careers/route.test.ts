import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const job = {
  id: '4bfd5851-6252-489d-a7b1-06a704c285a7',
  title: 'Operations Engineer',
  department: 'Operations',
  team: 'Operations',
  employmentType: 'FullTime',
  location: 'Remote',
  secondaryLocations: [{ location: 'Paris' }],
  publishedAt: '2026-10-01T00:00:00.000Z',
  isListed: true,
  isRemote: true,
  workplaceType: 'Remote',
  descriptionHtml: '<h2>About the role</h2><p>Build tools &amp; improve operations.</p>',
  descriptionPlain: 'About the role\n\nBuild tools & improve operations.',
  jobUrl: 'https://jobs.ashbyhq.com/MUI/4bfd5851-6252-489d-a7b1-06a704c285a7',
  applyUrl: 'https://jobs.ashbyhq.com/MUI/4bfd5851-6252-489d-a7b1-06a704c285a7/application',
};

const careerJob = {
  id: job.id,
  title: 'Operations Engineer',
  category: 'Operations',
  description: '<h2>About the role</h2><p>Build tools &amp; improve operations.</p>',
  summary: '',
  applicationUrl: job.applyUrl,
};

describe('GET /api/mui-careers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns only the local careers fields, preserving the full HTML description', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ apiVersion: '1', jobs: [job] }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=600');
    expect(await response.json()).toEqual({ data: [careerJob] });
    expect(fetchMock).toHaveBeenCalledWith('https://api.ashbyhq.com/posting-api/job-board/MUI', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });

  it('keeps href and data attributes while preserving markup and text', async () => {
    const descriptionHtml = `<h2 STYLE="color: red">About the role</h2><p style='font-size: 12px' class="intro" data-role="intro">Build <strong style=color:red>tools</strong> &amp; improve operations.</p><a href="https://mui.com" title="a style=example" data-style="keep" style="color: blue">MUI</a><p>Use style="display: none" as text.</p><template><span style="color:red">Details</span></template>`;
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ jobs: [{ ...job, descriptionHtml }] })),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          ...careerJob,
          description:
            '<h2>About the role</h2><p data-role="intro">Build <strong>tools</strong> &amp; improve operations.</p><a href="https://mui.com" data-style="keep">MUI</a><p>Use style="display: none" as text.</p><template><span>Details</span></template>',
        },
      ],
    });
  });

  it('excludes unlisted postings', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ jobs: [job, { ...job, id: 'unlisted', isListed: false }] }),
        ),
    );

    const response = await GET();

    expect(await response.json()).toEqual({ data: [careerJob] });
  });

  it.each([undefined, ''])('uses Other when the department is %s', async (department) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ jobs: [{ ...job, department }] })),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ ...careerJob, category: 'Other' }] });
  });

  it('does not require upstream fields that the careers API does not use', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          jobs: [
            {
              id: job.id,
              title: job.title,
              department: job.department,
              isListed: true,
              descriptionHtml: job.descriptionHtml,
              applyUrl: job.applyUrl,
            },
          ],
        }),
      ),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [careerJob] });
  });

  it('returns an empty list when Ashby has no published jobs', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ jobs: [] })));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });

  it.each([
    ['missing jobs', {}],
    ['null jobs', { jobs: null }],
    ['missing description', { jobs: [{ ...job, descriptionHtml: undefined }] }],
    ['missing visibility', { jobs: [{ ...job, isListed: undefined }] }],
    ['invalid application URL', { jobs: [{ ...job, applyUrl: 'invalid' }] }],
  ])('returns an error for malformed upstream data: %s', async (_name, body) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)));

    const response = await GET();

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Failed to fetch published jobs from Ashby' });
  });

  it.each([429, 503])('returns an error when Ashby responds with HTTP %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })));

    const response = await GET();

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).not.toHaveProperty('data');
  });

  it.each([
    new TypeError('fetch failed'),
    new DOMException('The operation timed out', 'TimeoutError'),
  ])('returns an error for a network failure: %s', async (error) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(error));

    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty('data');
  });

  it('returns an error when Ashby responds with invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Error</html>')),
    );

    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty('data');
  });
});

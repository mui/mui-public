import { describe, it, expect } from 'vitest';
import type { Sitemap, SitemapPage } from './types';
import { createSitemap } from './createSitemap';

function createPage(overrides: Partial<SitemapPage> & { slug: string; path: string }): SitemapPage {
  return { title: overrides.slug, ...overrides };
}

function createPrecomputedSitemap(data: Sitemap['data']): Sitemap {
  return { schema: { title: 'string', path: 'string' }, data };
}

const SOURCE_URL = 'file:///app/sitemap/index.ts';

describe('createSitemap', () => {
  it('returns precomputed data as-is when no filter is provided', () => {
    const precomputed = createPrecomputedSitemap({
      components: {
        title: 'Components',
        prefix: '/components',
        pages: [
          createPage({ slug: 'button', path: '/components/button' }),
          createPage({ slug: 'checkbox', path: '/components/checkbox' }),
        ],
      },
    });

    const result = createSitemap(SOURCE_URL, {}, { precompute: precomputed });

    expect(result).toBe(precomputed);
  });

  it('filters out pages tagged as Private for production deployments', () => {
    const precomputed = createPrecomputedSitemap({
      components: {
        title: 'Components',
        prefix: '/components',
        pages: [
          createPage({ slug: 'button', path: '/components/button' }),
          createPage({
            slug: 'internal-grid',
            path: '/components/internal-grid',
            tags: ['Private'],
          }),
          createPage({ slug: 'checkbox', path: '/components/checkbox' }),
        ],
      },
    });

    const result = createSitemap(
      SOURCE_URL,
      {},
      {
        precompute: precomputed,
        filter: (page) => !page.tags?.includes('Private'),
      },
    );

    expect(result?.data.components.pages).toHaveLength(2);
    expect(result?.data.components.pages.map((p) => p.slug)).toEqual(['button', 'checkbox']);
  });

  it('removes entire sections when all pages are filtered out', () => {
    const precomputed = createPrecomputedSitemap({
      internal: {
        title: 'Internal',
        prefix: '/internal',
        pages: [
          createPage({ slug: 'debug-tool', path: '/internal/debug-tool', tags: ['Private'] }),
        ],
      },
      components: {
        title: 'Components',
        prefix: '/components',
        pages: [createPage({ slug: 'button', path: '/components/button' })],
      },
    });

    const result = createSitemap(
      SOURCE_URL,
      {},
      {
        precompute: precomputed,
        filter: (page) => !page.tags?.includes('Private'),
      },
    );

    expect(result?.data.internal).toBeUndefined();
    expect(result?.data.components.pages).toHaveLength(1);
  });

  it('does not mutate the original precomputed sitemap when filtering', () => {
    const precomputed = createPrecomputedSitemap({
      components: {
        title: 'Components',
        prefix: '/components',
        pages: [
          createPage({ slug: 'button', path: '/components/button' }),
          createPage({ slug: 'internal', path: '/components/internal', tags: ['Private'] }),
        ],
      },
    });

    createSitemap(
      SOURCE_URL,
      {},
      {
        precompute: precomputed,
        filter: (page) => !page.tags?.includes('Private'),
      },
    );

    expect(precomputed.data.components.pages).toHaveLength(2);
  });

  it('preserves schema and section metadata after filtering', () => {
    const precomputed = createPrecomputedSitemap({
      components: {
        title: 'Components',
        prefix: '/components',
        pages: [
          createPage({ slug: 'button', path: '/components/button' }),
          createPage({ slug: 'hidden', path: '/components/hidden', tags: ['Private'] }),
        ],
      },
    });

    const result = createSitemap(
      SOURCE_URL,
      {},
      {
        precompute: precomputed,
        filter: (page) => !page.tags?.includes('Private'),
      },
    );

    expect(result?.schema).toEqual(precomputed.schema);
    expect(result?.data.components.title).toBe('Components');
    expect(result?.data.components.prefix).toBe('/components');
  });

  it('keeps all pages when filter returns true for every page', () => {
    const precomputed = createPrecomputedSitemap({
      components: {
        title: 'Components',
        prefix: '/components',
        pages: [
          createPage({ slug: 'button', path: '/components/button' }),
          createPage({ slug: 'checkbox', path: '/components/checkbox' }),
        ],
      },
    });

    const result = createSitemap(
      SOURCE_URL,
      {},
      {
        precompute: precomputed,
        filter: () => true,
      },
    );

    expect(result?.data.components.pages).toHaveLength(2);
  });

  it('returns undefined outside Next.js when no precompute is provided', () => {
    const result = createSitemap(SOURCE_URL, {});

    expect(result).toBeUndefined();
  });

  it('throws if sourceUrl is not a file URL', () => {
    expect(() => createSitemap('https://example.com', {})).toThrow(
      'createSitemap() requires the `sourceUrl` argument to be a file URL.',
    );
  });
});

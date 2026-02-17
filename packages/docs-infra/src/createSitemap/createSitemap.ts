import type * as React from 'react';
import type { Sitemap, SitemapPage } from './types';

type CreateSitemapMeta = {
  name?: string;
  slug?: string;
  displayName?: string;
  precompute?: Sitemap;
  skipPrecompute?: boolean;
  filter?: (page: SitemapPage) => boolean;
  [key: string]: any;
};

/**
 * Detects if code is running within a Next.js build or runtime context.
 * Returns true if Next.js environment variables are present.
 */
function isNextJsContext(): boolean {
  return (
    typeof process !== 'undefined' &&
    (typeof process.env.NEXT_RUNTIME === 'string' || // Next.js runtime (edge/nodejs)
      // eslint-disable-next-line no-underscore-dangle
      typeof process.env.__NEXT_PROCESSED_ENV === 'string' || // Next.js build
      typeof process.env.NEXT_PHASE === 'string') // Next.js build phase
  );
}

/**
 * Creates sitemap data from page components with optional precomputed data.
 * Returns a sitemap data object containing schema and page data.
 *
 * In Next.js builds, the webpack loader precomputes the sitemap data.
 * Outside Next.js (e.g., tests or scripts), use `loadServerSitemap()` for runtime loading.
 *
 * @param sourceUrl Depends on `import.meta.url` to determine the source file location.
 * @param pages Record of page components indexed by path.
 * @param meta Additional meta and precomputed sitemap configuration.
 */
export function createSitemap(
  sourceUrl: string,
  pages: Record<string, React.ComponentType<any> | null>,
  meta?: CreateSitemapMeta,
): Sitemap | undefined {
  if (!sourceUrl.startsWith('file:')) {
    throw new Error(
      'createSitemap() requires the `sourceUrl` argument to be a file URL. Use `import.meta.url` to get the current file URL.',
    );
  }

  // If precompute data exists or skipPrecompute is set, use the precomputed data
  if (meta?.precompute || meta?.skipPrecompute) {
    if (meta?.precompute && meta?.filter) {
      return filterSitemap(meta.precompute, meta.filter);
    }

    return meta.precompute;
  }

  // In Next.js context, precomputation should have happened via webpack loader
  // If it didn't, throw an error to help developers fix their configuration
  if (isNextJsContext()) {
    throw new Error(
      `createSitemap() was unable to precompute the sitemap data in ${sourceUrl}. Ensure the createSitemap() function is called within a path used for sitemap indexes. This is typically app/sitemap/index.ts but may be overridden in next.config.js`,
    );
  }

  // Outside Next.js, return undefined (sync function can't do async loading)
  // Use loadServerSitemap() for runtime loading
  return undefined;
}

/**
 * Filters pages in a sitemap using the provided predicate function.
 * Mirrors the behavior of `Array.prototype.filter` — pages for which
 * the predicate returns `false` are removed from each section.
 * Sections that end up with zero pages after filtering are removed entirely.
 *
 * @param sitemap The sitemap to filter.
 * @param predicate A function called for each page. Return `true` to keep the page.
 * @returns A new sitemap containing only the pages that passed the predicate.
 */
function filterSitemap(sitemap: Sitemap, predicate: (page: SitemapPage) => boolean): Sitemap {
  const filteredData: Sitemap['data'] = {};

  for (const [sectionKey, sectionData] of Object.entries(sitemap.data)) {
    const filteredPages = sectionData.pages.filter(predicate);

    if (filteredPages.length > 0) {
      filteredData[sectionKey] = {
        ...sectionData,
        pages: filteredPages,
      };
    }
  }

  return {
    schema: sitemap.schema,
    data: filteredData,
  };
}

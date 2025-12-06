import type * as React from 'react';
import type { Sitemap } from './types';

type CreateSitemapMeta = {
  name?: string;
  slug?: string;
  displayName?: string;
  precompute?: Sitemap;
  skipPrecompute?: boolean;
  [key: string]: any;
};

/**
 * Creates sitemap data from page components with optional precomputed data.
 * Returns a sitemap data object containing schema and page data.
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

  if (!meta || (!meta.precompute && !meta.skipPrecompute)) {
    throw new Error(
      `createSitemap() was unable to precompute the sitemap data in ${sourceUrl}. Ensure the createSitemap() function is called within a path used for sitemap indexes. This is typically app/sitemap/index.ts but may be overridden in next.config.js`,
    );
  }

  return meta.precompute;
}

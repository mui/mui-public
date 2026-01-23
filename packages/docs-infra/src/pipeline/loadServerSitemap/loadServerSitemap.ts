import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sitemap } from '../../createSitemap/types';
import { createLoadServerPageIndex } from '../loadServerPageIndex/loadServerPageIndex';
import { parseCreateFactoryCall } from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';

/**
 * Options for creating a loadServerSitemap function
 */
export interface CreateLoadServerSitemapOptions {
  /**
   * The root context directory for resolving relative paths.
   * Defaults to the directory containing the sitemap index file.
   */
  rootContext?: string;
}

/**
 * Function type for loading sitemap data from a sitemap index file URL
 */
export type LoadServerSitemap = (url: string) => Promise<Sitemap>;

/**
 * Creates the default Orama schema for search indexing.
 * See: https://docs.orama.com/docs/orama-js/usage/create#schema-properties-and-types
 */
export function createSitemapSchema(): Sitemap['schema'] {
  return {
    slug: 'string',
    path: 'string',
    title: 'string',
    description: 'string',
    sections: 'string[]',
    subsections: 'string[]',
    keywords: 'string[]',
  };
}

/**
 * Default loadServerSitemap function that loads sitemap data from a sitemap index file.
 * This function parses the sitemap index file to find createSitemap calls and resolves
 * the page index paths from the imports.
 */
export const loadServerSitemap: LoadServerSitemap = createLoadServerSitemap();

/**
 * Creates a loadServerSitemap function with custom options.
 *
 * This factory function creates a LoadServerSitemap implementation that:
 * 1. Parses the sitemap index file to find createSitemap calls with page imports
 * 2. Resolves all page index paths from the imports
 * 3. Loads each page index using loadServerPageIndex
 * 4. Returns a Sitemap object with schema and page data
 *
 * @param options - Configuration options for the loader
 * @returns LoadServerSitemap function that takes a file URL and returns Promise<Sitemap>
 */
export function createLoadServerSitemap(
  options: CreateLoadServerSitemapOptions = {},
): LoadServerSitemap {
  return async function loadSitemap(url: string): Promise<Sitemap> {
    // Convert file:// URL to proper file system path for reading the file
    // Using fileURLToPath handles Windows drive letters correctly (e.g., file:///C:/... → C:\...)
    const filePath = url.startsWith('file://') ? fileURLToPath(url) : url;

    // Determine root context from file path if not provided
    const rootContext = options.rootContext ?? path.dirname(filePath);

    // Create page index loader with root context
    const loadPageIndex = createLoadServerPageIndex({ rootContext });

    // Read the source file to find createSitemap calls
    const source = await readFile(filePath, 'utf-8');

    // Parse the source to find createSitemap call with page imports
    const sitemapCall = await parseCreateFactoryCall(source, filePath);

    if (!sitemapCall || !sitemapCall.variants) {
      // Return empty sitemap if no createSitemap call found
      return {
        schema: createSitemapSchema(),
        data: {},
      };
    }

    // Process all page index files in parallel
    const entries = Object.entries(sitemapCall.variants);
    const results = await Promise.all(
      entries.map(async ([key, importPath]) => {
        try {
          const metadata = await loadPageIndex(importPath);
          return { key, metadata, error: null };
        } catch (error) {
          return {
            key,
            metadata: null,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      }),
    );

    // Collect results and errors
    const sitemapData: Sitemap['data'] = {};
    const errors: Array<{ key: string; error: Error }> = [];

    for (const result of results) {
      if (result.error) {
        errors.push({ key: result.key, error: result.error });
      } else if (result.metadata) {
        sitemapData[result.key] = result.metadata;
      }
    }

    // Throw if any pages failed to load
    if (errors.length > 0) {
      const errorMessages = errors.map(({ key, error }) => `  ${key}: ${error.message}`).join('\n');
      throw new Error(`Failed to load ${errors.length} page index(es):\n${errorMessages}`);
    }

    return {
      schema: createSitemapSchema(),
      data: sitemapData,
    };
  };
}

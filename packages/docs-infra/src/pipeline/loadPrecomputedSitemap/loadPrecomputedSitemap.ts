// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
import type { LoaderContext } from 'webpack';
import {
  createPerformanceLogger,
  logPerformance,
  nameMark,
  performanceMeasure,
} from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { parseCreateFactoryCall } from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { replacePrecomputeValue } from '../loadPrecomputedCodeHighlighter/replacePrecomputeValue';
import { rewriteImportsToNull } from '../loaderUtils/rewriteImports';
import { createLoadServerPageIndex } from '../loadServerPageIndex/loadServerPageIndex';
import { createSitemapSchema } from '../loadServerSitemap/loadServerSitemap';
import type { Sitemap, SitemapSectionData } from '../../createSitemap/types';

export type LoaderOptions = {
  performance?: {
    logging?: boolean;
    notableMs?: number;
    showWrapperMeasures?: boolean;
    significantDependencyCountThreshold?: number;
  };
};

const functionName = 'Load Precomputed Sitemap';

export async function loadPrecomputedSitemap(
  this: LoaderContext<LoaderOptions>,
  source: string,
): Promise<void> {
  const callback = this.async();
  this.cacheable();

  const options = this.getOptions();
  const performanceNotableMs = options.performance?.notableMs ?? 100;
  const performanceShowWrapperMeasures = options.performance?.showWrapperMeasures ?? false;

  // const resourceName = extractNameAndSlugFromUrl(
  //   new URL('.', `file://${this.resourcePath}`).pathname,
  // ).name;

  const relativePath = path.relative(this.rootContext || process.cwd(), this.resourcePath);

  let observer: PerformanceObserver | undefined = undefined;
  if (options.performance?.logging) {
    observer = new PerformanceObserver(
      createPerformanceLogger(performanceNotableMs, performanceShowWrapperMeasures, relativePath),
    );
    observer.observe({ entryTypes: ['measure'] });
  }

  let currentMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(currentMark);

  try {
    // Parse the source to find a single createSitemap call
    const sitemapCall = await parseCreateFactoryCall(source, this.resourcePath);

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Parsed Factory', measure: 'Factory Parsing' },
      [functionName, relativePath],
    );

    // If no createSitemap call found, return the source unchanged
    if (!sitemapCall) {
      callback(null, source);
      return;
    }

    // If skipPrecompute is true, return the source unchanged
    if (sitemapCall.options.skipPrecompute) {
      callback(null, source);
      return;
    }

    // Extract the variants (imported markdown files)
    const variants = sitemapCall.variants;
    if (!variants || Object.keys(variants).length === 0) {
      callback(null, source);
      return;
    }

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Extracted Variants', measure: 'Variant Extraction' },
      [functionName, relativePath],
    );

    // Read and parse each markdown file
    const sitemapData: Sitemap['data'] = {};

    // Create page index loader with root context
    const rootContext = this.rootContext || process.cwd();
    const loadPageIndex = createLoadServerPageIndex({ rootContext });

    // Process all markdown files in parallel using shared logic
    const entries = Object.entries(variants);
    const results = await Promise.all(
      entries.map(
        async ([key, importPath]): Promise<{
          key: string;
          absolutePath: string;
          metadata: SitemapSectionData | null;
          error: Error | null;
        }> => {
          const absolutePath = importPath.startsWith('file://') ? importPath.slice(7) : importPath;
          try {
            const metadata = await loadPageIndex(importPath);
            return { key, absolutePath, metadata, error: null };
          } catch (error) {
            return {
              key,
              absolutePath,
              metadata: null,
              error: error instanceof Error ? error : new Error(String(error)),
            };
          }
        },
      ),
    );

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Processed All Files', measure: 'Process Markdown Files' },
      [functionName, relativePath],
    );

    // Collect results and dependencies
    for (const result of results) {
      if (result.error) {
        // Log error but continue processing other files
        console.error(`Failed to process ${result.key} at ${result.absolutePath}:`, result.error);
      } else if (result.metadata) {
        sitemapData[result.key] = result.metadata;
        // Add to dependencies for webpack watching
        this.addDependency(result.absolutePath);
      }
    }

    // Create sitemap with Orama schema for search indexing
    const precomputeData: Sitemap = {
      schema: createSitemapSchema(),
      data: sitemapData,
    };

    // Replace the factory function call with the precomputed sitemap data
    let modifiedSource = replacePrecomputeValue(source, precomputeData, sitemapCall);

    performanceMeasure(
      currentMark,
      { mark: 'replaced precompute', measure: 'precompute replacement' },
      [functionName, relativePath],
    );

    // Rewrite MDX imports to const declarations since we've precomputed the data
    if (sitemapCall.importsAndComments) {
      const { relative } = sitemapCall.importsAndComments;

      // Build a set of MDX imports to rewrite
      const importPathsToRewrite = new Set<string>();
      const importResult: Record<
        string,
        {
          positions: Array<{ start: number; end: number }>;
          names: Array<{ name: string; alias?: string; type: string }>;
        }
      > = {};

      for (const [importPath, importData] of Object.entries(relative)) {
        // Check if this is an MDX file
        if (importPath.endsWith('.mdx')) {
          // Add to the set of imports to rewrite
          importPathsToRewrite.add(importPath);
          importResult[importPath] = {
            positions: importData.positions,
            names: importData.names,
          };
        }
      }

      // Rewrite the import statements to const declarations if there are any MDX imports
      if (importPathsToRewrite.size > 0) {
        modifiedSource = rewriteImportsToNull(modifiedSource, importPathsToRewrite, importResult);

        currentMark = performanceMeasure(
          currentMark,
          { mark: 'rewritten imports', measure: 'import rewriting' },
          [functionName, relativePath],
        );
      }
    }

    // log any pending performance entries before completing
    observer
      ?.takeRecords()
      ?.forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures, relativePath),
      );
    observer?.disconnect();
    callback(null, modifiedSource);
  } catch (error) {
    // log any pending performance entries before completing
    observer
      ?.takeRecords()
      ?.forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures, relativePath),
      );
    observer?.disconnect();
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}

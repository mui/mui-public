// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import fs from 'fs/promises';
import type { LoaderContext } from 'webpack';
// import { extractNameAndSlugFromUrl } from '../loaderUtils';
import {
  createPerformanceLogger,
  logPerformance,
  nameMark,
  performanceMeasure,
} from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { parseCreateFactoryCall } from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { replacePrecomputeValue } from '../loadPrecomputedCodeHighlighter/replacePrecomputeValue';
import { markdownToMetadata } from '../transformMarkdownMetadata/metadataToMarkdown';

export type LoaderOptions = {
  performance?: {
    logging?: boolean;
    notableMs?: number;
    showWrapperMeasures?: boolean;
    significantDependencyCountThreshold?: number;
  };
};

const functionName = 'Load Precomputed Sitemap';

/**
 * Converts a path segment to a title
 * e.g., "docs-infra" -> "Docs Infra", "components" -> "Components"
 */
function pathSegmentToTitle(segment: string): string {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Recursively removes titleMarkdown fields from a heading hierarchy
 */
function stripTitleMarkdown(hierarchy: any): any {
  const result: any = {};
  for (const [key, value] of Object.entries(hierarchy)) {
    if (typeof value === 'object' && value !== null) {
      const { titleMarkdown, children, ...rest } = value as any;
      const strippedChildren = children ? stripTitleMarkdown(children) : {};
      result[key] = {
        ...rest,
        // Only include children if it has keys, otherwise set to undefined
        children: Object.keys(strippedChildren).length > 0 ? strippedChildren : undefined,
      };
    }
  }
  return result;
}

/**
 * Extracts prefix and title from an import path
 * e.g., "/path/to/app/docs-infra/components/page.mdx" -> { prefix: "/docs-infra/components/", title: "Docs Infra Components" }
 */
function extractPrefixAndTitle(
  absolutePath: string,
  rootContext: string,
): { prefix: string; title: string } {
  // Get the relative path from the root context
  const relativePath = path.relative(rootContext, absolutePath);

  // Extract the directory path (remove filename)
  const dirPath = path.dirname(relativePath);

  // Split into segments and filter out 'app' and current directory markers
  const segments = dirPath
    .split(path.sep)
    .filter((seg) => seg !== 'app' && seg !== '.' && seg !== '');

  // Generate prefix with leading and trailing slashes
  const prefix = segments.length > 0 ? `/${segments.join('/')}/` : '/';

  // Generate title from path segments
  const title = segments.map(pathSegmentToTitle).join(' ');

  return { prefix, title };
}

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
    const sitemapData: Record<string, any> = {};
    const allDependencies: string[] = [];

    // Process all markdown files in parallel
    const entries = Object.entries(variants);
    const results = await Promise.all(
      entries.map(async ([key, importPath]) => {
        try {
          // Resolve the absolute path to the markdown file
          const absolutePath = importPath.startsWith('file://') ? importPath.slice(7) : importPath;

          // Extract prefix and title from the import path
          const { prefix, title: generatedTitle } = extractPrefixAndTitle(
            absolutePath,
            this.rootContext || process.cwd(),
          );

          // Read the markdown file
          const markdownContent = await fs.readFile(absolutePath, 'utf-8');

          // Parse the markdown to extract metadata
          const metadata = await markdownToMetadata(markdownContent);

          // Add prefix and override title with the generated one from the path
          // Strip descriptionMarkdown and titleMarkdown to reduce bundle size
          if (metadata) {
            const enrichedMetadata = {
              ...metadata,
              prefix,
              // Use the generated title from the path (override markdown's H1)
              title: generatedTitle,
              // Strip markdown AST fields from each page to reduce size
              pages: metadata.pages.map((page) => {
                const { descriptionMarkdown, sections, ...pageWithoutMarkdown } = page;
                return {
                  ...pageWithoutMarkdown,
                  // Strip titleMarkdown from sections hierarchy
                  sections: sections ? stripTitleMarkdown(sections) : undefined,
                };
              }),
            };

            return { key, absolutePath, metadata: enrichedMetadata, error: null };
          }

          return { key, absolutePath, metadata: null, error: null };
        } catch (error) {
          return { key, absolutePath: importPath, metadata: null, error };
        }
      }),
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
        allDependencies.push(result.absolutePath);
      }
    }

    // Add Orama schema for search indexing
    // See: https://docs.orama.com/docs/orama-js/usage/create#schema-properties-and-types
    // Schema matches PageMetadata interface (slug, path, title, description, keywords, sections, openGraph)
    const precomputeData = {
      schema: {
        slug: 'string',
        path: 'string',
        title: 'string',
        description: 'string',
        keywords: 'string[]',
      },
      data: sitemapData,
    };

    // Replace the factory function call with the precomputed sitemap data
    const modifiedSource = replacePrecomputeValue(source, precomputeData, sitemapCall);

    performanceMeasure(
      currentMark,
      { mark: 'replaced precompute', measure: 'precompute replacement' },
      [functionName, relativePath],
    );

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

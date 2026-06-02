// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath, pathToFileURL } from 'url';

import type { LoaderContext } from 'webpack';
import { loadIsomorphicCodeVariant } from '../loadIsomorphicCodeVariant/loadIsomorphicCodeVariant';
import { createParseSource } from '../parseSource';
import { TypescriptToJavascriptTransformer } from '../transformTypescriptToJavascript';
import type { SourceEnhancers, SourceTransformers, VariantCode } from '../../CodeHighlighter/types';
import type { EnhanceCodeEmphasisOptions } from '../parseSource/calculateFrameRanges';
import {
  createEnhanceCodeEmphasis,
  EMPHASIS_COMMENT_PREFIX,
  FOCUS_COMMENT_PREFIX,
} from '../enhanceCodeEmphasis/enhanceCodeEmphasis';
import { parseCreateFactoryCall } from '../parseCreateFactoryCall/parseCreateFactoryCall';
import { resolveVariantPathsWithFs } from '../loadServerCodeMeta/resolveModulePathWithFs';
import { replacePrecomputeValue } from '../parseCreateFactoryCall/replacePrecomputeValue';
import { createLoadServerCodeSource } from '../loadServerCodeSource';
import { getFileNameFromUrl, IGNORE_COMMENT_PREFIXES } from '../loaderUtils';
import { createPerformanceLogger, logPerformance, performanceMeasure } from './performanceLogger';

/**
 * Extracts a string array from structured options data.
 * Handles the parser's array format: [[element1, element2, ...]]
 * and removes quotes from string elements.
 */
function extractStringArray(value: unknown): string[] | undefined {
  if (!value) {
    return undefined;
  }

  // Parser stores arrays as [[element1, element2, ...]]
  if (Array.isArray(value) && value.length === 1 && Array.isArray(value[0])) {
    return value[0].map((el: unknown) => {
      if (typeof el !== 'string') {
        return String(el);
      }
      // Remove surrounding quotes if present
      const trimmed = el.trim();
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('`') && trimmed.endsWith('`'))
      ) {
        return trimmed.slice(1, -1);
      }
      return trimmed;
    });
  }

  // Already a plain array (shouldn't happen but handle it)
  if (Array.isArray(value)) {
    return value.map((el) => String(el));
  }

  return undefined;
}

export type LoaderOptions = {
  performance?: {
    logging?: boolean;
    notableMs?: number;
    showWrapperMeasures?: boolean;
  };
  output?: 'hast' | 'hastJson' | 'hastCompressed';
  /**
   * Options for the code emphasis enhancer (padding frames, focus frames, etc.).
   * Passed to `createEnhanceCodeEmphasis`.
   */
  emphasisOptions?: EnhanceCodeEmphasisOptions;
  /**
   * Prefixes for comments that should be stripped from the source output.
   * Comments starting with these prefixes will be removed from the returned source.
   * They can still be collected via `notableCommentsPrefix`.
   * @example ['@highlight', '@internal']
   */
  removeCommentsWithPrefix?: string[];
  /**
   * Prefixes for notable comments that should be collected and included in the result.
   * Comments starting with these prefixes will be returned in the `comments` field,
   * which can be used by sourceEnhancers to modify the highlighted output.
   * @example ['@highlight', '@focus']
   */
  notableCommentsPrefix?: string[];
  /**
   * Marker option consumed by `pnpm docs-infra validate` (not by this loader).
   *
   * When set on a demo `index.ts` rule, the validate command ensures every
   * matched demo has a sibling `client.ts` that imports `createDemoClient`
   * from this specifier and that the demo's `create*` factory call receives
   * a `ClientProvider` entry in its meta object.
   *
   * Bare specifiers are written verbatim. Relative specifiers are resolved
   * against the directory containing `next.config.{js,mjs,ts}` and rewritten
   * to be relative to each generated `client.ts`.
   */
  requireClient?: string;
  /**
   * Marker option consumed by `pnpm docs-infra validate` (not by this loader).
   *
   * When `true` on a demo `index.ts` rule, the validate command ensures every
   * matched demo has a sibling `page.tsx` that renders the demo as the route's
   * default export, so each demo is browsable on its own page.
   *
   * Existing `page.tsx`/`page.ts` files are never overwritten.
   */
  requirePage?: boolean;
  /**
   * When `true`, registers the `TypescriptToJavascriptTransformer` so that
   * TypeScript variants also produce a JavaScript counterpart at build time.
   *
   * Defaults to `false` because the transform is comparatively expensive;
   * enable it when the rendered demos need both TS and JS sources.
   */
  transformTypescriptToJavascript?: boolean;
};

const functionName = 'Load Precomputed Code Highlighter';

/**
 * Webpack loader that processes demo files and precomputes variant data.
 *
 * Finds createDemo calls, loads and processes all variants with syntax highlighting
 * and TypeScript transformation, then injects the precomputed data back into the source.
 *
 * Supports single component syntax: createDemo(import.meta.url, Component)
 * And object syntax: createDemo(import.meta.url, { Component1, Component2 })
 *
 * Automatically skips processing if skipPrecompute: true is set.
 */
export async function loadPrecomputedCodeHighlighter(
  this: LoaderContext<LoaderOptions>,
  source: string,
): Promise<void> {
  const callback = this.async();
  this.cacheable();

  const options = this.getOptions();
  const performanceNotableMs = options.performance?.notableMs ?? 100;
  const performanceShowWrapperMeasures = options.performance?.showWrapperMeasures ?? false;

  const relativePath = path.relative(this.rootContext || process.cwd(), this.resourcePath);

  let observer: PerformanceObserver | undefined = undefined;
  if (options.performance?.logging) {
    observer = new PerformanceObserver(
      createPerformanceLogger(performanceNotableMs, performanceShowWrapperMeasures, relativePath),
    );
    observer.observe({ entryTypes: ['measure'] });
  }

  let currentMark = performanceMeasure(
    undefined,
    { mark: 'Start', measure: 'Start' },
    [functionName, relativePath],
    true,
  );

  // Convert the filesystem path to a file:// URL for cross-platform compatibility
  // pathToFileURL handles Windows drive letters correctly (e.g., C:\... → file:///C:/...)
  const resourceFileUrl = pathToFileURL(this.resourcePath).toString();

  try {
    // Parse the source to find a single createDemo call
    const demoCall = await parseCreateFactoryCall(source, resourceFileUrl);

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Parsed Factory', measure: 'Factory Parsing' },
      [functionName, relativePath],
    );

    // If no createDemo call found, return the source unchanged
    if (!demoCall) {
      callback(null, source);
      return;
    }

    // If skipPrecompute is true, return the source unchanged
    if (demoCall.options.skipPrecompute) {
      callback(null, source);
      return;
    }

    // Load variant data for all variants
    const variantData: Record<string, any> = {};
    const allDependencies: string[] = [];

    // Resolve all variant entry point paths using resolveVariantPathsWithFs
    const resolvedVariantMap = await resolveVariantPathsWithFs(demoCall.variants || {});

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Paths Resolved', measure: 'Path Resolution' },
      [functionName, relativePath],
    );

    // Create loader functions
    // Factory options take precedence over loader options for comment extraction
    // Use structuredOptions for reliable array extraction
    const structuredOptions = demoCall.structuredOptions as Record<string, unknown> | undefined;
    const factoryRemoveComments = extractStringArray(structuredOptions?.removeCommentsWithPrefix);
    const factoryNotableComments = extractStringArray(structuredOptions?.notableCommentsPrefix);

    // Always include @highlight for emphasis comments, plus any additional prefixes from options
    const notableCommentsPrefix = [
      EMPHASIS_COMMENT_PREFIX,
      FOCUS_COMMENT_PREFIX,
      ...(factoryNotableComments ?? options.notableCommentsPrefix ?? []),
    ];
    const removeCommentsWithPrefix = [
      EMPHASIS_COMMENT_PREFIX,
      FOCUS_COMMENT_PREFIX,
      ...IGNORE_COMMENT_PREFIXES,
      ...(factoryRemoveComments ?? options.removeCommentsWithPrefix ?? []),
    ];

    const loadSource = createLoadServerCodeSource({
      includeDependencies: true,
      storeAt: 'flat', // TODO: this should be configurable
      removeCommentsWithPrefix,
      notableCommentsPrefix,
    });

    // Setup source transformers for TypeScript to JavaScript conversion
    const sourceTransformers: SourceTransformers = options.transformTypescriptToJavascript
      ? [TypescriptToJavascriptTransformer]
      : [];

    // Setup source enhancers for post-parsing modifications
    const sourceEnhancers: SourceEnhancers = [createEnhanceCodeEmphasis(options.emphasisOptions)];

    // Create sourceParser promise for syntax highlighting
    const sourceParser = createParseSource();

    const functionsInitMark = performanceMeasure(
      currentMark,
      { mark: 'Functions Init', measure: 'Functions Init' },
      [functionName, relativePath],
    );
    currentMark = functionsInitMark;

    // Process variants in parallel
    const variantPromises = Array.from(resolvedVariantMap.entries()).map(
      async ([variantName, fileUrl]) => {
        const variantMark = performanceMeasure(
          functionsInitMark,
          { mark: 'Variant Started', measure: 'Variant Start' },
          [functionName, variantName, relativePath],
          true,
        );

        const namedExport = demoCall.namedExports?.[variantName];
        let variant: VariantCode | string = fileUrl;
        if (namedExport) {
          const { fileName } = getFileNameFromUrl(variant);
          if (!fileName) {
            throw new Error(
              `Cannot determine fileName from URL "${variant}" for variant "${variantName}". ` +
                `Please ensure the URL has a valid file extension.`,
            );
          }

          variant = { url: fileUrl, fileName, namedExport };
        }

        try {
          // Use loadIsomorphicCodeVariant to handle all loading, parsing, and transformation
          // This will recursively load all dependencies using loadSource
          const { code: processedVariant, dependencies } = await loadIsomorphicCodeVariant(
            fileUrl, // URL for the variant entry point (already includes file://)
            variantName,
            variant,
            {
              sourceParser, // For syntax highlighting
              loadSource, // For loading source files and dependencies
              loadVariantMeta: undefined,
              sourceTransformers, // For TypeScript to JavaScript conversion
              sourceEnhancers, // For post-parsing modifications (e.g., emphasis)
              maxDepth: 5,
              output: options.output || 'hastCompressed',
            },
          );

          performanceMeasure(
            variantMark,
            { mark: 'Variant Loaded', measure: 'Variant Loading' },
            [functionName, variantName, relativePath],
            true,
          );

          return {
            variantName,
            variantData: processedVariant, // processedVariant is a complete VariantCode
            dependencies, // All files that were loaded
          };
        } catch (error) {
          throw new Error(`Failed to load variant ${variantName} from ${fileUrl}: ${error}`);
        }
      },
    );

    const variantResults = await Promise.all(variantPromises);

    // Diagnostic: re-serialize each variant through JSON to sever any
    // `SlicedString`/`ConsString` references that may pin large parent strings
    // (e.g. raw source files) alive inside the precomputed hast tree. Enabled
    // by `DEBUG_DOCS_INFRA_FLATTEN=1`. If memory usage drops noticeably with
    // this on, the leak is SlicedString retention in variant data and we
    // should flatten at the source instead.
    const flattenVariants =
      typeof process !== 'undefined' && process.env?.DEBUG_DOCS_INFRA_FLATTEN === '1';

    // Process results and collect dependencies
    for (const result of variantResults) {
      if (result) {
        variantData[result.variantName] = flattenVariants
          ? JSON.parse(JSON.stringify(result.variantData))
          : result.variantData;
        result.dependencies.forEach((file: string) => {
          allDependencies.push(file);
        });
      }
    }

    currentMark = performanceMeasure(
      functionsInitMark,
      { mark: 'All Variants Loaded', measure: 'Complete Variants Loading' },
      [functionName, relativePath],
      true,
    );

    // Replace the factory function call with the actual precomputed data
    const modifiedSource = replacePrecomputeValue(source, variantData, demoCall);

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Replaced Precompute', measure: 'Precompute Replacement' },
      [functionName, relativePath],
    );

    // Add all dependencies to webpack's watch list
    allDependencies.forEach((dep) => {
      // Convert file:// URLs to proper file system paths for webpack's dependency tracking
      // Using fileURLToPath handles Windows drive letters correctly (e.g., file:///C:/... → C:\...)
      this.addDependency(dep.startsWith('file://') ? fileURLToPath(dep) : dep);
    });

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

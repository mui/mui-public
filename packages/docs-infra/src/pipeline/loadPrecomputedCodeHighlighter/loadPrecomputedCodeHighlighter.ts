// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';

import type { LoaderContext } from 'webpack';
import { loadCodeVariant } from '../loadCodeVariant/loadCodeVariant';
import { createParseSource } from '../parseSource';
// TODO: re-enable following benchmarking
// import { TypescriptToJavascriptTransformer } from '../transformTypescriptToJavascript';
import type { SourceTransformers, VariantCode } from '../../CodeHighlighter/types';
import { parseCreateFactoryCall } from './parseCreateFactoryCall';
import { resolveVariantPathsWithFs } from '../loadServerCodeMeta/resolveModulePathWithFs';
import { replacePrecomputeValue } from './replacePrecomputeValue';
import { createLoadServerSource } from '../loadServerSource';
import { getFileNameFromUrl } from '../loaderUtils';
import { createPerformanceLogger, logPerformance, performanceMeasure } from './performanceLogger';

export type LoaderOptions = {
  performance?: {
    logging?: boolean;
    notableMs?: number;
    showWrapperMeasures?: boolean;
  };
  output?: 'hast' | 'hastJson' | 'hastGzip';
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

  try {
    // Parse the source to find a single createDemo call
    const demoCall = await parseCreateFactoryCall(source, this.resourcePath);

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
    const loadSource = createLoadServerSource({
      includeDependencies: true,
      storeAt: 'flat', // TODO: this should be configurable
    });

    // Setup source transformers for TypeScript to JavaScript conversion
    // const sourceTransformers: SourceTransformers = [TypescriptToJavascriptTransformer];
    // TODO: maybe we should have `loadPrecomputedCodeHighlighterWithJsToTs`
    const sourceTransformers: SourceTransformers = [];

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
          // Use loadCodeVariant to handle all loading, parsing, and transformation
          // This will recursively load all dependencies using loadSource
          const { code: processedVariant, dependencies } = await loadCodeVariant(
            fileUrl, // URL for the variant entry point (already includes file://)
            variantName,
            variant,
            {
              sourceParser, // For syntax highlighting
              loadSource, // For loading source files and dependencies
              loadVariantMeta: undefined,
              sourceTransformers, // For TypeScript to JavaScript conversion
              maxDepth: 5,
              output: this.getOptions().output || 'hastGzip',
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

    // Process results and collect dependencies
    for (const result of variantResults) {
      if (result) {
        variantData[result.variantName] = result.variantData;
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
      // Strip 'file://' prefix if present before adding to webpack's dependency tracking
      this.addDependency(dep.startsWith('file://') ? dep.slice(7) : dep);
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

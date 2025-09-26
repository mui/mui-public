// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';

import type { LoaderContext } from 'webpack';
import { loadVariant } from '../../CodeHighlighter/loadVariant';
import { createParseSource } from '../parseSource';
// TODO: re-enable following benchmarking
// import { TypescriptToJavascriptTransformer } from '../transformTypescriptToJavascript';
import type { SourceTransformers, VariantCode } from '../../CodeHighlighter/types';
import { parseCreateFactoryCall } from './parseCreateFactoryCall';
import { resolveVariantPathsWithFs } from '../loaderUtils/resolveModulePathWithFs';
import { replacePrecomputeValue } from './replacePrecomputeValue';
import { createLoadServerSource } from '../loadServerSource';
import { getFileNameFromUrl } from '../loaderUtils';
import { createPerformanceLogger, logPerformance, nameMark } from './performanceLogger';

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

  let observer: PerformanceObserver | undefined = undefined;
  if (options.performance?.logging) {
    observer = new PerformanceObserver(
      createPerformanceLogger(performanceNotableMs, performanceShowWrapperMeasures),
    );
    observer.observe({ entryTypes: ['measure'] });
  }

  const relativePath = path.relative(this.rootContext || process.cwd(), this.resourcePath);
  const startMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(startMark);
  let currentMark = startMark;

  try {
    // Parse the source to find a single createDemo call
    const demoCall = await parseCreateFactoryCall(source, this.resourcePath);

    const parsedFactoryMark = nameMark(functionName, 'Parsed Factory', [relativePath]);
    performance.mark(parsedFactoryMark);
    performance.measure(
      nameMark(functionName, 'Factory Parsing', [relativePath]),
      currentMark,
      parsedFactoryMark,
    );
    currentMark = parsedFactoryMark;

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

    const pathsResolvedMark = nameMark(functionName, 'Paths Resolved', [relativePath]);
    performance.mark(pathsResolvedMark);
    performance.measure(
      nameMark(functionName, 'Path Resolution', [relativePath]),
      currentMark,
      pathsResolvedMark,
    );
    currentMark = pathsResolvedMark;

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

    const functionsInitMark = nameMark(functionName, 'Functions Init', [relativePath]);
    performance.mark(functionsInitMark);
    performance.measure(
      nameMark(functionName, 'Functions Init', [relativePath]),
      currentMark,
      functionsInitMark,
    );
    currentMark = functionsInitMark;

    // Process variants in parallel
    const variantPromises = Array.from(resolvedVariantMap.entries()).map(
      async ([variantName, fileUrl]) => {
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
          // Use loadVariant to handle all loading, parsing, and transformation
          // This will recursively load all dependencies using loadSource
          const { code: processedVariant, dependencies } = await loadVariant(
            fileUrl, // URL for the variant entry point (already includes file://)
            variantName,
            variant,
            {
              sourceParser, // For syntax highlighting
              loadSource, // For loading source files and dependencies
              loadVariantMeta: undefined,
              sourceTransformers, // For TypeScript to JavaScript conversion
              maxDepth: 5,
              output: options.output || 'hastGzip',
            },
          );

          const variantLoadedMark = nameMark(
            functionName,
            'Variant Loaded',
            [variantName, relativePath],
            true,
          );
          performance.mark(variantLoadedMark);
          performance.measure(
            nameMark(functionName, 'Variant Loading', [variantName, relativePath], true),
            currentMark,
            variantLoadedMark,
          );
          currentMark = variantLoadedMark;

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

    const variantsLoadedMark = nameMark(functionName, 'All Variants Loaded', [relativePath], true);
    performance.mark(variantsLoadedMark);
    performance.measure(
      nameMark(functionName, 'Complete Variants Loading', [relativePath], true),
      functionsInitMark,
      variantsLoadedMark,
    );
    currentMark = variantsLoadedMark;

    // Replace the factory function call with the actual precomputed data
    const modifiedSource = replacePrecomputeValue(source, variantData, demoCall);

    const replacedPrecomputeMark = nameMark(functionName, 'Replaced Precompute', [relativePath]);
    performance.mark(replacedPrecomputeMark);
    performance.measure(
      nameMark(functionName, 'Precompute Replacement', [relativePath]),
      currentMark,
      replacedPrecomputeMark,
    );
    currentMark = replacedPrecomputeMark;

    // Add all dependencies to webpack's watch list
    allDependencies.forEach((dep) => {
      // Strip 'file://' prefix if present before adding to webpack's dependency tracking
      this.addDependency(dep.startsWith('file://') ? dep.slice(7) : dep);
    });

    // log any pending performance entries before completing
    observer
      ?.takeRecords()
      ?.forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures),
      );
    observer?.disconnect();
    callback(null, modifiedSource);
  } catch (error) {
    // log any pending performance entries before completing
    observer
      ?.takeRecords()
      ?.forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures),
      );
    observer?.disconnect();
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}

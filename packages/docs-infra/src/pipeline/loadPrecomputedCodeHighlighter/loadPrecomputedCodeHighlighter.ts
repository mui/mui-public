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

export type LoaderOptions = {};

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

  try {
    // Parse the source to find a single createDemo call
    const demoCall = await parseCreateFactoryCall(source, this.resourcePath);

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
    const resolvedVariantMap = await resolveVariantPathsWithFs(demoCall.variants);

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

    // Process variants in parallel
    const variantPromises = Array.from(resolvedVariantMap.entries()).map(
      async ([variantName, fileUrl]) => {
        const namedExport = demoCall.namedExports[variantName];
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
            sourceParser, // For syntax highlighting
            loadSource, // For loading source files and dependencies
            undefined,
            sourceTransformers, // For TypeScript to JavaScript conversion
            {
              maxDepth: 5,
            },
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

    // Replace the factory function call with the actual precomputed data
    const modifiedSource = replacePrecomputeValue(source, variantData, demoCall);

    // Add all dependencies to webpack's watch list
    allDependencies.forEach((dep) => {
      // Strip 'file://' prefix if present before adding to webpack's dependency tracking
      this.addDependency(dep.startsWith('file://') ? dep.slice(7) : dep);
    });

    callback(null, modifiedSource);
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}

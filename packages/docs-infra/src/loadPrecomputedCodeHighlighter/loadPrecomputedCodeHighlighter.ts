import { loadVariant } from '../CodeHighlighter/loadVariant';
import { createParseSource } from '../parseSource';
import { TypescriptToJavascriptTransformer } from '../transformTypescriptToJavascript';
import type { SourceTransformers, Externals } from '../CodeHighlighter/types';
import { parseCreateFactoryCall } from './parseCreateFactoryCall';
import { resolveVariantPathsWithFs } from '../loaderUtils/resolveModulePathWithFs';
import { replacePrecomputeValue } from './replacePrecomputeValue';
import { createLoadServerSource } from '../loadServerSource';
import { createExternalsProvider } from './generateExternalsProvider';
import { mergeExternals } from '../loaderUtils/mergeExternals';
import { emitExternalsProvider } from './emitExternalsProvider';

/**
 * Filters out type-only imports from externals since they don't exist at runtime
 */
function filterRuntimeExternals(externals: Externals): Externals {
  const runtimeExternals: Externals = {};

  for (const [modulePath, imports] of Object.entries(externals)) {
    // Filter out imports where isType is true
    const runtimeImports = imports.filter((importItem) => !importItem.isType);

    // Only include the module if it has runtime imports
    if (runtimeImports.length > 0) {
      runtimeExternals[modulePath] = runtimeImports;
    }
  }

  return runtimeExternals;
}

interface LoaderContext {
  resourcePath: string;
  addDependency(dependency: string): void;
  async(): (err?: Error | null, content?: string) => void;
  cacheable(): void;
  emitFile?(name: string, content: string): void;
}

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
  this: LoaderContext,
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
    const sourceTransformers: SourceTransformers = [TypescriptToJavascriptTransformer];

    // Create sourceParser promise for syntax highlighting
    const sourceParser = createParseSource();

    // Process variants in parallel
    const variantPromises = Array.from(resolvedVariantMap.entries()).map(
      async ([variantName, fileUrl]) => {
        const namedExport = demoCall.namedExports[variantName];
        const variant = namedExport ? { url: fileUrl, namedExport } : fileUrl;

        try {
          // Use loadVariant to handle all loading, parsing, and transformation
          // This will recursively load all dependencies using loadSource
          const {
            code: processedVariant,
            dependencies,
            externals,
          } = await loadVariant(
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
            externals, // Combined externals from all loaded files
          };
        } catch (error) {
          console.warn(`Failed to load variant ${variantName} from ${fileUrl}:`, error);
          return null;
        }
      },
    );

    const variantResults = await Promise.all(variantPromises);

    // Process results and collect dependencies and externals
    const allExternalsArray: Externals[] = [];
    for (const result of variantResults) {
      if (result) {
        variantData[result.variantName] = result.variantData;
        result.dependencies.forEach((file: string) => {
          allDependencies.push(file);
        });
        // Collect externals for proper merging
        allExternalsArray.push(result.externals);
      }
    }

    // Properly merge externals from all variants
    const allExternals = mergeExternals(allExternalsArray);

    // Filter out type-only imports for the externals provider since they don't exist at runtime
    const runtimeExternals = filterRuntimeExternals(allExternals);

    // Create externals provider file if there are runtime external dependencies
    // Only process externals for live demos
    let externalsProviderPath: string | undefined;
    if (demoCall.live) {
      const externalsProviderInfo = createExternalsProvider(runtimeExternals, this.resourcePath);

      if (externalsProviderInfo) {
        // Use the new emitExternalsProvider which handles both webpack and turbopack
        externalsProviderPath = await emitExternalsProvider(this, externalsProviderInfo);
      }
    }

    // Replace the factory function call with the actual precomputed data
    const modifiedSource = replacePrecomputeValue(
      source,
      variantData,
      demoCall,
      externalsProviderPath,
    );

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

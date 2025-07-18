import { loadVariant } from '../CodeHighlighter/loadVariant';
import { parseSource } from '../parseSource';
import { transformTsToJs } from '../transformTsToJs';
import type { SourceTransformers } from '../CodeHighlighter/types';
import { parseCreateFactoryCall } from './parseCreateFactoryCall';
import { resolveVariantPathsWithFs } from '../resolveImports/resolveModulePathWithFs';
import { replacePrecomputeValue } from './replacePrecomputeValue';
import { createLoadSource } from './createLoadSource';
import { createLoadVariantCode } from './createLoadVariantCode';

interface LoaderContext {
  resourcePath: string;
  addDependency(dependency: string): void;
  async(): (err?: Error | null, content?: string) => void;
  cacheable(): void;
}

/**
 * Webpack loader that processes demo files and precomputes variant data.
 *
 * This loader:
 * 1. Parses demo files to find a single createDemo call with precompute: true
 * 2. Resolves all variant entry point paths using resolveModulePathsWithFs
 * 3. Uses loadVariant to handle all loading, parsing, and transformation:
 *    - loadSource: Loads individual files and extracts dependencies
 *    - loadVariantCode: Creates basic variant structure
 *    - parseSource: Applies syntax highlighting using Starry Night
 *    - sourceTransformers: Handles TypeScript to JavaScript conversion
 * 4. loadVariant handles recursive dependency loading automatically
 * 5. Adds all dependencies to webpack's watch list
 * 6. Replaces precompute: true with the actual precomputed data using replacePrecomputeValue
 *
 * Note: Only supports one createDemo call per file. Will throw an error if multiple calls are found.
 *
 * Features:
 * - Proper variant entry point resolution using resolveModulePathsWithFs
 * - Complete dependency tree loading handled by loadVariant
 * - Syntax highlighting using Starry Night (via parseSource)
 * - TypeScript to JavaScript transformation (via transformTsToJs)
 * - Webpack dependency tracking for hot reloading
 * - Precise precompute value replacement (via replacePrecomputeValue)
 *
 * Example input:
 * ```typescript
 * import { createDemo } from '@/functions/createDemo';
 * import CssModules from './CssModules';
 * import Tailwind from './Tailwind';
 *
 * export const CodeDemo = createDemo(
 *   import.meta.url,
 *   { CssModules, Tailwind },
 *   {
 *     name: 'Basic Code Block',
 *     slug: 'code',
 *     precompute: true,
 *   },
 * );
 * ```
 *
 * Example output (precompute: true replaced with processed data):
 * The precompute property is replaced with an object containing:
 * - fileName: The main file name
 * - source: HAST nodes with syntax highlighting applied
 * - extraFiles: Object containing additional dependency files
 * - transforms: Object with language variants (e.g., JavaScript version from TypeScript)
 */
export async function loadDemoCode(this: LoaderContext, source: string): Promise<void> {
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

    // If precompute is not explicitly true, return source unchanged
    if (!demoCall.options.precompute) {
      callback(null, source);
      return;
    }

    // Load variant data for all variants
    const variantData: Record<string, any> = {};
    const allDependencies: string[] = [];

    // Resolve all variant entry point paths using resolveVariantPathsWithFs
    const resolvedVariantMap = await resolveVariantPathsWithFs(demoCall.variants);

    // Create loader functions
    const loadSource = createLoadSource({
      includeDependencies: true,
      storeAt: 'flat', // TODO: this should be configurable
    });
    const loadVariantCode = createLoadVariantCode();

    // Setup source transformers for TypeScript to JavaScript conversion
    const sourceTransformers: SourceTransformers = [
      { extensions: ['ts', 'tsx'], transformer: transformTsToJs },
    ];

    // Process variants in parallel
    const variantPromises = Array.from(resolvedVariantMap.entries()).map(
      async ([variantName, fileUrl]) => {
        try {
          // Use loadVariant to handle all loading, parsing, and transformation
          // This will recursively load all dependencies using loadSource
          const { code: processedVariant, dependencies } = await loadVariant(
            fileUrl, // URL for the variant entry point (already includes file://)
            variantName,
            fileUrl, // Let loadVariantCode handle creating the initial variant
            parseSource, // For syntax highlighting
            loadSource, // For loading source files and dependencies
            loadVariantCode, // For creating basic variant structure
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
          console.warn(`Failed to load variant ${variantName} from ${fileUrl}:`, error);
          return null;
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

    // Replace 'precompute: true' with the actual precomputed data
    const modifiedSource = replacePrecomputeValue(source, variantData);

    // Add all dependencies to webpack's watch list
    allDependencies.forEach((dep) => this.addDependency(dep));

    callback(null, modifiedSource);
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}

// Default export for webpack loader
export default loadDemoCode;

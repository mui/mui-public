import { serverLoadVariantCodeWithOptions } from '../serverLoadVariantCode';
import { loadVariant } from '../CodeHighlighter/loadVariant';
import { parseSource } from '../parseSource';
import { transformTsToJs } from '../transformTsToJs';
import type { SourceTransformers } from '../CodeHighlighter/types';
import { parseCreateFactoryCall } from './parseCreateFactoryCall';
import { resolveModulePathsWithFs } from '../resolveImports/resolveModulePathWithFs';
import { replacePrecomputeValue } from './replacePrecomputeValue';

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
 * 3. Loads all variant code and dependencies using serverLoadVariantCodeWithOptions with resolved paths
 * 4. Processes code with parseSource (syntax highlighting) and transformTsToJs (TypeScript to JavaScript conversion)
 * 5. Adds all dependencies to webpack's watch list
 * 6. Replaces precompute: true with the actual precomputed data using replacePrecomputeValue
 *
 * Note: Only supports one createDemo call per file. Will throw an error if multiple calls are found.
 *
 * Features:
 * - Proper variant entry point resolution using resolveModulePathsWithFs
 * - Syntax highlighting using Starry Night (via parseSource)
 * - TypeScript to JavaScript transformation (via transformTsToJs)
 * - Recursive dependency loading
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

    // First, resolve all variant entry point paths using resolveModulePathsWithFs
    const variantPaths = Object.values(demoCall.variants);
    const resolvedVariantPaths = await resolveModulePathsWithFs(variantPaths);

    // Process variants in parallel
    const variantEntries = Object.entries(demoCall.variants);
    const variantPromises = variantEntries.map(async ([variantName, variantPath]) => {
      try {
        // Get the resolved entry point path for this variant
        const resolvedVariantPath = resolvedVariantPaths.get(variantPath);
        if (!resolvedVariantPath) {
          throw new Error(`Could not resolve variant path: ${variantPath}`);
        }

        // Load the variant code with dependencies using the resolved entry point path
        const variantResult = await serverLoadVariantCodeWithOptions(
          variantName,
          `file://${resolvedVariantPath}`, // Use the resolved variant entry point path
          {
            includeDependencies: true,
            maxDepth: 5,
            maxFiles: 50,
          },
        );

        // Setup source transformers for TypeScript to JavaScript conversion
        const sourceTransformers: SourceTransformers = [
          { extensions: ['ts', 'tsx'], transformer: transformTsToJs },
        ];

        // Use loadVariant to process the code with parsing and transformations
        // This applies:
        // 1. parseSource: Converts source code to HAST nodes with syntax highlighting
        // 2. transformTsToJs: Creates JavaScript variants for TypeScript files
        // 3. Processes all extra files with the same transformations
        const { code: processedVariant } = await loadVariant(
          resolvedVariantPath,
          variantName,
          variantResult.variant, // Use the variant property from the new interface
          parseSource,
          undefined, // loadSource - not needed since we already have the variant
          undefined, // loadVariantCode - not needed since we already have the variant
          sourceTransformers,
        );

        return {
          variantName,
          variantData: processedVariant, // processedVariant is already a clean VariantCode
          visitedFiles: variantResult.visitedFiles || [],
        };
      } catch (error) {
        console.warn(`Failed to load variant ${variantName} from ${variantPath}:`, error);
        return null;
      }
    });

    const variantResults = await Promise.all(variantPromises);

    // Process results and collect dependencies
    for (const result of variantResults) {
      if (result) {
        variantData[result.variantName] = result.variantData;
        result.visitedFiles.forEach((file) => {
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

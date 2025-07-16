import { serverLoadVariantCodeWithOptions } from '../serverLoadVariantCode';
import { loadVariant } from '../CodeHighlighter/loadVariant';
import { parseSource } from '../parseSource';
import { transformTsToJs } from '../transformTsToJs';
import type { SourceTransformers } from '../CodeHighlighter/types';
import { parseCreateFactoryCall } from './parseCreateFactoryCall';

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
 * 2. Loads all variant code and dependencies using serverLoadVariantCodeWithOptions
 * 3. Processes code with parseSource (syntax highlighting) and transformTsToJs (TypeScript to JavaScript conversion)
 * 4. Adds all dependencies to webpack's watch list
 * 5. Replaces precompute: true with the actual precomputed data
 *
 * Note: Only supports one createDemo call per file. Will throw an error if multiple calls are found.
 *
 * Features:
 * - Syntax highlighting using Starry Night (via parseSource)
 * - TypeScript to JavaScript transformation (via transformTsToJs)
 * - Recursive dependency loading
 * - Webpack dependency tracking for hot reloading
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

    // Process variants in parallel
    const variantEntries = Object.entries(demoCall.variants);
    const variantPromises = variantEntries.map(async ([variantName, variantPath]) => {
      try {
        // Load the variant code with dependencies using the current file path
        // Since demoCall.url is typically "import.meta.url", we use this.resourcePath instead
        const variantResult = await serverLoadVariantCodeWithOptions(
          variantName,
          `file://${this.resourcePath}`, // Use the current file being processed by the loader
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
          variantName,
          `file://${this.resourcePath}`, // Use the current file path consistently
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

    // Replace only the 'true' value in 'precompute: true' with the actual data
    // Find and replace just the true value, keeping the rest of the source unchanged
    const precomputeRegex = /precompute\s*:\s*true/g;
    const precomputeData = JSON.stringify(variantData, null, 2);

    // Replace 'precompute: true' with 'precompute: {data}'
    // The regex will match the exact pattern and we replace just that part
    const modifiedSource = source.replace(precomputeRegex, `precompute: ${precomputeData}`);

    // Add all dependencies to webpack's watch list
    allDependencies.forEach((dep) => this.addDependency(dep));

    callback(null, modifiedSource);
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}

// Default export for webpack loader
export default loadDemoCode;

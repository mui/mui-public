import type { LoaderContext } from 'webpack';

// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { readFile } from 'fs/promises';

import {
  parseCreateFactoryCall,
  ParsedCreateFactory,
} from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { generateResolvedExternals } from './generateResolvedExternals';
import { loadVariant } from '../../CodeHighlighter/loadVariant';
import { createLoadServerSource } from '../loadServerSource';
import { resolveVariantPathsWithFs } from '../loaderUtils/resolveModulePathWithFs';
import { getFileNameFromUrl } from '../loaderUtils';
import { mergeExternals } from '../loaderUtils/mergeExternals';
import type { Externals, VariantCode } from '../../CodeHighlighter/types';
import { filterRuntimeExternals } from './filterRuntimeExternals';
import { injectImportsIntoSource } from './injectImportsIntoSource';
import { replacePrecomputeValue } from '../loadPrecomputedCodeHighlighter/replacePrecomputeValue';

export type LoaderOptions = {};

/**
 * Webpack loader that processes demo client files and precomputes externals.
 *
 * Finds createDemoClient calls and injects all required externals as imports
 * at the top of the file, then passes them to the function as precompute.externals.
 *
 * The pattern expected is: create*Client(import.meta.url, { options: true })
 * The result will be: create*Client(import.meta.url, { options: true, precompute: { externals } })
 *
 * Automatically skips processing if skipPrecompute: true is set.
 */
export async function loadPrecomputedCodeHighlighterClient(
  this: LoaderContext<LoaderOptions>,
  source: string,
): Promise<void> {
  const callback = this.async();
  this.cacheable();

  try {
    // Parse the source to find a single createDemoClient call
    // Use metadataOnly mode since client calls only have (url, options?) arguments
    const demoCall = await parseCreateFactoryCall(source, this.resourcePath, {
      metadataOnly: true,
    });

    // If no createDemoClient call found, return the source unchanged
    if (!demoCall) {
      callback(null, source);
      return;
    }

    // Only process client factory calls (functions with "Client" in the name)
    if (!demoCall.functionName.includes('Client')) {
      callback(null, source);
      return;
    }

    // If skipPrecompute is true, return the source unchanged
    if (demoCall.options.skipPrecompute) {
      callback(null, source);
      return;
    }

    // Load variant data for all variants to collect externals
    const allDependencies: string[] = [];
    const allExternalsArray: Externals[] = [];

    // For client files, we need to read the corresponding index.ts to get variants
    // The client.ts and index.ts should be in the same directory
    const clientDir = this.resourcePath.substring(0, this.resourcePath.lastIndexOf('/'));
    const indexPath = `${clientDir}/index.ts`;

    // Read and parse the index.ts file to get variant information
    let indexDemoCall: ParsedCreateFactory | null = null;
    try {
      const indexSource = await readFile(indexPath, 'utf-8');

      // Add index.ts as a dependency for hot reloading
      this.addDependency(indexPath);

      indexDemoCall = await parseCreateFactoryCall(indexSource, indexPath);
    } catch (error) {
      // If we can't read index.ts, we can't determine variants
      console.warn(`Could not read ${indexPath} to determine variants for client: ${error}`);
      callback(null, source);
      return;
    }

    if (!indexDemoCall || !indexDemoCall.variants) {
      console.warn(`No createDemo call or variants found in ${indexPath} for client processing`);
      callback(null, source);
      return;
    }

    // Use variants from the index.ts file
    const resolvedVariantMap = await resolveVariantPathsWithFs(indexDemoCall.variants);

    // Create loader functions
    const loadSource = createLoadServerSource({
      includeDependencies: true,
      storeAt: 'flat', // TODO: choose whichever is most performant as it shouldn't affect the output
    });

    // Process variants in parallel to collect externals
    const variantPromises = Array.from(resolvedVariantMap.entries()).map(
      async ([variantName, fileUrl]) => {
        const namedExport = indexDemoCall.namedExports?.[variantName];
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
          // Use loadVariant to collect all dependencies and externals
          const { dependencies, externals } = await loadVariant(
            fileUrl, // URL for the variant entry point (already includes file://)
            variantName,
            variant,
            {
              loadSource, // For loading source files and dependencies
              maxDepth: 5,
              disableParsing: true,
              disableTransforms: true,
            },
          );

          return {
            variantName,
            dependencies, // All files that were loaded
            externals, // Combined externals from all loaded files
          };
        } catch (error) {
          throw new Error(`Failed to load variant ${variantName} from ${fileUrl}: ${error}`);
        }
      },
    );

    const variantResults = await Promise.all(variantPromises);

    // Process results and collect dependencies and externals
    for (const result of variantResults) {
      if (result) {
        result.dependencies.forEach((file: string) => {
          allDependencies.push(file);
        });
        // Collect externals for proper merging
        allExternalsArray.push(result.externals);
      }
    }

    // Properly merge externals from all variants
    const allExternals = mergeExternals(allExternalsArray);

    // Filter out type-only imports since they don't exist at runtime
    const runtimeExternals = filterRuntimeExternals(allExternals);

    // Generate import statements and resolved externals object
    const { imports: importLines, resolvedExternals } = generateResolvedExternals(runtimeExternals);

    // Add externals argument to the createDemoClient call using replacePrecomputeValue first
    // (before injecting imports, so the original positions are still valid)
    // with passPrecomputeAsIs enabled so externals are passed as resolved objects
    const precomputeData = {
      externals: resolvedExternals,
    };

    let modifiedSource = replacePrecomputeValue(source, precomputeData, demoCall, {
      passPrecomputeAsIs: true,
    });

    // Then inject imports at the top of the file (after 'use client' if present)
    modifiedSource = injectImportsIntoSource(modifiedSource, importLines);

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

// Default export for webpack loader
export default loadPrecomputedCodeHighlighterClient;

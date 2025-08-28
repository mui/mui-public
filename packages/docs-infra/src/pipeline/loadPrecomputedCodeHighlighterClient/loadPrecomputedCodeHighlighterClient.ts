import type { LoaderContext } from 'webpack';
import {
  parseCreateFactoryCall,
  ParsedCreateFactory,
} from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { generateImportStatements } from './generateImportStatements';
import { loadVariant } from '../../CodeHighlighter/loadVariant';
import { createLoadServerSource } from '../loadServerSource';
import { resolveVariantPathsWithFs } from '../loaderUtils/resolveModulePathWithFs';
import { getFileNameFromUrl } from '../loaderUtils';
import { mergeExternals } from '../loaderUtils/mergeExternals';
import type { Externals, VariantCode } from '../../CodeHighlighter/types';
import { filterRuntimeExternals } from './filterRuntimeExternals';
import { injectImportsIntoSource } from './injectImportsIntoSource';

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
    const demoCall = await parseCreateFactoryCall(source, this.resourcePath);

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
      const indexSource = await new Promise<string>((resolve, reject) => {
        this.fs.readFile(indexPath, 'utf8', (err, content) => {
          if (err) {
            reject(err);
          } else {
            resolve(content || '');
          }
        });
      });

      // Add index.ts as a dependency for hot reloading
      this.addDependency(indexPath);

      indexDemoCall = await parseCreateFactoryCall(indexSource, indexPath);
    } catch (error) {
      // If we can't read index.ts, we can't determine variants
      console.warn(`Could not read ${indexPath} to determine variants for client: ${error}`);
      callback(null, source);
      return;
    }

    if (!indexDemoCall) {
      console.warn(`No createDemo call found in ${indexPath} for client processing`);
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
          // Use loadVariant to collect all dependencies and externals
          const { dependencies, externals } = await loadVariant(
            fileUrl, // URL for the variant entry point (already includes file://)
            variantName,
            variant,
            undefined, // No highlighting needs to get the externals
            loadSource, // For loading source files and dependencies
            undefined,
            undefined, // No transforms for client
            {
              maxDepth: 5,
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

    // Generate import statements directly without creating a provider
    const importLines = generateImportStatements(runtimeExternals);

    // Inject imports at the top of the file (after 'use client' if present)
    let modifiedSource = injectImportsIntoSource(source, importLines);

    // Add externals parameter to the createDemoClient call by manually constructing the replacement
    // We'll use the original parameters and add the precompute.externals data
    const originalParameters = modifiedSource.substring(
      demoCall.parametersStartIndex,
      demoCall.parametersEndIndex,
    );

    let newParameters: string;
    if (demoCall.hasOptions && originalParameters.trim()) {
      // There are existing parameters - we need to add externals to the options object
      // Parse the existing parameters to see if we have an options object
      const trimmedParams = originalParameters.trim();
      const lastCommaIndex = trimmedParams.lastIndexOf(',');

      if (lastCommaIndex > -1) {
        // Multiple parameters - assume the last one is the options object
        const beforeLastParam = trimmedParams.substring(0, lastCommaIndex + 1);
        const lastParam = trimmedParams.substring(lastCommaIndex + 1).trim();

        // Try to add externals to the last parameter (options object)
        if (lastParam.startsWith('{') && lastParam.endsWith('}')) {
          // It's an object - add the externals property
          const objectContent = lastParam.slice(1, -1).trim();
          const newObjectContent = objectContent
            ? `${objectContent}, precompute: { externals: ${JSON.stringify(runtimeExternals)} }`
            : `precompute: { externals: ${JSON.stringify(runtimeExternals)} }`;
          newParameters = `${beforeLastParam} { ${newObjectContent} }`;
        } else {
          // Not an object - add a new parameter
          newParameters = `${trimmedParams}, { precompute: { externals: ${JSON.stringify(runtimeExternals)} } }`;
        }
      } else {
        // Single parameter - check if it's an options object
        const isOptionsObject = trimmedParams.startsWith('{') && trimmedParams.endsWith('}');
        if (isOptionsObject) {
          // It's an object - add the externals property
          const objectContent = trimmedParams.slice(1, -1).trim();
          const newObjectContent = objectContent
            ? `${objectContent}, precompute: { externals: ${JSON.stringify(runtimeExternals)} }`
            : `precompute: { externals: ${JSON.stringify(runtimeExternals)} }`;
          newParameters = `{ ${newObjectContent} }`;
        } else {
          // Not an object - add a new parameter
          newParameters = `${trimmedParams}, { precompute: { externals: ${JSON.stringify(runtimeExternals)} } }`;
        }
      }
    } else {
      // No existing parameters or options - just add the externals
      const externalsParam = `{ precompute: { externals: ${JSON.stringify(runtimeExternals)} } }`;
      newParameters = originalParameters.trim()
        ? `${originalParameters.trim()}, ${externalsParam}`
        : externalsParam;
    }

    // Replace the parameters in the function call
    modifiedSource =
      modifiedSource.substring(0, demoCall.parametersStartIndex) +
      newParameters +
      modifiedSource.substring(demoCall.parametersEndIndex);

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

import type { LoaderContext } from 'webpack';

// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { readFile } from 'fs/promises';
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath, pathToFileURL } from 'url';

import { parseCreateFactoryCall } from '../parseCreateFactoryCall/parseCreateFactoryCall';
import type { ParsedCreateFactory } from '../parseCreateFactoryCall/parseCreateFactoryCall';
import { generateDemoExternalsModule } from '../generateDemoExternalsModule';
import { ServerOnlyDemoExternalError } from '../generateDemoExternalsModule/errors';
import { collectDeclaredNames } from './collectDeclaredNames';
import { resolveVariantPathsWithFs } from '../loadServerCodeMeta/resolveModulePathWithFs';
import { injectGeneratedExternals } from './injectGeneratedExternals';

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
    // Convert the filesystem path to a file:// URL for cross-platform compatibility
    // pathToFileURL handles Windows drive letters correctly (e.g., C:\... → file:///C:/...)
    const resourceFileUrl = pathToFileURL(this.resourcePath).toString();

    // Parse the source to find a single createDemoClient call
    // Use metadataOnly mode since client calls only have (url, options?) arguments
    const demoCall = await parseCreateFactoryCall(source, resourceFileUrl, {
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

    // For client files, we need to read the corresponding index.ts to get variants
    // The client.ts and index.ts should be in the same directory
    const clientDir = path.dirname(this.resourcePath);
    const indexPath = path.join(clientDir, 'index.ts');
    // Convert to file:// URL for parseCreateFactoryCall
    const indexFileUrl = pathToFileURL(indexPath).toString();

    // Read and parse the index.ts file to get variant information
    let indexDemoCall: ParsedCreateFactory | null = null;
    try {
      const indexSource = await readFile(indexPath, 'utf-8');

      // Add index.ts as a dependency for hot reloading
      this.addDependency(indexPath);

      indexDemoCall = await parseCreateFactoryCall(indexSource, indexFileUrl);
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

    const resolvedVariantMap = await resolveVariantPathsWithFs(indexDemoCall.variants);
    const existingNames = Array.from(collectDeclaredNames(source));
    let generatedExternals;
    try {
      generatedExternals = await generateDemoExternalsModule({
        entries: Array.from(resolvedVariantMap.entries()).map(([name, url]) => ({
          name,
          url,
          namedExport: indexDemoCall.namedExports?.[name],
        })),
        existingNames,
        maxDepth: 5,
      });
    } catch (error) {
      if (!(error instanceof ServerOnlyDemoExternalError)) {
        throw error;
      }
      error.dependencies.forEach((dependency) => {
        this.addDependency(
          dependency.startsWith('file://') ? fileURLToPath(dependency) : dependency,
        );
      });
      callback(null, source);
      return;
    }

    const { dependencies: allDependencies } = generatedExternals;
    const modifiedSource = injectGeneratedExternals(source, demoCall, generatedExternals);

    // Add all dependencies to webpack's watch list
    allDependencies.forEach((dep) => {
      // Convert file:// URLs to proper file system paths for webpack's dependency tracking
      // Using fileURLToPath handles Windows drive letters correctly (e.g., file:///C:/... → C:\...)
      this.addDependency(dep.startsWith('file://') ? fileURLToPath(dep) : dep);
    });

    callback(null, modifiedSource);
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}

// Default export for webpack loader
export default loadPrecomputedCodeHighlighterClient;

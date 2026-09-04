import { getFileNameFromUrl } from '../loaderUtils';
import { mergeExternals } from '../loaderUtils/mergeExternals';
import { loadIsomorphicCodeVariant } from '../loadIsomorphicCodeVariant';
import { filterRuntimeExternals } from '../loadPrecomputedCodeHighlighterClient/filterRuntimeExternals';
import { findServerOnlyExternals } from '../loadPrecomputedCodeHighlighterClient/findServerOnlyExternals';
import { generateResolvedExternals } from '../loadPrecomputedCodeHighlighterClient/generateResolvedExternals';
import { createLoadServerCodeSource } from '../loadServerCodeSource';
import type { DemoEntry } from '../precomputeDemo';
import { ServerOnlyDemoExternalError } from './errors';
import type { GeneratedExternalsModule, GenerateDemoExternalsModuleOptions } from './types';

/** Creates the minimal variant metadata needed to traverse one entry. */
function createEntryVariant(entry: DemoEntry) {
  const fileName = entry.fileName ?? getFileNameFromUrl(entry.url).fileName;
  if (!fileName) {
    throw new Error(`Cannot determine fileName from URL "${entry.url}" for entry "${entry.name}"`);
  }

  return {
    fileName,
    url: entry.url,
    ...(entry.namedExport ? { namedExport: entry.namedExport } : {}),
  };
}

/** Serializes resolved external values as a JavaScript object expression. */
function serializeValueExpression(resolvedExternals: Record<string, string>): string {
  const entries = Object.entries(resolvedExternals).map(
    ([modulePath, value]) => `${modulePath}: ${value}`,
  );
  return `{ ${entries.join(', ')} }`;
}

/** Generates static imports and runtime external values for demo entries. */
export async function generateDemoExternalsModule(
  options: GenerateDemoExternalsModuleOptions,
): Promise<GeneratedExternalsModule> {
  const entryNames = new Set<string>();
  const entries = options.entries.map((entry) => {
    if (entryNames.has(entry.name)) {
      throw new Error(`Duplicate demo entry name: ${entry.name}`);
    }
    entryNames.add(entry.name);
    return { entry, variant: createEntryVariant(entry) };
  });

  const loadSource =
    options.loadSource ??
    createLoadServerCodeSource({
      includeDependencies: true,
      storeAt: 'canonical',
    });
  const results = await Promise.all(
    entries.map(async ({ entry, variant }) =>
      loadIsomorphicCodeVariant(entry.url, entry.name, variant, {
        disableParsing: true,
        disableTransforms: true,
        loadSource,
        maxDepth: options.maxDepth,
      }),
    ),
  );

  const dependencies = new Set<string>();
  results.forEach((result) => {
    result.dependencies.forEach((dependency) => dependencies.add(dependency));
  });
  const dependencyList = Array.from(dependencies);
  const externals = mergeExternals(results.map((result) => result.externals));
  const serverOnlyModules = findServerOnlyExternals(externals);
  if (serverOnlyModules.length > 0) {
    throw new ServerOnlyDemoExternalError(serverOnlyModules, dependencyList);
  }

  const runtimeExternals = filterRuntimeExternals(externals);
  const { imports, resolvedExternals } = generateResolvedExternals(
    runtimeExternals,
    options.existingNames,
  );
  return {
    dependencies: dependencyList,
    externals: runtimeExternals,
    imports,
    valueExpression: serializeValueExpression(resolvedExternals),
  };
}

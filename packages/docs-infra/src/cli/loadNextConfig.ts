import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OrderingConfig } from '../pipeline/loadServerTypesText/order';

const TYPES_LOADER = '@mui/internal-docs-infra/pipeline/loadPrecomputedTypes';
const TRANSFORM_METADATA_PLUGIN = '@mui/internal-docs-infra/pipeline/transformMarkdownMetadata';
const TRANSFORM_METADATA_PLUGIN_FUNCTION_NAME = 'transformMarkdownMetadata';

export type ExtractedNextConfigOptions = {
  ordering?: OrderingConfig;
  useVisibleDescription?: boolean;
};

/**
 * Reads useVisibleDescription from a remarkPlugins array.
 */
function extractUseVisibleDescriptionFromRemarkPlugins(
  remarkPlugins: unknown,
): boolean | undefined {
  if (!Array.isArray(remarkPlugins)) {
    return undefined;
  }

  for (const entry of remarkPlugins) {
    if (!Array.isArray(entry)) {
      continue;
    }

    const plugin = entry[0];
    const isPluginMatch =
      plugin === TRANSFORM_METADATA_PLUGIN ||
      (typeof plugin === 'function' && plugin.name === TRANSFORM_METADATA_PLUGIN_FUNCTION_NAME);

    if (!isPluginMatch || !entry[1] || typeof entry[1] !== 'object') {
      continue;
    }

    const pluginOptions = entry[1] as {
      extractToIndex?: { useVisibleDescription?: boolean };
    };
    if (typeof pluginOptions.extractToIndex?.useVisibleDescription === 'boolean') {
      return pluginOptions.extractToIndex.useVisibleDescription;
    }
  }

  return undefined;
}

/**
 * Extracts ordering and useVisibleDescription from loader options in a single pass.
 */
function extractOptionsFromLoaderEntries(
  loaders: { loader?: string; options?: any }[],
): ExtractedNextConfigOptions {
  const result: ExtractedNextConfigOptions = {};
  for (const loader of loaders) {
    if (typeof loader !== 'object') {
      continue;
    }
    if (!result.ordering && loader.loader === TYPES_LOADER && loader.options?.ordering) {
      result.ordering = loader.options.ordering as OrderingConfig;
    }
    if (result.useVisibleDescription === undefined && loader.options?.remarkPlugins) {
      const extracted = extractUseVisibleDescriptionFromRemarkPlugins(loader.options.remarkPlugins);
      if (typeof extracted === 'boolean') {
        result.useVisibleDescription = extracted;
      }
    }
  }
  return result;
}

/**
 * Searches turbopack rules for docs-infra options (ordering + useVisibleDescription).
 */
function extractOptionsFromTurbopack(config: any): ExtractedNextConfigOptions {
  const rules = config?.turbopack?.rules;
  if (!rules) {
    return {};
  }
  const merged: ExtractedNextConfigOptions = {};
  for (const rule of Object.values(rules)) {
    const loaders = (rule as any)?.loaders;
    if (!Array.isArray(loaders)) {
      continue;
    }
    const extracted = extractOptionsFromLoaderEntries(loaders);
    merged.ordering ??= extracted.ordering;
    merged.useVisibleDescription ??= extracted.useVisibleDescription;
  }
  return merged;
}

/**
 * Calls the webpack function with a minimal config and extracts docs-infra
 * options (ordering + useVisibleDescription) from the resulting rules.
 */
function extractOptionsFromWebpack(config: any): ExtractedNextConfigOptions {
  if (typeof config?.webpack !== 'function') {
    return {};
  }
  const webpackConfig = { module: { rules: [] as any[] }, resolve: { alias: {} }, plugins: [] };
  try {
    const result = config.webpack(webpackConfig, {
      defaultLoaders: { babel: {} },
    });
    const merged: ExtractedNextConfigOptions = {};
    for (const rule of result?.module?.rules ?? []) {
      const useEntries = Array.isArray(rule?.use) ? rule.use : [];
      const extracted = extractOptionsFromLoaderEntries(useEntries);
      merged.ordering ??= extracted.ordering;
      merged.useVisibleDescription ??= extracted.useVisibleDescription;
    }
    return merged;
  } catch {
    // webpack function may throw without real webpack context — ignore
  }
  return {};
}

const NEXT_CONFIG_EXTENSIONS = ['.mjs', '.js', '.ts'];

/**
 * Dynamically imports the next config from the given directory and extracts
 * docs-infra options needed by validate.
 */
export async function extractDocsInfraOptionsFromNextConfig(
  dir: string,
): Promise<ExtractedNextConfigOptions> {
  const configPath = await findNextConfig(dir);
  if (!configPath) {
    return {};
  }
  try {
    const configModule = await import(pathToFileURL(configPath).href);
    const config = configModule.default;
    const turbopack = extractOptionsFromTurbopack(config);
    const webpack = extractOptionsFromWebpack(config);
    return {
      ordering: turbopack.ordering ?? webpack.ordering,
      useVisibleDescription: turbopack.useVisibleDescription ?? webpack.useVisibleDescription,
    };
  } catch {
    // Config not importable — use defaults
  }
  return {};
}

async function findNextConfig(dir: string): Promise<string | undefined> {
  const checks = NEXT_CONFIG_EXTENSIONS.map(async (ext) => {
    const configPath = path.join(dir, `next.config${ext}`);
    try {
      await access(configPath);
      return configPath;
    } catch {
      return undefined;
    }
  });
  const results = await Promise.all(checks);
  return results.find(Boolean);
}

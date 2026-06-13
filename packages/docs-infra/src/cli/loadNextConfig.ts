import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import type { DescriptionReplacement } from '../pipeline/loadServerTypesMeta/format';
import type { OrderingConfig } from '../pipeline/loadServerTypesText/order';

const TYPES_LOADER = '@mui/internal-docs-infra/pipeline/loadPrecomputedTypes';
const CODE_HIGHLIGHTER_LOADER = '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter';
const TRANSFORM_METADATA_PLUGIN = '@mui/internal-docs-infra/pipeline/transformMarkdownMetadata';
const TRANSFORM_METADATA_PLUGIN_FUNCTION_NAME = 'transformMarkdownMetadata';

export interface DemoClientRequirement {
  /**
   * Either a Turbopack-style glob pattern (e.g. `./app/**\/demos/*\/index.ts`)
   * or a webpack-style RegExp used as the rule's `test`. Globs are extracted
   * from `turbopack.rules`; RegExps are extracted from `webpack` rules.
   */
  pattern: string | RegExp;
  /** Import specifier passed verbatim into the generated `client.ts`. */
  requireClient: string;
}

export interface DemoPageRequirement {
  /**
   * Either a Turbopack-style glob pattern (e.g. `./app/**\/demos/*\/index.ts`)
   * or a webpack-style RegExp used as the rule's `test`. Globs are extracted
   * from `turbopack.rules`; RegExps are extracted from `webpack` rules.
   */
  pattern: string | RegExp;
}

export type ExtractedNextConfigOptions = {
  ordering?: OrderingConfig;
  descriptionReplacements?: DescriptionReplacement[];
  useVisibleDescription?: boolean;
  generateEmbeddings?: boolean;
  socketDir?: string;
  /** Demo index patterns that opted into automatic `client.ts` generation. */
  demoClientRequirements?: DemoClientRequirement[];
  /** Demo index patterns that opted into automatic `page.tsx` generation. */
  demoPageRequirements?: DemoPageRequirement[];
};

/**
 * Reads useVisibleDescription and generateEmbeddings from a remarkPlugins array.
 */
function extractMetadataPluginOptionsFromRemarkPlugins(remarkPlugins: unknown): {
  useVisibleDescription?: boolean;
  generateEmbeddings?: boolean;
} {
  const result: { useVisibleDescription?: boolean; generateEmbeddings?: boolean } = {};
  if (!Array.isArray(remarkPlugins)) {
    return result;
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
      extractToIndex?: { useVisibleDescription?: boolean; generateEmbeddings?: boolean };
    };
    if (
      result.useVisibleDescription === undefined &&
      typeof pluginOptions.extractToIndex?.useVisibleDescription === 'boolean'
    ) {
      result.useVisibleDescription = pluginOptions.extractToIndex.useVisibleDescription;
    }
    if (
      result.generateEmbeddings === undefined &&
      typeof pluginOptions.extractToIndex?.generateEmbeddings === 'boolean'
    ) {
      result.generateEmbeddings = pluginOptions.extractToIndex.generateEmbeddings;
    }
    if (result.useVisibleDescription !== undefined && result.generateEmbeddings !== undefined) {
      break;
    }
  }

  return result;
}

/**
 * Extracts docs-infra options (ordering, descriptionReplacements, socketDir,
 * useVisibleDescription) from loader options in a single pass.
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
    if (
      !result.descriptionReplacements &&
      loader.loader === TYPES_LOADER &&
      loader.options?.descriptionReplacements
    ) {
      result.descriptionReplacements = loader.options
        .descriptionReplacements as DescriptionReplacement[];
    }
    if (
      !result.socketDir &&
      loader.loader === TYPES_LOADER &&
      typeof loader.options?.socketDir === 'string'
    ) {
      result.socketDir = loader.options.socketDir;
    }
    if (
      (result.useVisibleDescription === undefined || result.generateEmbeddings === undefined) &&
      loader.options?.remarkPlugins
    ) {
      const extracted = extractMetadataPluginOptionsFromRemarkPlugins(loader.options.remarkPlugins);
      if (
        result.useVisibleDescription === undefined &&
        typeof extracted.useVisibleDescription === 'boolean'
      ) {
        result.useVisibleDescription = extracted.useVisibleDescription;
      }
      if (
        result.generateEmbeddings === undefined &&
        typeof extracted.generateEmbeddings === 'boolean'
      ) {
        result.generateEmbeddings = extracted.generateEmbeddings;
      }
    }
  }
  return result;
}

/**
 * Searches turbopack rules for docs-infra options (ordering,
 * descriptionReplacements, socketDir, useVisibleDescription).
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
    merged.descriptionReplacements ??= extracted.descriptionReplacements;
    merged.useVisibleDescription ??= extracted.useVisibleDescription;
    merged.generateEmbeddings ??= extracted.generateEmbeddings;
    merged.socketDir ??= extracted.socketDir;
  }
  return merged;
}

/**
 * Builds a mock webpack config rich enough to satisfy common patterns used by
 * real `next.config` webpack functions (e.g. `config.resolve.extensions.filter`,
 * `config.module.rules.forEach`, `config.externals.slice`). Real webpack passes
 * an object with these properties populated, so a too-minimal mock causes
 * configs to throw before we can read their rules.
 */
function createMockWebpackConfig(): any {
  return {
    module: { rules: [] as any[] },
    resolve: {
      alias: {} as Record<string, unknown>,
      extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'],
      modules: [] as string[],
      fallback: {} as Record<string, unknown>,
    },
    plugins: [] as any[],
    externals: [] as any[],
    optimization: {},
    output: {},
    experiments: {},
  };
}

/**
 * Calls the webpack function with mock config + options pairs for both client
 * and server builds, returning a merged config or `null` if both variants
 * throw. Some Next.js configs only add loader rules when `options.isServer`
 * is true, so we need to evaluate both branches.
 */
function callWebpackSafely(config: any): any {
  if (typeof config?.webpack !== 'function') {
    return null;
  }

  const results: any[] = [];
  for (const isServer of [false, true]) {
    try {
      results.push(
        config.webpack(createMockWebpackConfig(), {
          defaultLoaders: { babel: {} },
          isServer,
          nextRuntime: isServer ? 'nodejs' : undefined,
          dev: false,
          buildId: 'docs-infra-validate',
          config: { env: {} },
          webpack: () => ({}),
        }),
      );
    } catch {
      // try next variant
    }
  }

  if (results.length === 0) {
    return null;
  }

  const mergedRules = results.flatMap((result) =>
    Array.isArray(result?.module?.rules) ? result.module.rules : [],
  );

  return {
    ...results[0],
    module: {
      ...(results[0]?.module ?? {}),
      rules: mergedRules,
    },
  };
}

/**
 * Calls the webpack function with a minimal config and extracts docs-infra
 * options (ordering, descriptionReplacements, socketDir, useVisibleDescription)
 * from the resulting rules.
 */
function extractOptionsFromWebpackResult(result: any): ExtractedNextConfigOptions {
  const merged: ExtractedNextConfigOptions = {};
  for (const rule of result?.module?.rules ?? []) {
    const useEntries = Array.isArray(rule?.use) ? rule.use : [];
    const extracted = extractOptionsFromLoaderEntries(useEntries);
    merged.ordering ??= extracted.ordering;
    merged.descriptionReplacements ??= extracted.descriptionReplacements;
    merged.useVisibleDescription ??= extracted.useVisibleDescription;
    merged.generateEmbeddings ??= extracted.generateEmbeddings;
    merged.socketDir ??= extracted.socketDir;
  }
  return merged;
}

const NEXT_CONFIG_EXTENSIONS = ['.mjs', '.js', '.ts'];

/**
 * Dynamically imports the next config from the given directory and extracts
 * docs-infra options needed by validate.
 */
/**
 * Walks Turbopack rules to collect demo patterns that opted into automatic
 * `client.ts` generation via the `requireClient` option.
 */
function extractDemoClientRequirementsFromTurbopack(config: any): DemoClientRequirement[] {
  const rules = config?.turbopack?.rules;
  if (!rules || typeof rules !== 'object') {
    return [];
  }
  const requirements: DemoClientRequirement[] = [];
  for (const [pattern, rule] of Object.entries(rules)) {
    const loaders = (rule as any)?.loaders;
    if (!Array.isArray(loaders)) {
      continue;
    }
    for (const loader of loaders) {
      if (
        loader?.loader === CODE_HIGHLIGHTER_LOADER &&
        typeof loader?.options?.requireClient === 'string'
      ) {
        requirements.push({ pattern, requireClient: loader.options.requireClient });
        break;
      }
    }
  }
  return requirements;
}

/**
 * Walks webpack rules to collect demo `test` regexes that opted into automatic
 * `client.ts` generation via the `requireClient` option. Mirrors the Turbopack
 * extractor but uses the rule's RegExp `test` as the pattern.
 */
function extractDemoClientRequirementsFromWebpackResult(result: any): DemoClientRequirement[] {
  const requirements: DemoClientRequirement[] = [];
  for (const rule of result?.module?.rules ?? []) {
    if (!(rule?.test instanceof RegExp)) {
      continue;
    }
    const useEntries = Array.isArray(rule.use) ? rule.use : [];
    for (const loader of useEntries) {
      if (
        loader?.loader === CODE_HIGHLIGHTER_LOADER &&
        typeof loader?.options?.requireClient === 'string'
      ) {
        requirements.push({ pattern: rule.test, requireClient: loader.options.requireClient });
        break;
      }
    }
  }
  return requirements;
}

/**
 * Walks Turbopack rules to collect demo patterns that opted into automatic
 * `page.tsx` generation via the `requirePage` option.
 *
 * Exported for tests.
 */
export function extractDemoPageRequirementsFromTurbopack(config: any): DemoPageRequirement[] {
  const rules = config?.turbopack?.rules;
  if (!rules || typeof rules !== 'object') {
    return [];
  }
  const requirements: DemoPageRequirement[] = [];
  for (const [pattern, rule] of Object.entries(rules)) {
    const loaders = (rule as any)?.loaders;
    if (!Array.isArray(loaders)) {
      continue;
    }
    for (const loader of loaders) {
      if (loader?.loader === CODE_HIGHLIGHTER_LOADER && loader?.options?.requirePage === true) {
        requirements.push({ pattern });
        break;
      }
    }
  }
  return requirements;
}

/**
 * Walks webpack rules to collect demo `test` regexes that opted into automatic
 * `page.tsx` generation via the `requirePage` option. Mirrors the Turbopack
 * extractor but uses the rule's RegExp `test` as the pattern.
 *
 * Exported for tests.
 */
export function extractDemoPageRequirementsFromWebpackResult(result: any): DemoPageRequirement[] {
  const requirements: DemoPageRequirement[] = [];
  for (const rule of result?.module?.rules ?? []) {
    if (!(rule?.test instanceof RegExp)) {
      continue;
    }
    const useEntries = Array.isArray(rule.use) ? rule.use : [];
    for (const loader of useEntries) {
      if (loader?.loader === CODE_HIGHLIGHTER_LOADER && loader?.options?.requirePage === true) {
        requirements.push({ pattern: rule.test });
        break;
      }
    }
  }
  return requirements;
}

export async function extractDocsInfraOptionsFromNextConfig(
  dir: string,
): Promise<ExtractedNextConfigOptions> {
  const configPath = await findNextConfig(dir);
  if (!configPath) {
    return {};
  }
  let config: any;
  try {
    if (configPath.endsWith('.ts')) {
      // Use jiti so TypeScript configs (and their transitive .ts imports
      // without extensions) load the same way Next.js itself loads them.
      const jiti = createJiti(configPath, { interopDefault: true });
      const configModule = await jiti.import<any>(configPath);
      config = (configModule as any)?.default ?? configModule;
    } else {
      const configModule = await import(pathToFileURL(configPath).href);
      config = configModule.default;
    }
  } catch (error) {
    // Surface the failure: a silently-swallowed import error here means
    // demoClientRequirements (and other extracted options) end up empty,
    // which usually presents to the user as `validate` doing nothing.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[docs-infra] Failed to load ${path.relative(dir, configPath)} for option extraction: ${message}`,
    );
    return {};
  }
  const turbopack = extractOptionsFromTurbopack(config);
  const webpackResult = callWebpackSafely(config);
  const webpack = webpackResult ? extractOptionsFromWebpackResult(webpackResult) : {};
  const turbopackDemoClientRequirements = extractDemoClientRequirementsFromTurbopack(config);
  const webpackDemoClientRequirements = webpackResult
    ? extractDemoClientRequirementsFromWebpackResult(webpackResult)
    : [];
  const demoClientRequirements = [
    ...new Map(
      [...turbopackDemoClientRequirements, ...webpackDemoClientRequirements].map((requirement) => [
        `${typeof requirement.pattern === 'string' ? requirement.pattern : requirement.pattern.toString()}::${requirement.requireClient}`,
        requirement,
      ]),
    ).values(),
  ];
  const turbopackDemoPageRequirements = extractDemoPageRequirementsFromTurbopack(config);
  const webpackDemoPageRequirements = webpackResult
    ? extractDemoPageRequirementsFromWebpackResult(webpackResult)
    : [];
  const demoPageRequirements = [
    ...new Map(
      [...turbopackDemoPageRequirements, ...webpackDemoPageRequirements].map((requirement) => [
        typeof requirement.pattern === 'string'
          ? requirement.pattern
          : requirement.pattern.toString(),
        requirement,
      ]),
    ).values(),
  ];
  return {
    ordering: turbopack.ordering ?? webpack.ordering,
    descriptionReplacements: turbopack.descriptionReplacements ?? webpack.descriptionReplacements,
    useVisibleDescription: turbopack.useVisibleDescription ?? webpack.useVisibleDescription,
    generateEmbeddings: turbopack.generateEmbeddings ?? webpack.generateEmbeddings,
    socketDir: turbopack.socketDir ?? webpack.socketDir,
    demoClientRequirements: demoClientRequirements.length > 0 ? demoClientRequirements : undefined,
    demoPageRequirements: demoPageRequirements.length > 0 ? demoPageRequirements : undefined,
  };
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

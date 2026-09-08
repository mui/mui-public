import type { VariantCode } from '../../CodeHighlighter/types';
import {
  createEnhanceCodeEmphasis,
  EMPHASIS_COMMENT_PREFIX,
  FOCUS_COMMENT_PREFIX,
} from '../enhanceCodeEmphasis';
import { getFileNameFromUrl, IGNORE_COMMENT_PREFIXES } from '../loaderUtils';
import { mergeExternals } from '../loaderUtils/mergeExternals';
import { loadIsomorphicCodeVariant } from '../loadIsomorphicCodeVariant';
import { createParseSource } from '../parseSource';
import { createLoadServerCodeSource } from '../loadServerCodeSource';
import type { DemoEntry, PrecomputedDemo, PrecomputeDemoOptions } from './types';

/** Creates the variant metadata used to process one demo entry. */
function createEntryVariant(entry: DemoEntry): VariantCode {
  const fileName = entry.fileName ?? getFileNameFromUrl(entry.url).fileName;
  if (!fileName) {
    throw new Error(`Cannot determine fileName from URL "${entry.url}" for entry "${entry.name}"`);
  }

  return {
    fileName,
    url: entry.url,
    ...(entry.language ? { language: entry.language } : {}),
    ...(entry.namedExport ? { namedExport: entry.namedExport } : {}),
  };
}

/** Loads and processes demo source entries without a factory wrapper. */
export async function precomputeDemo(options: PrecomputeDemoOptions): Promise<PrecomputedDemo> {
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
      includeDependencies: options.includeDependencies,
      notableCommentsPrefix: [EMPHASIS_COMMENT_PREFIX, FOCUS_COMMENT_PREFIX],
      removeCommentsWithPrefix: [
        EMPHASIS_COMMENT_PREFIX,
        FOCUS_COMMENT_PREFIX,
        ...IGNORE_COMMENT_PREFIXES,
      ],
      storeAt: 'canonical',
    });
  const sourceParser = options.sourceParser ?? createParseSource();
  const sourceEnhancers = options.sourceEnhancers ?? [createEnhanceCodeEmphasis()];

  const results = await Promise.all(
    entries.map(async ({ entry, variant }) => ({
      name: entry.name,
      result: await loadIsomorphicCodeVariant(entry.url, entry.name, variant, {
        loadSource,
        maxDepth: options.maxDepth,
        output: options.output ?? 'hastCompressed',
        sourceEnhancers,
        sourceParser,
        sourceTransformers: options.sourceTransformers,
      }),
    })),
  );

  const code: PrecomputedDemo['code'] = {};
  const dependencies = new Set<string>();
  for (const { name, result } of results) {
    code[name] = result.code;
    result.dependencies.forEach((dependency) => dependencies.add(dependency));
  }

  return {
    code,
    dependencies: Array.from(dependencies),
    externals: mergeExternals(results.map(({ result }) => result.externals)),
  };
}

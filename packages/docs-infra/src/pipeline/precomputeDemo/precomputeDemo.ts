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
import { createEditableSourceProjection } from '../loadIsomorphicCodeVariant/createEditableSourceProjection';
import { getHastTextContent } from '../hastUtils';
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

/**
 * Resolves a compatibility preview against one loaded variant, recording the
 * region it names as the variant's editable source projection.
 *
 * Each variant resolves the preview on its own: a preview written against the
 * TypeScript source may not appear in the JavaScript one, and a variant it
 * cannot resolve against simply carries no projection.
 */
function resolvePreviewProjection(
  variant: VariantCode,
  preview: string | undefined,
  variantName: string,
): VariantCode {
  if (!preview) {
    return variant;
  }

  const { source } = variant;
  let fullSource: string | undefined;
  if (typeof source === 'string') {
    fullSource = source;
  } else if (source && 'type' in source && source.type === 'root') {
    fullSource = getHastTextContent(source);
  }
  if (!fullSource) {
    return variant;
  }

  const sourceProjection = createEditableSourceProjection({ fullSource, previewSource: preview });
  if (!sourceProjection) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `precomputeDemo: the preview does not resolve against the "${variantName}" source, so that variant carries no projection.`,
      );
    }
    return variant;
  }

  return { ...variant, sourceProjection };
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
      storeAt: 'flat',
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
    code[name] = resolvePreviewProjection(result.code, options.preview, name);
    result.dependencies.forEach((dependency) => dependencies.add(dependency));
  }

  return {
    code,
    dependencies: Array.from(dependencies),
    externals: mergeExternals(results.map(({ result }) => result.externals)),
  };
}

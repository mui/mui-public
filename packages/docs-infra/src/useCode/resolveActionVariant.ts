import type { Fallbacks, VariantCode, VariantExtraFiles } from '../CodeHighlighter/types';
import type { TransformEngineLoader } from '../CodeProvider/CodeContext';
import type { TransformedFiles } from './useCodeUtils';
import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import { frameFallbackFromSpans } from '../pipeline/hastUtils';
import { peekTransformEngine, preloadTransformEngine } from './transformEngineCache';

export interface ResolvedActionVariant {
  variant: VariantCode;
  filenameMap: Record<string, string>;
  transformed: boolean;
}

/** Restores fallback dictionaries that a loading shell hoisted out of the variant. */
function attachFallbacks(variant: VariantCode, fallbacks?: Fallbacks): VariantCode {
  if (!fallbacks) {
    return variant;
  }
  const extraFiles = Object.fromEntries(
    Object.entries(variant.extraFiles ?? {}).map(([fileName, file]) => [
      fileName,
      typeof file === 'string' ? file : { ...file, fallback: file.fallback ?? fallbacks[fileName] },
    ]),
  );
  return {
    ...variant,
    fallback: variant.fallback ?? (variant.fileName ? fallbacks[variant.fileName] : undefined),
    ...(variant.extraFiles && { extraFiles }),
  };
}

/** Returns an identity filename map for every source file in a variant. */
function createFilenameMap(variant: VariantCode): Record<string, string> {
  const filenameMap: Record<string, string> = {};
  if (variant.fileName) {
    filenameMap[variant.fileName] = variant.fileName;
  }
  for (const fileName of Object.keys(variant.extraFiles ?? {})) {
    filenameMap[fileName] = fileName;
  }
  return filenameMap;
}

/** Rebuilds a variant from the complete file set returned by the transform engine. */
function mergeTransformedFiles(
  variant: VariantCode,
  transformedFiles: TransformedFiles | undefined,
): ResolvedActionVariant {
  if (!transformedFiles || transformedFiles.files.length === 0) {
    return { variant, filenameMap: createFilenameMap(variant), transformed: false };
  }

  const transformedByOriginalName = new Map(
    transformedFiles.files.map((file) => [file.originalName, file]),
  );
  const mainFile = variant.fileName ? transformedByOriginalName.get(variant.fileName) : undefined;
  const extraFiles: VariantExtraFiles = {};

  for (const [fileName, fileData] of Object.entries(variant.extraFiles ?? {})) {
    const transformedFile = transformedByOriginalName.get(fileName);
    if (!transformedFile) {
      extraFiles[fileName] = fileData;
      continue;
    }
    extraFiles[transformedFile.name] = {
      ...(typeof fileData === 'string' ? {} : fileData),
      source: transformedFile.source,
      ...(transformedFile.comments && { comments: transformedFile.comments }),
      ...(transformedFile.sourceProjection && {
        sourceProjection: transformedFile.sourceProjection,
      }),
    };
  }

  return {
    variant: {
      ...variant,
      ...(mainFile && {
        fileName: mainFile.name,
        source: mainFile.source,
        comments: mainFile.comments,
        sourceProjection: mainFile.sourceProjection,
      }),
      extraFiles,
      ...(variant.filesOrder && {
        filesOrder: variant.filesOrder.map(
          (fileName) => transformedFiles.filenameMap[fileName] ?? fileName,
        ),
      }),
    },
    filenameMap: { ...createFilenameMap(variant), ...transformedFiles.filenameMap },
    transformed: true,
  };
}

/** Applies a loaded transform engine to a variant. */
function transformActionVariant(
  variant: VariantCode,
  selectedTransform: string,
  fallbacks?: Fallbacks,
): ResolvedActionVariant {
  const transformEngine = peekTransformEngine();
  if (!transformEngine) {
    return { variant, filenameMap: createFilenameMap(variant), transformed: false };
  }
  return mergeTransformedFiles(
    variant,
    transformEngine(
      variant,
      selectedTransform,
      { decode: decodeHastSource, frameFallbackFromSpans },
      fallbacks,
    ),
  );
}

/** Loads the transform engine before resolving an action variant. */
async function loadActionVariant(
  variant: VariantCode,
  selectedTransform: string,
  transformEngineLoader?: TransformEngineLoader,
  fallbacks?: Fallbacks,
): Promise<ResolvedActionVariant> {
  await preloadTransformEngine(transformEngineLoader);
  return transformActionVariant(variant, selectedTransform, fallbacks);
}

/** Resolves the source and filenames used by copy and external export actions. */
export function resolveActionVariant(
  variant: VariantCode,
  selectedTransform: string | null | undefined,
  transformEngineLoader?: TransformEngineLoader,
  fallbacks?: Fallbacks,
): ResolvedActionVariant | Promise<ResolvedActionVariant> {
  const actionVariant = attachFallbacks(variant, fallbacks);
  if (!selectedTransform) {
    return {
      variant: actionVariant,
      filenameMap: createFilenameMap(actionVariant),
      transformed: false,
    };
  }
  if (peekTransformEngine()) {
    return transformActionVariant(actionVariant, selectedTransform, fallbacks);
  }
  return loadActionVariant(actionVariant, selectedTransform, transformEngineLoader, fallbacks);
}

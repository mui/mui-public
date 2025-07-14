import { transformSource } from './transformSource';
import { transformParsedSource } from './transformParsedSource';
import type {
  VariantCode,
  VariantSource,
  Transforms,
  ParseSource,
  LoadSource,
  LoadVariantCode,
  SourceTransformers,
} from './types';

async function loadSingleFile(
  variantName: string,
  fileName: string,
  source: VariantSource | undefined,
  url: string | undefined,
  loadSource: LoadSource | undefined,
  parseSource: ParseSource | undefined,
  sourceTransformers: SourceTransformers | undefined,
  transforms?: Transforms,
): Promise<{ source: VariantSource; transforms?: Transforms }> {
  let finalSource = source;

  // Load source if not provided
  if (!finalSource) {
    if (!loadSource) {
      throw new Error('"loadSource" function is required when source is not provided');
    }

    try {
      finalSource = await loadSource(variantName, fileName, url);
    } catch (error) {
      throw new Error(
        `Failed to load source code (variant: ${variantName}, file: ${fileName}, url: ${url}): ${JSON.stringify(error)}`,
      );
    }
  }

  // Apply source transformers if no transforms exist
  let finalTransforms = transforms;
  if (sourceTransformers && !finalTransforms) {
    finalTransforms = await transformSource(finalSource, fileName, sourceTransformers);
  }

  // Parse source if it's a string
  if (typeof finalSource === 'string') {
    if (!parseSource) {
      // TODO: this needs to check shouldHighlight
      throw new Error(
        '"parseSource" function is required when source is a string and highlightAt is "init"',
      );
    }

    try {
      const sourceString = finalSource;
      finalSource = await parseSource(finalSource, fileName);

      if (finalTransforms) {
        finalTransforms = await transformParsedSource(
          sourceString,
          finalSource,
          fileName,
          finalTransforms,
          parseSource,
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to parse source code (variant: ${variantName}, file: ${fileName}, url: ${url}): ${error instanceof Error ? error.message : ''}`,
      );
    }
  }

  return { source: finalSource, transforms: finalTransforms };
}

export async function loadVariant(
  variantName: any,
  url?: string,
  variant?: VariantCode,
  parseSource?: ParseSource,
  loadSource?: LoadSource,
  loadVariantCode?: LoadVariantCode,
  sourceTransformers?: SourceTransformers,
): Promise<{ variant: string; code: VariantCode }> {
  if (!variant) {
    if (!loadVariantCode) {
      throw new Error('"loadVariantCode" function is required when filenames are not provided');
    }

    try {
      variant = await loadVariantCode(variantName, url);
    } catch (error) {
      throw new Error(
        `Failed to load variant code (variant: ${variantName}, url: ${url}): ${JSON.stringify(error)}`,
      );
    }
  }

  const mainFileResult = await loadSingleFile(
    variantName,
    variant.fileName,
    variant.source,
    url,
    loadSource,
    parseSource,
    sourceTransformers,
    variant.transforms,
  );

  let processedExtraFiles = variant.extraFiles;
  if (variant.extraFiles) {
    processedExtraFiles = {};

    const extraFileEntries = Object.entries(variant.extraFiles);
    const extraFilePromises = extraFileEntries.map(async ([fileName, fileData]) => {
      try {
        const extraFileResult = await loadSingleFile(
          variantName,
          fileName,
          fileData?.source,
          url,
          loadSource,
          parseSource,
          sourceTransformers,
        );

        return [
          fileName,
          {
            ...fileData,
            source: extraFileResult.source,
            transforms: extraFileResult.transforms,
          },
        ] as const;
      } catch (error) {
        throw new Error(
          `Failed to load extra file (variant: ${variantName}, file: ${fileName}, url: ${url}): ${error instanceof Error ? error.message : ''}`,
        );
      }
    });

    const extraFileResults = await Promise.all(extraFilePromises);
    for (const [fileName, fileData] of extraFileResults) {
      processedExtraFiles[fileName] = fileData;
    }
  }

  const finalVariant: VariantCode = {
    ...variant,
    source: mainFileResult.source,
    transforms: mainFileResult.transforms,
    extraFiles: processedExtraFiles,
  };

  return {
    variant: variantName,
    code: finalVariant,
  };
}

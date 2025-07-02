import type {
  Code,
  VariantCode,
  VariantExtraFiles,
  ParseSource,
  LoadSource,
  LoadVariantCode,
  VariantSource,
} from './types';

export type FallbackVariants = {
  code: Code;
  initialFilename: string;
  initialSource: VariantSource;
  initialExtraFiles?: VariantExtraFiles;
};

export async function loadFallbackVariant(
  initialVariant: string,
  shouldHighlight?: boolean,
  loaded?: Code,
  initial?: VariantCode,
  url?: string,
  parseSource?: ParseSource,
  loadSource?: LoadSource,
  loadVariantCode?: LoadVariantCode,
): Promise<FallbackVariants> {
  if (!loaded) {
    loaded = {};
  }

  if (!initial) {
    if (!loadVariantCode) {
      throw new Error(
        '"loadVariantCode" function is required when initial filenames are not provided',
      );
    }

    try {
      initial = await loadVariantCode(initialVariant, url);
      loaded[initialVariant] = initial;
    } catch (error) {
      throw new Error(
        `Failed to load initial variant code (variant: ${initialVariant}, url: ${url}): ${JSON.stringify(error)}`,
      );
    }
  }

  const initialFilename = initial.fileName;
  let initialSource = initial.source;
  if (!initialSource) {
    if (!loadSource) {
      throw new Error('"loadSource" function is required when initial source is not provided');
    }

    try {
      initialSource = await loadSource(initialVariant, initialFilename, url);
      loaded[initialVariant] = { ...(loaded[initialVariant] || {}), source: initialSource };
    } catch (error) {
      throw new Error(
        `Failed to load initial source code (variant: ${initialVariant}, file: ${initialFilename}, url: ${url}): ${JSON.stringify(error)}`,
      );
    }
  }

  if (typeof initialSource === 'string' && shouldHighlight) {
    if (!parseSource) {
      throw new Error(
        '"parseSource" function is required when initial source is a string and highlightAt is "init"',
      );
    }

    try {
      initialSource = await parseSource(initialSource);
      loaded[initialVariant] = { ...(loaded[initialVariant] || {}), source: initialSource };
    } catch (error) {
      throw new Error(
        `Failed to parse initial source code (variant: ${initialVariant}, file: ${initialFilename}, url: ${url}): ${JSON.stringify(error)}`,
      );
    }
  }

  initialSource;

  // TODO: handle fallbackUsesExtraFiles and fallbackUsesAllVariants

  return {
    code: loaded,
    initialFilename,
    initialSource,
    initialExtraFiles: initial.extraFiles || {},
  };
}

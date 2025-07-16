import type {
  Code,
  VariantExtraFiles,
  ParseSource,
  LoadSource,
  LoadVariantCode,
  VariantSource,
  LoadCode,
} from './types';

export type FallbackVariants = {
  code: Code;
  initialFilename: string;
  initialSource: VariantSource;
  initialExtraFiles?: VariantExtraFiles;
};

export async function loadFallbackVariant(
  url: string,
  initialVariant: string,
  loaded: Code | undefined,
  shouldHighlight?: boolean,
  parseSource?: ParseSource,
  loadSource?: LoadSource,
  loadVariantCode?: LoadVariantCode,
  loadCode?: LoadCode,
): Promise<FallbackVariants> {
  loaded = { ...loaded };

  let initial = loaded[initialVariant];
  if (!initial) {
    if (!loadCode) {
      throw new Error('"loadCode" function is required when initial variant is not provided');
    }

    try {
      loaded = await loadCode(url);
    } catch (error) {
      throw new Error(`Failed to load code from URL: ${url}. Error: ${JSON.stringify(error)}`);
    }

    initial = loaded[initialVariant];
    if (!initial) {
      throw new Error(`Initial variant "${initialVariant}" not found in loaded code.`);
    }
  }

  if (typeof initial === 'string') {
    if (!loadVariantCode) {
      throw new Error('"loadVariantCode" function is required when initial variant is a string');
    }

    try {
      initial = await loadVariantCode(initialVariant, initial);
      loaded = { ...loaded, [initialVariant]: initial };
    } catch (error) {
      throw new Error(
        `Failed to load initial variant code (variant: ${initialVariant}, url: ${initial}): ${JSON.stringify(error)}`,
      );
    }
  }

  const initialFilename = initial.fileName;
  let initialSource = initial.source; // TODO: if filesOrder is provided, we need to determine which source to use
  if (!initialSource) {
    if (!loadSource) {
      throw new Error('"loadSource" function is required when initial source is not provided');
    }

    try {
      initialSource = await loadSource(initialVariant, initialFilename, url);
      loaded = { ...loaded, [initialVariant]: { ...(initial || {}), source: initialSource } };
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
      initialSource = await parseSource(initialSource, initialFilename);
      loaded = { ...loaded, [initialVariant]: { ...(initial || {}), source: initialSource } };
    } catch (error) {
      throw new Error(
        `Failed to parse initial source code (variant: ${initialVariant}, file: ${initialFilename}, url: ${url}): ${JSON.stringify(error)}`,
      );
    }
  }

  // TODO: handle fallbackUsesExtraFiles and fallbackUsesAllVariants

  return {
    code: loaded,
    initialFilename,
    initialSource,
    initialExtraFiles: initial.extraFiles || {},
  };
}

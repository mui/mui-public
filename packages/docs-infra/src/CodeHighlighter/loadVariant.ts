import { transformSource } from './transformSource';
import type {
  VariantCode,
  ParseSource,
  LoadSource,
  LoadVariantCode,
  SourceTransformers,
} from './types';

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

  const filename = variant.fileName;
  let source = variant.source;
  if (!source) {
    if (!loadSource) {
      throw new Error('"loadSource" function is required when source is not provided');
    }

    try {
      source = await loadSource(variantName, filename, url);
      variant = { ...variant, source };
    } catch (error) {
      throw new Error(
        `Failed to load source code (variant: ${variantName}, file: ${filename}, url: ${url}): ${JSON.stringify(error)}`,
      );
    }
  }

  if (sourceTransformers && !('transforms' in variant)) {
    const transforms = await transformSource(source, filename, sourceTransformers);
    variant = { ...variant, transforms };
  }

  if (typeof source === 'string') {
    if (!parseSource) {
      // TODO: this needs to check shouldHighlight
      throw new Error(
        '"parseSource" function is required when source is a string and highlightAt is "init"',
      );
    }

    try {
      source = await parseSource(source, filename);
      variant = { ...variant, source };
    } catch (error) {
      throw new Error(
        `Failed to parse source code (variant: ${variantName}, file: ${filename}, url: ${url}): ${JSON.stringify(error)}`,
      );
    }
  }

  // TODO: extraFiles handling

  return {
    variant: variantName,
    code: variant,
  };
}

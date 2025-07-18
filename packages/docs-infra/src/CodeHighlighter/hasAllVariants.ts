import { Code, VariantSource } from './types';

function isSourceLoaded(code: { source?: VariantSource }, needsHighlight?: boolean): boolean {
  if (!code.source) {
    return false;
  }

  if (typeof code.source === 'string' && needsHighlight) {
    // TODO: handle 'stream' case
    return false;
  }

  // if it's a hast node or hastJson, we assume it's loaded
  return true;
}

export function hasAllVariants(variants: string[], code: Code, needsHighlight?: boolean) {
  return variants.every((variant) => {
    const codeVariant = code?.[variant];
    if (
      !codeVariant ||
      typeof codeVariant === 'string' ||
      !isSourceLoaded(codeVariant, needsHighlight)
    ) {
      return false;
    }

    const extraFiles = codeVariant.extraFiles;
    if (!extraFiles) {
      return true;
    }

    return Object.keys(extraFiles).every((file) => {
      const extraFile = extraFiles[file];
      if (
        !extraFile ||
        typeof extraFile === 'string' ||
        !isSourceLoaded(extraFile, needsHighlight)
      ) {
        return false;
      }

      return true;
    });
  });
}

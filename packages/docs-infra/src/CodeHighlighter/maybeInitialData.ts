import { hasAllVariants } from './hasAllVariants';
import { Code, VariantExtraFiles, VariantSource } from './types';

export function maybeInitialData(
  variants: string[],
  variant: string,
  code?: Code,
  fileName?: string,
  needsHighlight = false,
  needsAllFiles = false,
  needsAllVariants = false,
): {
  initialData:
    | false
    | {
        code: Code;
        initialFilename: string | undefined;
        initialSource: VariantSource;
        initialExtraFiles?: VariantExtraFiles;
      };
  reason?: string;
} {
  if (!code) {
    return {
      initialData: false,
      reason: 'No code provided',
    };
  }

  if (needsAllVariants && !hasAllVariants(variants, code, needsHighlight)) {
    return {
      initialData: false,
      reason: 'Not all variants are available',
    };
  }

  const variantCode = code[variant];
  if (!variantCode || typeof variantCode === 'string') {
    return {
      initialData: false,
      reason: 'Variant code is not loaded yet',
    };
  }

  if (needsAllFiles) {
    if (!variantCode) {
      return {
        initialData: false,
        reason: 'Variant code not found',
      };
    }

    if (!variantCode.source) {
      return {
        initialData: false,
        reason: 'Variant source not found',
      };
    }

    if (
      variantCode.extraFiles &&
      !Object.keys(variantCode.extraFiles).every((file) => {
        const fileData = variantCode.extraFiles?.[file];
        return typeof fileData === 'object' && fileData?.source !== undefined;
      })
    ) {
      return {
        initialData: false,
        reason: 'Not all extra files are available',
      };
    }
  }

  // TODO, filename might need to be determined from filesOrder if provided?
  const initialFilename = fileName || variantCode.fileName;
  let fileSource: VariantSource | undefined;

  if (fileName && fileName !== variantCode.fileName) {
    const fileData = variantCode?.extraFiles?.[fileName];
    if (!fileData) {
      return {
        initialData: false,
        reason: `File not found in code`,
      };
    }

    if (typeof fileData === 'string') {
      // It's a URL, not actual source content
      return {
        initialData: false,
        reason: `File is not loaded yet`,
      };
    }

    fileSource = fileData.source;
  } else {
    fileSource = variantCode.source;
  }

  if (!fileSource) {
    return {
      initialData: false,
      reason: `File source not found`,
    };
  }

  if (needsHighlight && typeof fileSource === 'string') {
    return {
      initialData: false,
      reason: 'File needs highlighting',
    };
  }

  return {
    initialData: {
      code,
      initialFilename,
      initialSource: fileSource,
      initialExtraFiles: variantCode?.extraFiles,
    },
  };
}

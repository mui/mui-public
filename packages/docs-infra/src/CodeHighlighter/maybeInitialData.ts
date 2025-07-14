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
        initialFilename: string;
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

  if (needsAllVariants && !variants.every((v) => code[v] !== undefined)) {
    // If we need all variants, we check if the code has all the variants
    return {
      initialData: false,
      reason: 'Not all variants are available',
    };
  }

  const variantCode = code[variant];
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
      !Object.keys(variantCode.extraFiles).every(
        (file) => variantCode.extraFiles?.[file]?.source !== undefined,
      )
    ) {
      return {
        initialData: false,
        reason: 'Not all extra files are available',
      };
    }
  }

  // TODO, filename might need to be determined from filesOrder if provided?
  const file = fileName ? variantCode?.extraFiles?.[fileName] : variantCode;
  const initialFilename = fileName || variantCode.fileName;
  if (!file || !file.source) {
    return {
      initialData: false,
      reason: `File not found in code`,
    };
  }

  if (needsHighlight && typeof file.source === 'string') {
    return {
      initialData: false,
      reason: 'File needs highlighting',
    };
  }

  return {
    initialData: {
      code,
      initialFilename,
      initialSource: file.source,
      initialExtraFiles: variantCode?.extraFiles,
    },
  };
}

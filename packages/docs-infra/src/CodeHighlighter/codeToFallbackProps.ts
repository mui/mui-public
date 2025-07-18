import { Code, ContentLoadingProps, ContentLoadingVariant, VariantCode } from './types';
import { stringOrHastToJsx } from '../hast/hast';

function toExtraSource(variantCode: VariantCode, fileName?: string) {
  return Object.entries(variantCode.extraFiles || {}).reduce(
    (acc, [name, file]) => {
      if (name !== fileName && typeof file === 'object' && file?.source) {
        acc[name] = stringOrHastToJsx(file.source);
      }
      return acc;
    },
    { [variantCode.fileName]: variantCode.source && stringOrHastToJsx(variantCode.source) },
  );
}

export function codeToFallbackProps(
  variant: string,
  code?: Code,
  fileName?: string,
  needsAllFiles = false,
  needsAllVariants = false,
): ContentLoadingProps {
  const variantCode = code?.[variant];
  if (!variantCode || typeof variantCode === 'string') {
    return {};
  }

  const fileNames = [variantCode.fileName, ...Object.keys(variantCode.extraFiles || {})];
  let source;

  if (fileName) {
    const fileData = variantCode.extraFiles?.[fileName];
    if (fileData && typeof fileData === 'object' && 'source' in fileData && fileData.source) {
      source = stringOrHastToJsx(fileData.source);
    }
  } else if (variantCode.source) {
    source = stringOrHastToJsx(variantCode.source);
  }

  if (needsAllVariants || needsAllFiles) {
    const extraSource = toExtraSource(variantCode, fileName);

    if (needsAllVariants) {
      const extraVariants = Object.entries(code || {}).reduce(
        (acc, [name, vCode]) => {
          if (name !== variant && vCode && typeof vCode !== 'string') {
            const extraVariantExtraSource = toExtraSource(vCode, vCode.fileName);

            acc[name] = {
              fileNames: [vCode.fileName, ...Object.keys(vCode.extraFiles || {})], // TODO: use filesOrder if provided
              source: vCode.source && stringOrHastToJsx(vCode.source),
              extraSource: extraVariantExtraSource,
            };
          }
          return acc;
        },
        {} as Record<string, ContentLoadingVariant>,
      );

      return {
        fileNames,
        source,
        extraSource,
        extraVariants,
      };
    }

    return {
      fileNames,
      source,
      extraSource,
    };
  }

  return {
    fileNames,
    source,
  };
}

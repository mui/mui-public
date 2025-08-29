import { BaseContentLoadingProps, Code, ContentLoadingVariant, VariantCode } from './types';
import { stringOrHastToJsx } from '../pipeline/hastUtils';

function toExtraSource(variantCode: VariantCode, fileName?: string) {
  return Object.entries(variantCode.extraFiles || {}).reduce(
    (acc, [name, file]) => {
      if (name !== fileName && typeof file === 'object' && file?.source) {
        acc[name] = stringOrHastToJsx(file.source);
      }
      return acc;
    },
    {} as Record<string, any>,
  );
}

export function codeToFallbackProps(
  variant: string,
  code?: Code,
  fileName?: string,
  needsAllFiles = false,
  needsAllVariants = false,
): BaseContentLoadingProps {
  const variantCode = code?.[variant];
  if (!variantCode || typeof variantCode === 'string') {
    return {};
  }

  const fileNames = [variantCode.fileName, ...Object.keys(variantCode.extraFiles || {})].filter(
    (name): name is string => Boolean(name),
  );
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
              fileNames: [vCode.fileName, ...Object.keys(vCode.extraFiles || {})].filter(
                (fn): fn is string => Boolean(fn),
              ), // TODO: use filesOrder if provided
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

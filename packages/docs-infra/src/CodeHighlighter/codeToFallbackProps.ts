import {
  type BaseContentLoadingProps,
  type Code,
  type ContentLoadingExtraSource,
  type ContentLoadingVariant,
  type VariantCode,
} from './types';
import { stringOrHastToJsx } from '../pipeline/hastUtils';
import { getLanguageFromExtension } from '../pipeline/loaderUtils/getLanguageFromExtension';

function getLanguageFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) {
    return undefined;
  }
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) {
    return undefined;
  }
  return getLanguageFromExtension(fileName.slice(dotIndex));
}

function toExtraSource(
  variantCode: VariantCode,
  fileName?: string,
): Record<string, ContentLoadingExtraSource> {
  return Object.entries(variantCode.extraFiles || {}).reduce(
    (acc, [name, file]) => {
      if (name !== fileName && typeof file === 'object' && file?.source) {
        acc[name] = {
          source: stringOrHastToJsx(file.source),
          language: file.language ?? getLanguageFromFileName(name),
        };
      }
      return acc;
    },
    {} as Record<string, ContentLoadingExtraSource>,
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
  let language: string | undefined;

  if (fileName && fileName !== variantCode.fileName) {
    const fileData = variantCode.extraFiles?.[fileName];
    if (fileData && typeof fileData === 'object' && 'source' in fileData && fileData.source) {
      source = stringOrHastToJsx(fileData.source);
      language = fileData.language ?? getLanguageFromFileName(fileName);
    }
  } else if (variantCode.source) {
    source = stringOrHastToJsx(variantCode.source);
    language = variantCode.language ?? getLanguageFromFileName(variantCode.fileName);
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
              language: vCode.source
                ? (vCode.language ?? getLanguageFromFileName(vCode.fileName))
                : undefined,
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
        language,
        extraSource,
        extraVariants,
      };
    }

    return {
      fileNames,
      source,
      language,
      extraSource,
    };
  }

  return {
    fileNames,
    source,
    language,
  };
}

import type { Code, ControlledCode, Fallbacks, VariantCode, VariantSource } from './types';
import { stringOrHastToString } from '../pipeline/hastUtils';

export function hasSourceChanges(
  controlledCode: ControlledCode | null,
  initialCode: Code | undefined,
  activeVariantKey: string,
  activeFallbacks: Fallbacks | undefined,
): boolean {
  if (!controlledCode) {
    return false;
  }

  const initialVariants = Object.entries(initialCode ?? {}).filter(
    (entry): entry is [string, VariantCode] => Boolean(entry[1]) && typeof entry[1] === 'object',
  );

  const controlledVariants = Object.entries(controlledCode).filter(
    ([, variant]) => variant !== null,
  );

  if (initialVariants.length !== controlledVariants.length) {
    return true;
  }

  for (const [variantKey, initialVariant] of initialVariants) {
    const controlledVariant = controlledCode[variantKey];
    const variantFallbacks = variantKey === activeVariantKey ? activeFallbacks : undefined;

    const toInitialSource = (source: VariantSource | null | undefined, fileName?: string) =>
      source == null
        ? source
        : stringOrHastToString(
            source,
            (fileName ? variantFallbacks?.[fileName] : undefined) ?? initialVariant.fallback,
          );

    if (
      !controlledVariant ||
      controlledVariant.source !== toInitialSource(initialVariant.source, initialVariant.fileName)
    ) {
      return true;
    }

    const initialFiles = Object.entries(initialVariant.extraFiles ?? {});
    const controlledFiles = Object.entries(controlledVariant.extraFiles ?? {});

    if (initialFiles.length !== controlledFiles.length) {
      return true;
    }

    for (const [fileName, initialFile] of initialFiles) {
      let initialSource: string | null | undefined;

      if (typeof initialFile === 'string') {
        initialSource = initialFile;
      } else if (initialFile.source == null) {
        initialSource = initialFile.source;
      } else {
        initialSource = stringOrHastToString(
          initialFile.source,
          variantFallbacks?.[fileName] ?? initialFile.fallback,
        );
      }

      if (controlledVariant.extraFiles?.[fileName]?.source !== initialSource) {
        return true;
      }
    }
  }

  return false;
}

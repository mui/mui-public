import { basename } from 'node:path';
import type { LoadVariantMeta, VariantCode } from '../CodeHighlighter/types';

/**
 * Creates a simple loadVariantMeta function that returns basic variant info.
 * This function doesn't load any source code - that's handled by loadSource.
 * It just returns the basic variant structure with fileName.
 */
export function createLoadVariantMeta(): LoadVariantMeta {
  return async function loadVariantMeta(variantName: string, url: string): Promise<VariantCode> {
    // Remove file:// prefix if present
    const filePath = url.replace('file://', '');

    return {
      url,
      fileName: basename(filePath),
    };
  };
}

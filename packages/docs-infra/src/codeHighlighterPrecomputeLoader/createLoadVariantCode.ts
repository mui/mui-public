import { basename } from 'node:path';
import type { LoadVariantCode, VariantCode } from '../CodeHighlighter/types';

/**
 * Creates a simple loadVariantCode function that returns basic variant info.
 * This function doesn't load any source code - that's handled by loadSource.
 * It just returns the basic variant structure with fileName.
 */
export function createLoadVariantCode(): LoadVariantCode {
  return async function loadVariantCode(variantName: string, url: string): Promise<VariantCode> {
    // Remove file:// prefix if present
    const filePath = url.replace('file://', '');

    return {
      url,
      fileName: basename(filePath),
    };
  };
}

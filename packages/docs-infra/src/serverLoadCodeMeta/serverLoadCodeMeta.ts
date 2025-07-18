import { readFile } from 'node:fs/promises';
import type { LoadCodeMeta, Code } from '../CodeHighlighter/types';
import { resolveVariantPathsWithFs } from '../resolveImports/resolveModulePathWithFs';
import { parseCreateFactoryCall } from '../codeHighlighterPrecomputeLoader/parseCreateFactoryCall';

export interface CreateLoadCodeMetaOptions {
  // No options needed for simple path resolution
}

/**
 * Default serverLoadCodeMeta function that resolves variant paths from demo files.
 * This function is used to load code metadata for demos, specifically resolving paths for variants defined in the demo files.
 * It reads the demo file, parses it to find `createDemo` calls with variants, and resolves the paths for those variants.
 * It returns a Code object mapping variant names to their resolved file URLs.
 */
export const serverLoadCodeMeta = createServerLoadCodeMeta();

/**
 * Creates a loadCodeMeta function that resolves variant paths from demo files.
 *
 * This factory function creates a LoadCodeMeta implementation that:
 * 1. Parses the demo file to find createDemo calls with variants
 * 2. Resolves all variant entry point paths using resolveVariantPaths
 * 3. Returns a Code object mapping variant names to their resolved file URLs
 *
 * The actual loading, parsing, and transformation of the variants is handled
 * elsewhere by the CodeHighlighter component using loadVariant.
 *
 * @param options - Configuration options (currently unused)
 * @returns LoadCodeMeta function that takes a URL and returns Promise<Code>
 */
export function createServerLoadCodeMeta(_options: CreateLoadCodeMetaOptions = {}): LoadCodeMeta {
  return async function loadCodeMeta(url: string): Promise<Code> {
    // Remove file:// prefix if present to get file path
    const filePath = url.replace('file://', '');

    // Read the source file to find createDemo calls
    const source = await readFile(filePath, 'utf-8');

    // Parse the source to find createDemo call with variants
    const demoCall = await parseCreateFactoryCall(source, filePath);

    if (!demoCall || !demoCall.variants) {
      // Return empty code object if no variants found
      return {};
    }

    const code: Code = {};

    // Resolve all variant paths and get them as file URLs
    const resolvedVariantMap = await resolveVariantPathsWithFs(demoCall.variants);

    // Build Code object from the resolved variant map
    Array.from(resolvedVariantMap.entries()).forEach(([variantName, fileUrl]) => {
      code[variantName] = fileUrl;
    });

    return code;
  };
}

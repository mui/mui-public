// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { readFile } from 'fs/promises';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';

import type { LoadSource } from '../../CodeHighlighter/types';
import { resolveImportResultWithFs } from '../loadServerCodeMeta/resolveModulePathWithFs';
import type { StoreAtMode } from '../loaderUtils/processRelativeImports';
import { createLoadIsomorphicCodeSource } from '../loadIsomorphicCodeSource';

interface LoadSourceOptions {
  maxDepth?: number;
  maxFiles?: number;
  includeDependencies?: boolean;
  storeAt?: StoreAtMode;
  /**
   * Prefixes for comments that should be stripped from the source output.
   * Comments starting with these prefixes will be removed from the returned source.
   * They can still be collected via `notableCommentsPrefix`.
   * @example ['@highlight', '@internal']
   */
  removeCommentsWithPrefix?: string[];
  /**
   * Prefixes for notable comments that should be collected and included in the result.
   * Comments starting with these prefixes will be returned in the `comments` field.
   * @example ['@highlight', '@focus']
   */
  notableCommentsPrefix?: string[];
}

/**
 * Reads a source file from the local filesystem.
 *
 * Uses `fileURLToPath` so `file://` URLs (including Windows drive letters) and
 * plain absolute paths are both accepted.
 */
async function readFileFromUrl(url: string): Promise<string> {
  const filePath = url.startsWith('file://') ? fileURLToPath(url) : url;
  return readFile(filePath, 'utf8');
}

/**
 * Default loadServerSource function that reads a file and extracts its dependencies.
 * This function is used to load source files for demos, resolving their imports and dependencies.
 * It reads the source file, resolves its imports, and returns the processed source along with any
 * additional files and dependencies that were found.
 */
export const loadServerSource = createLoadServerSource();

/**
 * Creates a loadSource function that reads a file and extracts its dependencies.
 *
 * @param options.storeAt - Controls how imports are stored in extraFiles:
 *   - 'canonical': Full resolved path (e.g., '../Component/index.js')
 *   - 'import': Import path with file extension (e.g., '../Component.js')
 *   - 'flat': Flattened to current directory with rewritten imports (e.g., './Component.js')
 * @param options.removeCommentsWithPrefix - Prefixes for comments to strip from source
 * @param options.notableCommentsPrefix - Prefixes for comments to collect
 */
export function createLoadServerSource(options: LoadSourceOptions = {}): LoadSource {
  return createLoadIsomorphicCodeSource({
    fetchSource: readFileFromUrl,
    resolveImports: resolveImportResultWithFs,
    ...options,
  });
}

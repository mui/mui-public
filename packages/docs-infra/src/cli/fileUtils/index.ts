import { access } from 'node:fs/promises';
import type * as Prettier from 'prettier';

/**
 * Returns whether a path exists on disk. Used to decide whether an
 * auto-generated sibling file (e.g. `client.ts`, `page.ts`) already exists so
 * the validate passes never overwrite developer-authored files.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cached prettier module reference. Resolved lazily on first use so the
 * dependency stays optional — if the consumer doesn't have prettier installed,
 * formatting is skipped and the unformatted content is returned.
 */
type PrettierModule = typeof Prettier;
let prettierModulePromise: Promise<PrettierModule | null> | undefined;

async function loadPrettier(): Promise<PrettierModule | null> {
  if (!prettierModulePromise) {
    prettierModulePromise = import('prettier').catch(() => null);
  }
  return prettierModulePromise;
}

/**
 * Formats `content` with the project's prettier configuration for `filePath`.
 * Falls back to the original content when prettier is not installed or fails.
 */
export async function formatWithPrettier(content: string, filePath: string): Promise<string> {
  const prettier = await loadPrettier();
  if (!prettier) {
    return content;
  }
  try {
    const config = await prettier.resolveConfig(filePath);
    return await prettier.format(content, { ...config, filepath: filePath });
  } catch {
    return content;
  }
}

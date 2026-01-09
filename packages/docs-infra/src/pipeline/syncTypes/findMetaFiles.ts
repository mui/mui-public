// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import fs from 'fs/promises';

function hasSuffix(suffixes: string[], filename: string): boolean {
  return suffixes.some(
    (suffix) =>
      filename.endsWith(`${suffix}.d.ts`) ||
      filename.endsWith(`${suffix}.ts`) ||
      filename.endsWith(`${suffix}.tsx`),
  );
}

/**
 * Finds metadata files (DataAttributes, CssVars) in the directory of the given entrypoint file.
 *
 * @param entrypoint - A filesystem path pointing to the entrypoint file
 * @param suffixes - File suffixes to search for (default: ['DataAttributes', 'CssVars'])
 * @returns Array of filesystem paths for matching files
 */
export async function findMetaFiles(
  entrypoint: string,
  suffixes: string[] = ['DataAttributes', 'CssVars'],
): Promise<string[]> {
  const dir = path.dirname(entrypoint);

  const files: string[] = [];

  async function walkDirectory(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    const subdirectories: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        subdirectories.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    await Promise.all(subdirectories.map((subdir) => walkDirectory(subdir)));
  }

  await walkDirectory(dir);

  return files.filter((file) => hasSuffix(suffixes, file));
}

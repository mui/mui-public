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
 * Finds metadata files (DataAttributes, CssVars) in the directory of the given entrypoint file,
 * or recursively within the given directory.
 *
 * @param entrypoint - A filesystem path pointing to the entrypoint file or a directory
 * @param suffixes - File suffixes to search for (default: ['DataAttributes', 'CssVars'])
 * @returns Array of filesystem paths for matching files
 */
export async function findMetaFiles(
  entrypoint: string,
  suffixes: string[] = ['DataAttributes', 'CssVars'],
): Promise<string[]> {
  // Check if the path ends with / (directory hint) or check via stat
  let dir: string;
  if (entrypoint.endsWith('/')) {
    // Path ends with / - it's explicitly a directory, walk it directly
    dir = entrypoint.slice(0, -1); // Remove trailing slash for fs operations
  } else {
    // It's a file - walk its parent directory
    dir = path.dirname(entrypoint);
  }

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

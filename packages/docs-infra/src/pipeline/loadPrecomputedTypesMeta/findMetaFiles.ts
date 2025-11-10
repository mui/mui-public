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

export async function findMetaFiles(
  entrypoint: string,
  suffixes: string[] = ['DataAttributes', 'CssVars'],
): Promise<string[]> {
  // If entrypoint is a file, use its directory; if it's already a directory, use it directly
  const dir =
    entrypoint.endsWith('.ts') || entrypoint.endsWith('.tsx')
      ? path.dirname(entrypoint)
      : entrypoint;
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

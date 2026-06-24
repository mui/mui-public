import fs from 'node:fs/promises';

async function lookupKnownPages(
  dir: string,
  maxDepth: number,
  basePath: string[] = [],
  currentPath: string[] = [],
) {
  if (maxDepth === 0) {
    return [];
  }

  const fullPath = [...basePath, ...currentPath].join('/');
  const files = await fs.readdir(`${dir}/app/${fullPath}`, { withFileTypes: true });

  const params: string[][] = [];
  const dirPromises: Promise<string[][]>[] = [];

  for (const file of files) {
    if (file.isDirectory()) {
      dirPromises.push(lookupKnownPages(dir, maxDepth - 1, basePath, [...currentPath, file.name]));
    } else if (file.isFile() && file.name.startsWith('page.')) {
      params.push(currentPath);
    }
  }

  const dirResults = await Promise.all(dirPromises);
  for (const result of dirResults) {
    params.push(...result);
  }

  return params;
}

export async function collectKnownPages(dir: string = '.', maxDepth: number = 5) {
  const pages = await lookupKnownPages(dir, maxDepth);

  return pages.map((segments) => segments.filter((segment) => !segment.startsWith('(')));
}

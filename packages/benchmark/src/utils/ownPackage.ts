import { createRequire } from 'node:module';

/**
 * This package's own manifest.
 *
 * Self-referencing, not a relative path: a module sits one directory deeper in the repository
 * (`src/…`) than in the published package, which is built from `build/`, so no relative path
 * reaches the manifest from both layouts — and the one that works in the repository silently keeps
 * working through a workspace symlink, so only a real install shows the break. Resolving by name
 * is independent of where the importing file sits.
 */
export const ownPackage: { name: string; version: string } = createRequire(import.meta.url)(
  '@mui/internal-benchmark/package.json',
);

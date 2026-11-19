import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** Resolves `name` from this package, or from inside the `from` package for a transitive dependency. */
export function packageDir(name: string, from?: string): string {
  const paths = from ? [packageDir(from)] : undefined;
  let dir = dirname(require.resolve(name, { paths }));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.name === name) {
        return dir;
      }
    } catch {
      // keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Cannot find package.json for ${name}`);
    }
    dir = parent;
  }
}

export function packageVersion(name: string): string {
  return JSON.parse(readFileSync(join(packageDir(name), 'package.json'), 'utf8')).version;
}

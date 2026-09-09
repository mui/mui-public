import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { $ } from 'execa';

/** A workspace package, as `pnpm ls` reports it. */
export interface WorkspacePackage {
  name: string;
  version: string;
  /** Absolute path to the package directory. */
  path: string;
  /** Whether the package is excluded from publishing. */
  isPrivate: boolean;
}

interface ListedPackage {
  name?: string;
  version?: string;
  path: string;
  private?: boolean;
}

/**
 * The workspace packages of `cwd`, as `pnpm ls` resolves them.
 *
 * Asks pnpm rather than scanning directories, so the set follows `pnpm-workspace.yaml` and matches
 * exactly what a release would publish. A package counts as private when it says so, or when it
 * lacks the name or version that publishing requires.
 */
export async function getWorkspacePackages(
  options: { cwd?: string; publicOnly?: boolean } = {},
): Promise<WorkspacePackage[]> {
  const { cwd, publicOnly = false } = options;

  const result = await $({ cwd })`pnpm ls -r --json --depth -1`;
  const listed: ListedPackage[] = JSON.parse(result.stdout);

  return listed.flatMap((pkg) => {
    const isPrivate = Boolean(pkg.private) || !pkg.name || !pkg.version;
    if (publicOnly && isPrivate) {
      return [];
    }
    return [
      {
        name: pkg.name ?? '',
        version: pkg.version ?? '',
        path: pkg.path,
        isPrivate,
      },
    ];
  });
}

/** Reads a directory's `package.json`. */
export async function readPackageJson(packagePath: string): Promise<Record<string, any>> {
  const content = await fs.readFile(path.join(packagePath, 'package.json'), 'utf8');
  return JSON.parse(content);
}

/** Writes a directory's `package.json`, formatted the way the repository writes manifests. */
export async function writePackageJson(packagePath: string, packageJson: object): Promise<void> {
  const content = `${JSON.stringify(packageJson, null, 2)}\n`;
  await fs.writeFile(path.join(packagePath, 'package.json'), content);
}

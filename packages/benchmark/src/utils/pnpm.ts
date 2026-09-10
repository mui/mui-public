import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { $ } from 'execa';

/** A publishable workspace package, as `pnpm ls` reports it. */
export interface PublishablePackage {
  name: string;
  version: string;
  /** Absolute path to the package directory. */
  path: string;
}

interface ListedPackage {
  name?: string;
  version?: string;
  path: string;
  private?: boolean;
}

/**
 * The publishable workspace packages of `cwd`, as `pnpm ls` resolves them.
 *
 * Asks pnpm rather than scanning directories, so the set follows `pnpm-workspace.yaml` and mirrors
 * exactly what a release publishes. A package is skipped when it says it is private, or when it
 * lacks the name or version that publishing requires.
 *
 * Deliberately narrower than the equivalent in `@mui/internal-code-infra`, which also filters by
 * pattern and by what changed since a ref: those need git and pnpm-filter semantics nothing here
 * wants. Named for what it does so the two cannot be mistaken for each other.
 */
export async function listPublishablePackages(cwd: string): Promise<PublishablePackage[]> {
  const result = await $({ cwd })`pnpm ls -r --json --depth -1`;
  const listed: ListedPackage[] = JSON.parse(result.stdout);

  return listed.flatMap((pkg) =>
    pkg.private || !pkg.name || !pkg.version
      ? []
      : [{ name: pkg.name, version: pkg.version, path: pkg.path }],
  );
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

/** One project, as `pnpm ls` reports it. */
interface ListedProject {
  dependencies?: Record<string, { version?: string }>;
  devDependencies?: Record<string, { version?: string }>;
}

/**
 * The version the project in `cwd` resolved for each of its direct dependencies.
 *
 * Asked of pnpm rather than read out of `node_modules`, so the answer follows however pnpm chose to
 * lay that directory out. `--filter .` keeps it to the one project; without it pnpm reports every
 * workspace member.
 */
export async function installedVersions(cwd: string): Promise<Map<string, string>> {
  const result = await $({ cwd })`pnpm ls --json --depth 0 --filter .`;
  const [project]: ListedProject[] = JSON.parse(result.stdout);
  const versions = new Map<string, string>();

  for (const section of [project?.dependencies, project?.devDependencies]) {
    for (const [name, entry] of Object.entries(section ?? {})) {
      // A workspace link reports `link:../…` here rather than a version. Callers want a version to
      // pin, so leave those out and let them fall back to whatever the manifest declared.
      if (entry.version && !entry.version.startsWith('link:')) {
        versions.set(name, entry.version);
      }
    }
  }

  return versions;
}

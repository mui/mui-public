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
 * The publishable workspace packages of `cwd`: those pnpm lists that are not private and have the
 * name and version publishing requires.
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

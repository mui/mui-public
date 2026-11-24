import { mapAsync } from 'es-toolkit/array';
import { minimatch } from 'minimatch';
import { parse as parseYaml } from 'yaml';

/**
 * @typedef {import('./changelogFiles.mjs').FileSource} FileSource
 * @typedef {import('./types.ts').ChangelogPackage} ChangelogPackage
 */

/**
 * @typedef {Object} Manifest
 * @property {string} path - Package directory, `.` for the root
 * @property {string | null} name
 * @property {string | null} version
 * @property {boolean} private
 */

const IGNORED = /(^|\/)(node_modules|bower_components)\//;

/**
 * @param {FileSource} source
 * @returns {Promise<string[]>}
 */
async function readWorkspaceGlobs(source) {
  if (source.paths.includes('pnpm-workspace.yaml')) {
    return parseYaml(await source.read('pnpm-workspace.yaml'))?.packages ?? [];
  }
  if (source.paths.includes('package.json')) {
    const { workspaces } = JSON.parse(await source.read('package.json'));
    return workspaces?.packages ?? workspaces ?? [];
  }
  return [];
}

/**
 * The manifests of the root package and the workspace members.
 *
 * @param {FileSource} source
 * @returns {Promise<Manifest[]>}
 */
export async function readManifests(source) {
  const globs = (await readWorkspaceGlobs(source)).map((glob) => glob.replace(/^(!?)\.\//, '$1'));
  const isNegated = (/** @type {string} */ glob) => glob.startsWith('!');
  const included = globs.filter((glob) => !isNegated(glob));
  const excluded = globs.filter(isNegated).map((glob) => glob.slice(1));

  const files = source.paths.filter((file) => {
    if (file === 'package.json') {
      return true;
    }
    if (!file.endsWith('/package.json') || IGNORED.test(file)) {
      return false;
    }
    const matches = (/** @type {string} */ glob) => minimatch(file, `${glob}/package.json`);
    return included.some(matches) && !excluded.some(matches);
  });

  return mapAsync(
    files,
    async (file) => {
      const manifest = JSON.parse(await source.read(file));
      return {
        path: file === 'package.json' ? '.' : file.slice(0, -'/package.json'.length),
        name: manifest.name ?? null,
        version: manifest.version ?? null,
        private: manifest.private === true || !manifest.version,
      };
    },
    { concurrency: 10 },
  );
}

/**
 * Packages are matched by name, so that moving one doesn't make it look new.
 *
 * @param {Manifest[]} manifests
 * @param {Manifest[]} previousManifests
 * @returns {ChangelogPackage[]}
 */
export function comparePackages(manifests, previousManifests) {
  const previousByName = new Map(previousManifests.map((manifest) => [manifest.name, manifest]));
  return manifests
    .flatMap(({ name, ...manifest }) => {
      if (name === null) {
        return [];
      }
      const previous = previousByName.get(name);
      return [
        {
          name,
          ...manifest,
          previousVersion: previous?.version ?? null,
          versionChanged: !previous || previous.version !== manifest.version,
        },
      ];
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

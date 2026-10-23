/* eslint-disable no-console */
import { $ } from 'execa';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { mapAsync } from 'es-toolkit/array';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { getWorkspacePackages } from '../utils/pnpm.mjs';

/**
 * @typedef {import('./packageJson').PackageJson} PackageJson
 */

/**
 * @typedef {Object} TypeScriptError
 * @property {string} file Path relative to the consumer project, or `<package>/<path>` for files
 *   inside a packed package.
 * @property {string} code
 * @property {string} message
 */

/**
 * The conditions TypeScript matches when resolving `exports` in each mode. `types` comes first in
 * every published manifest, so matching it in all modes is what TypeScript does too.
 */
const ESM_CONDITIONS = new Set(['types', 'import', 'node', 'default']);
const CJS_CONDITIONS = new Set(['types', 'require', 'node', 'default']);

/**
 * Follows an `exports` target the way Node.js does: the first key that matches wins, even when
 * it maps to `null`.
 *
 * @param {unknown} target
 * @param {Set<string>} conditions
 * @returns {string | null}
 */
function resolveExportTarget(target, conditions) {
  if (typeof target === 'string') {
    return target;
  }
  if (Array.isArray(target)) {
    return target.length > 0 ? resolveExportTarget(target[0], conditions) : null;
  }
  if (target && typeof target === 'object') {
    for (const [condition, value] of Object.entries(target)) {
      if (conditions.has(condition)) {
        return resolveExportTarget(value, conditions);
      }
    }
  }
  return null;
}

/**
 * Lists the import specifiers consumers can type-check against, per resolution mode. Glob
 * subpaths are skipped: `code-infra build` expands them into concrete entries.
 *
 * @param {PackageJson} packageJson A published manifest.
 * @returns {{ esm: string[], cjs: string[] }}
 */
function getTypedEntryPoints(packageJson) {
  const name = /** @type {string} */ (packageJson.name);
  const packageExports = packageJson.exports;
  /** @type {Record<string, unknown>} */
  let exportsMap;
  if (packageExports === undefined || packageExports === null) {
    exportsMap = packageJson.types || packageJson.typings ? { '.': '.' } : {};
  } else if (
    typeof packageExports === 'string' ||
    Array.isArray(packageExports) ||
    !Object.keys(packageExports).some((key) => key.startsWith('.'))
  ) {
    exportsMap = { '.': packageExports };
  } else {
    exportsMap = packageExports;
  }

  /** @type {{ esm: string[], cjs: string[] }} */
  const entryPoints = { esm: [], cjs: [] };
  for (const [subpath, target] of Object.entries(exportsMap)) {
    if (subpath.includes('*') || subpath === './package.json') {
      continue;
    }
    const specifier = subpath === '.' ? name : `${name}/${subpath.slice(2)}`;
    for (const [mode, conditions] of /** @type {const} */ ([
      ['esm', ESM_CONDITIONS],
      ['cjs', CJS_CONDITIONS],
    ])) {
      const resolved = resolveExportTarget(target, conditions);
      if (resolved && (/\.d\.[cm]?ts$/.test(resolved) || resolved === '.')) {
        entryPoints[mode].push(specifier);
      }
    }
  }
  return entryPoints;
}

/**
 * @param {string[]} specifiers
 * @returns {string}
 */
function createEntryFile(specifiers) {
  return `${specifiers
    .map((specifier, index) => `import type * as entry${index} from '${specifier}';`)
    .join('\n')}\nexport {};\n`;
}

/**
 * Parses `tsc --pretty false` output. Errors inside a packed package are reported relative to
 * that package, so the output doesn't depend on the store layout.
 *
 * @param {string} output
 * @param {string[]} packageNames
 * @returns {TypeScriptError[]}
 */
function parseTypeScriptErrors(output, packageNames) {
  /** @type {TypeScriptError[]} */
  const errors = [];
  for (const line of output.split('\n')) {
    const match = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(line);
    if (match) {
      errors.push({ file: match[1], code: match[2], message: match[3] });
    } else if (line.startsWith(' ') && errors.length > 0) {
      errors[errors.length - 1].message += `\n${line}`;
    }
  }
  return errors.flatMap((error) => {
    const index = error.file.lastIndexOf('node_modules/');
    if (index === -1) {
      return [error];
    }
    const modulePath = error.file.slice(index + 'node_modules/'.length);
    const owner = packageNames.find((name) => modulePath.startsWith(`${name}/`));
    // Errors in third-party declarations are not ours to fix.
    return owner ? [{ ...error, file: modulePath }] : [];
  });
}

/**
 * @param {string} tarball
 * @returns {Promise<PackageJson>}
 */
async function readPackedManifest(tarball) {
  const { stdout } = await $`tar -xzOf ${tarball} package/package.json`;
  return JSON.parse(stdout);
}

/**
 * @param {string} workspaceRoot
 * @param {string} name
 * @returns {Promise<string | null>}
 */
async function getInstalledVersion(workspaceRoot, name) {
  try {
    const content = await fs.readFile(
      path.join(workspaceRoot, 'node_modules', name, 'package.json'),
      'utf8',
    );
    return JSON.parse(content).version;
  } catch {
    return null;
  }
}

/**
 * Installs the packed public packages into a fresh project, the way a consumer would, and
 * type-checks an import of every typed entry point with `skipLibCheck` off. Hoisting is disabled
 * so each package only resolves what its manifest declares.
 *
 * @param {Object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.projectDir An empty directory outside the workspace.
 * @param {string[]} [options.filter]
 * @returns {Promise<{ errors: TypeScriptError[], entryPointCount: number, packageCount: number }>}
 */
export async function validateConsumerTypes({ workspaceRoot, projectDir, filter = [] }) {
  const packages = await getWorkspacePackages({ cwd: workspaceRoot, publicOnly: true, filter });
  if (packages.length === 0) {
    throw new Error('No public packages found.');
  }
  const tarballDir = path.join(projectDir, 'tarballs');
  await fs.mkdir(tarballDir, { recursive: true });

  // Packed the same way as @mui/internal-benchmark's `packWorkspace`.
  const packed = await mapAsync(
    packages,
    async (pkg) => {
      // `+` cannot appear in a package name, so no two tarballs collide.
      const tarball = path.join(tarballDir, `${pkg.name.replace(/^@/, '').replace('/', '+')}.tgz`);
      await $({ cwd: pkg.path })`pnpm pack --out ${tarball}`;
      return { tarball, manifest: await readPackedManifest(tarball) };
    },
    { concurrency: os.availableParallelism() },
  );

  const packageNames = packed.map(({ manifest }) => /** @type {string} */ (manifest.name));
  /** @type {Record<string, string>} */
  const tarballs = Object.fromEntries(
    packed.map(({ manifest, tarball }) => [manifest.name, `file:${tarball}`]),
  );
  // Consumers provide every peer, optional ones included, at a version in range.
  /** @type {Record<string, string>} */
  const peers = {};
  for (const { manifest } of packed) {
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (range && !tarballs[name] && !peers[name]) {
        peers[name] = range;
      }
    }
  }
  if (!peers['@types/node']) {
    peers['@types/node'] = (await getInstalledVersion(workspaceRoot, '@types/node')) ?? '*';
  }

  await fs.writeFile(
    path.join(projectDir, 'package.json'),
    `${JSON.stringify({ private: true, dependencies: { ...peers, ...tarballs } }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(projectDir, 'pnpm-workspace.yaml'),
    [
      'hoistPattern: []',
      'publicHoistPattern: []',
      'autoInstallPeers: false',
      'strictPeerDependencies: false',
      'blockExoticSubdeps: false',
      'ignoreScripts: true',
      'overrides:',
      ...Object.entries(tarballs).map(([name, spec]) => `  '${name}': '${spec}'`),
      '',
    ].join('\n'),
  );
  await $({ cwd: projectDir })`pnpm install --lockfile=false`;

  const esmEntryPoints = [];
  const cjsEntryPoints = [];
  for (const { manifest } of packed) {
    const { esm, cjs } = getTypedEntryPoints(manifest);
    esmEntryPoints.push(...esm);
    cjsEntryPoints.push(...cjs);
  }
  await fs.writeFile(path.join(projectDir, 'index.mts'), createEntryFile(esmEntryPoints));
  await fs.writeFile(path.join(projectDir, 'index.cts'), createEntryFile(cjsEntryPoints));

  const compilerOptions = {
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    types: ['node'],
    lib: ['esnext', 'dom', 'dom.iterable'],
    jsx: 'react-jsx',
  };
  // A consumer is either ESM or CommonJS. Checking both in one program would load the CommonJS and
  // ESM declarations side by side, and their global augmentations then conflict.
  /** @type {Record<string, { compilerOptions: Record<string, unknown>, files: string[] }>} */
  const tsconfigs = {
    'tsconfig.esm.json': {
      compilerOptions: { ...compilerOptions, module: 'nodenext' },
      files: ['index.mts'],
    },
    'tsconfig.cjs.json': {
      compilerOptions: { ...compilerOptions, module: 'nodenext' },
      files: ['index.cts'],
    },
    'tsconfig.bundler.json': {
      compilerOptions: { ...compilerOptions, module: 'esnext', moduleResolution: 'bundler' },
      files: ['index.mts'],
    },
  };
  const tscBin = path.join(workspaceRoot, 'node_modules', '.bin', 'tsc');
  const tsc = (await fs.stat(tscBin).catch(() => null)) ? tscBin : 'tsc';

  const outputs = await Promise.all(
    Object.entries(tsconfigs).map(async ([file, tsconfig]) => {
      await fs.writeFile(path.join(projectDir, file), `${JSON.stringify(tsconfig, null, 2)}\n`);
      const result = await $({ cwd: projectDir, reject: false })`${tsc} -p ${file} --pretty false`;
      return result.stdout;
    }),
  );
  /** @type {Map<string, TypeScriptError>} */
  const errors = new Map();
  for (const error of outputs.flatMap((output) => parseTypeScriptErrors(output, packageNames))) {
    errors.set(`${error.file}\0${error.code}\0${error.message}`, error);
  }

  return {
    errors: Array.from(errors.values()),
    entryPointCount: new Set([...esmEntryPoints, ...cjsEntryPoints]).size,
    packageCount: packed.length,
  };
}

/**
 * @typedef {Object} Args
 * @property {string[]} [filter]
 * @property {boolean} [keep]
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'validate-consumer-types',
  describe:
    'Install the packed public packages into a fresh project and type-check every typed entry point, as a consumer would. Run after building.',
  builder: (yargs) =>
    yargs
      .option('filter', {
        type: 'string',
        array: true,
        description: 'Only pack public packages matching these pnpm filters.',
      })
      .option('keep', {
        type: 'boolean',
        default: false,
        description: 'Keep the consumer project for inspection.',
      }),
  handler: async ({ filter = [], keep = false }) => {
    const workspaceRoot = await findWorkspaceDir(process.cwd());
    if (!workspaceRoot) {
      throw new Error('Workspace directory not found');
    }
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-consumer-types-'));
    let failed = false;
    try {
      const { errors, entryPointCount, packageCount } = await validateConsumerTypes({
        workspaceRoot,
        projectDir,
        filter,
      });
      if (entryPointCount === 0) {
        throw new Error('No typed entry points found. Build the packages first.');
      }
      if (errors.length > 0) {
        failed = true;
        console.error(
          `❌ Found ${errors.length} type errors in ${entryPointCount} entry points of ${packageCount} packages.\n`,
        );
        for (const error of errors) {
          console.error(`${error.file}: ${error.code} ${error.message}`);
        }
        process.exitCode = 1;
      } else {
        console.log(
          `✅ ${entryPointCount} entry points of ${packageCount} packages type-check for consumers.`,
        );
      }
    } finally {
      if (keep || failed) {
        console.error(`\nConsumer project: ${projectDir}`);
      } else {
        await fs.rm(projectDir, { recursive: true, force: true });
      }
    }
  },
});

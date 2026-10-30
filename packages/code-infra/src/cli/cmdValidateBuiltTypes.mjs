/* eslint-disable no-console */
import { $ } from 'execa';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { mapAsync } from 'es-toolkit/array';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import * as semver from 'semver';
import { stringify } from 'yaml';
import { getWorkspacePackages, readPackageJson, writePackageJson } from '../utils/pnpm.mjs';
import { findTscPair } from '../utils/typescript.mjs';

/**
 * @typedef {import('./packageJson').PackageJson} PackageJson
 */

/**
 * @typedef {Object} TypeScriptError
 * @property {string} file `<package>/<path>` for files inside a packed package, otherwise relative
 *   to the consumer project.
 * @property {string} code
 * @property {string} message
 */

/**
 * @typedef {Map<string, string>} EntryPoints Import specifier to the declaration file it resolves
 *   to.
 */

/**
 * The `exports` conditions TypeScript matches for each kind of consumer. `types` comes first in
 * every published manifest, so matching it in all modes is what TypeScript does too.
 */
const CONDITIONS = {
  esm: new Set(['types', 'import', 'node', 'default']),
  cjs: new Set(['types', 'require', 'node', 'default']),
  bundler: new Set(['types', 'import', 'default']),
};

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
    return resolveExportTarget(target[0], conditions);
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
 * Lists a package's import specifiers with their `exports` targets. Glob subpaths are skipped:
 * `code-infra build` expands them into concrete entries.
 *
 * @param {PackageJson} packageJson A published manifest.
 * @returns {[specifier: string, target: unknown][]}
 */
function getExportEntries(packageJson) {
  const name = /** @type {string} */ (packageJson.name);
  const packageExports = packageJson.exports;
  if (packageExports === undefined || packageExports === null) {
    const types = packageJson.types ?? packageJson.typings;
    return types ? [[name, { types, default: packageJson.main ?? './index.js' }]] : [];
  }
  /** @type {Record<string, unknown>} */
  const exportsMap =
    typeof packageExports === 'string' ||
    Array.isArray(packageExports) ||
    !Object.keys(packageExports).some((key) => key.startsWith('.'))
      ? { '.': packageExports }
      : packageExports;
  return Object.entries(exportsMap)
    .filter(([subpath]) => !subpath.includes('*') && subpath !== './package.json')
    .map(([subpath, target]) => [subpath === '.' ? name : `${name}/${subpath.slice(2)}`, target]);
}

/**
 * @param {unknown} target
 * @param {Set<string>} conditions
 * @returns {{ types: string | null, runtime: string | null }}
 */
function resolveEntryPoint(target, conditions) {
  const types = resolveExportTarget(target, conditions);
  return {
    types: types && /\.d\.[cm]?ts$/.test(types) ? types : null,
    runtime: resolveExportTarget(
      target,
      new Set(Array.from(conditions).filter((condition) => condition !== 'types')),
    ),
  };
}

/**
 * Lists the modules consumers can import types from under `conditions`. Entry points without a
 * runtime target, such as code-infra's `build-env`, are left out: nothing imports them.
 *
 * @param {PackageJson} packageJson
 * @param {Set<string>} conditions
 * @returns {EntryPoints}
 */
function getTypedEntryPoints(packageJson, conditions) {
  /** @type {EntryPoints} */
  const entryPoints = new Map();
  for (const [specifier, target] of getExportEntries(packageJson)) {
    const { types, runtime } = resolveEntryPoint(target, conditions);
    if (types && runtime) {
      entryPoints.set(specifier, types);
    }
  }
  return entryPoints;
}

/**
 * @param {EntryPoints} a
 * @param {EntryPoints} b
 */
function isSameEntryPoints(a, b) {
  return a.size === b.size && Array.from(a).every(([specifier, file]) => b.get(specifier) === file);
}

/**
 * @param {EntryPoints} entryPoints
 * @returns {string}
 */
function createEntryFile(entryPoints) {
  return `${Array.from(entryPoints.keys())
    .map((specifier, index) => `import type * as entry${index} from '${specifier}';`)
    .join('\n')}\nexport {};\n`;
}

/**
 * `@scope/pkg` → `scope+pkg`, the same file names as @mui/internal-benchmark's `packWorkspace`.
 * `+` cannot appear in a package name, so no two collide.
 *
 * @param {string} packageName
 */
function toFileStem(packageName) {
  return packageName.replace(/^@/, '').replace('/', '+');
}

/**
 * The range of versions that satisfy both `a` and `b`.
 *
 * @param {string} name
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function intersectRanges(name, a, b) {
  if (!semver.validRange(a) || !semver.validRange(b)) {
    return a;
  }
  if (!semver.intersects(a, b)) {
    throw new Error(`No version of "${name}" satisfies every peer range: "${a}" and "${b}".`);
  }
  const setsOf = (/** @type {string} */ range) =>
    new semver.Range(range).set.map((comparators) => comparators.map(String).join(' '));
  return setsOf(a)
    .flatMap((setA) => setsOf(b).map((setB) => `${setA} ${setB}`.trim()))
    .filter((range) => semver.intersects(range, range))
    .join(' || ');
}

/**
 * Parses the errors in `tsc --pretty false` output that point at a file.
 *
 * @param {string} output
 * @returns {TypeScriptError[]}
 */
function parseTypeScriptErrors(output) {
  /** @type {TypeScriptError[]} */
  const errors = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(line);
    if (match) {
      errors.push({ file: match[1], code: match[2], message: match[3] });
    } else if (line.startsWith(' ') && errors.length > 0) {
      errors[errors.length - 1].message += `\n${line}`;
    }
  }
  return errors;
}

/**
 * Keeps the errors in the packed packages and the generated entry files. Errors inside a packed
 * package are reported relative to that package, so the output doesn't depend on the store layout.
 *
 * @param {TypeScriptError[]} errors
 * @param {string[]} packageNames
 * @param {string} tempDir Stripped from messages.
 * @returns {TypeScriptError[]}
 */
function getOwnErrors(errors, packageNames, tempDir) {
  return errors.flatMap((error) => {
    const message = error.message.replaceAll(`${tempDir}/`, '');
    const index = error.file.lastIndexOf('node_modules/');
    if (index === -1) {
      return [{ ...error, message }];
    }
    const modulePath = error.file.slice(index + 'node_modules/'.length);
    const owner = packageNames.find((name) => modulePath.startsWith(`${name}/`));
    // Errors in third-party declarations are not ours to fix.
    return owner ? [{ ...error, file: modulePath, message }] : [];
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
 * Installs the packed public packages into a fresh project, the way a consumer would, and
 * type-checks an import of every typed entry point with `skipLibCheck` off.
 *
 * @param {Object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.tempDir An empty directory outside the workspace.
 * @returns {Promise<{ errors: TypeScriptError[], entryPointCount: number, packageCount: number }>}
 */
async function validateBuiltTypes({ workspaceRoot, tempDir }) {
  const packages = await getWorkspacePackages({ cwd: workspaceRoot, publicOnly: true });
  if (packages.length === 0) {
    throw new Error('No public packages found.');
  }
  const tarballDir = path.join(tempDir, 'tarballs');
  const projectDir = path.join(tempDir, 'project');
  await Promise.all([
    fs.mkdir(tarballDir, { recursive: true }),
    fs.mkdir(path.join(projectDir, 'checks'), { recursive: true }),
  ]);

  // Packed like @mui/internal-benchmark's `packWorkspace`, so each tarball is what `pnpm publish`
  // would upload.
  const packed = await mapAsync(
    packages,
    async (pkg) => {
      const tarball = path.join(tarballDir, `${toFileStem(pkg.name)}.tgz`);
      await $({ cwd: pkg.path })`pnpm pack --out ${tarball}`;
      return { tarball, manifest: await readPackedManifest(tarball), dir: pkg.path };
    },
    { concurrency: os.availableParallelism() },
  );

  /** @type {Record<string, string>} */
  const tarballs = Object.fromEntries(
    packed.map(({ manifest, tarball }) => [manifest.name, `file:${tarball}`]),
  );
  const packageNames = Object.keys(tarballs);
  // Consumers provide every peer, optional ones included, at a version in range of every package.
  // The versions the workspace installed for its packages come first: they are fixed by the
  // lockfile, so a new upstream release can't change the outcome until the workspace updates.
  const declaredPeers = packed.flatMap(({ manifest, dir }) =>
    Object.entries(manifest.peerDependencies ?? {})
      .filter(([name, range]) => range && !tarballs[name])
      .map(([name, range]) => ({ name, range: /** @type {string} */ (range), dir })),
  );
  const installedPeers = await Promise.all(
    declaredPeers.map(({ name, dir }) =>
      readPackageJson(path.join(dir, 'node_modules', name)).then(
        ({ name: installedName, version }) =>
          // An aliased install, such as `typescript: npm:@typescript/typescript6@6.0.2`.
          installedName === name ? version : `npm:${installedName}@${version}`,
        () => undefined,
      ),
    ),
  );
  /** @type {Record<string, string>} */
  const peerRanges = {};
  for (const { name, range } of declaredPeers) {
    peerRanges[name] = peerRanges[name] ? intersectRanges(name, peerRanges[name], range) : range;
  }
  /** @type {Record<string, string>} */
  const peers = {};
  for (const [name, range] of Object.entries(peerRanges)) {
    const installed = installedPeers.find(
      (spec, index) =>
        spec &&
        declaredPeers[index].name === name &&
        semver.satisfies(spec.slice(spec.lastIndexOf('@') + 1), range),
    );
    peers[name] = installed ?? range;
  }
  // Installed as in any project that uses Node packages, but not made ambient: a program only loads
  // Node types when declarations reference them, so they don't reach sources that shouldn't see them.
  peers['@types/node'] ??= await readPackageJson(
    path.join(workspaceRoot, 'node_modules', '@types/node'),
  ).then(
    (packageJson) => packageJson.version ?? '*',
    () => '*',
  );

  await writePackageJson(projectDir, { private: true, dependencies: { ...peers, ...tarballs } });
  // Every package and peer is a dependency of the project, so a package that looked them up from
  // the project's node_modules would resolve what it never declared. With hoisting off and the
  // virtual store outside the project, it only finds the dependencies pnpm linked for it.
  await fs.writeFile(
    path.join(projectDir, 'pnpm-workspace.yaml'),
    stringify({
      virtualStoreDir: '../virtual-store',
      enableGlobalVirtualStore: false,
      hoistPattern: [],
      publicHoistPattern: [],
      autoInstallPeers: false,
      strictPeerDependencies: false,
      blockExoticSubdeps: false,
      ignoreScripts: true,
      overrides: tarballs,
    }),
  );
  await $({ cwd: projectDir })`pnpm install --lockfile=false --prefer-offline`;

  const compilerOptions = {
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    types: [],
    lib: ['esnext', 'dom', 'dom.iterable'],
    jsx: 'react-jsx',
  };
  // One program per package and consumer kind. A consumer is either ESM or CommonJS, and installs
  // one package rather than all of them: a shared program would check the global augmentations of
  // unrelated packages, and of a package's CommonJS and ESM declarations, against each other.
  // CommonJS and bundler consumers only get a program of their own when they resolve other
  // declarations than ESM consumers; on the same files, they find nothing an ESM program misses.
  /** @type {{ file: string, entryPoints: EntryPoints, module: string, moduleResolution?: string }[]} */
  const checks = [];
  const specifiers = new Set();
  for (const { manifest } of packed) {
    const esm = getTypedEntryPoints(manifest, CONDITIONS.esm);
    const cjs = getTypedEntryPoints(manifest, CONDITIONS.cjs);
    const bundler = getTypedEntryPoints(manifest, CONDITIONS.bundler);
    const stem = path.join('checks', toFileStem(/** @type {string} */ (manifest.name)));
    checks.push({ file: `${stem}.esm.mts`, entryPoints: esm, module: 'nodenext' });
    if (!isSameEntryPoints(cjs, esm)) {
      checks.push({ file: `${stem}.cjs.cts`, entryPoints: cjs, module: 'nodenext' });
    }
    if (!isSameEntryPoints(bundler, esm)) {
      checks.push({
        file: `${stem}.bundler.mts`,
        entryPoints: bundler,
        module: 'esnext',
        moduleResolution: 'bundler',
      });
    }
    for (const entryPoints of [esm, cjs, bundler]) {
      for (const specifier of entryPoints.keys()) {
        specifiers.add(specifier);
      }
    }
  }

  const { native, js } = await findTscPair(workspaceRoot);
  const tsc = native ?? js;
  const realTempDir = await fs.realpath(tempDir);
  const ownErrors = await mapAsync(
    checks.filter(({ entryPoints }) => entryPoints.size > 0),
    async ({ file, entryPoints, module, moduleResolution }) => {
      const tsconfigFile = `${file}.json`;
      await Promise.all([
        fs.writeFile(path.join(projectDir, file), createEntryFile(entryPoints)),
        fs.writeFile(
          path.join(projectDir, tsconfigFile),
          `${JSON.stringify({ compilerOptions: { ...compilerOptions, module, moduleResolution }, files: [path.basename(file)] }, null, 2)}\n`,
        ),
      ]);
      const result = await $({
        cwd: projectDir,
        reject: false,
      })`${tsc} -p ${tsconfigFile} --pretty false`;
      const fileErrors = parseTypeScriptErrors(result.stdout);
      // Errors in third-party declarations also fail tsc, but a failure without any error in a
      // file means tsc didn't check the program at all.
      if (result.failed && fileErrors.length === 0) {
        throw new Error(
          `TypeScript failed to check ${tsconfigFile}:\n${result.stdout || result.stderr || result.message}`,
        );
      }
      return getOwnErrors(fileErrors, packageNames, realTempDir);
    },
    { concurrency: os.availableParallelism() },
  );
  /** @type {Map<string, TypeScriptError>} */
  const errors = new Map();
  for (const error of ownErrors.flat()) {
    errors.set(`${error.file}\0${error.code}\0${error.message}`, error);
  }

  return {
    errors: Array.from(errors.values()),
    entryPointCount: specifiers.size,
    packageCount: packed.length,
  };
}

/**
 * @typedef {Object} Args
 * @property {boolean} keep
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'validate-built-types',
  describe:
    'Install the packed public packages into a fresh project and type-check every entry point that has types, as a consumer would. Run after building.',
  builder: (yargs) =>
    yargs.option('keep', {
      type: 'boolean',
      default: false,
      description: 'Keep the consumer project for inspection.',
    }),
  handler: async ({ keep }) => {
    const workspaceRoot = await findWorkspaceDir(process.cwd());
    if (!workspaceRoot) {
      throw new Error('Workspace directory not found');
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-built-types-'));
    let failed = false;
    try {
      const { errors, entryPointCount, packageCount } = await validateBuiltTypes({
        workspaceRoot,
        tempDir,
      });
      if (entryPointCount === 0) {
        throw new Error(
          `No entry points with types found in ${packageCount} packages. Build the packages first.`,
        );
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
        console.error(`\nConsumer project: ${path.join(tempDir, 'project')}`);
      } else {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }
  },
});

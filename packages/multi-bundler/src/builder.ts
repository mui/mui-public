import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  resolveBinEntries,
  type ResolvedEntry,
  resolveExportsEntries,
} from './utils/resolve-entrypoints';
import { findBabelConfigRoot, findTsConfig } from './utils/config-finder';
import { createBundlerAdapter } from './adapters';
import type { BundlerConfig, BundlerType, PackageInfo } from './types';
import { type GeneratedExports, generateExportsField } from './utils/generate-exports-field';

export type BundleFormat = 'esm' | 'cjs' | 'both';

interface CLIOptions extends Omit<
  BundlerConfig,
  'entries' | 'sourceMap' | 'formats' | 'watch' | 'cwd' | 'packageInfo'
> {
  /** The bundler to use */
  bundler: BundlerType;
  /** Output directory */
  outDir: string;
  /** Bundle format (esm, cjs, or both) */
  format: BundleFormat;
  /** Enable watch mode */
  watch?: boolean;
  /** Generate source maps */
  sourceMap?: boolean;
  /** Working directory (defaults to cwd) */
  cwd?: string;
}

export async function parsePackageJson(cwd: string): Promise<PackageInfo> {
  const packageJsonPath = path.join(cwd, 'package.json');
  const content = await fs.readFile(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content);

  return {
    name: pkg.name || 'unknown',
    version: pkg.version || '0.0.0',
    license: pkg.license,
    exports: pkg.exports,
    bin: pkg.bin,
    dependencies: pkg.dependencies,
    peerDependencies: pkg.peerDependencies,
    peerDependenciesMeta: pkg.peerDependenciesMeta,
  };
}

export async function build(options: CLIOptions): Promise<GeneratedExports> {
  const cwd = options.cwd || process.cwd();
  const packageInfo = await parsePackageJson(cwd);

  const exportEntries = await resolveExportsEntries(packageInfo.exports, cwd);
  const binEntries = await resolveBinEntries(packageInfo.bin, cwd);

  if (exportEntries.length === 0 && binEntries.length === 0) {
    throw new Error(
      'No entry points found in package.json exports or bin fields. Please add an "exports" or "bin" field to your package.json.',
    );
  }

  const tsconfigPath = await findTsConfig(cwd);
  const babelConfigPath = await findBabelConfigRoot(cwd);
  const formats: ('esm' | 'cjs')[] = options.format === 'both' ? ['esm', 'cjs'] : [options.format];

  const entries = new Map<string, ResolvedEntry>(
    Array.from([...exportEntries, ...binEntries]).map((entry) => [entry.exportKey, entry]),
  );

  const bundlerConfig: BundlerConfig = {
    ...options,
    entries,
    formats,
    tsconfigPath,
    babelConfigPath,
    cwd,
    packageInfo,
  };
  const adapter = await createBundlerAdapter(options.bundler);
  const outputChunks = await adapter.build(bundlerConfig);
  return generateExportsField(outputChunks, entries);
}

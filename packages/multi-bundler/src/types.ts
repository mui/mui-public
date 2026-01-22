import type { BinField, ExportsField, ResolvedEntry } from './utils/resolve-entrypoints';

export type Format = 'esm' | 'cjs';
export type BundlerType = 'tsdown' | 'rolldown' | 'rollup';

export interface BundlerConfig {
  /** Entry points mapped from package.json exports */
  entries: Map<string, ResolvedEntry>;
  /** Output directory */
  outDir: string;
  /** Bundle formats to generate */
  formats: ('esm' | 'cjs')[];
  /** Generate source maps */
  sourceMap?: boolean;
  /** Enable watch mode */
  watch?: boolean;
  /** TypeScript config path if exists */
  tsconfigPath?: string;
  /** Babel config path if exists */
  babelConfigPath?: string;
  /** Working directory */
  cwd: string;
  /** Package information */
  packageInfo: PackageInfo;
  /** Should bundle css */
  bundleCss?: boolean;
  verbose?: boolean;
  preserveDirectory?: boolean;
  enableReactCompiler?: boolean;
  clean?: boolean;
}

export interface PackageInfo {
  name: string;
  version: string;
  license?: string;
  exports?: ExportsField;
  bin?: BinField;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: boolean }>;
}

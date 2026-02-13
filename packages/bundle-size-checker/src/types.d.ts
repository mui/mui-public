// Upload configuration with optional properties
export interface UploadConfig {
  repo?: string; // The repository name (e.g., "mui/material-ui")
  branch?: string; // Optional branch name (defaults to current Git branch)
  isPullRequest?: boolean; // Whether this is a pull request build (defaults to CI detection)
}

// Normalized upload configuration where all properties are defined
export interface NormalizedUploadConfig {
  repo: string; // The repository name (e.g., "mui/material-ui")
  branch: string; // Branch name
  isPullRequest: boolean; // Whether this is a pull request build
}

// EntryPoint types
export type StringEntry = string;

export interface ObjectEntry {
  id: string; // Unique identifier for the entry (renamed from 'name')
  code?: string; // Code to be executed in the virtual module (now optional)
  import?: string; // Optional package name to import
  importedNames?: string[]; // Optional array of named imports
  externals?: string[]; // Optional array of packages to exclude from the bundle
  track?: boolean; // Whether this bundle should be tracked in PR comments (defaults to false)
  expand?: boolean; // Whether to expand the entry to include all exports
}

export type EntryPoint = StringEntry | ObjectEntry;

// Bundle size checker config with optional upload config
export interface BundleSizeCheckerConfigObject {
  entrypoints: EntryPoint[];
  upload?: UploadConfig | boolean | null;
  comment?: boolean; // Whether to post PR comments (defaults to true)
  replace?: Record<string, string>; // String replacements to apply during bundling
}

export type BundleSizeCheckerConfig =
  | BundleSizeCheckerConfigObject
  | Promise<BundleSizeCheckerConfigObject>
  | (() => BundleSizeCheckerConfigObject | Promise<BundleSizeCheckerConfigObject>);

// Normalized bundle size checker config with all properties defined
export interface NormalizedBundleSizeCheckerConfig {
  entrypoints: ObjectEntry[];
  upload: NormalizedUploadConfig | null; // null means upload is disabled
  comment: boolean; // Whether to post PR comments
  replace: Record<string, string>; // String replacements to apply during bundling
}

// Command line argument types
export interface CommandLineArgs {
  analyze?: boolean;
  output?: string;
  verbose?: boolean;
  filter?: string[];
  concurrency?: number;
  debug?: boolean;
}

export interface ReportCommandArgs {
  pr?: number;
  owner?: string;
  repo?: string;
}

// Diff command argument types
export interface DiffCommandArgs {
  base: string;
  head?: string;
  output?: 'json' | 'markdown';
  reportUrl?: string;
}

// PR command argument types
export interface PrCommandArgs {
  prNumber: number;
  output?: 'json' | 'markdown';
}

export interface PrInfo {
  number: number;
  base: {
    ref: string;
    sha: string;
    repo: {
      full_name: string;
    };
  };
  head: {
    ref: string;
    sha: string;
  };
}

export interface SizeSnapshotEntry {
  parsed: number;
  gzip: number;
}

export interface SizeInfo {
  previous: number;
  current: number;
  absoluteDiff: number;
  relativeDiff: number | null;
}

export interface Size {
  id: string;
  parsed: SizeInfo;
  gzip: SizeInfo;
}

export interface ComparisonResult {
  entries: Size[];
  totals: {
    totalParsed: number;
    totalGzip: number;
    totalParsedPercent: number;
    totalGzipPercent: number;
  };
  fileCounts: {
    added: number;
    removed: number;
    changed: number;
    total: number;
  };
}

export type SizeSnapshot = Record<string, SizeSnapshotEntry>;

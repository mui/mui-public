// WebpackEntry type
interface WebpackEntry {
  import: string;
  importName?: string;
}

// Webpack stats types
interface StatsAsset {
  name: string;
  size: number;
  related?: {
    find: (predicate: (asset: any) => boolean) => { size: number; type: string };
  };
}

interface StatsChunkGroup {
  name: string;
  assets: Array<{ name: string; size: number }>;
}

interface WebpackStats {
  hasErrors(): boolean;
  toJson(options: any): {
    assets?: StatsAsset[];
    entrypoints?: Record<string, StatsChunkGroup>;
    errors?: any[];
  };
}

// Upload configuration with optional properties
interface UploadConfig {
  repo?: string; // The repository name (e.g., "mui/material-ui")
  branch?: string; // Optional branch name (defaults to current Git branch)
  isPullRequest?: boolean; // Whether this is a pull request build (defaults to CI detection)
}

// Normalized upload configuration where all properties are defined
interface NormalizedUploadConfig {
  repo: string; // The repository name (e.g., "mui/material-ui")
  branch: string; // Branch name
  isPullRequest: boolean; // Whether this is a pull request build
}

// EntryPoint types
type StringEntry = string;

interface ObjectEntry {
  id: string; // Unique identifier for the entry (renamed from 'name')
  code?: string; // Code to be executed in the virtual module (now optional)
  import?: string; // Optional package name to import
  importedNames?: string[]; // Optional array of named imports
  externals?: string[]; // Optional array of packages to exclude from the bundle
}

type EntryPoint = StringEntry | ObjectEntry;

// Bundle size checker config with optional upload config
interface BundleSizeCheckerConfig {
  entrypoints: EntryPoint[];
  upload?: UploadConfig | boolean | null;
}

// Normalized bundle size checker config with all properties defined
interface NormalizedBundleSizeCheckerConfig {
  entrypoints: ObjectEntry[];
  upload: NormalizedUploadConfig | null; // null means upload is disabled
}

// Command line argument types
interface CommandLineArgs {
  analyze?: boolean;
  accurateBundles?: boolean;
  output?: string;
  verbose?: boolean;
  filter?: string[];
}

// Diff command argument types
interface DiffCommandArgs {
  base: string;
  head?: string;
  output?: 'json' | 'markdown';
  reportUrl?: string;
}

// PR command argument types
interface PrCommandArgs {
  prNumber: number;
  output?: 'json' | 'markdown';
  circleci?: string;
}

interface PrInfo {
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

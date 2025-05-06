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

// Upload configuration
interface UploadConfig {
  repo?: string; // The repository name (e.g., "mui/material-ui")
  branch?: string; // Optional branch name (defaults to current Git branch)
  isPullRequest?: boolean; // Whether this is a pull request build (defaults to CI detection)
}

// Bundle size checker config
interface BundleSizeCheckerConfig {
  entrypoints: string[];
  upload?: UploadConfig;
}

// Command line argument types
interface CommandLineArgs {
  analyze?: boolean;
  accurateBundles?: boolean;
  output?: string;
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

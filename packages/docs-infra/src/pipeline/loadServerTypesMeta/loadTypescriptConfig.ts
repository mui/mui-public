// webpack doesn't like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import fs from 'fs/promises';
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
import ts from 'typescript';

// Cache for loaded TypeScript configurations
// Uses process object to persist across Turbopack module contexts
const TSCONFIG_CACHE_KEY = Symbol.for('@mui/docs-infra/tsconfig-cache');
const TSCONFIG_WATCHERS_KEY = Symbol.for('@mui/docs-infra/tsconfig-watchers');

interface ProcessWithTsConfigCache {
  [TSCONFIG_CACHE_KEY]?: Map<
    string,
    Promise<{ projectPath: string; options: ts.CompilerOptions; dependencies: string[] }>
  >;
  [TSCONFIG_WATCHERS_KEY]?: Set<string>;
}

function getTsConfigCache(): Map<
  string,
  Promise<{ projectPath: string; options: ts.CompilerOptions; dependencies: string[] }>
> {
  const processObj = process as ProcessWithTsConfigCache;
  if (!processObj[TSCONFIG_CACHE_KEY]) {
    processObj[TSCONFIG_CACHE_KEY] = new Map();
  }
  return processObj[TSCONFIG_CACHE_KEY];
}

function getTsConfigWatchers(): Set<string> {
  const processObj = process as ProcessWithTsConfigCache;
  if (!processObj[TSCONFIG_WATCHERS_KEY]) {
    processObj[TSCONFIG_WATCHERS_KEY] = new Set();
  }
  return processObj[TSCONFIG_WATCHERS_KEY];
}

function setupFileWatcher(filePath: string): void {
  const cache = getTsConfigCache();
  const watchers = getTsConfigWatchers();

  // Skip if already watching this file
  if (watchers.has(filePath)) {
    return;
  }

  // Mark as watching
  watchers.add(filePath);

  // Set up file watcher
  const watcher = fs.watch(filePath);

  // Handle file changes
  (async () => {
    try {
      for await (const event of watcher) {
        if (event.eventType === 'change') {
          // Any cached config may extend the changed file, purge them all
          cache.clear();
        }
      }
    } catch (error) {
      // Watcher was closed or file was deleted
      watchers.delete(filePath);
    }
  })();
}

const FORMAT_DIAGNOSTICS_HOST: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
};

/**
 * Reads and parses a tsconfig, letting TypeScript resolve `extends` with the same
 * semantics as `tsc`. Throws the first configuration error as an `Error`.
 */
async function loadTypescriptConfigUncached(configPath: string) {
  const projectPath = path.dirname(configPath);

  const data = await fs.readFile(configPath, 'utf-8');
  const sourceFile = ts.readJsonConfigFile(configPath, () => data);

  const parsed = ts.parseJsonSourceFileConfigFileContent(
    sourceFile,
    ts.sys,
    projectPath,
    undefined,
    configPath,
  );

  const [diagnostic] = ts.getConfigFileParsingDiagnostics(parsed);
  if (diagnostic) {
    throw new Error(ts.formatDiagnostic(diagnostic, FORMAT_DIAGNOSTICS_HOST).trim());
  }

  // TypeScript reports extended files with forward slashes
  const extendedFiles = (sourceFile.extendedSourceFiles ?? []).map((file) => path.normalize(file));
  extendedFiles.forEach(setupFileWatcher);

  return { projectPath, options: parsed.options, dependencies: [configPath, ...extendedFiles] };
}

/**
 * Loads a tsconfig and caches the result until the tsconfig or any file it extends changes.
 * Failed loads are not cached, so a fixed tsconfig is picked up on the next call.
 */
export async function loadTypescriptConfig(configPath: string) {
  const cache = getTsConfigCache();

  // Return cached promise if it exists
  const cached = cache.get(configPath);
  if (cached) {
    return cached;
  }

  // Set up file watcher to purge cache on changes
  setupFileWatcher(configPath);

  // Create and cache the promise
  const promise = (async () => {
    try {
      return await loadTypescriptConfigUncached(configPath);
    } catch (error) {
      cache.delete(configPath);
      throw error;
    }
  })();
  cache.set(configPath, promise);

  return promise;
}

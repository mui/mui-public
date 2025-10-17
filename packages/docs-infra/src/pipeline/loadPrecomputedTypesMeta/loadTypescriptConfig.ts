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

function setupFileWatcher(configPath: string): void {
  const cache = getTsConfigCache();
  const watchers = getTsConfigWatchers();

  // Skip if already watching this file
  if (watchers.has(configPath)) {
    return;
  }

  // Mark as watching
  watchers.add(configPath);

  // Set up file watcher
  const watcher = fs.watch(configPath);

  // Handle file changes
  (async () => {
    try {
      for await (const event of watcher) {
        if (event.eventType === 'change') {
          // Purge this config and any configs that might extend it
          const cachedPaths = Array.from(cache.keys());
          const toPurge = cachedPaths.filter(
            (cachedPath) => cachedPath === configPath || cachedPath.includes(configPath),
          );

          toPurge.forEach((pathToPurge) => {
            cache.delete(pathToPurge);
          });
        }
      }
    } catch (error) {
      // Watcher was closed or file was deleted
      watchers.delete(configPath);
    }
  })();
}

function mergeConfig(target: any, source: any): any {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (
        typeof target[key] === 'object' &&
        target[key] !== null &&
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(target[key]) &&
        !Array.isArray(source[key])
      ) {
        mergeConfig(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }

  return target;
}

async function loadTypescriptConfigUncached(configPath: string) {
  const dependencies = [configPath];
  const projectPath = new URL('.', `file://${configPath}`).pathname;

  const data = await fs.readFile(configPath, 'utf-8');
  const { config, error } = ts.readConfigFile(configPath, (filePath) => {
    if (filePath !== configPath) {
      throw new Error(`Unexpected file path: ${filePath}`);
    }

    return data.toString();
  });

  if (error) {
    throw error;
  }

  const { options, errors, raw } = ts.parseJsonConfigFileContent(config, ts.sys, projectPath);
  options.configFilePath = configPath;

  let mergedConfig = options;
  if (raw.extends) {
    const {
      options: parentOptions,
      projectPath: parentPath,
      dependencies: parentDependencies,
    } = await loadTypescriptConfig(new URL(raw.extends, `file://${configPath}`).pathname);

    dependencies.push(...parentDependencies);

    // scope compilerOptions.paths relative to the tsconfig location
    if (parentOptions.paths) {
      Object.keys(parentOptions.paths).forEach((key) => {
        if (!parentOptions.paths) {
          return;
        }

        const paths: string[] = [];
        parentOptions.paths[key].forEach((relativePath: string) => {
          const absolutePath = new URL(relativePath, `file://${parentPath}`).pathname;
          let scopedPath = path.relative(projectPath, absolutePath);
          if (!scopedPath.startsWith('.')) {
            scopedPath = `./${scopedPath}`;
          }
          paths.push(scopedPath);
        });
        parentOptions.paths[key] = paths;
      });
    }

    mergedConfig = mergeConfig(parentOptions, mergedConfig);
  }

  if (errors.length > 0) {
    throw errors[0];
  }

  return { projectPath, options: mergedConfig, dependencies };
}

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
  const promise = loadTypescriptConfigUncached(configPath);
  cache.set(configPath, promise);

  return promise;
}

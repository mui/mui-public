import * as path from 'node:path';
import { globby } from 'globby';

export type Platform = 'node' | 'browser' | 'neutral';

/**
 * Resolved entry point with metadata
 */
export interface ResolvedEntry {
  /** The export key (e.g., ".", "./adapter-*") */
  exportKey: string;
  /** The condition key if nested (e.g., "react-server", "default") */
  condition?: string;
  /** Source file path */
  source: string;
  /** Target platform */
  platform: Platform;
  /** Whether this is a bin entry */
  isBin?: boolean;
  /** Bin name if this is a bin entry */
  binName?: string;
  originalKey: string;
}

/**
 * Nested export conditions (e.g., { "types": "...", "default": "..." })
 */
export interface ExportConditions {
  types?: string;
  import?:
    | string
    | {
        types?: string;
        default?: string;
      };
  require?:
    | string
    | {
        types?: string;
        default?: string;
      };
  default?: string;
  node?: string;
  browser?: string;
  'react-server'?: string;
  [key: string]: string | ExportConditions | undefined;
}

/**
 * Package.json exports field structure
 */
export type ExportsField = string | ExportConditions | Record<string, string | ExportConditions>;

/**
 * Package.json bin field structure
 */
export type BinField = string | Record<string, string>;

const nodeConditions = ['node', 'react-server', 'deno', 'workerd', 'edge-light'];
const browserConditions = ['browser', 'worker'];
/**
 * Determine the target platform based on export condition key
 */
function getPlatformForCondition(condition: string | undefined): Platform {
  if (!condition) {
    return 'neutral';
  }

  if (nodeConditions.includes(condition)) {
    return 'node';
  }
  if (browserConditions.includes(condition)) {
    return 'browser';
  }

  return 'neutral';
}

/**
 * Resolve bin entries
 */
export async function resolveBinEntries(
  bin: BinField | undefined,
  _rootDir: string,
): Promise<ResolvedEntry[]> {
  if (!bin) {
    return [];
  }

  const entries: ResolvedEntry[] = [];

  if (typeof bin === 'string') {
    entries.push({
      exportKey: 'bin',
      source: path.normalize(bin),
      platform: 'node',
      isBin: true,
      originalKey: bin,
    });
  } else {
    for (const [name, source] of Object.entries(bin)) {
      entries.push({
        exportKey: `bin/${name}`,
        source: path.normalize(source),
        platform: 'node',
        isBin: true,
        binName: name,
        originalKey: name,
      });
    }
  }

  return entries;
}

/**
 * Check if a string contains glob patterns
 */
function containsGlob(str: string): boolean {
  return str.includes('*');
}

/**
 * Check if the source file is an index file (index.ts, index.js, etc.)
 */
function isIndexFile(source: string): boolean {
  const filename = path.basename(source);
  return filename === 'index' || filename.startsWith('index.');
}

/**
 * Normalize export key:
 * - "." becomes "index"
 * - Remove leading "./" from export keys
 * - If fromGlob is true and source file is index.*, append "/index" to the export key
 * - If condition is provided and not "default", append ".{condition}" to the export key
 */
function normalizeExportKey(exportKey: string, source: string, condition?: string): string {
  let normalized: string;

  if (exportKey === '.') {
    normalized = 'index';
  } else {
    // Remove leading "./"
    normalized = exportKey.replace(/^\.\//, '');
  }

  // Only append /index for glob-expanded entries with index files
  if (isIndexFile(source) && !(normalized.endsWith('/index') || normalized === 'index')) {
    normalized = `${normalized}/index`;
  }

  // Append condition suffix (except for "default")
  if (condition && condition !== 'default') {
    normalized = `${normalized}.${condition}`;
  }

  return normalized;
}

/**
 * Resolve all entry points from exports field
 */
export async function resolveExportsEntries(
  exports: ExportsField | undefined,
  rootDir: string,
): Promise<ResolvedEntry[]> {
  if (!exports) {
    return [];
  }

  const entries: ResolvedEntry[] = [];

  // Handle string exports (e.g., "exports": "./src/index.ts")
  if (typeof exports === 'string') {
    entries.push({
      exportKey: normalizeExportKey('.', exports),
      source: path.normalize(exports),
      platform: 'neutral',
      originalKey: '.',
    });
    return entries;
  }

  // Handle object exports
  for (const [key, value] of Object.entries(exports)) {
    if (key === './package.json') {
      continue; // Skip package.json export
    }
    if (typeof value === 'string') {
      // Simple string value
      if (containsGlob(key) || containsGlob(value)) {
        // Expand glob patterns
        // eslint-disable-next-line no-await-in-loop
        const expanded = await expandGlobPattern(key, value, rootDir);
        for (const { exportKey, source } of expanded) {
          entries.push({
            exportKey: normalizeExportKey(exportKey, source),
            source: path.normalize(source),
            platform: 'neutral',
            originalKey: exportKey,
          });
        }
      } else {
        entries.push({
          exportKey: normalizeExportKey(key, value),
          source: path.normalize(value),
          platform: 'neutral',
          originalKey: key,
        });
      }
    } else if (typeof value === 'object' && value !== null) {
      // Nested conditions
      // eslint-disable-next-line no-await-in-loop
      await resolveConditionedExport(key, value as ExportConditions, entries, rootDir);
    }
  }

  return entries;
}

/**
 * Convert export key glob pattern to file glob pattern
 * e.g., "./adapter-*" -> "./src/adapter-*.ts" (based on source pattern)
 */
async function expandGlobPattern(
  exportPattern: string,
  sourcePattern: string,
  rootDir: string,
): Promise<Array<{ exportKey: string; source: string }>> {
  // Remove leading "./" from patterns for glob matching
  const normalizedSource = sourcePattern.replace(/^\.\//, '');

  const files = await globby(normalizedSource, { cwd: rootDir });
  return files.map((file) => {
    // Extract the variable part from the file that matches the glob
    const sourceRegex = new RegExp(
      `^${normalizedSource.replace(/\*/g, '(.*)').replace(/\?/g, '(.)')}$`,
    );
    const match = file.match(sourceRegex);

    let exportKey = exportPattern;
    if (match) {
      // Replace each * in the export pattern with corresponding captured group
      let groupIndex = 1;
      // eslint-disable-next-line no-plusplus
      exportKey = exportPattern.replace(/\*/g, () => match[groupIndex++] || '');
    }

    // Remove file extension from export key if it ends with .ts, .tsx, .js, .jsx
    exportKey = exportKey.replace(/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/, '');

    return {
      exportKey,
      source: path.normalize(`./${file}`),
    };
  });
}

/**
 * Resolve conditioned export (nested with conditions like "node", "browser", etc.)
 */
async function resolveConditionedExport(
  exportKey: string,
  conditions: ExportConditions,
  entries: ResolvedEntry[],
  rootDir: string,
): Promise<void> {
  for (const [condition, value] of Object.entries(conditions)) {
    // Skip types condition - we'll generate those
    if (condition === 'types') {
      continue;
    }

    if (typeof value === 'string') {
      // Check if source file exists and is a source file (not output)
      const ext = path.extname(value);
      if (/^\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(ext)) {
        if (containsGlob(exportKey) || containsGlob(value)) {
          // eslint-disable-next-line no-await-in-loop
          const expanded = await expandGlobPattern(exportKey, value, rootDir);
          for (const { exportKey: expKey, source } of expanded) {
            entries.push({
              exportKey: normalizeExportKey(expKey, source, condition),
              condition,
              source: path.normalize(source),
              platform: getPlatformForCondition(condition),
              originalKey: expKey,
            });
          }
        } else {
          entries.push({
            exportKey: normalizeExportKey(exportKey, value, condition),
            condition,
            source: path.normalize(value),
            platform: getPlatformForCondition(condition),
            originalKey: exportKey,
          });
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      // Further nested conditions (recursive)
      // eslint-disable-next-line no-await-in-loop
      await resolveConditionedExport(exportKey, value as ExportConditions, entries, rootDir);
    }
  }
}

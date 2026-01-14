import * as path from 'node:path';
import { globby } from 'globby';

/**
 * @typedef {import('../types.mjs').Platform} Platform
 * @typedef {import('../types.mjs').ResolvedEntry} ResolvedEntry
 * @typedef {import('../types.mjs').ExportConditions} ExportConditions
 * @typedef {import('../types.mjs').ExportsField} ExportsField
 * @typedef {import('../types.mjs').BinField} BinField
 */

/** @type {string[]} */
const nodeConditions = ['node', 'react-server', 'deno', 'workerd', 'edge-light'];
/** @type {string[]} */
const browserConditions = ['browser', 'worker'];

/**
 * Determine the target platform based on export condition key
 * @param {string | undefined} condition
 * @returns {Platform}
 */
function getPlatformForCondition(condition) {
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
 * @param {BinField | undefined} bin
 * @param {string} _rootDir
 * @returns {Promise<ResolvedEntry[]>}
 */
export async function resolveBinEntries(bin, _rootDir) {
  if (!bin) {
    return [];
  }

  /** @type {ResolvedEntry[]} */
  const entries = [];

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
 * @param {string} str
 * @returns {boolean}
 */
function containsGlob(str) {
  return str.includes('*');
}

/**
 * Check if the source file is an index file (index.ts, index.js, etc.)
 * @param {string} source
 * @returns {boolean}
 */
function isIndexFile(source) {
  const filename = path.basename(source);
  return filename === 'index' || filename.startsWith('index.');
}

/**
 * Normalize export key:
 * - "." becomes "index"
 * - Remove leading "./" from export keys
 * - If fromGlob is true and source file is index.*, append "/index" to the export key
 * - If condition is provided and not "default", append ".{condition}" to the export key
 * @param {string} exportKey
 * @param {string} source
 * @param {string} [condition]
 * @returns {string}
 */
function normalizeExportKey(exportKey, source, condition) {
  /** @type {string} */
  let normalized;

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
 * @param {ExportsField | undefined} exports
 * @param {string} rootDir
 * @returns {Promise<ResolvedEntry[]>}
 */
export async function resolveExportsEntries(exports, rootDir) {
  if (!exports) {
    return [];
  }

  /** @type {ResolvedEntry[]} */
  const entries = [];

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
      await resolveConditionedExport(
        key,
        /** @type {ExportConditions} */ (value),
        entries,
        rootDir,
      );
    }
  }

  return entries;
}

/**
 * Convert export key glob pattern to file glob pattern
 * e.g., "./adapter-*" -> "./src/adapter-*.ts" (based on source pattern)
 * @param {string} exportPattern
 * @param {string} sourcePattern
 * @param {string} rootDir
 * @returns {Promise<Array<{ exportKey: string; source: string }>>}
 */
async function expandGlobPattern(exportPattern, sourcePattern, rootDir) {
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
 * @param {string} exportKey
 * @param {ExportConditions} conditions
 * @param {ResolvedEntry[]} entries
 * @param {string} rootDir
 * @returns {Promise<void>}
 */
async function resolveConditionedExport(exportKey, conditions, entries, rootDir) {
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
      await resolveConditionedExport(
        exportKey,
        /** @type {ExportConditions} */ (value),
        entries,
        rootDir,
      );
    }
  }
}

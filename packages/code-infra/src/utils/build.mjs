import * as path from 'node:path';
import { globby } from 'globby';

/**
 * @typedef {'esm' | 'cjs'} BundleType
 */
export const isMjsBuild = !!process.env.MUI_EXPERIMENTAL_MJS;

/**
 * @param {BundleType} bundle
 */
export function getOutExtension(bundle, isType = false) {
  if (isType) {
    if (!isMjsBuild) {
      return '.d.ts';
    }
    return bundle === 'esm' ? '.d.mts' : '.d.ts';
  }
  if (!isMjsBuild) {
    return '';
  }
  return bundle === 'esm' ? '.mjs' : '';
}

/**
 * @typedef {Object} BuildOptions
 * @property {boolean} [watch=false] - Whether to watch files for changes.
 * @property {boolean} [verbose=false] - Whether to enable verbose logging.
 * @property {boolean} [sourceMap=false] - Whether to generate source maps.
 */

/**
 * @typedef {Record<string, string | null | Record<string, string>>} Exports
 */

/**
 * @param {Record<string, string>} entryMap
 * @param {string} key
 * @param {string} value
 */
function addEntry(entryMap, key, value) {
  const finalKey = key.startsWith('./') ? key.slice(2) : key;
  entryMap[finalKey] = value;
}

/**
 * Processes the exports field of a package.json file and maps them to entry points to be used by tsdown.
 * Expands glob patterns and resolves file paths.
 * @param {Exports} pkgExports
 * @param {string | Record<string, string>} pkgBin
 * @param {{ cwd: string }} options
 * @returns {Promise<[Record<string, string>, string[], Record<string, string>]>}
 */
export async function processExportsToEntry(pkgExports, pkgBin, { cwd }) {
  /**
   * @type {Record<string, string>}
   */
  const entries = {};
  /**
   * @type {Record<string, string>}
   */
  const binEntries = {};
  /**
   * @type {string[]}
   */
  const nullEntries = [];

  if (typeof pkgBin === 'string') {
    addEntry(binEntries, 'bin', pkgBin);
  } else if (pkgBin && typeof pkgBin === 'object') {
    Object.entries(pkgBin).forEach(([key, value]) => {
      addEntry(binEntries, `bin/${key}`, value);
    });
  }

  await Promise.all(
    Object.entries(pkgExports).map(async ([key, value]) => {
      if (!value) {
        nullEntries.push(key);
        return;
      }
      if (key === './package.json') {
        return;
      }
      if (typeof value === 'string') {
        if (value.includes('*')) {
          if (value.includes('**')) {
            throw new Error(
              `Unsupported glob pattern: ${value} in "exports.${key}". Please use single asterisks (*) for glob patterns.`,
            );
          }
          const files = await globby(value, {
            cwd,
            globstar: false,
          });
          files.forEach((file) => {
            const fileName = path.basename(file);
            const ext = path.extname(file);
            if (fileName.replace(ext, '') === 'index') {
              const fileKey = file
                .replace(/^(src|\.\/src)\//, '')
                .replace(new RegExp(`\\${ext}$`), '');
              // console.log({ fileKey });
              // const fragments = fileKey.split('/');
              // fragments.pop();
              addEntry(entries, fileKey, file);
            } else {
              const fileKey = fileName
                .replace(/^(src|\.\/src)\//, '')
                .replace(new RegExp(`\\${ext}$`), '');
              addEntry(entries, fileKey, file);
            }
          });
        } else {
          addEntry(entries, key === '.' ? 'index' : key, value);
        }
      } else if (value && typeof value === 'object') {
        // entries[key] = processExportsToEntry(value)[0];
        // @TODO
        throw new Error('TODO: Objects in exports are not supported yet.');
      }
    }),
  );
  return [entries, nullEntries, binEntries];
}

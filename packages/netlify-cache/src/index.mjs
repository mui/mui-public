/* eslint-disable no-console */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const CACHE_OUTPUT_FILE = 'cache-output.json';

/**
 * @typedef {Object} NetlifyPluginContext
 * @property {Object} constants - Constants provided by Netlify
 * @property {string} constants.CONFIG_PATH - Path to the Netlify configuration file
 * @property {string} constants.PUBLISH_DIR - Path to the publish directory
 * @property {Object} utils - Utility functions provided by Netlify
 * @property {Object} utils.cache - Cache utility functions
 * @property {Function} utils.cache.restore - Function to restore cache
 * @property {Function} utils.cache.save - Function to save cache
 * @property {Function} utils.cache.list - Function to list cached files
 */

/**
 *
 * @param {NetlifyPluginContext} context
 * @returns {{nextjsCacheDir: string}} Absolute paths used in the plugin
 */
function generateAbsolutePaths({ constants }) {
  const workspaceRoot = path.dirname(constants.CONFIG_PATH);
  const docsWorkspacePath = path.join(workspaceRoot, 'docs');

  const nextjsCacheDir = path.join(docsWorkspacePath, '.next', 'cache');

  return { nextjsCacheDir };
}

/**
 *
 * @param {string} dirPath
 * @returns {Promise<boolean>} True if the directory exists, false otherwise
 */
async function dirExists(dirPath) {
  return fs
    .stat(dirPath)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
}

/**
 * Restore the `.next/cache` folder
 * based on: https://github.com/netlify/next-runtime/blob/733a0219e5413aa1eea790af48c745322dbce917/src/index.ts
 * @param {NetlifyPluginContext} context
 */
export async function onPreBuild(context) {
  const { utils } = context;
  const { nextjsCacheDir } = generateAbsolutePaths(context);

  const cacheDirExists = await fs
    .stat(nextjsCacheDir)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  console.log("'%s' exists: %s", nextjsCacheDir, String(cacheDirExists));

  const success = await utils.cache.restore(nextjsCacheDir);

  console.log("Restored the cached '%s' folder: %s", nextjsCacheDir, String(success));

  const restoredCacheDir = await dirExists(nextjsCacheDir);
  console.log("'%s' exists: %s", nextjsCacheDir, String(restoredCacheDir));
}

/**
 * On build, cache the `.next/cache` folder
 * based on: https://github.com/netlify/next-runtime/blob/733a0219e5413aa1eea790af48c745322dbce917/src/index.ts
 * This hook is called immediately after the build command is executed.
 * @param {NetlifyPluginContext} context
 */
export async function onBuild(context) {
  const { utils } = context;
  const { nextjsCacheDir } = generateAbsolutePaths(context);

  const cacheExists = await dirExists(nextjsCacheDir);

  if (cacheExists) {
    console.log("'%s' exists: %s", nextjsCacheDir, String(cacheExists));

    const success = await utils.cache.save(nextjsCacheDir);

    console.log("Cached '%s' folder: %s", nextjsCacheDir, String(success));
  } else {
    console.log("'%s' does not exist", nextjsCacheDir);
  }
}

/**
 * debug
 * based on: https://github.com/netlify-labs/netlify-plugin-debug-cache/blob/v1.0.3/index.js
 * @param {NetlifyPluginContext} param0
 */
export async function onEnd({ constants, utils }) {
  const { PUBLISH_DIR } = constants;
  const cacheManifestFileName = CACHE_OUTPUT_FILE;
  const cacheManifestPath = path.join(PUBLISH_DIR, cacheManifestFileName);
  console.log('Saving cache file manifest for debugging...');
  const files = await utils.cache.list();
  await fs.mkdir(PUBLISH_DIR, { recursive: true });
  await fs.writeFile(cacheManifestPath, JSON.stringify(files, null, 2));
  console.log(`Cache file count: ${files.length}`);
  console.log(`Cache manifest saved to ${cacheManifestPath}`);
  console.log(`Please download the build files to inspect ${cacheManifestFileName}.`);
  console.log('Instructions => http://bit.ly/netlify-dl-cache');
}

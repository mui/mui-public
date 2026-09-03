import * as path from 'node:path';
import { access } from 'node:fs/promises';

/**
 * Normalize a file path to use POSIX separators
 * @param {string} filePath
 * @returns {string}
 */
export function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

/**
 * True if `target` exists on disk.
 *
 * @param {string} target - Path to check
 * @returns {Promise<boolean>}
 */
export async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

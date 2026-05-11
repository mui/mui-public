import * as path from 'node:path';

/**
 * Normalize a file path to use POSIX separators
 * @param {string} filePath
 * @returns {string}
 */
export function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

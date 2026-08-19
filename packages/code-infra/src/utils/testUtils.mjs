import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { onTestFinished } from 'vitest';

import { writePackageJson } from './pnpm.mjs';

/**
 * Creates a temporary directory and registers an `onTestFinished` hook to
 * remove it automatically when the current test ends — even if the test throws.
 *
 * @returns {Promise<string>} The path of the created temporary directory.
 */
export async function makeTempDir() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-test-'));
  onTestFinished(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
  return tmpDir;
}

/**
 * Write a package.json into a subdirectory of a temp workspace.
 *
 * @param {string} root - Workspace root
 * @param {string} dir - Subdirectory to create
 * @param {object} pkgJson - Manifest contents
 * @returns {Promise<string>} The package directory
 */
export async function writePackage(root, dir, pkgJson) {
  const pkgDir = path.join(root, dir);
  await fs.mkdir(pkgDir, { recursive: true });
  await writePackageJson(pkgDir, pkgJson);
  return pkgDir;
}

/**
 * @param {string} name
 * @param {string} pkgPath
 * @returns {import('./pnpm.mjs').PublicPackage}
 */
export function publicPkg(name, pkgPath) {
  return { name, version: '1.0.0', path: pkgPath, isPrivate: false };
}

/**
 * @param {string} name
 * @param {string} pkgPath
 * @returns {import('./pnpm.mjs').PrivatePackage}
 */
export function privatePkg(name, pkgPath) {
  return { name, version: '1.0.0', path: pkgPath, isPrivate: true };
}

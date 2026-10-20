import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
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

/**
 * Serve npm metadata and accept publishes on localhost, using real HTTP and clients.
 * @param {Record<string, { tags: Record<string, string>, versions?: string[] }>} packages
 * @param {{ authenticate?: 'bearer' | 'basic' }} [options]
 */
export async function createTestRegistry(packages, { authenticate } = {}) {
  const token =
    authenticate === 'basic'
      ? Buffer.from('test-user:test-password').toString('base64')
      : 'registry-test-token';
  const authorization = `${authenticate === 'basic' ? 'Basic' : 'Bearer'} ${token}`;
  /** @type {{ name: string, tags: Record<string, string> }[]} */
  const published = [];
  const prefix = '/registry/';
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    response.setHeader('Content-Type', 'application/json');
    if (authenticate && request.headers.authorization !== authorization) {
      response.writeHead(401).end(JSON.stringify({ error: 'Authentication required' }));
      return;
    }
    if (!pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }
    const endpoint = pathname.slice(prefix.length);
    if (request.method === 'PUT') {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
      }
      const metadata = JSON.parse(body);
      published.push({ name: metadata.name, tags: metadata['dist-tags'] });
      response.writeHead(201).end(JSON.stringify({ ok: true }));
      return;
    }
    const isDistTags = endpoint.startsWith('-/package/') && endpoint.endsWith('/dist-tags');
    const isVersion = request.method === 'HEAD';
    let name = endpoint;
    if (isDistTags) {
      name = endpoint.slice('-/package/'.length, -'/dist-tags'.length);
    } else if (isVersion) {
      name = endpoint.slice(0, endpoint.lastIndexOf('/'));
    }
    const pkg = packages[name];
    if (!pkg) {
      response.writeHead(404).end(JSON.stringify({ error: 'Package not found' }));
      return;
    }
    const versions = pkg.versions ?? Object.values(pkg.tags);
    if (isVersion) {
      const version = endpoint.slice(endpoint.lastIndexOf('/') + 1);
      response.writeHead(versions.includes(version) ? 200 : 404).end();
      return;
    }
    const { tags } = pkg;
    response.end(
      JSON.stringify(
        isDistTags
          ? tags
          : {
              name,
              'dist-tags': tags,
              versions: Object.fromEntries(
                versions.map((version) => [
                  version,
                  { name, version, dist: { tarball: `http://localhost/unused-${version}.tgz` } },
                ]),
              ),
            },
      ),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
      server.closeAllConnections();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP test registry');
  }
  return { url: `http://127.0.0.1:${address.port}${prefix}`, token, published };
}

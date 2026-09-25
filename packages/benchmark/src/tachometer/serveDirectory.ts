import * as http from 'node:http';
import * as path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export interface StaticServer {
  /** `http://127.0.0.1:<port>`, with no trailing slash. */
  origin: string;
  close: () => Promise<void>;
}

/**
 * Serves a directory of built pages on a free local port. Nothing is cached by the server; the
 * browser's own cache is per context, so each side of a comparison warms its own.
 */
export async function serveDirectory(root: string): Promise<StaticServer> {
  const server = http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = path.join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (path.relative(root, file).startsWith('..')) {
      response.writeHead(403).end();
      return;
    }
    try {
      if (!(await stat(file)).isFile()) {
        throw new Error('Not a file');
      }
    } catch {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(response);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

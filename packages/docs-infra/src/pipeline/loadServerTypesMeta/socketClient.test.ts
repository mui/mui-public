import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ensureSocketDir,
  getSocketPath,
  hasExistingWorker,
  releaseServerLock,
  SocketClient,
  tryAcquireServerLock,
} from './socketClient';

describe('tryAcquireServerLock', () => {
  it('elects a server when no types worker is listening', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));
    vi.stubEnv('MUI_DOCS_INFRA_SOCKET_DIR', socketDir);

    try {
      expect(await tryAcquireServerLock()).toBe(true);
    } finally {
      await releaseServerLock();
      await rm(socketDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('does not elect another server while the lock is held', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));
    vi.stubEnv('MUI_DOCS_INFRA_SOCKET_DIR', socketDir);

    try {
      expect(await tryAcquireServerLock()).toBe(true);
      expect(await tryAcquireServerLock()).toBe(false);
    } finally {
      await releaseServerLock();
      await rm(socketDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
});

describe('hasExistingWorker', () => {
  it('detects a listening types worker', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));
    vi.stubEnv('MUI_DOCS_INFRA_SOCKET_DIR', socketDir);
    const socketPath = getSocketPath();
    const server = createServer();

    await ensureSocketDir();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    try {
      expect(await hasExistingWorker()).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      await rm(socketDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('does not elect another server while a types worker is listening', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));
    vi.stubEnv('MUI_DOCS_INFRA_SOCKET_DIR', socketDir);
    const socketPath = getSocketPath();
    const server = createServer();

    await ensureSocketDir();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    try {
      expect(await tryAcquireServerLock()).toBe(false);
    } finally {
      await releaseServerLock();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      await rm(socketDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('reuses a types worker that starts while checking the endpoint', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));
    vi.stubEnv('MUI_DOCS_INFRA_SOCKET_DIR', socketDir);
    const socketPath = getSocketPath();
    const server = createServer();

    await ensureSocketDir();
    const serverStarted = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
      }, 50);
    });

    try {
      expect(await tryAcquireServerLock()).toBe(false);
    } finally {
      await releaseServerLock();
      await serverStarted;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      await rm(socketDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
});

describe('SocketClient', () => {
  it('retries the persistent connection while the server starts', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));
    vi.stubEnv('MUI_DOCS_INFRA_SOCKET_DIR', socketDir);
    const socketPath = getSocketPath();
    const server = createServer();
    const client = new SocketClient();
    let connectionCount = 0;

    await ensureSocketDir();
    const connectionAccepted = new Promise<void>((resolve) => {
      server.once('connection', () => {
        connectionCount += 1;
        resolve();
      });
    });
    const serverStarted = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
      }, 50);
    });

    try {
      await client.connect(500);
      await connectionAccepted;
      expect(connectionCount).toBe(1);
    } finally {
      client.close();
      await serverStarted;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      await rm(socketDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('keeps multi-byte characters split across response chunks', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));
    vi.stubEnv('MUI_DOCS_INFRA_SOCKET_DIR', socketDir);
    const socketPath = getSocketPath();
    const error = 'markup — so';
    const server = createServer((socket) => {
      socket.once('data', (data) => {
        const { id } = JSON.parse(data.toString());
        const response = Buffer.from(
          `${JSON.stringify({ id, type: 'success', data: { success: true, error } })}\n`,
        );
        const splitAt = response.indexOf('—') + 1;
        socket.write(response.subarray(0, splitAt));
        setTimeout(() => socket.write(response.subarray(splitAt)), 10);
      });
    });
    const client = new SocketClient();

    await ensureSocketDir();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    try {
      await client.connect(500);
      const response = await client.sendRequest({
        projectPath: '',
        compilerOptions: {},
        resolvedVariantMap: [],
        dependencies: [],
        rootContextDir: '/',
        relativePath: '',
      });
      expect(response.error).toBe(error);
    } finally {
      client.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await rm(socketDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
});

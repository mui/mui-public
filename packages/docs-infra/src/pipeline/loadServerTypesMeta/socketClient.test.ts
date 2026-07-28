import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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

    try {
      expect(await tryAcquireServerLock(socketDir)).toBe(true);
    } finally {
      await releaseServerLock();
      await rm(socketDir, { recursive: true, force: true });
    }
  });

  it('does not elect another server while the lock is held', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));

    try {
      expect(await tryAcquireServerLock(socketDir)).toBe(true);
      expect(await tryAcquireServerLock(socketDir)).toBe(false);
    } finally {
      await releaseServerLock();
      await rm(socketDir, { recursive: true, force: true });
    }
  });
});

describe('hasExistingWorker', () => {
  it('detects a listening types worker', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));
    const socketPath = getSocketPath(socketDir);
    const server = createServer();

    await ensureSocketDir(socketDir);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    try {
      expect(await hasExistingWorker(socketDir)).toBe(true);
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
    }
  });

  it('does not elect another server while a types worker is listening', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));
    const socketPath = getSocketPath(socketDir);
    const server = createServer();

    await ensureSocketDir(socketDir);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    try {
      expect(await tryAcquireServerLock(socketDir)).toBe(false);
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
    }
  });

  it('reuses a types worker that starts while checking the endpoint', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));
    const socketPath = getSocketPath(socketDir);
    const server = createServer();

    await ensureSocketDir(socketDir);
    const serverStarted = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
      }, 50);
    });

    try {
      expect(await tryAcquireServerLock(socketDir)).toBe(false);
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
    }
  });
});

describe('SocketClient', () => {
  it('retries the persistent connection while the server starts', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'docs-infra-types-'));
    const socketPath = getSocketPath(socketDir);
    const server = createServer();
    const client = new SocketClient(socketDir);
    let connectionCount = 0;

    await ensureSocketDir(socketDir);
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
    }
  });
});

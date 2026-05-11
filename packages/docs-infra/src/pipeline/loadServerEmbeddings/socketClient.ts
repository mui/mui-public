/**
 * Socket client for communicating with the embeddings worker.
 *
 * Mirrors the design used by `loadServerTypesMeta`. A single worker owns the
 * embeddings pipeline (~133MB ONNX model) and serves requests from other
 * workers/loaders over a Unix domain socket (or Windows named pipe), so the
 * model is downloaded and held in memory exactly once per project per host.
 */

import { connect, type Socket } from 'node:net';
import { mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { EmbeddingsRequest, EmbeddingsResponse } from './worker';

const isWindows = process.platform === 'win32';

const projectHash = createHash('sha256').update(process.cwd()).digest('hex').slice(0, 8);

function getDefaultSocketDir(): string {
  return (
    process.env.RUNNER_TEMP ?? // GitHub Actions
    process.env.AGENT_TEMPDIRECTORY ?? // Azure Pipelines
    tmpdir()
  );
}

function getEffectiveSocketDir(socketDir?: string): string {
  if (socketDir) {
    return socketDir;
  }
  return `${getDefaultSocketDir()}/mui-docs-infra-${projectHash}`;
}

export function getSocketPath(socketDir?: string): string {
  if (isWindows) {
    return join('\\\\?\\pipe', getEffectiveSocketDir(socketDir), 'embeddings');
  }
  const dir = getEffectiveSocketDir(socketDir);
  return join(dir, 'embeddings.sock');
}

export function getLockPath(socketDir?: string): string {
  const dir = getEffectiveSocketDir(socketDir);
  return join(dir, 'embeddings.lock');
}

export async function ensureSocketDir(socketDir?: string): Promise<void> {
  const dir = getEffectiveSocketDir(socketDir);
  await mkdir(dir, { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function tryConnectToPipe(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect(socketPath);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Wait for the IPC endpoint to become available.
 * The model can take a long time to download on a cold cache, so the default
 * timeout is generous (5 minutes).
 */
export async function waitForSocketFile(
  socketDir?: string,
  timeoutMs: number = 5 * 60_000,
): Promise<void> {
  const socketPath = getSocketPath(socketDir);
  const pollInterval = 100;
  const startTime = Date.now();

  if (isWindows) {
    while (Date.now() - startTime < timeoutMs) {
      // eslint-disable-next-line no-await-in-loop
      if (await tryConnectToPipe(socketPath)) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(pollInterval);
    }
    throw new Error(`Embeddings named pipe did not become available within ${timeoutMs}ms`);
  }

  await mkdir(getEffectiveSocketDir(socketDir), { recursive: true });

  while (Date.now() - startTime < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    if (await fileExists(socketPath)) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollInterval);
  }

  throw new Error(`Embeddings socket file did not appear within ${timeoutMs}ms`);
}

let lockReleaseFunction: (() => Promise<void>) | null = null;

/**
 * Try to acquire the server lock. Returns true if this caller should spawn
 * the embeddings server worker.
 */
export async function tryAcquireServerLock(socketDir?: string): Promise<boolean> {
  const lockPath = getLockPath(socketDir);

  await ensureSocketDir(socketDir);

  try {
    lockReleaseFunction = await lockfile.lock(lockPath, {
      retries: 0,
      // The model can take a while to download; allow a long stale window so
      // a slow downloader is not considered dead.
      stale: 5 * 60_000,
      realpath: false,
    });
    return true;
  } catch (error: any) {
    if (error.code === 'ELOCKED') {
      return false;
    }
    return false;
  }
}

export async function releaseServerLock(): Promise<void> {
  if (lockReleaseFunction) {
    try {
      await lockReleaseFunction();
      lockReleaseFunction = null;
    } catch {
      // Ignore errors during cleanup
    }
  }
}

export class SocketClient {
  private socket: Socket | null = null;

  private messageId = 0;

  private socketDir: string | undefined;

  private pendingRequests = new Map<
    string,
    {
      resolve: (response: EmbeddingsResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  private buffer = '';

  constructor(socketDir?: string) {
    this.socketDir = socketDir;
  }

  async connect(retryCount = 0, maxRetries = 10, retryDelay = 100): Promise<void> {
    const socketPath = getSocketPath(this.socketDir);

    try {
      await this.attemptConnect(socketPath);
    } catch (error) {
      if (retryCount >= maxRetries - 1) {
        throw error;
      }
      await sleep(retryDelay);
      await this.connect(retryCount + 1, maxRetries, retryDelay);
    }
  }

  private attemptConnect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect(socketPath);

      this.socket.on('connect', () => {
        this.socket?.removeAllListeners('error');
        resolve();
      });

      this.socket.on('error', (error) => {
        this.socket?.destroy();
        this.socket = null;
        reject(error);
      });

      this.socket.on('data', (data) => {
        this.handleData(data);
      });

      this.socket.on('end', () => {
        this.socket = null;
      });
    });
  }

  private handleData(data: Buffer): void {
    const chunk = data.toString();
    this.buffer += chunk;

    if (!chunk.includes('\n')) {
      return;
    }

    const messages = this.buffer.split('\n');
    this.buffer = messages.pop() || '';

    for (const messageStr of messages) {
      if (!messageStr.trim()) {
        continue;
      }

      try {
        const message = JSON.parse(messageStr);
        const pending = this.pendingRequests.get(message.id);

        if (pending) {
          this.pendingRequests.delete(message.id);

          if (message.type === 'success') {
            pending.resolve(message.data);
          } else {
            pending.reject(new Error(message.data?.error || 'Unknown error'));
          }
        }
      } catch (error) {
        console.error('[EmbeddingsSocketClient] Failed to parse message:', error);
      }
    }
  }

  async sendRequest(request: EmbeddingsRequest): Promise<EmbeddingsResponse> {
    if (!this.socket) {
      throw new Error('Not connected to embeddings worker socket');
    }

    const id = `req-${this.messageId}`;
    this.messageId += 1;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const message = {
        id,
        type: 'generate-embedding',
        data: request,
      };

      this.socket!.write(`${JSON.stringify(message)}\n`);

      setTimeout(
        () => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            reject(new Error('Embeddings request timeout'));
          }
        },
        5 * 60 * 1000,
      );
    });
  }

  close(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}

/**
 * Socket client for communicating with the TypeScript language service worker
 *
 * When a worker starts, it checks if another worker is already running via a socket.
 * If so, it forwards requests to that worker instead of processing them locally.
 *
 * On Unix systems, this uses Unix domain sockets.
 * On Windows, this uses named pipes (which Node.js net module supports transparently).
 */

import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { WorkerRequest, WorkerResponse } from './worker';

const isWindows = process.platform === 'win32';

/**
 * Short, stable hash of the current project directory. Used to scope shared
 * temp directories (CI runners, system tmp) so concurrent docs-infra processes
 * from different projects don't collide on the same socket/lock files.
 */
const projectHash = createHash('sha256').update(process.cwd()).digest('hex').slice(0, 8);

/**
 * Get the default socket directory.
 * On Unix: Prefers CI-specific temp directories, then falls back to system temp.
 * On Windows: Not used for the socket path itself (named pipes don't need directories).
 */
function getDefaultSocketDir(): string {
  // CI environments often have dedicated temp directories that work better
  return (
    process.env.RUNNER_TEMP ?? // GitHub Actions
    process.env.AGENT_TEMPDIRECTORY ?? // Azure Pipelines
    tmpdir()
  );
}

/**
 * Get the effective socket directory for Unix sockets and lock files.
 * Shared temp directories (CI runner temp or system tmp) are namespaced with a
 * short hash of the project directory so concurrent docs-infra processes from
 * different projects don't collide on the same socket/lock files.
 *
 * `MUI_DOCS_INFRA_SOCKET_DIR` overrides the directory for the rare host whose
 * temp directory can't host a Unix domain socket. It is used as-is, so it has to
 * be an absolute path short enough to stay under the platform's socket path
 * limit, and unique per checkout if several run at once.
 */
function getEffectiveSocketDir(): string {
  return (
    process.env.MUI_DOCS_INFRA_SOCKET_DIR ??
    `${getDefaultSocketDir()}/mui-docs-infra-${projectHash}`
  );
}

/**
 * Get the path to the IPC endpoint (Unix socket or Windows named pipe).
 * Throws when the resulting Unix socket path is too long for the platform,
 * so that every worker fails with the cause instead of only the one that goes
 * on to bind the socket.
 */
export function getSocketPath(): string {
  if (isWindows) {
    // Windows named pipe using extended-length path format
    // Uses effective socket dir to ensure uniqueness per project (prevents conflicts between parallel builds)
    return join('\\\\?\\pipe', getEffectiveSocketDir(), 'types');
  }

  const socketPath = join(getEffectiveSocketDir(), 'types.sock');

  // Unix domain sockets have a max path length (sun_path field in sockaddr_un):
  // Linux: 108 bytes, macOS/BSD: 104 bytes
  const maxSocketPath = process.platform === 'darwin' ? 104 : 108;
  if (Buffer.byteLength(socketPath) >= maxSocketPath) {
    throw new Error(
      `Socket path exceeds the maximum length of ${maxSocketPath} bytes ` +
        `for this platform (${Buffer.byteLength(socketPath)} bytes): ${socketPath}. ` +
        `Set MUI_DOCS_INFRA_SOCKET_DIR to a shorter directory.`,
    );
  }

  return socketPath;
}

/**
 * Get the path to the lock file used for server election
 */
export function getLockPath(): string {
  return join(getEffectiveSocketDir(), 'types.lock');
}

/**
 * Ensure the socket directory exists
 */
export async function ensureSocketDir(): Promise<void> {
  await mkdir(getEffectiveSocketDir(), { recursive: true });
}

/**
 * Try to connect to an IPC endpoint.
 * @returns true if connection succeeded, false otherwise
 */
function tryConnectToSocket(socketPath: string): Promise<boolean> {
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

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Poll an IPC endpoint until it accepts a connection or the timeout expires.
 */
async function waitForSocketConnection(socketPath: string, timeoutMs: number): Promise<boolean> {
  const pollInterval = 50;
  const startTime = Date.now();

  do {
    // eslint-disable-next-line no-await-in-loop
    if (await tryConnectToSocket(socketPath)) {
      return true;
    }

    const remainingTime = timeoutMs - (Date.now() - startTime);
    if (remainingTime <= 0) {
      return false;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(Math.min(pollInterval, remainingTime));
  } while (Date.now() - startTime < timeoutMs);

  return false;
}

// Store the release function globally so we can call it when needed
let lockReleaseFunction: (() => Promise<void>) | null = null;

/**
 * Try to acquire the server lock using proper-lockfile
 * Returns true if successfully acquired (this worker should be server)
 */
export async function tryAcquireServerLock(): Promise<boolean> {
  const lockPath = getLockPath();

  // Ensure the directory exists
  await ensureSocketDir();

  try {
    // Try to acquire the lock with no retries (immediate check)
    // Allow enough time for a server worker to start even when validation workers
    // saturate the CPU and delay the lock heartbeat.
    lockReleaseFunction = await lockfile.lock(lockPath, {
      retries: 0, // Don't retry, just check once
      stale: 30_000,
      realpath: false, // Don't resolve symlinks (file doesn't need to exist)
      onCompromised: (error) => {
        console.error('[SocketClient] Server lock compromised:', error);
        lockReleaseFunction = null;
      },
    });

    // A worker that initialized earlier may have released the election lock after
    // starting the server. Check the endpoint while holding the lock so late
    // workers reuse that server instead of trying to listen on the same address.
    if (await hasExistingWorker()) {
      await releaseServerLock();
      return false;
    }

    return true;
  } catch (error: any) {
    // Lock is already held by another worker
    if (error.code === 'ELOCKED') {
      return false;
    }
    // Other errors should be logged but still return false
    return false;
  }
}

/**
 * Release the server lock
 */
export async function releaseServerLock(): Promise<void> {
  const release = lockReleaseFunction;
  lockReleaseFunction = null;

  if (release) {
    try {
      await release();
    } catch (error) {
      // Ignore errors during cleanup
    }
  }
}

/**
 * Check whether a types server is accepting connections, retrying for up to 500ms.
 */
export async function hasExistingWorker(): Promise<boolean> {
  // The election lock may have been released immediately before the server
  // becomes connectable. Retry briefly before deciding to start another server.
  return waitForSocketConnection(getSocketPath(), 500);
}

/**
 * Client for communicating with an existing worker via socket
 */
export class SocketClient {
  private socket: Socket | null = null;

  private messageId = 0;

  private pendingRequests = new Map<
    string,
    {
      resolve: (response: WorkerResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  private buffer = '';

  /**
   * Connect to the worker socket, retrying while the server starts or named-pipe
   * instances are temporarily busy.
   */
  async connect(timeoutMs: number = 30_000, retryDelay: number = 50): Promise<void> {
    const socketPath = getSocketPath();
    const startTime = Date.now();

    while (true) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.attemptConnect(socketPath);
        return;
      } catch (error) {
        if (Date.now() - startTime >= timeoutMs) {
          throw error;
        }
      }

      // eslint-disable-next-line no-await-in-loop
      await sleep(retryDelay);
    }
  }

  /**
   * Attempt to connect to the socket
   */
  private attemptConnect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect(socketPath);

      this.socket.on('connect', () => {
        // Remove error listener after successful connection
        this.socket?.removeAllListeners('error');
        resolve();
      });

      this.socket.on('error', (error) => {
        // Clean up and reject
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

  /**
   * Handle incoming data from socket.
   * Optimized to avoid O(n²) behavior on large messages: only split the buffer
   * when the incoming chunk actually contains a newline delimiter.
   */
  private handleData(data: Buffer): void {
    const chunk = data.toString();
    this.buffer += chunk;

    // Fast path: skip expensive split if this chunk has no message boundary
    if (!chunk.includes('\n')) {
      return;
    }

    // Process complete messages (delimited by newlines)
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
        console.error('[SocketClient] Failed to parse message:', error);
      }
    }
  }

  /**
   * Send a request to the worker
   */
  async sendRequest(request: WorkerRequest): Promise<WorkerResponse> {
    if (!this.socket) {
      throw new Error('Not connected to worker socket');
    }

    const id = `req-${this.messageId}`;
    this.messageId += 1;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const message = {
        id,
        type: 'process-types',
        data: request,
      };

      this.socket!.write(`${JSON.stringify(message)}\n`);

      // Timeout after 5 minutes
      setTimeout(
        () => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            reject(new Error('Request timeout'));
          }
        },
        5 * 60 * 1000,
      );
    });
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}

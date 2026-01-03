/**
 * Socket client for communicating with the TypeScript language service worker
 *
 * When a worker starts, it checks if another worker is already running via a socket.
 * If so, it forwards requests to that worker instead of processing them locally.
 */

import { connect, Socket } from 'node:net';
import { watch } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { WorkerRequest, WorkerResponse } from './worker.js';

/**
 * Get the default socket directory.
 * Prefers CI-specific temp directories that are known to work better,
 * then falls back to system temp.
 */
function getDefaultSocketDir(): string {
  // CI environments often have dedicated temp directories that work better
  // (especially on Windows where the default temp may not support Unix sockets)
  return (
    process.env.RUNNER_TEMP ?? // GitHub Actions
    process.env.AGENT_TEMPDIRECTORY ?? // Azure Pipelines
    tmpdir()
  );
}

/**
 * Get the path to the Unix domain socket
 * @param socketDir - Optional custom directory for socket files
 */
export function getSocketPath(socketDir?: string): string {
  const dir = socketDir ?? getDefaultSocketDir();
  return join(dir, 'mui-types-meta-worker.sock');
}

/**
 * Get the path to the lock file used for server election
 * @param socketDir - Optional custom directory for socket files
 */
export function getLockPath(socketDir?: string): string {
  const dir = socketDir ?? getDefaultSocketDir();
  return join(dir, 'mui-types-meta-worker.lock');
}

/**
 * Ensure the socket directory exists
 * @param socketDir - Optional custom directory for socket files
 */
export async function ensureSocketDir(socketDir?: string): Promise<void> {
  if (socketDir) {
    await mkdir(socketDir, { recursive: true });
  }
}

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the socket file to appear
 * Returns when the socket file exists or throws after timeout
 * @param socketDir - Optional custom directory for socket files
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 */
export async function waitForSocketFile(
  socketDir?: string,
  timeoutMs: number = 5000,
): Promise<void> {
  const socketPath = getSocketPath(socketDir);

  // Check if it already exists
  if (await fileExists(socketPath)) {
    return;
  }

  // Ensure the directory exists before watching
  const dir = socketDir ?? getDefaultSocketDir();
  await mkdir(dir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout;

    // Watch the directory for the socket file to appear
    const watcher = watch(dir, (eventType, filename) => {
      if (filename && filename.includes('mui-types-meta-worker.sock')) {
        clearTimeout(timer);
        watcher.close();
        resolve();
      }
    });

    timer = setTimeout(() => {
      watcher.close();
      reject(new Error(`Socket file did not appear within ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

// Store the release function globally so we can call it when needed
let lockReleaseFunction: (() => Promise<void>) | null = null;

/**
 * Try to acquire the server lock using proper-lockfile
 * Returns true if successfully acquired (this worker should be server)
 * @param socketDir - Optional custom directory for socket files
 */
export async function tryAcquireServerLock(socketDir?: string): Promise<boolean> {
  const lockPath = getLockPath(socketDir);

  // Ensure the directory exists
  await ensureSocketDir(socketDir);

  try {
    // Try to acquire the lock with no retries (immediate check)
    // Stale locks will be detected after 3 seconds (server should start quickly)
    lockReleaseFunction = await lockfile.lock(lockPath, {
      retries: 0, // Don't retry, just check once
      stale: 3000, // Consider lock stale after 3 seconds
      realpath: false, // Don't resolve symlinks (file doesn't need to exist)
    });

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
  if (lockReleaseFunction) {
    try {
      await lockReleaseFunction();
      lockReleaseFunction = null;
    } catch (error) {
      // Ignore errors during cleanup
    }
  }
}

/**
 * Check if there's an existing worker socket file
 * Note: The socket server will clean up stale sockets on startup
 * @param socketDir - Optional custom directory for socket files
 */
export async function hasExistingWorker(socketDir?: string): Promise<boolean> {
  return fileExists(getSocketPath(socketDir));
}

/**
 * Client for communicating with an existing worker via socket
 */
export class SocketClient {
  private socket: Socket | null = null;

  private messageId = 0;

  private socketDir: string | undefined;

  private pendingRequests = new Map<
    string,
    {
      resolve: (response: WorkerResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  private buffer = '';

  constructor(socketDir?: string) {
    this.socketDir = socketDir;
  }

  /**
   * Connect to the worker socket with retry logic
   */
  async connect(retryCount = 0, maxRetries = 10, retryDelay = 50): Promise<void> {
    const socketPath = getSocketPath(this.socketDir);

    try {
      await this.attemptConnect(socketPath);
    } catch (error) {
      // If we've exhausted retries, throw the error
      if (retryCount >= maxRetries - 1) {
        throw error;
      }

      // Wait before retrying
      await new Promise((resolve) => {
        setTimeout(resolve, retryDelay);
      });

      // Recursive retry
      await this.connect(retryCount + 1, maxRetries, retryDelay);
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
   * Handle incoming data from socket
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

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

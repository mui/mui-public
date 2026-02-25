/**
 * Socket client for communicating with the TypeScript language service worker
 *
 * When a worker starts, it checks if another worker is already running via a socket.
 * If so, it forwards requests to that worker instead of processing them locally.
 *
 * On Unix systems, this uses Unix domain sockets.
 * On Windows, this uses named pipes (which Node.js net module supports transparently).
 */

import { connect, Socket } from 'node:net';
import { watch } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { WorkerRequest, WorkerResponse } from './worker.js';

const isWindows = process.platform === 'win32';

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
 * On CI environments, always prefer CI-specific temp directories.
 * Otherwise, use the provided socketDir or fall back to defaults.
 * @param socketDir - Optional custom directory for socket files
 */
function getEffectiveSocketDir(socketDir?: string): string {
  // CI environments always use their temp directories for better compatibility
  const ciTempDir = process.env.RUNNER_TEMP ?? process.env.AGENT_TEMPDIRECTORY;
  if (ciTempDir) {
    return `${ciTempDir}/mui-docs-infra`;
  }
  return socketDir ?? `${getDefaultSocketDir()}/mui-docs-infra`;
}

/**
 * Get the path to the IPC endpoint (Unix socket or Windows named pipe)
 * @param socketDir - Optional custom directory for socket files (Unix only)
 */
export function getSocketPath(socketDir?: string): string {
  if (isWindows) {
    // Windows named pipe using extended-length path format
    // Uses effective socket dir to ensure uniqueness per project (prevents conflicts between parallel builds)
    return join('\\\\?\\pipe', getEffectiveSocketDir(socketDir), 'types');
  }
  const dir = getEffectiveSocketDir(socketDir);
  return join(dir, 'types.sock');
}

/**
 * Get the path to the lock file used for server election
 * @param socketDir - Optional custom directory for socket files
 */
export function getLockPath(socketDir?: string): string {
  const dir = getEffectiveSocketDir(socketDir);
  return join(dir, 'types.lock');
}

/**
 * Ensure the socket directory exists
 * @param socketDir - Optional custom directory for socket files
 */
export async function ensureSocketDir(socketDir?: string): Promise<void> {
  const dir = getEffectiveSocketDir(socketDir);
  await mkdir(dir, { recursive: true });
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
 * Try to connect to a named pipe (Windows)
 * @returns true if connection succeeded, false otherwise
 */
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

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Wait for the IPC endpoint to become available.
 * On Unix: Watches for the socket file to appear.
 * On Windows: Polls by attempting to connect to the named pipe.
 * @param socketDir - Optional custom directory for socket files (Unix only)
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 */
export async function waitForSocketFile(
  socketDir?: string,
  timeoutMs: number = 5000,
): Promise<void> {
  const socketPath = getSocketPath(socketDir);

  if (isWindows) {
    // On Windows, named pipes don't create files - poll by trying to connect
    const startTime = Date.now();
    const pollInterval = 100; // ms

    while (Date.now() - startTime < timeoutMs) {
      // eslint-disable-next-line no-await-in-loop
      if (await tryConnectToPipe(socketPath)) {
        return;
      }

      // Wait before next poll
      // eslint-disable-next-line no-await-in-loop
      await sleep(pollInterval);
    }

    throw new Error(`Named pipe did not become available within ${timeoutMs}ms`);
  }

  // Unix: Check if socket file already exists
  if (await fileExists(socketPath)) {
    return;
  }

  // Ensure the directory exists before watching
  const dir = getEffectiveSocketDir(socketDir);
  await mkdir(dir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout;

    // Watch the directory for the socket file to appear
    const watcher = watch(dir, (eventType, filename) => {
      if (
        filename &&
        (filename.includes('types.sock') || (isWindows && filename.includes('types')))
      ) {
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

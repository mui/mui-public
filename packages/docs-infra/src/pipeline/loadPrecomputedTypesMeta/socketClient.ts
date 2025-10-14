/**
 * Socket client for communicating with the TypeScript language service worker
 *
 * When a worker starts, it checks if another worker is already running via a socket.
 * If so, it forwards requests to that worker instead of processing them locally.
 */

import { connect, Socket } from 'node:net';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { WorkerRequest, WorkerResponse } from './worker.js';

/**
 * Get the path to the Unix domain socket
 */
export function getSocketPath(): string {
  return join(tmpdir(), 'mui-types-meta-worker.sock');
}

/**
 * Get the path to the lock file used for server election
 */
export function getLockPath(): string {
  return join(tmpdir(), 'mui-types-meta-worker.lock');
}

// Store the release function globally so we can call it when needed
let lockReleaseFunction: (() => Promise<void>) | null = null;

/**
 * Try to acquire the server lock using proper-lockfile
 * Returns true if successfully acquired (this worker should be server)
 */
export async function tryAcquireServerLock(): Promise<boolean> {
  const lockPath = getLockPath();

  try {
    // Try to acquire the lock with no retries (immediate check)
    // Stale locks will be detected after 10 seconds by default
    lockReleaseFunction = await lockfile.lock(lockPath, {
      retries: 0, // Don't retry, just check once
      stale: 10000, // Consider lock stale after 10 seconds
      realpath: false, // Don't resolve symlinks (file doesn't need to exist)
    });

    console.warn('[Worker] Acquired server lock');
    return true;
  } catch (error: any) {
    // Lock is already held by another worker
    if (error.code === 'ELOCKED') {
      return false;
    }
    // Other errors should be logged
    console.warn('[Worker] Failed to acquire lock:', error);
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
      console.warn('[Worker] Released server lock');
    } catch (error) {
      console.warn('[Worker] Failed to release server lock:', error);
    }
  }
}

/**
 * Check if there's an existing worker socket file
 * Note: The socket server will clean up stale sockets on startup
 */
export function hasExistingWorker(): boolean {
  return existsSync(getSocketPath());
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
   * Connect to the worker socket with retry logic
   */
  async connect(retryCount = 0, maxRetries = 10, retryDelay = 50): Promise<void> {
    const socketPath = getSocketPath();

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
        console.warn('[SocketClient] Connected to existing worker');
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
        console.warn('[SocketClient] Connection closed');
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

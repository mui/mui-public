/**
 * Socket server for the first TypeScript language service worker
 *
 * The first worker to start creates a socket server that other workers can connect to.
 * This allows sharing a single TypeScript language service across all Next.js worker processes.
 *
 * On Unix systems, this uses Unix domain sockets.
 * On Windows, this uses named pipes (which Node.js net module supports transparently).
 */

import { createServer, Server, Socket } from 'node:net';
import { unlink, stat } from 'node:fs/promises';
import { getSocketPath, ensureSocketDir } from './socketClient';
import { FrameDecoder, encodeFrame } from './socketFraming';
import type { WorkerRequest, WorkerResponse } from './worker';

const isWindows = process.platform === 'win32';

interface ServerMessage {
  id: string;
  type: 'process-types';
  data: WorkerRequest;
}

interface ServerResponse {
  id: string;
  type: 'success' | 'error';
  data: WorkerResponse | { error: string };
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
 * Socket server that handles requests from other workers
 */
export class SocketServer {
  private server: Server;

  private socketPath: string;

  private connections = new Set<Socket>();

  private requestHandler: (request: WorkerRequest) => Promise<WorkerResponse>;

  /**
   * Request queue to serialize processTypes calls.
   * The TypeScript language service is a singleton that uses setRootFiles()
   * on each call — concurrent requests would thrash the program cache.
   */
  private requestQueue: Promise<void> = Promise.resolve();

  private constructor(
    requestHandler: (request: WorkerRequest) => Promise<WorkerResponse>,
    socketPath: string,
    server: Server,
  ) {
    this.socketPath = socketPath;
    this.requestHandler = requestHandler;
    this.server = server;
  }

  /**
   * Create and initialize a socket server
   */
  static async create(
    requestHandler: (request: WorkerRequest) => Promise<WorkerResponse>,
    socketDir?: string,
  ): Promise<SocketServer> {
    const socketPath = getSocketPath(socketDir);

    // Ensure the directory exists (only needed for Unix sockets)
    if (!isWindows) {
      // Unix domain sockets have a max path length (sun_path field in sockaddr_un):
      // Linux: 108 bytes, macOS/BSD: 104 bytes
      const maxSocketPath = process.platform === 'darwin' ? 104 : 108;
      if (Buffer.byteLength(socketPath) >= maxSocketPath) {
        throw new Error(
          `Socket path exceeds the maximum length of ${maxSocketPath} bytes ` +
            `for this platform (${Buffer.byteLength(socketPath)} bytes): ${socketPath}. ` +
            `Use a shorter socketDir path or avoid deeply nesting your project directory.`,
        );
      }

      await ensureSocketDir(socketDir);

      // Clean up existing socket file if it exists (might be stale from previous build)
      if (await fileExists(socketPath)) {
        try {
          await unlink(socketPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    const server = createServer();
    const instance = new SocketServer(requestHandler, socketPath, server);

    server.on('connection', (socket) => {
      instance.handleConnection(socket);
    });

    server.on('error', (error) => {
      console.error('[SocketServer] Server error:', error);
    });

    return instance;
  }

  /**
   * Start the socket server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.socketPath, () => {
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Handle incoming client connection
   */
  private handleConnection(socket: Socket): void {
    this.connections.add(socket);

    const decoder = new FrameDecoder();

    socket.on('data', (data) => {
      let messages: unknown[];
      try {
        messages = decoder.push(data);
      } catch (error) {
        console.error('[SocketServer] Failed to decode frame:', error);
        this.sendResponse(socket, {
          id: 'unknown',
          type: 'error',
          data: {
            error: `Invalid frame: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
        // Reset the decoder so one corrupt frame doesn't poison the whole connection.
        decoder.reset();
        return;
      }

      for (const message of messages) {
        if (
          message &&
          typeof message === 'object' &&
          'id' in message &&
          'type' in message
        ) {
          this.handleMessage(socket, message as ServerMessage);
        } else {
          console.error('[SocketServer] Ignoring malformed message:', message);
        }
      }
    });

    socket.on('end', () => {
      this.connections.delete(socket);
    });

    socket.on('error', (error) => {
      console.error('[SocketServer] Socket error:', error);
      this.connections.delete(socket);
    });
  }

  /**
   * Handle incoming message from client.
   * Requests are serialized through a queue to prevent concurrent processTypes
   * calls from thrashing the singleton TypeScript language service.
   */
  private handleMessage(socket: Socket, message: ServerMessage): void {
    if (message.type === 'process-types' && message.data) {
      this.requestQueue = this.requestQueue
        .then(async () => {
          try {
            const result = await this.requestHandler(message.data);
            this.sendResponse(socket, {
              id: message.id,
              type: 'success',
              data: result,
            });
          } catch (error) {
            console.error('[SocketServer] Error handling message:', error);
            this.sendResponse(socket, {
              id: message.id,
              type: 'error',
              data: {
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        })
        .catch((error) => {
          console.error('[SocketServer] Unexpected queue error:', error);
        });
    }
  }

  /**
   * Send response to client using the length-prefixed binary framing defined
   * in `./socketFraming`. `v8.serialize` has no UTF-8 string-length ceiling,
   * so payloads that previously crashed with `RangeError: Invalid string length`
   * (e.g. mui-x `DataGridProps`) now go through cleanly.
   */
  private sendResponse(socket: Socket, response: ServerResponse): void {
    let frame: Buffer;
    try {
      frame = encodeFrame(response);
    } catch (err) {
      // structured-clone failure: bad shape (function, host object, etc.).
      // Emit a minimal error frame for the same request id instead of
      // crashing the worker pool.
      const id = 'id' in response ? response.id : 'unknown';
      console.error(
        `[SocketServer] Failed to encode response for request ${id}:`,
        err instanceof Error ? err.message : String(err),
      );
      frame = encodeFrame({
        id,
        type: 'error',
        data: {
          error: `Failed to encode response: ${err instanceof Error ? err.message : String(err)}`,
        },
      } satisfies ServerResponse);
    }
    socket.write(frame);
  }

  /**
   * Shutdown the server
   */
  shutdown(): void {
    // Close all connections
    this.connections.forEach((socket) => {
      socket.end();
    });

    this.server.close(() => {
      // Clean up socket file asynchronously (only for Unix sockets)
      if (!isWindows) {
        unlink(this.socketPath).catch(() => {
          // Ignore cleanup errors
        });
      }
    });
  }
}

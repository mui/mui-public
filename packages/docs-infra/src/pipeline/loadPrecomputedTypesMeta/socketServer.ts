/**
 * Socket server for the first TypeScript language service worker
 *
 * The first worker to start creates a socket server that other workers can connect to.
 * This allows sharing a single TypeScript language service across all Next.js worker processes.
 */

import { createServer, Server, Socket } from 'node:net';
import { unlink, stat } from 'node:fs/promises';
import { getSocketPath, ensureSocketDir } from './socketClient.js';
import type { WorkerRequest, WorkerResponse } from './worker.js';

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

    // Ensure the directory exists
    await ensureSocketDir(socketDir);

    // Clean up existing socket if it exists (might be stale from previous build)
    if (await fileExists(socketPath)) {
      try {
        await unlink(socketPath);
      } catch (error) {
        // Ignore cleanup errors
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

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      // Process complete messages (delimited by newlines)
      const messages = buffer.split('\n');
      buffer = messages.pop() || '';

      for (const messageStr of messages) {
        if (!messageStr.trim()) {
          continue;
        }

        try {
          const message: ServerMessage = JSON.parse(messageStr);
          // Process message asynchronously
          this.handleMessage(socket, message).catch((error) => {
            console.error('[SocketServer] Error processing message:', error);
          });
        } catch (error) {
          console.error('[SocketServer] Failed to parse message:', error);
          this.sendResponse(socket, {
            id: 'unknown',
            type: 'error',
            data: { error: 'Invalid message format' },
          });
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
   * Handle incoming message from client
   */
  private async handleMessage(socket: Socket, message: ServerMessage): Promise<void> {
    try {
      if (message.type === 'process-types' && message.data) {
        const result = await this.requestHandler(message.data);
        this.sendResponse(socket, {
          id: message.id,
          type: 'success',
          data: result,
        });
      }
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
  }

  /**
   * Send response to client
   */
  private sendResponse(socket: Socket, response: ServerResponse): void {
    socket.write(`${JSON.stringify(response)}\n`);
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
      // Clean up socket file asynchronously
      unlink(this.socketPath).catch(() => {
        // Ignore cleanup errors
      });
    });
  }
}

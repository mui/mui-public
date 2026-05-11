/**
 * Socket server hosting the singleton embeddings pipeline.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { unlink, stat } from 'node:fs/promises';
import { getSocketPath, ensureSocketDir } from './socketClient';
import type { EmbeddingsRequest, EmbeddingsResponse } from './worker';

const isWindows = process.platform === 'win32';

interface ServerMessage {
  id: string;
  type: 'generate-embedding';
  data: EmbeddingsRequest;
}

interface ServerResponse {
  id: string;
  type: 'success' | 'error';
  data: EmbeddingsResponse | { error: string };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class SocketServer {
  private server: Server;

  private socketPath: string;

  private connections = new Set<Socket>();

  private requestHandler: (request: EmbeddingsRequest) => Promise<EmbeddingsResponse>;

  private constructor(
    requestHandler: (request: EmbeddingsRequest) => Promise<EmbeddingsResponse>,
    socketPath: string,
    server: Server,
  ) {
    this.socketPath = socketPath;
    this.requestHandler = requestHandler;
    this.server = server;
  }

  static async create(
    requestHandler: (request: EmbeddingsRequest) => Promise<EmbeddingsResponse>,
    socketDir?: string,
  ): Promise<SocketServer> {
    const socketPath = getSocketPath(socketDir);

    if (!isWindows) {
      const maxSocketPath = process.platform === 'darwin' ? 104 : 108;
      if (Buffer.byteLength(socketPath) >= maxSocketPath) {
        throw new Error(
          `Socket path exceeds the maximum length of ${maxSocketPath} bytes ` +
            `for this platform (${Buffer.byteLength(socketPath)} bytes): ${socketPath}. ` +
            `Use a shorter socketDir path or avoid deeply nesting your project directory.`,
        );
      }

      await ensureSocketDir(socketDir);

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
      console.error('[EmbeddingsSocketServer] Server error:', error);
    });

    return instance;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.socketPath, () => {
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  private handleConnection(socket: Socket): void {
    this.connections.add(socket);

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      const messages = buffer.split('\n');
      buffer = messages.pop() || '';

      for (const messageStr of messages) {
        if (!messageStr.trim()) {
          continue;
        }

        try {
          const message: ServerMessage = JSON.parse(messageStr);
          this.handleMessage(socket, message);
        } catch (error) {
          console.error('[EmbeddingsSocketServer] Failed to parse message:', error);
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
      console.error('[EmbeddingsSocketServer] Socket error:', error);
      this.connections.delete(socket);
    });
  }

  /**
   * Handle an incoming embeddings request. Unlike the types pipeline, the
   * embeddings pipeline is safe to call concurrently — the underlying ONNX
   * runtime serializes inference internally — so requests are handled in
   * parallel without an outer queue.
   */
  private handleMessage(socket: Socket, message: ServerMessage): void {
    if (message.type !== 'generate-embedding' || !message.data) {
      return;
    }

    this.requestHandler(message.data)
      .then((result) => {
        this.sendResponse(socket, {
          id: message.id,
          type: 'success',
          data: result,
        });
      })
      .catch((error) => {
        console.error('[EmbeddingsSocketServer] Error handling message:', error);
        this.sendResponse(socket, {
          id: message.id,
          type: 'error',
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
  }

  private sendResponse(socket: Socket, response: ServerResponse): void {
    socket.write(`${JSON.stringify(response)}\n`);
  }

  shutdown(): void {
    this.connections.forEach((socket) => {
      socket.end();
    });

    this.server.close(() => {
      if (!isWindows) {
        unlink(this.socketPath).catch(() => {
          // Ignore cleanup errors
        });
      }
    });
  }
}

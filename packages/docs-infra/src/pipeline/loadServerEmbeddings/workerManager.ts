// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';
// eslint-disable-next-line n/prefer-node-protocol
import { isMainThread, Worker } from 'worker_threads';
import { generateEmbeddings } from '../generateEmbeddings/generateEmbeddings';
import {
  SocketClient,
  tryAcquireServerLock,
  releaseServerLock,
  waitForSocketFile,
} from './socketClient';
import { SocketServer } from './socketServer';
import type { EmbeddingsRequest, EmbeddingsResponse } from './worker';

export interface EmbeddingsProcessor {
  generateEmbedding(text: string): Promise<number[]>;
  terminate(): void;
}

function unwrap(response: EmbeddingsResponse): number[] {
  if (!response.success || !response.embedding) {
    throw new Error(response.error ?? 'Embeddings worker returned no embedding');
  }
  return response.embedding;
}

async function processInline(request: EmbeddingsRequest): Promise<EmbeddingsResponse> {
  try {
    const embedding = await generateEmbeddings(request.text);
    return { success: true, embedding };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Try to connect to an already-running socket server. Returns the connected
 * client on success, or null if no server is reachable.
 */
async function tryConnectClient(socketDir: string | undefined): Promise<SocketClient | null> {
  const client = new SocketClient(socketDir);
  try {
    await client.connect(0, 1, 0);
    return client;
  } catch {
    client.close();
    return null;
  }
}

type Mode = 'main-host' | 'worker-host' | 'client';

/**
 * Unified embeddings processor that elects a single host across all threads
 * and processes sharing the same `socketDir`:
 *
 * - First, try connecting to an existing socket server. If reachable, become
 *   a client.
 * - Otherwise, race for the filesystem lock.
 *   - Main-thread winner: load the pipeline in-process and host the socket
 *     server directly from this thread. Own requests run inline (no IPC).
 *   - Worker-thread winner: spawn a dedicated child worker (with `isServer`)
 *     that loads the pipeline and hosts the socket. Own requests go through
 *     the socket like everyone else.
 *   - Loser: wait for the winner's socket and connect as a client.
 *
 * Cross-process safety: the lock prevents two hosts from spawning at once.
 * After winning the lock and starting the host, we re-check for an existing
 * socket (in case another process won between our pre-check and our lock
 * acquisition) and back off to client mode if so.
 */
class UnifiedEmbeddingsProcessor implements EmbeddingsProcessor {
  private socketDir: string | undefined;

  private initPromise: Promise<void> | null = null;

  private mode: Mode | null = null;

  private socketClient: SocketClient | null = null;

  private socketServer: SocketServer | null = null;

  private serverWorker: Worker | null = null;

  constructor(socketDir?: string) {
    this.socketDir = socketDir;
  }

  private ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.init().catch((error) => {
        this.initPromise = null;
        throw error;
      });
    }
    return this.initPromise;
  }

  private async init(): Promise<void> {
    // Fast path: another host is already serving — just connect.
    const existing = await tryConnectClient(this.socketDir);
    if (existing) {
      this.mode = 'client';
      this.socketClient = existing;
      return;
    }

    // Try to win the host role.
    const won = await tryAcquireServerLock(this.socketDir);

    if (!won) {
      // Someone else is currently spinning up. Wait for their socket.
      this.mode = 'client';
      await waitForSocketFile(this.socketDir, 5 * 60_000);
      this.socketClient = new SocketClient(this.socketDir);
      await this.socketClient.connect();
      return;
    }

    try {
      // Re-check after acquiring the lock. Another process may have started
      // and released between our initial probe and our lock acquisition.
      const existingAfterLock = await tryConnectClient(this.socketDir);
      if (existingAfterLock) {
        this.mode = 'client';
        this.socketClient = existingAfterLock;
        return;
      }

      if (isMainThread) {
        // Main thread: serve the socket directly from this thread, no child.
        // Inference will run on the main event loop — acceptable for the
        // Next.js MDX loader where each page makes a single embedding call
        // and the model is fast enough that briefly blocking is fine.
        this.mode = 'main-host';
        this.socketServer = await SocketServer.create(processInline, this.socketDir);
        await this.socketServer.start();
      } else {
        // Worker thread: spawn a dedicated child worker that hosts the
        // pipeline + socket, so the validate worker (which has other work
        // to do) is not blocked by inference.
        this.mode = 'worker-host';
        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const workerPath = path.join(currentDir, 'worker.mjs');
        this.serverWorker = new Worker(workerPath, {
          workerData: { isServer: true, ...(this.socketDir && { socketDir: this.socketDir }) },
        });

        this.serverWorker.on('error', (error) => {
          console.error('[EmbeddingsWorker] Server worker error:', error);
        });

        await waitForSocketFile(this.socketDir, 5 * 60_000);
        this.socketClient = new SocketClient(this.socketDir);
        await this.socketClient.connect();
      }
    } finally {
      await releaseServerLock();
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    await this.ensureInit();
    if (this.mode === 'main-host') {
      // No IPC for own requests — run the in-process pipeline directly.
      return generateEmbeddings(text);
    }
    return unwrap(await this.socketClient!.sendRequest({ text }));
  }

  terminate(): void {
    if (this.socketClient) {
      this.socketClient.close();
      this.socketClient = null;
    }
    if (this.socketServer) {
      this.socketServer.shutdown();
      this.socketServer = null;
    }
    if (this.serverWorker) {
      this.serverWorker.terminate();
      this.serverWorker = null;
    }
    this.mode = null;
    this.initPromise = null;
  }
}

const WORKER_MANAGER_KEY = Symbol.for('@mui/docs-infra/embeddings-worker-manager');

interface ProcessWithWorkerManager {
  [WORKER_MANAGER_KEY]?: EmbeddingsProcessor;
}

export function getEmbeddingsWorkerManager(socketDir?: string): EmbeddingsProcessor {
  const processObj = process as ProcessWithWorkerManager;
  if (!processObj[WORKER_MANAGER_KEY]) {
    processObj[WORKER_MANAGER_KEY] = new UnifiedEmbeddingsProcessor(socketDir);
  }
  return processObj[WORKER_MANAGER_KEY];
}

export function terminateEmbeddingsWorkerManager(): void {
  const processObj = process as ProcessWithWorkerManager;
  if (processObj[WORKER_MANAGER_KEY]) {
    processObj[WORKER_MANAGER_KEY].terminate();
    processObj[WORKER_MANAGER_KEY] = undefined;
  }
}

// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';
// eslint-disable-next-line n/prefer-node-protocol
import { isMainThread, Worker } from 'worker_threads';
import {
  SocketClient,
  tryAcquireServerLock,
  releaseServerLock,
  waitForSocketFile,
} from './socketClient';
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

/**
 * Spawns a dedicated worker thread that owns the embeddings pipeline. Used
 * from a Node process main thread (webpack/Next.js loaders) where there is
 * no need to share with sibling worker threads in the same process — one
 * worker per process is enough.
 */
class EmbeddingsWorkerManager implements EmbeddingsProcessor {
  private worker: Worker | null = null;

  private pendingRequests = new Map<number, (response: EmbeddingsResponse) => void>();

  private requestId = 0;

  private workerPath: string;

  private socketDir: string | undefined;

  constructor(socketDir?: string) {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    this.workerPath = path.join(currentDir, 'worker.mjs');
    this.socketDir = socketDir;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(this.workerPath, {
        workerData: this.socketDir ? { socketDir: this.socketDir } : undefined,
      });

      this.worker.on('message', (response: EmbeddingsResponse & { requestId?: number }) => {
        const { requestId, ...rest } = response;
        if (requestId !== undefined && this.pendingRequests.has(requestId)) {
          const resolve = this.pendingRequests.get(requestId)!;
          this.pendingRequests.delete(requestId);
          resolve(rest);
        }
      });

      this.worker.on('error', (error) => {
        console.error('[EmbeddingsWorker] Worker error:', error);
        this.pendingRequests.forEach((resolve) => {
          resolve({
            success: false,
            error: `Worker error: ${error.message}`,
          });
        });
        this.pendingRequests.clear();
        this.worker = null;
      });

      this.worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`[EmbeddingsWorker] Worker stopped with exit code ${code}`);
        }
        this.worker = null;
      });
    }

    return this.worker;
  }

  private processRequest(request: EmbeddingsRequest): Promise<EmbeddingsResponse> {
    const worker = this.ensureWorker();
    const currentRequestId = this.requestId;
    this.requestId += 1;

    return new Promise((resolve) => {
      this.pendingRequests.set(currentRequestId, resolve);

      worker.postMessage({
        ...request,
        requestId: currentRequestId,
      });
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return unwrap(await this.processRequest({ text }));
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}

/**
 * Embeddings processor for use from inside a worker thread (e.g. the validate
 * worker pool). On first request, races other sibling workers to acquire the
 * server lock:
 *
 * - Winner: spawns a bare worker in `isServer` mode (which creates the socket
 *   server), waits for the socket file to appear, then releases the lock.
 * - Losers: wait for the socket file.
 *
 * All sibling workers then connect to the socket server as clients.
 */
class WorkerThreadEmbeddingsProcessor implements EmbeddingsProcessor {
  private socketDir: string | undefined;

  private initPromise: Promise<void> | null = null;

  private socketClient: SocketClient | null = null;

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
    const isServer = await tryAcquireServerLock(this.socketDir);

    if (isServer) {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const workerPath = path.join(currentDir, 'worker.mjs');
      this.serverWorker = new Worker(workerPath, {
        workerData: { isServer: true, ...(this.socketDir && { socketDir: this.socketDir }) },
      });

      this.serverWorker.on('error', (error) => {
        console.error('[EmbeddingsWorker] Server worker error:', error);
      });

      try {
        // The model can take a while to download on a cold cache; allow up to
        // 5 minutes for the server to come up.
        await waitForSocketFile(this.socketDir, 5 * 60_000);
      } catch (error) {
        await releaseServerLock();
        throw error;
      }
      await releaseServerLock();
    } else {
      await waitForSocketFile(this.socketDir, 5 * 60_000);
    }

    this.socketClient = new SocketClient(this.socketDir);
    await this.socketClient.connect();
  }

  async generateEmbedding(text: string): Promise<number[]> {
    await this.ensureInit();
    return unwrap(await this.socketClient!.sendRequest({ text }));
  }

  terminate(): void {
    if (this.socketClient) {
      this.socketClient.close();
      this.socketClient = null;
    }
    if (this.serverWorker) {
      this.serverWorker.terminate();
      this.serverWorker = null;
    }
  }
}

const WORKER_MANAGER_KEY = Symbol.for('@mui/docs-infra/embeddings-worker-manager');

interface ProcessWithWorkerManager {
  [WORKER_MANAGER_KEY]?: EmbeddingsProcessor;
}

export function getEmbeddingsWorkerManager(socketDir?: string): EmbeddingsProcessor {
  const processObj = process as ProcessWithWorkerManager;

  if (!processObj[WORKER_MANAGER_KEY]) {
    if (isMainThread) {
      processObj[WORKER_MANAGER_KEY] = new EmbeddingsWorkerManager(socketDir);
    } else {
      processObj[WORKER_MANAGER_KEY] = new WorkerThreadEmbeddingsProcessor(socketDir);
    }
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

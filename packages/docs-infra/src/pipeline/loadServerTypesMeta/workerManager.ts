// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';
// eslint-disable-next-line n/prefer-node-protocol
import { isMainThread, Worker } from 'worker_threads';
import { SocketClient, tryAcquireServerLock, releaseServerLock } from './socketClient';
import type { WorkerRequest, WorkerResponse } from './worker';

/**
 * Shared interface for types processing managers.
 */
export interface TypesProcessor {
  processTypes(request: WorkerRequest): Promise<WorkerResponse>;
  terminate(): Promise<void>;
}

/**
 * Spawns a dedicated worker thread for TypeScript type processing.
 * Used from the main thread (webpack/Next.js) where the nested worker runs
 * processTypes and handles socket server/client election internally.
 */
class TypesMetaWorkerManager implements TypesProcessor {
  private worker: Worker | null = null;

  private pendingRequests = new Map<number, (response: WorkerResponse) => void>();

  private requestId = 0;

  private workerPath: string;

  constructor() {
    // Worker file must be compiled JS, not TS
    // Use import.meta.url to get current directory in ESM
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    this.workerPath = path.join(currentDir, 'worker.mjs');
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(this.workerPath);

      this.worker.on('message', (response: WorkerResponse & { requestId?: number }) => {
        const { requestId, ...rest } = response;
        if (requestId !== undefined && this.pendingRequests.has(requestId)) {
          const resolve = this.pendingRequests.get(requestId)!;
          this.pendingRequests.delete(requestId);
          resolve(rest);
        }
      });

      this.worker.on('error', (error) => {
        console.error('[TypesMetaWorker] Worker error:', error);
        // Reject all pending requests
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
          console.error(`[TypesMetaWorker] Worker stopped with exit code ${code}`);
        }
        this.worker = null;
      });
    }

    return this.worker;
  }

  async processTypes(request: WorkerRequest): Promise<WorkerResponse> {
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

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}

/**
 * Types processor for validate worker threads.
 * On first processTypes() call, races to acquire the server lock:
 * - Winner: holds the lock and spawns a bare worker that becomes the socket server
 * - Losers: skip spawning
 *
 * All workers then connect to the socket server as clients.
 * Result: N validate workers + 1 types server worker = N+1 threads total.
 */
class WorkerThreadTypesProcessor implements TypesProcessor {
  private initPromise: Promise<void> | null = null;

  private socketClient: SocketClient | null = null;

  private serverWorker: Worker | null = null;

  private ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.init().catch((error) => {
        // Reset so the next processTypes() call can retry
        this.initPromise = null;
        throw error;
      });
    }
    return this.initPromise;
  }

  private async init(): Promise<void> {
    const isServer = await tryAcquireServerLock();

    if (isServer) {
      // We won the lock — spawn the bare worker which will become a socket server.
      // Keep the lock held so no other worker tries to spawn a second server.
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const workerPath = path.join(currentDir, 'worker.mjs');
      this.serverWorker = new Worker(workerPath, {
        workerData: { isServer: true },
      });

      this.serverWorker.on('error', (error) => {
        console.error('[WorkerThreadTypesProcessor] Server worker error:', error);
      });
    }

    this.socketClient = new SocketClient();
    try {
      // Establish the persistent client connection directly. A separate probe
      // can consume an available Windows named-pipe instance and make the real
      // connection fail under high concurrency.
      await this.socketClient.connect();
    } catch (error) {
      this.socketClient?.close();
      this.socketClient = null;

      try {
        if (this.serverWorker) {
          await this.serverWorker.terminate();
        }
      } finally {
        this.serverWorker = null;
        if (isServer) {
          await releaseServerLock();
        }
      }
      throw error;
    }
  }

  async processTypes(request: WorkerRequest): Promise<WorkerResponse> {
    await this.ensureInit();
    return this.socketClient!.sendRequest(request);
  }

  async terminate(): Promise<void> {
    if (this.socketClient) {
      this.socketClient.close();
      this.socketClient = null;
    }
    if (this.serverWorker) {
      await this.serverWorker.terminate();
      this.serverWorker = null;
    }
    await releaseServerLock();
  }
}

// Use process global to ensure singleton persists across all Turbopack module contexts
// In Turbopack dev mode, each compilation can have separate globalThis contexts,
// but they all share the same Node.js process object
const WORKER_MANAGER_KEY = Symbol.for('@mui/docs-infra/types-meta-worker-manager');

interface ProcessWithWorkerManager {
  [WORKER_MANAGER_KEY]?: TypesProcessor;
}

export function getWorkerManager(): TypesProcessor {
  const processObj = process as ProcessWithWorkerManager;

  if (!processObj[WORKER_MANAGER_KEY]) {
    if (isMainThread) {
      // Main thread (webpack/Next.js): spawn a worker that does lock election internally
      processObj[WORKER_MANAGER_KEY] = new TypesMetaWorkerManager();
    } else {
      // Worker thread (validate workers): do lock election here to avoid nested workers
      processObj[WORKER_MANAGER_KEY] = new WorkerThreadTypesProcessor();
    }
  }

  return processObj[WORKER_MANAGER_KEY];
}

export async function terminateWorkerManager(): Promise<void> {
  const processObj = process as ProcessWithWorkerManager;
  if (processObj[WORKER_MANAGER_KEY]) {
    await processObj[WORKER_MANAGER_KEY].terminate();
    processObj[WORKER_MANAGER_KEY] = undefined;
  }
}

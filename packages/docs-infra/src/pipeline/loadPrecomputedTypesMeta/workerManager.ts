// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';
// eslint-disable-next-line n/prefer-node-protocol
import { Worker } from 'worker_threads';
import type { WorkerRequest, WorkerResponse } from './worker';

/**
 * Singleton worker manager for processing types metadata
 * Maintains a single worker instance that persists across webpack loader calls
 * to preserve the language service cache
 */
class TypesMetaWorkerManager {
  private worker: Worker | null = null;

  private pendingRequests = new Map<number, (response: WorkerResponse) => void>();

  private requestId = 0;

  private workerPath: string;

  constructor() {
    // Worker file must be compiled JS, not TS
    // Use import.meta.url to get current directory in ESM
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    this.workerPath = path.join(currentDir, 'worker.js');
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      // eslint-disable-next-line no-console
      console.log('[TypesMetaWorker] Creating new worker instance');
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
        // eslint-disable-next-line no-console
        console.log(`[TypesMetaWorker] Worker exited with code ${code}`);
        if (code !== 0) {
          console.error(`[TypesMetaWorker] Worker stopped with exit code ${code}`);
        }
        this.worker = null;
      });
    } else {
      // eslint-disable-next-line no-console
      console.log('[TypesMetaWorker] Reusing existing worker instance');
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

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}

// Use process global to ensure singleton persists across all Turbopack module contexts
// In Turbopack dev mode, each compilation can have separate globalThis contexts,
// but they all share the same Node.js process object
const WORKER_MANAGER_KEY = Symbol.for('@mui/docs-infra/types-meta-worker-manager');

interface ProcessWithWorkerManager {
  [WORKER_MANAGER_KEY]?: TypesMetaWorkerManager;
}

// Debug tracking
let accessCount = 0;
const moduleId = Math.random().toString(36).substring(2, 9);

export function getWorkerManager(): TypesMetaWorkerManager {
  accessCount += 1;
  const processObj = process as ProcessWithWorkerManager;

  if (!processObj[WORKER_MANAGER_KEY]) {
    processObj[WORKER_MANAGER_KEY] = new TypesMetaWorkerManager();

    // eslint-disable-next-line no-console
    console.log(`[WorkerManager] Creating NEW manager instance`);
    // eslint-disable-next-line no-console
    console.log(`  Module ID: ${moduleId}`);
    // eslint-disable-next-line no-console
    console.log(`  Access count in this module: ${accessCount}`);
    // eslint-disable-next-line no-console
    console.log(`  Process ID: ${process.pid}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[WorkerManager] Reusing EXISTING manager instance`);
    // eslint-disable-next-line no-console
    console.log(`  Module ID: ${moduleId}`);
    // eslint-disable-next-line no-console
    console.log(`  Access count in this module: ${accessCount}`);
    // eslint-disable-next-line no-console
    console.log(`  Process ID: ${process.pid}`);
  }

  return processObj[WORKER_MANAGER_KEY];
}

export function terminateWorkerManager(): void {
  const processObj = process as ProcessWithWorkerManager;
  if (processObj[WORKER_MANAGER_KEY]) {
    processObj[WORKER_MANAGER_KEY].terminate();
    processObj[WORKER_MANAGER_KEY] = undefined;
  }
}

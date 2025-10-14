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

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}

// Use globalThis to ensure singleton persists across all webpack module contexts
// Symbol key prevents naming conflicts with other global properties
const GLOBAL_KEY = Symbol.for('@mui/docs-infra/types-meta-worker-manager');

interface GlobalWithWorkerManager {
  [GLOBAL_KEY]?: TypesMetaWorkerManager;
}

export function getWorkerManager(): TypesMetaWorkerManager {
  const globalObj = globalThis as GlobalWithWorkerManager;
  if (!globalObj[GLOBAL_KEY]) {
    globalObj[GLOBAL_KEY] = new TypesMetaWorkerManager();
  }
  return globalObj[GLOBAL_KEY];
}

export function terminateWorkerManager(): void {
  const globalObj = globalThis as GlobalWithWorkerManager;
  if (globalObj[GLOBAL_KEY]) {
    globalObj[GLOBAL_KEY].terminate();
    globalObj[GLOBAL_KEY] = undefined;
  }
}

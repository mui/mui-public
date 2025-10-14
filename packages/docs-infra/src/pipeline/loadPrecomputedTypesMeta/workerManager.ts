// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
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
    this.workerPath = path.join(__dirname, 'worker.js');
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

// Global singleton instance
let workerManagerInstance: TypesMetaWorkerManager | null = null;

export function getWorkerManager(): TypesMetaWorkerManager {
  if (!workerManagerInstance) {
    workerManagerInstance = new TypesMetaWorkerManager();
  }
  return workerManagerInstance;
}

export function terminateWorkerManager(): void {
  if (workerManagerInstance) {
    workerManagerInstance.terminate();
    workerManagerInstance = null;
  }
}

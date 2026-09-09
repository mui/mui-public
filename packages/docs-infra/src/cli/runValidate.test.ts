import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { shutdownWorker, shutdownWorkers } from './runValidate';

describe('shutdownWorker', () => {
  it('returns when the worker already exited', async () => {
    const worker = new Worker('', { eval: true });
    await once(worker, 'exit');

    await expect(shutdownWorker(worker, 50)).resolves.toBeUndefined();
  });

  it('terminates a worker that does not acknowledge shutdown', async () => {
    const worker = new Worker('setInterval(() => {}, 1000)', { eval: true });

    await shutdownWorker(worker, 50);

    expect(worker.threadId).toBe(-1);
  });

  it('lets workers acknowledge shutdown before terminating them', async () => {
    const worker = new Worker(
      `
        const { parentPort } = require('node:worker_threads');
        parentPort.on('message', () => {
          setTimeout(() => {
            parentPort.postMessage({ type: 'shutdown' });
          }, 50);
        });
      `,
      { eval: true },
    );
    let acknowledged = false;
    worker.on('message', () => {
      acknowledged = true;
    });
    await once(worker, 'online');

    await shutdownWorkers([worker]);

    expect(acknowledged).toBe(true);
  });
});

// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { parentPort, workerData } from 'worker_threads';

import { SocketServer } from './socketServer';
import {
  processTypes,
  type WorkerRequest,
  type WorkerResponse,
  type VariantResult,
} from './processTypes';

// Re-export types for convenience
export type { WorkerRequest, WorkerResponse, VariantResult };

// Get socket directory from worker data (if provided)
const socketDir: string | undefined = workerData?.socketDir;
// When true, start a socket server so other workers can connect via IPC.
const isServer: boolean = workerData?.isServer === true;

let socketServer: SocketServer | null = null;

// If told to be a server, start the socket server for other workers to connect to.
const socketReady = isServer
  ? SocketServer.create(processTypes, socketDir).then(async (server) => {
      socketServer = server;
      await server.start();
    })
  : Promise.resolve();

if (parentPort) {
  parentPort.on('message', async (request: WorkerRequest) => {
    await socketReady;

    const response = await processTypes(request);

    // Echo back the requestId for the worker manager to match responses
    parentPort?.postMessage({
      ...response,
      requestId: request.requestId,
    });
  });

  parentPort.on('close', () => {
    if (socketServer) {
      socketServer.shutdown();
    }
  });
}

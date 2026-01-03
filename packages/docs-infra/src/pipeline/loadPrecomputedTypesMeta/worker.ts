// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { parentPort, workerData } from 'worker_threads';

import {
  SocketClient,
  tryAcquireServerLock,
  releaseServerLock,
  waitForSocketFile,
} from './socketClient';
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

// Worker message handler
let socketClient: SocketClient | null = null;
let socketServer: SocketServer | null = null;

// Initialize socket connection
const initSocket = async () => {
  // Try to acquire the server lock (only one worker will succeed)
  let shouldBeServer = await tryAcquireServerLock(socketDir);

  if (shouldBeServer) {
    // This is the first worker - create a socket server
    socketServer = await SocketServer.create(processTypes, socketDir);
    await socketServer.start();
  } else {
    // Another worker is already running - wait for the socket file to appear

    try {
      // Wait for the socket file to be created by the server
      await waitForSocketFile(socketDir);

      socketClient = new SocketClient(socketDir);
      await socketClient.connect();
    } catch (error) {
      // Retry: Maybe no server exists yet, try to become the server ourselves
      shouldBeServer = await tryAcquireServerLock(socketDir);

      if (shouldBeServer) {
        socketClient = null;
        socketServer = await SocketServer.create(processTypes, socketDir);
        await socketServer.start();
      } else {
        // Fall back to processing locally
        socketClient = null;
      }
    }
  }
};

// Start initialization
const socketReady = initSocket();

if (parentPort) {
  parentPort.on('message', async (request: WorkerRequest) => {
    // Wait for socket initialization to complete
    await socketReady;

    let response: WorkerResponse;

    // If we have a socket client connection, forward the request
    if (socketClient) {
      try {
        response = await socketClient.sendRequest(request);
      } catch (error) {
        socketClient = null; // Disconnect on error
        response = await processTypes(request);
      }
    } else {
      // Process locally (either server worker or standalone worker)
      response = await processTypes(request);
    }

    // Echo back the requestId for the worker manager to match responses
    parentPort?.postMessage({
      ...response,
      requestId: request.requestId,
    });
  });

  // Clean up on worker termination
  parentPort.on('close', () => {
    if (socketClient) {
      socketClient.close();
    }
    if (socketServer) {
      socketServer.shutdown();
      // Release lock asynchronously (fire and forget since worker is closing)
      releaseServerLock().catch((error) => {
        console.error('[Worker] Failed to release lock on close:', error);
      });
    }
  });
}

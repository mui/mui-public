/**
 * Worker thread that owns the singleton embeddings pipeline.
 *
 * The worker is started in one of two modes via `workerData`:
 *
 * - Default (no `isServer` flag): listens on `parentPort` and processes
 *   requests directly. Used when only one consumer needs embeddings (the
 *   main thread of a Node process).
 *
 * - `isServer: true`: starts a Unix socket / Windows named pipe server in
 *   addition to the `parentPort` listener so other worker threads (e.g. the
 *   validate worker pool) can share the same in-memory pipeline.
 */

// eslint-disable-next-line n/prefer-node-protocol
import { parentPort, workerData } from 'worker_threads';
import { generateEmbeddings } from '../generateEmbeddings/generateEmbeddings';
import { SocketServer } from './socketServer';

export interface EmbeddingsRequest {
  text: string;
}

export interface EmbeddingsResponse {
  success: boolean;
  embedding?: number[];
  error?: string;
}

interface ParentMessage extends EmbeddingsRequest {
  requestId: number;
}

const socketDir: string | undefined = workerData?.socketDir;
const isServer: boolean = workerData?.isServer === true;

let socketServer: SocketServer | null = null;

async function processEmbeddings(request: EmbeddingsRequest): Promise<EmbeddingsResponse> {
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

const socketReady = isServer
  ? SocketServer.create(processEmbeddings, socketDir).then(async (server) => {
      socketServer = server;
      await server.start();
    })
  : Promise.resolve();

if (parentPort) {
  parentPort.on('message', async (request: ParentMessage) => {
    await socketReady;

    const response = await processEmbeddings({ text: request.text });

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

import { getEmbeddingsWorkerManager } from './workerManager';

/**
 * Generate an embedding vector for `text` using the singleton embeddings
 * pipeline (see {@link getEmbeddingsWorkerManager}). Safe to call concurrently
 * from many call sites — the underlying model is loaded into memory exactly
 * once per Node process and downloaded exactly once per host.
 *
 * @param text - The text to embed.
 * @param socketDir - Optional directory for the IPC socket and lock file.
 *   Defaults to a project-scoped directory under the system temp dir.
 */
export async function loadServerEmbeddings(text: string, socketDir?: string): Promise<number[]> {
  const manager = getEmbeddingsWorkerManager(socketDir);
  return manager.generateEmbedding(text);
}

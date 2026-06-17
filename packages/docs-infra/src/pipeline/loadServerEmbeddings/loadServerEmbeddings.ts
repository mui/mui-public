import { getEmbeddingsWorkerManager } from './workerManager';

/**
 * Generate an embedding vector for `text` using the singleton embeddings
 * pipeline (see {@link getEmbeddingsWorkerManager}). Safe to call concurrently
 * from many call sites — the underlying model is loaded into memory exactly
 * once per Node process and downloaded exactly once per host.
 *
 * Returns the embedding as a base64-encoded little-endian float32 string.
 * This is the format used throughout the docs pipeline (sitemap, page index
 * markdown, etc.); decode with `decodeEmbeddingsBase64` only at the boundary
 * where the vector is handed to a vector index.
 *
 * @param text - The text to embed.
 * @param socketDir - Optional directory for the IPC socket and lock file.
 *   Defaults to a project-scoped directory under the system temp dir.
 */
export async function loadServerEmbeddings(text: string, socketDir?: string): Promise<string> {
  const manager = getEmbeddingsWorkerManager(socketDir);
  return manager.generateEmbedding(text);
}

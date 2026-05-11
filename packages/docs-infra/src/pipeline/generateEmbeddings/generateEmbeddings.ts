import { getEmbeddingsPipeline } from './getEmbeddingsPipeline';
import { normalizeVector } from './oramaPluginEmbeddings';

export async function generateEmbeddings(text: string): Promise<number[]> {
  let lastLogTime = performance.now();
  let logged = false;

  const featureExtractor = await getEmbeddingsPipeline((progress) => {
    if (progress.status === 'progress') {
      const now = performance.now();
      if (now - lastLogTime > 3000) {
        // eslint-disable-next-line no-console
        console.log(
          `[docs-infra embeddings] Loading ${progress.file} - ${Math.round(progress.progress)}%`,
        );
        lastLogTime = now;
        logged = true;
      }
    }
  });

  if (logged) {
    // eslint-disable-next-line no-console
    console.log('[docs-infra embeddings] Model loaded.');
  }

  const result = await featureExtractor(text, {
    pooling: 'mean',
    normalize: true,
  });

  const output = Array.from(result.data) as number[];

  // Round to 6 decimal places to keep serialized embeddings byte-stable across
  // platforms. ONNX runtimes can produce slightly different floating-point
  // values depending on CPU SIMD path, thread count, and runtime version;
  // those differences are well below cosine-similarity noise but cause
  // unnecessary diffs in committed `[//]: # 'Embeddings: …'` markers.
  return normalizeVector(output).map((value) => Math.round(value * 1e6) / 1e6);
}

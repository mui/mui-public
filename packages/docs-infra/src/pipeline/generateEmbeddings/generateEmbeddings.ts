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

  // Round to 5 decimal places to keep serialized embeddings byte-stable
  // across platforms. ONNX runtimes can produce slightly different
  // floating-point values (~1e-7) depending on CPU SIMD path, thread count,
  // and runtime version. Rounding to 1e-5 keeps the rounding midpoint two
  // orders of magnitude away from that drift, so values won't flip across
  // the boundary between machines. The lost precision is well below
  // cosine-similarity noise.
  return normalizeVector(output).map((value) => Math.round(value * 1e5) / 1e5);
}

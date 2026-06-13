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

  return normalizeVector(output);
}

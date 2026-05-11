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

  // Round each component to 6 significant digits. This shrinks the
  // serialized index (~30% size reduction) without affecting cosine-similarity
  // ranking. Cross-platform stability is handled separately by the tolerance
  // comparison in `syncPageIndex`, so the choice of rounding direction here
  // doesn't matter — plain round-to-nearest is fine.
  return normalizeVector(output).map((value) => {
    if (value === 0 || !Number.isFinite(value)) {
      return value;
    }
    const magnitude = Math.floor(Math.log10(Math.abs(value)));
    const scale = 10 ** (5 - magnitude); // 6 significant digits
    return Math.round(value * scale) / scale;
  });
}

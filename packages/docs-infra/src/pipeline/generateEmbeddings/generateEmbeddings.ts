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

  // Quantize to 6 significant digits, always rounding the absolute value up
  // (toward +∞ for positive values, toward -∞ for negative). ONNX runtimes
  // produce slightly different floating-point values across CPU SIMD paths,
  // thread counts, and runtime versions; using a fixed-direction quantization
  // keeps the serialized output byte-stable across platforms when the drift
  // is below the quantization step. The lost precision is well below
  // cosine-similarity noise.
  return normalizeVector(output).map((value) => {
    if (value === 0 || !Number.isFinite(value)) {
      return value;
    }
    const sign = value < 0 ? -1 : 1;
    const abs = Math.abs(value);
    const magnitude = Math.floor(Math.log10(abs));
    const scale = 10 ** (5 - magnitude); // 6 significant digits
    return (sign * Math.floor(abs * scale)) / scale;
  });
}

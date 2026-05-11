import {
  pipeline,
  type FeatureExtractionPipeline,
  type ProgressCallback,
} from '@huggingface/transformers';

const TASK = 'feature-extraction' as const;
const MODEL = 'Supabase/gte-small';
const EMBEDDINGS_PIPELINE_KEY = '__docs_infra_embeddings_pipeline__';

type EmbeddingsPipeline = FeatureExtractionPipeline;

export async function getEmbeddingsPipeline(
  progress_callback?: ProgressCallback,
): Promise<EmbeddingsPipeline> {
  // Memoize the in-flight promise (not the resolved result) so concurrent
  // callers share a single underlying `pipeline()` invocation. Awaiting before
  // assigning would let parallel callers each start their own model download.
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope[EMBEDDINGS_PIPELINE_KEY]) {
    globalScope[EMBEDDINGS_PIPELINE_KEY] = pipeline(TASK, MODEL, {
      progress_callback,
      // Pin to fp32 instead of 'auto' so the same dtype kernel runs on every
      // machine. With 'auto', different hardware can pick fp16 vs fp32 (or
      // quantized variants), producing embeddings that diverge well beyond
      // floating-point noise and break cross-platform byte-stability.
      dtype: 'fp32',
    });
  }

  return globalScope[EMBEDDINGS_PIPELINE_KEY] as Promise<EmbeddingsPipeline>;
}

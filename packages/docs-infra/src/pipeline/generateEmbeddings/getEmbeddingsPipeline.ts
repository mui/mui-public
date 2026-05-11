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
      dtype: 'auto',
    });
  }

  return globalScope[EMBEDDINGS_PIPELINE_KEY] as Promise<EmbeddingsPipeline>;
}

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
  if (!(globalThis as any)[EMBEDDINGS_PIPELINE_KEY]) {
    (globalThis as any)[EMBEDDINGS_PIPELINE_KEY] = await pipeline(TASK, MODEL, {
      progress_callback,
      dtype: 'auto',
    });
  }

  return (globalThis as any)[EMBEDDINGS_PIPELINE_KEY] as EmbeddingsPipeline;
}

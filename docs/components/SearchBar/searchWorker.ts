import { createChannel } from 'bidc';
import { getEmbeddingsPipeline } from '@mui/internal-docs-infra/pipeline/generateEmbeddings';
import { ProgressInfo } from '@huggingface/transformers';

const { send, receive } = createChannel();

const featureExtractorPromise = getEmbeddingsPipeline((x) => send(x));

export type ReceivePayload = { type: 'generate'; text: string } | { type: 'check' };
export type ReceiveResponse =
  | ProgressInfo
  | { status: 'ready' | 'unknown' }
  | { status: 'complete'; output: number[] };

receive(async (payload: ReceivePayload): Promise<ReceiveResponse> => {
  if (payload.type === 'check') {
    await featureExtractorPromise;
    return { status: 'ready' };
  }

  if (payload.type !== 'generate') {
    console.error(`Unknown payload type: ${JSON.stringify(payload)}`);
    return { status: 'unknown' };
  }

  const featureExtractor = await featureExtractorPromise;
  const result = await featureExtractor(payload.text, {
    pooling: 'mean',
    normalize: true,
  });

  const output = Array.from(result.data) as number[];

  return {
    status: 'complete',
    output,
  };
});

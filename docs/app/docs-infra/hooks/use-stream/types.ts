import { createMultipleTypes } from '@/functions/createTypes';
import { useStream, useStreamController, streamChunks } from '@mui/internal-docs-infra/useStream';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, {
  useStream,
  useStreamController,
  streamChunks,
});

export const TypesUseStream = types;
export const TypesUseStreamAdditional = AdditionalTypes;

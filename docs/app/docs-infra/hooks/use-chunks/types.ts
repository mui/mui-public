import { createMultipleTypes } from '@/functions/createTypes';
import {
  useChunks,
  useChunksController,
  streamChunkSource,
} from '@mui/internal-docs-infra/useChunks';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, {
  useChunks,
  useChunksController,
  streamChunkSource,
});

export const TypesUseChunks = types;
export const TypesUseChunksAdditional = AdditionalTypes;

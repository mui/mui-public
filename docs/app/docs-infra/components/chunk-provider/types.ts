import { createMultipleTypes } from '@/functions/createTypes';
import { ChunkProvider, PreloadProvider, usePreload } from '@mui/internal-docs-infra/ChunkProvider';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, {
  ChunkProvider,
  PreloadProvider,
  usePreload,
});

export const TypesChunkProvider = types;
export const TypesChunkProviderAdditional = AdditionalTypes;

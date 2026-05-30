import { createMultipleTypes } from '@/functions/createTypes';
import {
  abstractCreateChunked,
  createChunkedFactory,
} from '@mui/internal-docs-infra/abstractCreateChunked';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, {
  abstractCreateChunked,
  createChunkedFactory,
});

export const TypesAbstractCreateChunked = types;
export const TypesAbstractCreateChunkedAdditional = AdditionalTypes;

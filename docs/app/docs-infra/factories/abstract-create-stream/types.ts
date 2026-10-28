import { createMultipleTypes } from '@/functions/createTypes';
import {
  abstractCreateStream,
  createStreamFactory,
} from '@mui/internal-docs-infra/abstractCreateStream';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, {
  abstractCreateStream,
  createStreamFactory,
});

export const TypesAbstractCreateStream = types;
export const TypesAbstractCreateStreamAdditional = AdditionalTypes;

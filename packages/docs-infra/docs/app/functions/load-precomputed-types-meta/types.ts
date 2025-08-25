import { createTypes } from '@/functions/createTypes';
import { loadPrecomputedTypesMeta } from '../../../../src/pipeline/loadPrecomputedTypesMeta/loadPrecomputedTypesMeta';

export const TypesLoadPrecomputedTypesMeta = createTypes(
  import.meta.url,
  loadPrecomputedTypesMeta,
  {
    globalTypes: ['react', 'node'],
  },
);

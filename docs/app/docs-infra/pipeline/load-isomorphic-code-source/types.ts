import { createTypes } from '@/functions/createTypes';
import { createLoadIsomorphicCodeSource } from '@mui/internal-docs-infra/pipeline/loadIsomorphicCodeSource';

export const TypesLoadIsomorphicCodeSource = createTypes(
  import.meta.url,
  createLoadIsomorphicCodeSource,
);

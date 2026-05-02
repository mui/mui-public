import { createMultipleTypes } from '@/functions/createTypes';
import * as loadIsomorphicCodeVariant from '@mui/internal-docs-infra/pipeline/loadIsomorphicCodeVariant';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, loadIsomorphicCodeVariant);

export const TypesLoadIsomorphicCodeVariant = types;
export const TypesLoadIsomorphicCodeVariantAdditional = AdditionalTypes;

import { createMultipleTypes } from '@/functions/createTypes';
import * as loadCodeVariant from '@mui/internal-docs-infra/pipeline/loadCodeVariant';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, loadCodeVariant);

export const TypesLoadCodeVariant = types;
export const TypesLoadCodeVariantAdditional = AdditionalTypes;

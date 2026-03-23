import { createMultipleTypes } from '@/functions/createTypes';
import * as hastUtils from '@mui/internal-docs-infra/pipeline/hastUtils';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, hastUtils);

export const TypesHastUtils = types;
export const TypesHastUtilsAdditional = AdditionalTypes;

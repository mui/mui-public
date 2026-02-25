import { createMultipleTypes } from '@/functions/createTypes';
import * as loadServerTypesText from '@mui/internal-docs-infra/pipeline/loadServerTypesText';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, loadServerTypesText);

export const TypesLoadServerTypesText = types;
export const TypesLoadServerTypesTextAdditional = AdditionalTypes;

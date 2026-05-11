import { createMultipleTypes } from '@/functions/createTypes';
import * as UseTypeModule from '@mui/internal-docs-infra/useType';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, UseTypeModule);

export const TypesUseType = types;
export const TypesUseTypeAdditional = AdditionalTypes;

import { createMultipleTypes } from '@/functions/createTypes';
import * as AbstractCreateTypesModule from '@mui/internal-docs-infra/abstractCreateTypes';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, AbstractCreateTypesModule);

export const TypesAbstractCreateTypes = types;
export const TypesAbstractCreateTypesAdditional = AdditionalTypes;

import { createMultipleTypes } from '@/functions/createTypes';
import * as AbstractCreateTypesModule from '@mui/internal-docs-infra/abstractCreateTypes';

const types = createMultipleTypes(import.meta.url, AbstractCreateTypesModule);

export const TypesAbstractCreateTypes = types.abstractCreateTypes;
export const TypesCreateTypesFactory = types.createTypesFactory;
export const TypesCreateMultipleTypesFactory = types.createMultipleTypesFactory;

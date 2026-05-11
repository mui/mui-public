import { createMultipleTypes } from '@/functions/createTypes';
import * as parseCreateFactoryCall from '@mui/internal-docs-infra/pipeline/parseCreateFactoryCall';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, parseCreateFactoryCall);

export const TypesParseCreateFactoryCall = types;
export const TypesParseCreateFactoryCallAdditional = AdditionalTypes;

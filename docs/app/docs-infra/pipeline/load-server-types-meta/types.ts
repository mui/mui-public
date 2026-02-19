import { createMultipleTypes } from '@/functions/createTypes';
import * as loadServerTypesMeta from '@mui/internal-docs-infra/pipeline/loadServerTypesMeta';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, loadServerTypesMeta);

export const TypesLoadServerTypesMeta = types;
export const TypesLoadServerTypesMetaAdditional = AdditionalTypes;

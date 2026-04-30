import { createMultipleTypes } from '@/functions/createTypes';
import * as withDocsInfra from '@mui/internal-docs-infra/withDocsInfra';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, withDocsInfra);

export const TypesWithDocsInfra = types;
export const TypesWithDocsInfraAdditional = AdditionalTypes;

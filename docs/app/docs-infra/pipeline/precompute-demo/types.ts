import { createMultipleTypes } from '@/functions/createTypes';
import * as precomputeDemo from '@mui/internal-docs-infra/pipeline/precomputeDemo';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, precomputeDemo);

export const TypesPrecomputeDemo = types;
export const TypesPrecomputeDemoAdditional = AdditionalTypes;

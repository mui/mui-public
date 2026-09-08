import { createMultipleTypes } from '@/functions/createTypes';
import * as precomputeFileDemo from '@mui/internal-docs-infra/pipeline/precomputeFileDemo';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, precomputeFileDemo);

export const TypesPrecomputeFileDemo = types;
export const TypesPrecomputeFileDemoAdditional = AdditionalTypes;

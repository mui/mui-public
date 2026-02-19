import { createMultipleTypes } from '@/functions/createTypes';
import * as useDemo from '@mui/internal-docs-infra/useDemo';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, useDemo);

export const TypesUseDemo = types;
export const TypesUseDemoAdditional = AdditionalTypes;

import { createMultipleTypes } from '@/functions/createTypes';
import * as useCrossTabState from '@mui/internal-docs-infra/useCrossTabState';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, useCrossTabState);

export const TypesUseCrossTabState = types.useCrossTabState;
export const TypesUseCrossTabMirror = types.useCrossTabMirror;
export const TypesUseCrossTabStateAdditionalTypes = AdditionalTypes;

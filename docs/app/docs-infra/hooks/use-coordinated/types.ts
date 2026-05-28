import { createMultipleTypes } from '@/functions/createTypes';
import {
  useCoordinated,
  useCoordinatedLocalStorage,
  useCoordinatedPreference,
} from '@mui/internal-docs-infra/useCoordinated';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, {
  useCoordinated,
  useCoordinatedLocalStorage,
  useCoordinatedPreference,
});

export const TypesUseCoordinated = types;
export const TypesUseCoordinatedAdditional = AdditionalTypes;

import { createMultipleTypes } from '@/functions/createTypes';
import { usePreference, usePreferences } from '@mui/internal-docs-infra/usePreference';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, {
  usePreference,
  usePreferences,
});

export const TypesUsePreference = types;
export const TypesUsePreferenceAdditional = AdditionalTypes;

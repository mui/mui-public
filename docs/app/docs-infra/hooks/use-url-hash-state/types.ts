import { createTypes } from '@/functions/createTypes';
import { useUrlHashState } from '@mui/internal-docs-infra/useUrlHashState';

export const TypesUseUrlHashState = createTypes(import.meta.url, useUrlHashState);

import { createTypes } from '@/functions/createTypes';
import { useErrors } from '@mui/internal-docs-infra/useErrors';

export const TypesUseErrors = createTypes(import.meta.url, useErrors);

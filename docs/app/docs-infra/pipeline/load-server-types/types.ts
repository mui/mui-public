import { createTypes } from '@/functions/createTypes';
import { loadServerTypes } from '@mui/internal-docs-infra/pipeline/loadServerTypes';

export const TypesLoadServerTypes = createTypes(import.meta.url, loadServerTypes);

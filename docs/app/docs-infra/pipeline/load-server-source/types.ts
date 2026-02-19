import { createTypes } from '@/functions/createTypes';
import { loadServerSource } from '@mui/internal-docs-infra/pipeline/loadServerSource';

export const TypesLoadServerSource = createTypes(import.meta.url, loadServerSource);

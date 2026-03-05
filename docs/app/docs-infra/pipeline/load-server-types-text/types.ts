import { createTypes } from '@/functions/createTypes';
import { loadServerTypesText } from '@mui/internal-docs-infra/pipeline/loadServerTypesText';

export const TypesLoadServerTypesText = createTypes(import.meta.url, loadServerTypesText);

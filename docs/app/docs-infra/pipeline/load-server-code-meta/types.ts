import { createTypes } from '@/functions/createTypes';
import { loadServerCodeMeta } from '@mui/internal-docs-infra/pipeline/loadServerCodeMeta';

export const TypesLoadServerCodeMeta = createTypes(import.meta.url, loadServerCodeMeta);

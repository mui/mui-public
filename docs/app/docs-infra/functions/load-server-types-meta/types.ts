import { createTypes } from '@/functions/createTypes';
import { loadServerTypesMeta } from '@mui/internal-docs-infra/pipeline/loadServerTypesMeta';

export const TypesLoadServerTypesMeta = createTypes(import.meta.url, loadServerTypesMeta);

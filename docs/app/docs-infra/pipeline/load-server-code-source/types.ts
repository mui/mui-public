import { createTypes } from '@/functions/createTypes';
import { loadServerCodeSource } from '@mui/internal-docs-infra/pipeline/loadServerCodeSource';

export const TypesLoadServerCodeSource = createTypes(import.meta.url, loadServerCodeSource);

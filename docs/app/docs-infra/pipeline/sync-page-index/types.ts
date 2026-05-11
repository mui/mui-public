import { createTypes } from '@/functions/createTypes';
import { syncPageIndex } from '@mui/internal-docs-infra/pipeline/syncPageIndex';

export const TypesSyncPageIndex = createTypes(import.meta.url, syncPageIndex);

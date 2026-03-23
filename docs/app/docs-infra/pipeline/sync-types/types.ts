import { createTypes } from '@/functions/createTypes';
import { syncTypes } from '@mui/internal-docs-infra/pipeline/syncTypes';

export const TypesSyncTypes = createTypes(import.meta.url, syncTypes);

import { createTypes } from '@/functions/createTypes';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';

export const TypesCodeProvider = createTypes(import.meta.url, CodeProvider);

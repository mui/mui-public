import { createTypes } from '@/functions/createTypes';
import { LiveDemoProvider } from '@mui/internal-docs-infra/LiveDemoProvider';

export const TypesLiveDemoProvider = createTypes(import.meta.url, LiveDemoProvider);

import { createTypes } from '@/functions/createTypes';
import enhanceCodeInline from '@mui/internal-docs-infra/pipeline/enhanceCodeInline';

export const TypesEnhanceCodeInline = createTypes(import.meta.url, enhanceCodeInline);

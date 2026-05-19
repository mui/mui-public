import { createTypes } from '@/functions/createTypes';
import { enhanceCodeEmphasis } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';

export const TypesEnhanceCodeEmphasis = createTypes(import.meta.url, enhanceCodeEmphasis);

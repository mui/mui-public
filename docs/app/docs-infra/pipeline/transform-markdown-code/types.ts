import { createTypes } from '@/functions/createTypes';
import transformMarkdownCode from '@mui/internal-docs-infra/pipeline/transformMarkdownCode';

export const TypesTransformMarkdownCode = createTypes(import.meta.url, transformMarkdownCode);

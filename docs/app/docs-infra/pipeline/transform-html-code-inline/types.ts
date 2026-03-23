import { createTypes } from '@/functions/createTypes';
import transformHtmlCodeInline from '@mui/internal-docs-infra/pipeline/transformHtmlCodeInline';

export const TypesTransformHtmlCodeInline = createTypes(import.meta.url, transformHtmlCodeInline);

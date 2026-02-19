import { createTypes } from '@/functions/createTypes';
import transformHtmlCodeInlineHighlighted from '@mui/internal-docs-infra/pipeline/transformHtmlCodeInlineHighlighted';

export const TypesTransformHtmlCodeInlineHighlighted = createTypes(
  import.meta.url,
  transformHtmlCodeInlineHighlighted,
);

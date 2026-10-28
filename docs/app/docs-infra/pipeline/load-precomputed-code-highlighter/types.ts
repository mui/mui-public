import { createTypes } from '@/functions/createTypes';
import loadPrecomputedCodeHighlighter from '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter';

export const TypesLoadPrecomputedCodeHighlighter = createTypes(
  import.meta.url,
  loadPrecomputedCodeHighlighter,
);

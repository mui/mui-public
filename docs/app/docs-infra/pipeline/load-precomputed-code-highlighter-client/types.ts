import { createTypes } from '@/functions/createTypes';
import loadPrecomputedCodeHighlighterClient from '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient';

export const TypesLoadPrecomputedCodeHighlighterClient = createTypes(
  import.meta.url,
  loadPrecomputedCodeHighlighterClient,
);

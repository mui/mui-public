import { createMultipleTypes } from '@/functions/createTypes';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import * as CodeHighlighterTypes from '@mui/internal-docs-infra/CodeHighlighter/types';

const { types } = createMultipleTypes(import.meta.url, {
  CodeHighlighter,
  CodeHighlighterTypes,
});

export const TypesCodeHighlighter = types.CodeHighlighter;
export const TypesCodeHighlighterTypes = types.CodeHighlighterTypes;

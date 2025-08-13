import { createTypes } from '@/functions/createTypes';
import { CodeHighlighter } from '../../../../src/CodeHighlighter/CodeHighlighter';

export const TypesCodeHighlighter = createTypes(import.meta.url, CodeHighlighter, {
  globalTypes: ['node'],
});

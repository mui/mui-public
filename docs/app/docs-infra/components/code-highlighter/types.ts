import { createTypes } from '@/functions/createTypes';
import { CodeHighlighter } from '../../../../../packages/docs-infra/src/CodeHighlighter/CodeHighlighter';

export const TypesCodeHighlighter = createTypes(import.meta.url, CodeHighlighter, {
  globalTypes: ['node'],
});

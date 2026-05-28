import 'server-only';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import type {
  Code as CodeType,
  SourceTransformer,
} from '@mui/internal-docs-infra/CodeHighlighter/types';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { createEnhanceCodeEmphasis } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';

import { CollapsibleContent } from './CollapsibleContent';

const sourceParser = createParseSource();
const sourceEnhancers = [createEnhanceCodeEmphasis({ paddingFrameMaxSize: 3 })];

/**
 * A server component that renders a collapsible code block.
 *
 * Pass `code` directly with pre-extracted comments so the
 * enhancer can recognize `@highlight` directives without
 * needing `loadSource`.
 */
export function Code({
  code,
  sourceTransformers,
}: {
  code: CodeType;
  sourceTransformers?: SourceTransformer[];
}) {
  return (
    // @focus-start
    <CodeHighlighter
      code={code}
      Content={CollapsibleContent}
      sourceParser={sourceParser}
      sourceEnhancers={sourceEnhancers}
      sourceTransformers={sourceTransformers}
    />
    // @focus-end
  );
}

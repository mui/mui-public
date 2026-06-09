import 'server-only';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import type {
  Code as CodeType,
  SourceTransformer,
} from '@mui/internal-docs-infra/CodeHighlighter/types';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { createEnhanceCodeEmphasis } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';

import { CollapsibleContentLazy } from './CollapsibleContentLazy';
import { CollapsibleContentLoading } from './CollapsibleContentLoading';

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
  collapseToEmpty,
  initialExpanded,
}: {
  code: CodeType;
  sourceTransformers?: SourceTransformer[];
  collapseToEmpty?: boolean;
  initialExpanded?: boolean;
}) {
  return (
    // @focus-start
    <CodeHighlighter
      code={code}
      Content={CollapsibleContentLazy}
      ContentLoading={CollapsibleContentLoading}
      sourceParser={sourceParser}
      sourceEnhancers={sourceEnhancers}
      sourceTransformers={sourceTransformers}
      collapseToEmpty={collapseToEmpty}
      initialExpanded={initialExpanded}
    />
    // @focus-end
  );
}

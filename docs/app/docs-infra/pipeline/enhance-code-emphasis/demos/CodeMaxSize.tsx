import 'server-only';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import type { Code as CodeType } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { createEnhanceCodeEmphasis } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';

import { CollapsibleContent } from './CollapsibleContent';

const sourceParser = createParseSource();
const sourceEnhancers = [createEnhanceCodeEmphasis({ focusFramesMaxSize: 6 })];

/**
 * A server component that renders a collapsible code block with focusFramesMaxSize.
 *
 * Uses `focusFramesMaxSize: 6` so highlighted regions longer than 6 lines
 * are split into a focused window from the start with unfocused overflow below.
 */
export function CodeMaxSize({ code }: { code: CodeType }) {
  return (
    // @focus-start
    <CodeHighlighter
      code={code}
      Content={CollapsibleContent}
      sourceParser={sourceParser}
      sourceEnhancers={sourceEnhancers}
    />
    // @focus-end
  );
}

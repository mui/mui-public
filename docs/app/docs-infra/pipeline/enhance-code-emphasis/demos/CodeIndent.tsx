import 'server-only';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import type { Code as CodeType } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { enhanceCodeEmphasis } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';

import { IndentContent } from './IndentContent';

const sourceParser = createParseSource();
const sourceEnhancers = [enhanceCodeEmphasis];

/**
 * A server component that renders a collapsible code block with indent shifting.
 *
 * Uses the default `enhanceCodeEmphasis` (no padding) so only `highlighted`
 * and normal frames are produced. The `data-frame-indent` attribute on
 * highlighted frames drives the CSS-based left shift.
 */
export function CodeIndent({ code }: { code: CodeType }) {
  return (
    <CodeHighlighter
      code={code}
      Content={IndentContent}
      sourceParser={sourceParser}
      sourceEnhancers={sourceEnhancers}
    />
  );
}

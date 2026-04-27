import 'server-only';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import type { Code as CodeType } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { createEnhanceCodeEmphasis } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';

import { IndentContent } from './IndentContent';

const sourceParser = createParseSource();
// `emitFrameIndent: true` opts in to the `data-frame-indent` attribute that
// the CSS below uses to shift the focused frame left when collapsed.
const sourceEnhancers = [createEnhanceCodeEmphasis({ emitFrameIndent: true })];

/**
 * A server component that renders a collapsible code block with indent shifting.
 *
 * Uses `createEnhanceCodeEmphasis({ emitFrameIndent: true })` (no padding) so
 * only `highlighted`/`focus` and normal frames are produced, and each region
 * frame carries a `data-frame-indent` attribute that drives the CSS-based
 * left shift.
 */
export function CodeIndent({ code }: { code: CodeType }) {
  return (
    // @focus-start
    <CodeHighlighter
      code={code}
      Content={IndentContent}
      sourceParser={sourceParser}
      sourceEnhancers={sourceEnhancers}
    />
    // @focus-end
  );
}

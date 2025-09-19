import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import type { CodeHighlighterProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { CodeContent } from '../CodeContent';
import { CodeContentLoading } from '../CodeContentLoading';

type PreProps = {
  'data-precompute'?: string;
};

export function Pre(props: PreProps) {
  if (!props['data-precompute']) {
    return (
      <div>
        Expected precompute data to be provided. Ensure that transformHtmlCode rehype plugin is
        used.
      </div>
    );
  }

  const precompute = JSON.parse(
    props['data-precompute'],
  ) as CodeHighlighterProps<object>['precompute'];

  return (
    <CodeHighlighter
      url="file://index.js"
      precompute={precompute}
      Content={CodeContent}
      ContentLoading={CodeContentLoading}
      fallbackUsesAllVariants
      highlightAt="idle"
    />
  );
}

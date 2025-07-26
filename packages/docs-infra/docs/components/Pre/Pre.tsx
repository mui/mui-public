import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { CodeContent } from '../CodeContent';
import styles from './Pre.module.css';
import type { CodeHighlighterProps } from '@mui/internal-docs-infra/CodeHighlighter/types';

type PreProps = {
  children: React.ReactNode;
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

  const precompute = JSON.parse(props['data-precompute']) as CodeHighlighterProps<{}>['precompute'];

  return <CodeHighlighter url="file://index.js" precompute={precompute} Content={CodeContent} />;
}

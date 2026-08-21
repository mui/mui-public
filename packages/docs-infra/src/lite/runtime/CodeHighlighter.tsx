import * as React from 'react';
import type { CodeHighlighterProps } from './types';

/** Bridges build-time precompute data to an application's Content component. */
export function CodeHighlighter<T extends object = {}>(
  props: CodeHighlighterProps<T>,
): React.ReactNode {
  const { Content, contentProps, precompute, components, name, slug, url } = props;
  return (
    <Content
      {...(contentProps as T)}
      code={precompute}
      components={components}
      name={name}
      slug={slug}
      url={url}
    />
  );
}

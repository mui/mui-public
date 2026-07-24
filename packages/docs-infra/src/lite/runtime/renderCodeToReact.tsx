'use client';

import * as React from 'react';

export interface RenderCodeConfig {
  preClassName?: string;
}

/** Renders loader output as a `<pre><code>` React node. */
export function renderCodeToReact(
  html: string,
  language: string,
  { preClassName }: RenderCodeConfig = {},
): React.ReactNode {
  return (
    <pre className={preClassName}>
      <code
        className={`language-${language}`}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
}

import * as React from 'react';
import kebabCase from 'kebab-case';

import { useCode, Variant } from '../useCode';
import { UseCopierOpts } from '../useCopier';
import { ContentProps } from '../CodeHighlighter/types';

export type { Variant };

type UseDemoOpts = {
  defaultOpen?: boolean;
  copy?: UseCopierOpts;
  githubUrlPrefix?: string;
  codeSandboxUrlPrefix?: string;
  stackBlitzPrefix?: string;
  initialVariant?: string;
  initialTransform?: string;
};

// TODO: take initialVariant and initialTransforms as parameters
export function useDemo(contentProps: ContentProps, opts?: UseDemoOpts) {
  const slug = React.useMemo(
    () =>
      contentProps.slug || (contentProps.name ? kebabCase(contentProps.name, false) : undefined),
    [contentProps.slug, contentProps.name],
  );

  // Use the generic useCode hook for all code functionality
  const codeResult = useCode(contentProps, opts);

  // Return demo-specific interface with additional demo fields
  return {
    ...codeResult,
    // Demo-specific additions
    name: contentProps.name,
    slug,
    description: contentProps.description,
  };
}

import * as React from 'react';
import kebabCase from 'kebab-case';

import { useCode } from '../useCode';
import { UseCopierOpts } from '../useCopier';
import { ContentProps } from '../CodeHighlighter/types';

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
export function useDemo<T extends {} = {}>(contentProps: ContentProps<T>, opts?: UseDemoOpts) {
  const codeResult = useCode(contentProps, opts);

  const slug = React.useMemo(
    () =>
      contentProps.slug || (contentProps.name ? kebabCase(contentProps.name, false) : undefined),
    [contentProps.slug, contentProps.name],
  );

  return {
    ...codeResult,
    // Demo-specific additions
    name: contentProps.name,
    slug,
  };
}

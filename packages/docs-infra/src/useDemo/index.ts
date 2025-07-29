import * as React from 'react';
import kebabCase from 'kebab-case';

import { useCode } from '../useCode';
import { UseCopierOpts } from '../useCopier';
import type { ContentProps } from '../CodeHighlighter/types';
import { CodeHighlighterContext } from '../CodeHighlighter/CodeHighlighterContext';

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

  // Get context to access components if available (using React.useContext to avoid import conflicts)
  const context = React.useContext(CodeHighlighterContext);

  const slug = React.useMemo(
    () =>
      contentProps.slug || (contentProps.name ? kebabCase(contentProps.name, false) : undefined),
    [contentProps.slug, contentProps.name],
  );

  // Get the effective components object - context overrides contentProps
  const effectiveComponents = React.useMemo(() => {
    return context?.components || contentProps.components || {};
  }, [context?.components, contentProps.components]);

  // Get the component for the current variant
  const component = React.useMemo(() => {
    return effectiveComponents[codeResult.selectedVariant] || null;
  }, [effectiveComponents, codeResult.selectedVariant]);

  // Demo-specific ref and focus management
  const ref = React.useRef<HTMLDivElement | null>(null);
  const resetFocus = React.useCallback(() => {
    ref.current?.focus();
  }, []);

  return {
    ...codeResult,
    // Demo-specific additions
    component,
    ref,
    resetFocus,
    name: contentProps.name,
    slug,
  };
}

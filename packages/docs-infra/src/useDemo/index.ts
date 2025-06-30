import * as React from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { Nodes } from 'hast';
import { toText } from 'hast-util-to-text';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import kebabCase from 'kebab-case';

import { useCopier, UseCopierOpts } from '../useCopier';

type Source = Nodes;
export type Variant = {
  component: React.ReactNode;
  fileName: string;
  source: Source;
  extraSource?: { [key: string]: Source };
};
export type Demo = {
  name?: string;
  slug?: string;
  description?: string;
  variants: { [key: string]: Variant };
};

type UseDemoOpts = {
  defaultOpen?: boolean;
  copy?: UseCopierOpts;
  githubUrlPrefix?: string;
  codeSandboxUrlPrefix?: string;
  stackBlitzPrefix?: string;
};

function toComponent(source: Source) {
  return toJsxRuntime(source, { Fragment, jsx, jsxs });
}

export function useDemo(demo: Demo, opts?: UseDemoOpts) {
  const { copy: copyOpts, defaultOpen = false } = opts || {};

  const slug = React.useMemo(
    () => demo.slug || (demo.name ? kebabCase(demo.name, false) : undefined),
    [demo.slug, demo.name],
  );

  const [expanded, setExpanded] = React.useState(defaultOpen);
  const expand = React.useCallback(() => setExpanded(true), []);

  const ref = React.useRef<HTMLDivElement>(null);
  const resetFocus = React.useCallback(() => {
    ref.current?.focus();
  }, []);

  const variantKeys = React.useMemo(() => Object.keys(demo.variants), [demo.variants]);
  const [selectedVariantKey, setSelectedVariantKey] = React.useState<string>(variantKeys[0]);
  const selectedVariant = demo.variants[selectedVariantKey];

  const [selectedFileName, setSelectedFileName] = React.useState(selectedVariant.fileName);
  const selectedFile = React.useMemo(
    () =>
      selectedFileName === selectedVariant.fileName
        ? selectedVariant.source
        : selectedVariant.extraSource?.[selectedFileName],
    [selectedFileName, selectedVariant],
  );

  // if copying, convert the selected file's hast to text
  const sourceFileToText = React.useCallback(
    () => selectedFile && toText(selectedFile, { whitespace: 'pre' }), // TODO: allow passing the filename to copy
    [selectedFile],
  );
  const { copy, disabled: copyDisabled } = useCopier(sourceFileToText, copyOpts);

  // transform hast source to React components
  const files = React.useMemo(() => {
    const extraSource = selectedVariant.extraSource;
    return [
      { name: selectedVariant.fileName, component: toComponent(selectedVariant.source) },
      ...(extraSource
        ? Object.keys(extraSource).map((name) => ({
            name,
            component: toComponent(extraSource[name]),
          }))
        : []),
    ];
  }, [selectedVariant]);
  const selectedFileComponent = React.useMemo(() => {
    const matchedFile = files.find((file) => file.name === selectedFileName);
    return matchedFile ? matchedFile.component : null;
  }, [files, selectedFileName]);

  return {
    component: selectedVariant.component,
    name: demo.name,
    slug,
    description: demo.description,
    ref,
    variants: variantKeys,
    selectedVariant: selectedVariantKey,
    selectVariant: setSelectedVariantKey,
    files,
    selectedFile: selectedFileComponent,
    selectedFileName,
    selectFileName: setSelectedFileName,
    expanded,
    expand,
    setExpanded,
    resetFocus,
    copy,
    copyDisabled,
  };
}

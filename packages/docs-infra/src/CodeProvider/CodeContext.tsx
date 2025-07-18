'use client';

import * as React from 'react';
import type {
  LoadCodeMeta,
  LoadSource,
  LoadVariantMeta,
  ParseSource,
  SourceTransformers,
} from '../CodeHighlighter';

export interface CodeContext {
  parseSource?: ParseSource;
  sourceTransformers?: SourceTransformers;
  loadSource?: LoadSource;
  loadVariantMeta?: LoadVariantMeta;
  loadCodeMeta?: LoadCodeMeta;
}

export const CodeContext = React.createContext<CodeContext>({});

export const useCodeContext = () => {
  const context = React.useContext(CodeContext);

  return context;
};

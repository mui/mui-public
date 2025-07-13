'use client';

import * as React from 'react';
import type {
  LoadSource,
  LoadVariantCode,
  ParseSource,
  SourceTransformers,
} from '../CodeHighlighter';

export interface CodeContext {
  parseSource?: ParseSource;
  sourceTransformers?: SourceTransformers;
  loadSource?: LoadSource;
  loadVariantCode?: LoadVariantCode;
}

export const CodeContext = React.createContext<CodeContext>({});

export const useCodeContext = () => {
  const context = React.useContext(CodeContext);

  return context;
};

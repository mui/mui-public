'use client';

import * as React from 'react';
import type {
  LoadCode,
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
  loadCode?: LoadCode;
}

export const CodeContext = React.createContext<CodeContext>({});

export const useCodeContext = () => {
  const context = React.useContext(CodeContext);

  return context;
};

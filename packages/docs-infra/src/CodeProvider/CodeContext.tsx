'use client';

import * as React from 'react';
import { LoadSource, LoadVariantCode, ParseSource } from '../CodeHighlighter';

export interface CodeContext {
  parseSource?: ParseSource;
  loadSource?: LoadSource;
  loadVariantCode?: LoadVariantCode;
}

export const CodeContext = React.createContext<CodeContext>({});

export const useCodeContext = () => {
  const context = React.useContext(CodeContext);

  return context;
};

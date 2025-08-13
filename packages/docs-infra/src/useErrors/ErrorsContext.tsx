'use client';

import * as React from 'react';

export interface CodeErrorsContext {
  errors?: Error[];
}

export const CodeErrorsContext = React.createContext<CodeErrorsContext | undefined>(undefined);

export function useErrorsContext() {
  return React.useContext(CodeErrorsContext);
}

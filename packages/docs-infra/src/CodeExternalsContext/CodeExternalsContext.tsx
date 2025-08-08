'use client';

import * as React from 'react';

type Module = {};
export interface CodeExternalsContext {
  externals?: Record<string, Module>;
}

export const CodeExternalsContext = React.createContext<CodeExternalsContext | undefined>(
  undefined,
);

export function useCodeExternals() {
  return React.useContext(CodeExternalsContext);
}

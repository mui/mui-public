'use client';
import * as React from 'react';
import type { Components } from 'hast-util-to-jsx-runtime';

type CodeComponents = Partial<Components>;

export const CodeComponentsContext = React.createContext<CodeComponents | undefined>(undefined);

export function useCodeComponents(): CodeComponents | undefined {
  return React.useContext(CodeComponentsContext);
}

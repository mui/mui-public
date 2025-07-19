'use client';

import * as React from 'react';
import { ControlledCode } from '../CodeHighlighter/types';

export type Selection = { variant: string; fileName?: string; transformKey?: string };

export interface CodeControllerContext {
  code?: ControlledCode;
  selection?: Selection;
  setCode?: React.Dispatch<React.SetStateAction<ControlledCode | undefined>>;
  setSelection?: React.Dispatch<React.SetStateAction<Selection>>;
  components?: Record<string, React.ReactNode> | undefined;
}

export const CodeControllerContext = React.createContext<CodeControllerContext | undefined>(
  undefined,
);

export function useControlledCode() {
  const context = React.useContext(CodeControllerContext);
  return {
    controlledCode: context?.code,
    controlledSelection: context?.selection,
    controlledSetCode: context?.setCode,
    controlledSetSelection: context?.setSelection,
    controlledComponents: context?.components,
  };
}

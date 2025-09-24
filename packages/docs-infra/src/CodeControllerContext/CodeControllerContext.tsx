'use client';

import * as React from 'react';
import type { ControlledCode } from '../CodeHighlighter/types';

export type Selection = { variant: string; fileName?: string; transformKey?: string };

/**
 * Context for controlling the code shown within the CodeHighlighter component.
 *
 * To benefit from server or build-time rendering, the initial code should not be provided
 * to the controller context. It's recommended to only set `code` after the first `setCode`
 * event fires.
 */
export interface CodeControllerContext {
  /**
   * Controls the code shown within the code highlighter. Unlike the CodeHighlighter component,
   * code is always a string to simplify use. It will be highlighted when it is passed as `code`.
   * This behavior depends on client-side highlighting and the CodeProvider component.
   */
  code?: ControlledCode;

  /**
   * Controls the state for displaying the given code. This works with build-time and client-side
   * loading. If using server loading, the selection won't work for fallback loading and would
   * have to be passed directly into the CodeHighlighter component within a server component.
   */
  selection?: Selection;

  /**
   * Setter function for updating the code. When provided in the context, this function will be
   * called when the user interacts with the code highlighting. It's recommended to only set `code`
   * after the first `setCode` event fires to benefit from server or build-time rendering.
   */
  setCode?: React.Dispatch<React.SetStateAction<ControlledCode | undefined>>;

  /**
   * Setter function for updating the selection state. When provided in the context, this function
   * will be called when the user interacts with the code highlighting interface.
   */
  setSelection?: React.Dispatch<React.SetStateAction<Selection>>;

  /**
   * Allows overriding the preview components shown within the CodeHighlighter.
   * It's recommended to keep this value undefined until there are any changes made to a
   * component's code and passed as `code`. Each variant has a given component,
   * e.g. `{ variantA: {}, variantB: {} }`.
   */
  components?: Record<string, React.ReactNode> | undefined;
}

export const CodeControllerContext = React.createContext<CodeControllerContext | undefined>(
  undefined,
);

/**
 * Hook for accessing the controlled code context.
 *
 * This hook provides access to the controlled code, selection state, and setter functions
 * from the CodeControllerContext. It's worth noting that useCode and useDemo handle
 * controlling selection in typical cases.
 *
 * @returns An object containing:
 *   - code: The current code being controlled
 *   - selection: The current selection state
 *   - setCode: Function to update the controlled code
 *   - setSelection: Function to update the selection
 *   - components: Override components for the preview
 */
export function useControlledCode() {
  const context = React.useContext(CodeControllerContext);

  return {
    code: context?.code,
    selection: context?.selection,
    setCode: context?.setCode,
    setSelection: context?.setSelection,
    components: context?.components,
  };
}

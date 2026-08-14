'use client';

import * as React from 'react';

/** Represents any imported module or object that can be provided as an external dependency */
type Module = NonNullable<unknown>;

/**
 * Context interface for providing external dependencies to demo components.
 * Used by demo client providers to make precomputed externals available to child components.
 */
export interface CodeExternalsContext {
  /** Map of module specifiers to their imported values (e.g., { 'react': React, '@mui/material': { Button } }) */
  externals?: Record<string, Module>;
  /**
   * Values bound as top-level identifiers in the runner's scope, rather than
   * reached through an import (e.g. `{ process: {} }` so a demo referring to
   * `process` sees a host-controlled object instead of a `ReferenceError`).
   */
  globals?: Record<string, unknown>;
}

/**
 * React context for managing external dependencies in demo components.
 * Primarily used internally by demo client providers created with abstractCreateDemoClient.
 */
export const CodeExternalsContext = React.createContext<CodeExternalsContext | undefined>(
  undefined,
);

/**
 * Hook to access external dependencies from the CodeExternalsContext.
 * Returns undefined if used outside of a provider.
 */
export function useCodeExternals() {
  return React.useContext(CodeExternalsContext);
}

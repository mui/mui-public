'use client';

import * as React from 'react';
import type { ProcessedTypesMeta } from '../abstractCreateTypes/typesToJsx';

/**
 * Data for a single type, including the processed type metadata and its anchor href.
 */
export interface TypeData {
  /** The processed type metadata (component, hook, function, class, or raw) */
  meta: ProcessedTypesMeta;
  /** The anchor href for navigating to this type's documentation */
  href: string;
}

export interface TypesDataContextValue {
  /** Map from type name to its data */
  types: Map<string, TypeData>;
  /** Register types into the context */
  registerTypes: (entries: Array<{ name: string; data: TypeData }>) => void;
}

export const TypesDataContext = React.createContext<TypesDataContextValue | undefined>(undefined);

/**
 * Returns the TypesDataContext value, or undefined if not within a provider.
 * Used internally by `useTypes` to register types and by `useType` to look up types.
 */
export function useTypesDataContext(): TypesDataContextValue | undefined {
  return React.useContext(TypesDataContext);
}

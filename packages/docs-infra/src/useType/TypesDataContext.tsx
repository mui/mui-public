'use client';

import * as React from 'react';
import type { EnhancedTypesMeta, EnhancedProperty } from '../abstractCreateTypes/typesToJsx';

/**
 * Data for a single type, including the processed type metadata and its anchor href.
 */
export interface TypeData {
  /** The processed type metadata (component, hook, function, class, or raw) */
  meta: EnhancedTypesMeta;
  /** The anchor href for navigating to this type's documentation */
  href: string;
}

/**
 * Data for a single type property, including the processed property and its anchor href.
 */
export interface TypePropData {
  /** The processed property metadata */
  property: EnhancedProperty;
  /** The anchor href for navigating to this property's documentation */
  href: string;
}

export interface TypesDataContextValue {
  /** Map from type name to its data */
  types: Map<string, TypeData>;
  /** Register types into the context */
  registerTypes: (entries: Array<{ name: string; data: TypeData }>) => void;
  /** Map from "typeName:propName" to property data */
  typeProps: Map<string, TypePropData>;
  /** Register type properties into the context */
  registerTypeProps: (entries: Array<{ key: string; data: TypePropData }>) => void;
}

export const TypesDataContext = React.createContext<TypesDataContextValue | undefined>(undefined);

/**
 * Returns the TypesDataContext value, or undefined if not within a provider.
 * Used internally by `useTypes` to register types and by `useType` to look up types.
 */
export function useTypesDataContext(): TypesDataContextValue | undefined {
  return React.useContext(TypesDataContext);
}

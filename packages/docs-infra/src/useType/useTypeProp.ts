'use client';

import * as React from 'react';
import { useTypesDataContext, type TypePropData } from './TypesDataContext';

/**
 * Props passed to the custom `typePropRefComponent` element.
 */
export interface TypePropRefProps {
  /** The anchor id (when this is the definition site) */
  id?: string;
  /** The anchor href (when this is a reference to the definition) */
  href?: string;
  /** The owner type name (e.g., "Root", "Trigger") */
  name: string;
  /** The property path (e.g., "className", "open") */
  prop: string;
  /** Optional CSS class name(s) inherited from syntax highlighting */
  className?: string;
  /** The rendered text content */
  children: React.ReactNode;
}

/**
 * Hook to look up a single type property's data from the nearest `TypesDataProvider`.
 *
 * Returns the `TypePropData` for the given type and property name, or `undefined` if:
 * - No `TypesDataProvider` is present in the tree
 * - The type or property has not been registered
 *
 * @param typeName - The type name (e.g., "Root", "Trigger")
 * @param propName - The property name (e.g., "className", "defaultOpen")
 */
export function useTypeProp(typeName: string, propName: string): TypePropData | undefined {
  const context = useTypesDataContext();
  return context?.typeProps.get(`${typeName}:${propName}`);
}

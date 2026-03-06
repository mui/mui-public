'use client';

import { useTypesDataContext, type TypePropData } from './TypesDataContext';

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

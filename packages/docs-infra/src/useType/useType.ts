'use client';

import { useTypesDataContext, type TypeData } from './TypesDataContext';

/**
 * Hook to look up a single type's data by name from the nearest `TypesDataProvider`.
 *
 * Returns the `TypeData` for the given name, or `undefined` if:
 * - No `TypesDataProvider` is present in the tree
 * - The type name has not been registered
 *
 * @param name - The type name to look up (e.g., "Root", "Trigger", "AccordionTrigger")
 */
export function useType(name: string): TypeData | undefined {
  const context = useTypesDataContext();
  return context?.types.get(name);
}

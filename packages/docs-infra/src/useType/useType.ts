'use client';

import * as React from 'react';
import { useTypesDataContext, type TypeData } from './TypesDataContext';

/**
 * Props passed to the custom `typeRefComponent` element.
 */
export interface TypeRefProps {
  /** The anchor href for the type documentation */
  href: string;
  /** The matched identifier name (e.g., "Trigger", "Accordion.Trigger") */
  name: string;
  /** Optional CSS class name(s) inherited from the syntax highlighting span */
  className?: string;
  /** The rendered text content */
  children: React.ReactNode;
}

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

'use client';

import * as React from 'react';
import type { TypesContentProps } from '../abstractCreateTypes';
import { useTypesDataContext, type TypeData } from '../useType/TypesDataContext';

/**
 * Hook for accessing types props in TypesContent components.
 *
 * When rendered inside a `TypesDataProvider`, automatically registers
 * the main type and additional types into the context so they can be
 * looked up by name via `useType(name)`.
 */
export function useTypes<T extends {}>(contentProps: TypesContentProps<T>): TypesContentProps<T> {
  const context = useTypesDataContext();
  const registerTypes = context?.registerTypes;

  const { type, additionalTypes } = contentProps;

  React.useEffect(() => {
    if (!registerTypes) {
      return;
    }

    const entries: Array<{ name: string; data: TypeData }> = [];

    if (type) {
      const typeData: TypeData = {
        meta: type,
        href: type.slug ? `#${type.slug}` : `#${type.name.toLowerCase()}`,
      };
      entries.push({ name: type.name, data: typeData });
      // Also register under alias names (e.g., flat export name like "AccordionRootProps")
      if (type.aliases) {
        for (const alias of type.aliases) {
          entries.push({ name: alias, data: typeData });
        }
      }
    }

    for (const additional of additionalTypes) {
      const additionalData: TypeData = {
        meta: additional,
        href: additional.slug ? `#${additional.slug}` : `#${additional.name.toLowerCase()}`,
      };
      entries.push({ name: additional.name, data: additionalData });
      // Also register under alias names
      if (additional.aliases) {
        for (const alias of additional.aliases) {
          entries.push({ name: alias, data: additionalData });
        }
      }
    }

    if (entries.length > 0) {
      registerTypes(entries);
    }
  }, [registerTypes, type, additionalTypes]);

  return contentProps;
}

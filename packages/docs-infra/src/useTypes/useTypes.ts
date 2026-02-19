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
      entries.push({
        name: type.name,
        data: { meta: type, href: type.slug ? `#${type.slug}` : `#${type.name.toLowerCase()}` },
      });
    }

    for (const additional of additionalTypes) {
      entries.push({
        name: additional.name,
        data: {
          meta: additional,
          href: additional.slug ? `#${additional.slug}` : `#${additional.name.toLowerCase()}`,
        },
      });
    }

    if (entries.length > 0) {
      registerTypes(entries);
    }
  }, [registerTypes, type, additionalTypes]);

  return contentProps;
}

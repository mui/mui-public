'use client';

import * as React from 'react';
import type { TypesContentProps } from '../abstractCreateTypes';
import type { ProcessedProperty, ProcessedTypesMeta } from '../abstractCreateTypes/typesToJsx';
import { useTypesDataContext, type TypeData, type TypePropData } from '../useType/TypesDataContext';
import { toKebabCase } from '../pipeline/loaderUtils/toKebabCase';

/**
 * Collects the properties from a ProcessedTypesMeta entry into key/data pairs.
 * - Component types: extracts `data.props`
 * - Hook/function types: extracts `data.optionsProperties` (the properties of the options object)
 */
function collectTypeProps(
  typeMeta: ProcessedTypesMeta,
): Array<{ key: string; data: TypePropData }> {
  const slug = typeMeta.slug ?? typeMeta.name.toLowerCase();
  const entries: Array<{ key: string; data: TypePropData }> = [];

  function addProperties(props: Record<string, ProcessedProperty>) {
    for (const [propName, prop] of Object.entries(props)) {
      entries.push({
        key: `${typeMeta.name}:${propName}`,
        data: {
          property: prop,
          href: `#${slug}:${toKebabCase(propName)}`,
        },
      });
    }
  }

  if (typeMeta.type === 'component') {
    addProperties(typeMeta.data.props);
  } else if (typeMeta.type === 'hook' || typeMeta.type === 'function') {
    if (typeMeta.data.optionsProperties) {
      addProperties(typeMeta.data.optionsProperties);
    }
  }

  return entries;
}

/**
 * Hook for accessing types props in TypesContent components.
 *
 * When rendered inside a `TypesDataProvider`, automatically registers
 * the main type and additional types into the context so they can be
 * looked up by name via `useType(name)`, and registers their properties
 * so they can be looked up via `useTypeProp(typeName, propName)`.
 */
export function useTypes<T extends {}>(contentProps: TypesContentProps<T>): TypesContentProps<T> {
  const context = useTypesDataContext();
  const registerTypes = context?.registerTypes;
  const registerTypeProps = context?.registerTypeProps;

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

  React.useEffect(() => {
    if (!registerTypeProps) {
      return;
    }

    const propEntries: Array<{ key: string; data: TypePropData }> = [];

    if (type) {
      propEntries.push(...collectTypeProps(type));
    }

    for (const additional of additionalTypes) {
      propEntries.push(...collectTypeProps(additional));
    }

    if (propEntries.length > 0) {
      registerTypeProps(propEntries);
    }
  }, [registerTypeProps, type, additionalTypes]);

  return contentProps;
}

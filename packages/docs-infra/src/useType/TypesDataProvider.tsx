'use client';

import * as React from 'react';
import { TypesDataContext, type TypeData, type TypePropData } from './TypesDataContext';

/**
 * Provider that collects type data from all `useTypes()` calls within its subtree.
 * This enables `useType(name)` to look up individual type data anywhere in the tree,
 * and `useTypeProp(typeName, propName)` to look up individual properties.
 */
export function TypesDataProvider({ children }: { children: React.ReactNode }) {
  const [types, setTypes] = React.useState<Map<string, TypeData>>(() => new Map());
  const [typeProps, setTypeProps] = React.useState<Map<string, TypePropData>>(() => new Map());

  const registerTypes = React.useCallback((entries: Array<{ name: string; data: TypeData }>) => {
    setTypes((prev) => {
      let changed = false;
      for (const entry of entries) {
        const existing = prev.get(entry.name);
        if (existing?.meta !== entry.data.meta || existing?.href !== entry.data.href) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        return prev;
      }
      const next = new Map(prev);
      for (const entry of entries) {
        next.set(entry.name, entry.data);
      }
      return next;
    });
  }, []);

  const registerTypeProps = React.useCallback(
    (entries: Array<{ key: string; data: TypePropData }>) => {
      setTypeProps((prev) => {
        let changed = false;
        for (const entry of entries) {
          const existing = prev.get(entry.key);
          if (existing?.property !== entry.data.property || existing?.href !== entry.data.href) {
            changed = true;
            break;
          }
        }
        if (!changed) {
          return prev;
        }
        const next = new Map(prev);
        for (const entry of entries) {
          next.set(entry.key, entry.data);
        }
        return next;
      });
    },
    [],
  );

  const value = React.useMemo(
    () => ({ types, registerTypes, typeProps, registerTypeProps }),
    [types, registerTypes, typeProps, registerTypeProps],
  );

  return <TypesDataContext.Provider value={value}>{children}</TypesDataContext.Provider>;
}

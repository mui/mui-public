'use client';

import * as React from 'react';

const CurrentTypesTableIdContext = React.createContext<string | undefined>(undefined);

export function CurrentTypesTableIdProvider({
  id,
  children,
}: {
  id: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <CurrentTypesTableIdContext.Provider value={id}>{children}</CurrentTypesTableIdContext.Provider>
  );
}

export function useCurrentTypesTableId() {
  return React.useContext(CurrentTypesTableIdContext);
}

export function getHrefTargetId(href: string | undefined) {
  if (!href) {
    return undefined;
  }

  const hashIndex = href.indexOf('#');
  if (hashIndex === -1) {
    return undefined;
  }

  return href.slice(hashIndex + 1) || undefined;
}

export function getTypeSectionId(targetId: string | undefined) {
  if (!targetId) {
    return undefined;
  }

  const propertySeparatorIndex = targetId.indexOf(':');
  if (propertySeparatorIndex === -1) {
    return targetId;
  }

  return targetId.slice(0, propertySeparatorIndex);
}

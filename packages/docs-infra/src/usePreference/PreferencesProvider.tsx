'use client';

import * as React from 'react';

export interface PreferencesContext {
  prefix?: string;
}

export const PreferencesContext = React.createContext<PreferencesContext | undefined>(undefined);

export function usePreferences() {
  return React.useContext(PreferencesContext);
}

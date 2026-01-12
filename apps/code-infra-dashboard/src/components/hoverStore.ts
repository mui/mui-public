import * as React from 'react';

// HoverStore for synchronized hover state
class HoverStore {
  private hoveredIndex: number | null = null;

  private listeners = new Set<() => void>();

  subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  };

  getSnapshot = (): number | null => this.hoveredIndex;

  setHoveredIndex = (index: number | null): void => {
    this.hoveredIndex = index;
    this.listeners.forEach((callback) => callback());
  };
}

const HoverStoreContext = React.createContext<HoverStore | null>(null);

export function HoverStoreProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [hoverStore] = React.useState(() => new HoverStore());
  return React.createElement(HoverStoreContext.Provider, { value: hoverStore }, children);
}

export function useHoverStore(): HoverStore {
  const hoverStore = React.useContext(HoverStoreContext);
  if (!hoverStore) {
    throw new Error('useHoverStore must be used within a HoverStoreProvider');
  }
  return hoverStore;
}

export function useHoveredIndex(): number | null {
  const hoverStore = useHoverStore();
  return React.useSyncExternalStore(
    hoverStore.subscribe,
    hoverStore.getSnapshot,
    hoverStore.getSnapshot,
  );
}

import * as React from 'react';

export function useScrollToHash(items: unknown[]) {
  React.useEffect(() => {
    const { hash } = window.location;
    if (hash) {
      const element = document.getElementById(hash.slice(1));
      if (element) {
        element.scrollIntoView();
      }
    }
  }, [items]);
}

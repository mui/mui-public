import * as React from 'react';

export function useOnHydrate(callback?: () => void) {
  const [isHydrated, setIsHydrated] = React.useState(false);
  const callbackRef = React.useRef(callback);
  callbackRef.current = callback;
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      callbackRef.current?.();
      setIsHydrated(true);
    }
  }, []);

  return isHydrated;
}

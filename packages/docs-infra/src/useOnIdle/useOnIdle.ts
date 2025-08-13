import * as React from 'react';

export function useOnIdle(callback?: () => void, timeout = 1000) {
  const [isIdle, setIsIdle] = React.useState(false);
  const callbackRef = React.useRef(callback);
  callbackRef.current = callback;

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleIdle = () => {
      callbackRef.current?.();
      setIsIdle(true);
    };

    let idleCallbackId: number | undefined;
    let timeoutId: NodeJS.Timeout | undefined;
    if ('requestIdleCallback' in window) {
      idleCallbackId = window.requestIdleCallback(handleIdle, { timeout });
    } else {
      timeoutId = setTimeout(handleIdle, timeout);
    }

    return () => {
      if (idleCallbackId && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [timeout]);

  return isIdle;
}

import { onTestFinished } from 'vitest';

export function ignoreActWarnings() {
  const originalConsoleError = console.error;
  console.error = new Proxy(console.error, {
    apply(target, thisArg, args) {
      if (
        typeof args[0] === 'string' &&
        args[0].includes('An update to %s inside a test was not wrapped in act')
      ) {
        return;
      }
      Reflect.apply(target, thisArg, args);
    },
  });
  onTestFinished(() => {
    console.error = originalConsoleError;
  });
}

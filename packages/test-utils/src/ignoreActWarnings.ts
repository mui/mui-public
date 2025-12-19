let actWarningIgnored = false;

export function installActWarnings() {
  console.error = new Proxy(console.error, {
    apply(target, thisArg, args) {
      if (
        actWarningIgnored &&
        typeof args[0] === 'string' &&
        args[0].includes('An update to %s inside a test was not wrapped in act')
      ) {
        return;
      }
      Reflect.apply(target, thisArg, args);
    },
  });
}

export function ignoreActWarnings() {
  actWarningIgnored = true;
}

export function restoreActWarnings() {
  actWarningIgnored = false;
}

import './initMatchers';

export * from './components';
export { default as describeConformance } from './describeConformance';
export * from './describeConformance';
export { default as createDescribe } from './createDescribe';
export * from './createRenderer';
export {
  default as focusVisible,
  simulatePointerDevice,
  simulateKeyboardDevice,
  programmaticFocusTriggersFocusVisible,
} from './focusVisible';
// eslint-disable-next-line import/extensions
export { fireEvent as fireDiscreteEvent } from '@testing-library/react/pure.js';
export { flushMicrotasks } from './flushMicrotasks';
export * from './env';

let actWarningInstalled = false;
let actWarningIgnored = false;

export function ignoreActWarnings() {
  if (!actWarningInstalled) {
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
    actWarningInstalled = true;
  }
  actWarningIgnored = true;
}

export function restoreActWarnings() {
  actWarningIgnored = false;
}

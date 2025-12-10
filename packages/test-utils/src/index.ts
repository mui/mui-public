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
export * as fireDiscreteEvent from './fireDiscreteEvent';
export { flushMicrotasks } from './flushMicrotasks';
export * from './env';
export { configure } from './configure';

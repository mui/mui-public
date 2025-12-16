import { describe } from 'vitest';

export type MUIDescribe<P extends any[]> = {
  (...args: P): void;

  skip: (...args: P) => void;
  only: (...args: P) => void;
};

/**
 * Create a custom describe function with chainable skip and only methods.
 * It is used to group conformance tests but still make the focusable/skippable.
 *
 * @param message - The message to display for the describe block.
 * @param callback - The callback function containing the tests.
 * @returns A custom describe function with skip and only methods.
 */
export default function createDescribe<P extends any[]>(
  message: string,
  callback: (...args: P) => void,
): MUIDescribe<P> {
  const muiDescribe = (...args: P) => {
    describe(message, () => {
      callback(...args);
    });
  };

  muiDescribe.skip = (...args: P) => {
    describe.skip(message, () => {
      callback(...args);
    });
  };

  muiDescribe.only = (...args: P) => {
    describe.only(message, () => {
      callback(...args);
    });
  };

  return muiDescribe;
}

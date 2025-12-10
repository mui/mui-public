import failOnConsole from 'vitest-fail-on-console';
import * as chai from 'chai';
import './chaiTypes';
import { cleanup, act } from '@testing-library/react/pure';
import { afterEach, vi } from 'vitest';
import chaiDom from 'chai-dom';
import chaiPlugin from './chaiPlugin';
import { Configuration, configure } from './configure';

let isInitialized = false;

export default function setupVitest(config: Partial<Configuration> = {}): void {
  // When run in vitest with --no-isolate, the test hooks are cleared between each suite,
  // but modules are only evaluated once, so calling it top-level would only register the
  // hooks for the first suite only.
  // Instead call `setupVitest` in one of the `setupFiles`, which are not cached and executed
  // per suite.
  afterEach(async () => {
    if (vi.isFakeTimers()) {
      await act(async () => {
        vi.runOnlyPendingTimers();
      });
      vi.useRealTimers();
    }

    cleanup();
  });

  if (isInitialized) {
    return;
  }

  configure(config);

  isInitialized = true;

  // Don't call test lifecycle hooks after this point

  chai.use(chaiPlugin);

  failOnConsole({
    silenceMessage: (message: string) => {
      if (process.env.NODE_ENV === 'production') {
        // TODO: mock scheduler
        if (message.includes('act(...) is not supported in production builds of React')) {
          return true;
        }
      }

      if (message.includes('Warning: useLayoutEffect does nothing on the server')) {
        // Controversial warning that is commonly ignored by switching to `useEffect` on the server.
        // https://github.com/facebook/react/issues/14927
        // However, this switch doesn't work since it relies on environment sniffing and we test SSR in a browser environment.
        return true;
      }

      // Unclear why this is an issue for the current occurrences of this warning.
      // TODO: Revisit once https://github.com/facebook/react/issues/22796 is resolved
      if (
        message.includes(
          'Detected multiple renderers concurrently rendering the same context provider.',
        )
      ) {
        return true;
      }

      return false;
    },
  });

  if (typeof window !== 'undefined') {
    chai.use(chaiDom);

    // Enable missing act warnings: https://github.com/reactwg/react-18/discussions/102
    (globalThis as any).jest = null;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

    if (window.navigator.userAgent.includes('jsdom')) {
      // Not yet supported: https://github.com/jsdom/jsdom/issues/2152
      (globalThis as any).window.Touch ??= class Touch {
        instance: any;

        constructor(instance: any) {
          this.instance = instance;
        }

        get identifier() {
          return this.instance.identifier;
        }

        get pageX() {
          return this.instance.pageX;
        }

        get pageY() {
          return this.instance.pageY;
        }

        get clientX() {
          return this.instance.clientX;
        }

        get clientY() {
          return this.instance.clientY;
        }
      };
    }
  }
}

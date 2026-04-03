import failOnConsole from 'vitest-fail-on-console';
// eslint-disable-next-line import/extensions
import { cleanup, act } from '@testing-library/react/pure.js';
import { afterEach, vi } from 'vitest';
import { Configuration, configure } from './configure';

let isInitialized = false;

export default function setupVitest({
  failOnConsoleEnabled = true,
  chaiEnabled = true,
  ...config
}: Partial<Configuration> & { failOnConsoleEnabled?: boolean; chaiEnabled?: boolean } = {}): void {
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
    }

    vi.useRealTimers();

    cleanup();
  });

  if (failOnConsoleEnabled) {
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
  }

  // Don't call test lifecycle hooks (afterEach/afterAll/beforeEach/beforeAll/...) after this point
  // Make sure none of (transitive) dependencies call lifecycle hooks either, otherwise they won't be
  // registered and thus won't run when using `--no-isolate --no-file-parallelism`.

  if (isInitialized) {
    return;
  }

  isInitialized = true;

  configure(config);

  (async () => {
    if (chaiEnabled) {
      try {
        const [{ default: chaiPluginModule }, chaiModule] = await Promise.all([
          import('./chaiPlugin'),
          import('chai'),
          import('./chaiTypes'),
        ]);
        chaiModule.use(chaiPluginModule);

        if (typeof window !== 'undefined') {
          try {
            const { default: chaiDomModule } = await import('chai-dom');
            chaiModule.use(chaiDomModule);
          } catch (error) {
            throw new Error(
              '[test-utils] Failed to load chai-dom. Make sure "chai-dom" is installed, or pass `chaiEnabled: false` to setupVitest().',
              { cause: error },
            );
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('[test-utils]')) {
          throw error;
        }
        throw new Error(
          '[test-utils] Failed to load chai. Make sure "chai" is installed, or pass `chaiEnabled: false` to setupVitest().',
          { cause: error },
        );
      }
    }

    if (typeof window !== 'undefined') {
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
  })();
}

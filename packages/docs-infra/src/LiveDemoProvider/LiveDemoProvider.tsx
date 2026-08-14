'use client';

import * as React from 'react';
import { CodeExternalsContext } from '../CodeExternalsContext';
import type { CodeExternalsContext as CodeExternalsContextValue } from '../CodeExternalsContext';
import { CodeControllerContext } from '../CodeControllerContext';
import { useDemoController } from '../useDemoController';

export interface LiveDemoProviderProps {
  /**
   * Modules the demo's source can import, keyed by specifier — the same map a
   * generated `client.ts` passes as precomputed externals.
   */
  externals?: CodeExternalsContextValue['externals'];
  /**
   * Values bound as top-level identifiers in the runner's scope rather than
   * imported, e.g. `{ process: {} }` so a demo mentioning `process` sees a
   * host-controlled object instead of a `ReferenceError`.
   */
  globals?: CodeExternalsContextValue['globals'];
  children: React.ReactNode;
}

/**
 * Makes the demos below it live, with no generated `client.ts`.
 *
 * A host that already produces static imports passes them as `externals` and
 * wraps its demos; the provider owns the controlled source, builds each edited
 * variant, and publishes the previews and errors through
 * `CodeControllerContext` — the same wiring `createDemoClient` performs, minus
 * the generated file.
 */
export function LiveDemoProvider(props: LiveDemoProviderProps) {
  const { externals, globals, children } = props;

  const externalsValue = React.useMemo(
    () => ({ externals: externals ?? {}, globals }),
    [externals, globals],
  );

  return (
    <CodeExternalsContext.Provider value={externalsValue}>
      <LiveDemoController>{children}</LiveDemoController>
    </CodeExternalsContext.Provider>
  );
}

/**
 * Separate component so `useDemoController` reads the externals context this
 * provider just installed, rather than whatever was above it.
 */
function LiveDemoController({ children }: { children: React.ReactNode }) {
  const controller = useDemoController();

  return (
    <CodeControllerContext.Provider value={controller}>{children}</CodeControllerContext.Provider>
  );
}

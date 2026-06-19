'use client';

import * as React from 'react';
import { useRunner } from './useRunner';
import { ErrorBoundary } from './ErrorBoundary';
import type { Scope } from './types';

// ---------------------------------------------------------------------------
// Presentational preview for a single demo variant. The async transpilation +
// scope build happen upstream in `useDemoController` (off the main thread, in a
// worker), so this is mounted only once a variant is READY and stays fully
// synchronous: it evaluates the already-transpiled entry, renders it, and reports
// runtime errors. Not built for direct use — `useDemoController` owns it.
// ---------------------------------------------------------------------------

export interface DemoRunnerProps {
  /** The already-transpiled entry code for the variant (from the transpile worker). */
  runnerCode: string;
  /** The built module registry the entry evaluates against. */
  scope: Scope;
  /** Compiled stylesheet text collected from the variant's CSS extra files. */
  css?: string;
  /**
   * Called with the runner's current error message (or `null` when it renders
   * cleanly). Lets the controller surface errors while the live preview keeps
   * showing the last good render.
   */
  onError?: (message: string | null) => void;
}

/**
 * Renders one ready demo variant. Wraps the content in an {@link ErrorBoundary} as
 * a backstop; runtime errors thrown while rendering the entry are already caught by
 * the inner `Runner` and reported through `onError` the same way.
 */
export function DemoRunner({ runnerCode, scope, css, onError }: DemoRunnerProps) {
  return (
    <ErrorBoundary resetKeys={[runnerCode, scope]} onError={(caught) => onError?.(caught.message)}>
      <DemoRunnerContent runnerCode={runnerCode} scope={scope} css={css} onError={onError} />
    </ErrorBoundary>
  );
}

function DemoRunnerContent({ runnerCode, scope, css, onError }: DemoRunnerProps) {
  const { element, error } = useRunner({ transpiledCode: runnerCode, scope });

  // Report the current error (or `null` when clean) to the host without unmounting
  // the live preview, which `useRunner` keeps showing. The latest `onError` is kept
  // in a ref so an inline callback doesn't re-fire the report.
  const onErrorRef = React.useRef(onError);
  React.useEffect(() => {
    onErrorRef.current = onError;
  });
  // Report on every change, but clear (`null`) only on unmount — clearing on each
  // change would blink the error off and back on as the source is edited.
  React.useEffect(() => {
    onErrorRef.current?.(error);
  }, [error]);
  React.useEffect(
    () => () => {
      onErrorRef.current?.(null);
    },
    [],
  );

  // Render the compiled module CSS as a `<style>` inside the output (rather than
  // injecting it into `document.head`) so the scoped styles are co-located with the
  // demo and easy to inspect. A plain `<style>` (no `precedence`) is not hoisted by
  // React, and its rules still apply document-wide.
  return (
    <React.Fragment>
      {css ? (
        <div data-demo-styles="">
          <style>{css}</style>
        </div>
      ) : null}
      {element}
    </React.Fragment>
  );
}

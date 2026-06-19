'use client';

import * as React from 'react';
import type { ControlledVariantExtraFiles } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeExternals } from '@mui/internal-docs-infra/CodeExternalsContext';
import { useRunner } from './useRunner';
import { buildScope } from './buildScope';
import { ErrorBoundary } from './ErrorBoundary';

// ---------------------------------------------------------------------------
// Live-editing runtime for a single variant. Kept in its own chunk — it bundles
// the heavy `sucrase` transpiler — so a host can lazy-load it on demand, keeping
// it out of the initial client bundle until a reader engages a demo's editor.
// ---------------------------------------------------------------------------

export interface DemoRunnerProps {
  /** The current (live-edited) source for the variant. */
  code: string;
  /** Sibling files the source can import, keyed by file name. */
  extraFiles?: ControlledVariantExtraFiles;
  /**
   * Called with the runner's current error message (or `null` when it renders
   * cleanly). Lets a host surface errors — e.g. through the controller context —
   * while the live preview keeps showing the last good render.
   */
  onError?: (message: string | null) => void;
}

/**
 * Runs a single demo variant. Wraps the content in an {@link ErrorBoundary} so a
 * throw while building the scope (e.g. a broken sibling `extraFile`) surfaces
 * through `onError` instead of crashing the page, and recovers once the offending
 * source is edited. Runtime errors thrown while rendering the main source are
 * already caught by the inner `Runner` and reported the same way.
 */
export function DemoRunner({ code, extraFiles, onError }: DemoRunnerProps) {
  return (
    <ErrorBoundary resetKeys={[code, extraFiles]} onError={(caught) => onError?.(caught.message)}>
      <DemoRunnerContent code={code} extraFiles={extraFiles} onError={onError} />
    </ErrorBoundary>
  );
}

function DemoRunnerContent({ code, extraFiles, onError }: DemoRunnerProps) {
  const externalsContext = useCodeExternals();
  // `buildScope` registers the extra files AND the main (so an extra can import
  // the entry), and returns the (absolutized when nested) source to run. `code` is
  // in the deps so an edit re-registers the main and any extra that imports it
  // re-evaluates against it; the per-file transpile is cached, so this is cheap.
  const { scope, css, runnerCode } = React.useMemo(() => {
    const externals = externalsContext?.externals ?? { react: React };
    const built = buildScope(extraFiles, externals, code);
    return { scope: { import: built.imports }, css: built.css, runnerCode: built.runnerCode };
  }, [externalsContext, extraFiles, code]);

  const { element, error } = useRunner({ code: runnerCode ?? code, scope });

  // Report the current error (or `null` when clean) to the host without
  // unmounting the live preview, which `useRunner` keeps showing. The latest
  // `onError` is kept in a ref so an inline callback doesn't re-fire the report.
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
  // injecting it into `document.head`) so the scoped styles are co-located with
  // the demo and easy to inspect. A plain `<style>` (no `precedence`) is not
  // hoisted by React, and its rules still apply document-wide.
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

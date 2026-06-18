'use client';

import * as React from 'react';
import type { ControlledVariantExtraFiles } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeExternals } from '@mui/internal-docs-infra/CodeExternalsContext';
import { useRunner } from './useRunner';
import { importCode } from './importCode';
import { compileCssModule } from './compileCssModule';
import { ErrorBoundary } from './ErrorBoundary';

// ---------------------------------------------------------------------------
// Live-editing runtime for a single variant. Split into its own chunk because
// the live runner bundles the heavy `sucrase` transpiler — `DemoController`
// lazy-imports this module and warms it on `onActivate` so it stays out of the
// initial client bundle and only loads once a reader engages a demo's editor.
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
  const { scope, css } = React.useMemo(() => {
    // `scope.import` is the runner's module map; its `require` does an exact-key
    // lookup. Start from the package externals, then register each extra file under
    // the specifier the main source imports it by, passing the same growing
    // `imports` map so a file can import earlier siblings + externals. Files are
    // routed by extension:
    //   - `*.module.css` -> compiled to scoped CSS (collected for the output); the
    //     class-name map is exported under the full `./name.module.css` specifier.
    //   - other `*.css`  -> emitted as-is (global); the side-effect import resolves
    //     to an empty module.
    //   - everything else -> evaluated as JS/TS under its extension-less specifier
    //     (flat mode strips it, e.g. `top100Films.ts` -> `./top100Films`).
    const imports: Record<string, unknown> = {
      ...(externalsContext?.externals ?? { react: React }),
    };
    const styleSheets: string[] = [];

    for (const [fileName, file] of Object.entries(extraFiles ?? {})) {
      const source = file?.source;
      if (typeof source !== 'string') {
        continue;
      }

      if (fileName.endsWith('.module.css')) {
        const compiled = compileCssModule(source);
        imports[`./${fileName}`] = compiled.exports;
        styleSheets.push(compiled.css);
      } else if (fileName.endsWith('.css')) {
        imports[`./${fileName}`] = {};
        styleSheets.push(source);
      } else {
        imports[`./${fileName.replace(/\.[^.]+$/, '')}`] = importCode(source, { import: imports });
      }
    }

    return { scope: { import: imports }, css: styleSheets.join('\n') };
  }, [externalsContext, extraFiles]);

  const { element, error } = useRunner({ code, scope });

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

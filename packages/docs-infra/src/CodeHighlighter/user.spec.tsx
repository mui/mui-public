/**
 * @vitest-environment jsdom
 *
 * Integration tests for the full `CodeHighlighter` (client) render path. These
 * exercise the real component — `CodeHighlighterClient` driving a `useCode`
 * content — and document the user-facing behaviors:
 *
 * - Rendering precomputed, highlighted code
 * - Switching variants
 * - Switching files within a variant
 * - Toggling a transform (e.g. TS → JS)
 * - Editing a controlled file (re-highlight)
 *
 * NOT covered here: the fallback↔content swap and the residual-compression
 * variant swap. Both need a *server-rendered + hydrated* tree to commit the
 * swap — a client-only render (jsdom or vitest-browser) sits on the fallback and
 * never mounts the content, so they belong in an E2E against the built docs. The
 * residual decode *logic* (producer compresses → client decompresses with the
 * rendered dictionary → scatters → variant decodes) is unit-verified in
 * `prepareInitialSource.test.tsx`.
 *
 * These tests use inline HAST sources (already "highlighted"), so they render
 * directly without the fallback hoist. They read as documentation of the
 * component's user cases; keep them readable over clever.
 */
import * as React from 'react';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
// Manual cleanup: the root vitest config does not set `globals: true`, so RTL's
// automatic `afterEach(cleanup)` is a no-op here.
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { CodeHighlighterClient } from './CodeHighlighterClient';
import { useCode } from '../useCode';
import { CodeControllerContext } from '../CodeControllerContext';
import { CodeContext } from '../CodeProvider/CodeContext';
import { parseControlledCode } from './parseControlledCode';
import { createParseSource } from '../pipeline/parseSource';
import { preloadSourceEditingEngine } from '../useCode/useSourceEditing';
import type { Code, ContentProps, ControlledCode, HastRoot, ParseSource } from './types';

afterEach(cleanup);

let parseSource: ParseSource;

// `<Pre>` observes line/frame visibility; jsdom ships neither observer. Stub
// them as no-ops so the rendered code commits (frames stay at their initial
// visibility, which is all these tests assert against). Also warm the editing
// engine and a real Starry Night parser so the controlled-edit re-highlight
// runs synchronously.
beforeAll(async () => {
  class NoopObserver {
    observe() {}

    unobserve() {}

    disconnect() {}

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
  globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;
  await preloadSourceEditingEngine();
  parseSource = await createParseSource();
});

/** A stateful `CodeControllerContext` host — the controller a live editor wires. */
function CodeController({ children }: { children: React.ReactNode }) {
  const [controlledCode, setControlledCode] = React.useState<ControlledCode | undefined>(undefined);
  const value = React.useMemo(
    () => ({ code: controlledCode, setCode: setControlledCode }),
    [controlledCode],
  );
  return <CodeControllerContext.Provider value={value}>{children}</CodeControllerContext.Provider>;
}

/** A minimal "already highlighted" HAST source: one frame, one line of text. */
function highlighted(text: string): HastRoot {
  return {
    type: 'root',
    data: { totalLines: 1, focusedLines: 1 },
    children: [
      {
        type: 'element',
        tagName: 'span',
        properties: { className: 'frame' },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [{ type: 'text', value: text }],
          },
        ],
      },
    ],
  };
}

/**
 * A representative content component: renders the selected file and exposes the
 * variant/file/transform controls a real demo would, so the tests interact the
 * way a user does.
 */
function Demo(props: ContentProps<object>) {
  const code = useCode(props, { variantSwapDelay: 0, transformDelay: 0 });
  return (
    <div>
      <span data-testid="variant">{code.selectedVariant}</span>
      <span data-testid="file">{code.selectedFileName}</span>
      <span data-testid="transform">{String(code.selectedTransform ?? 'none')}</span>
      <pre data-testid="code">{code.selectedFile}</pre>
      {code.variants.map((variant) => (
        <button
          key={variant}
          type="button"
          data-testid={`variant:${variant}`}
          onClick={() => code.selectVariant(variant)}
        >
          {variant}
        </button>
      ))}
      {code.files.map((file) => (
        <button
          key={file.name}
          type="button"
          data-testid={`file:${file.name}`}
          onClick={() => code.selectFileName(file.name)}
        >
          {file.name}
        </button>
      ))}
      {code.availableTransforms.map((transform) => (
        <button
          key={transform}
          type="button"
          data-testid={`transform:${transform}`}
          onClick={() => code.selectTransform(transform)}
        >
          {transform}
        </button>
      ))}
      {code.setSource ? (
        <button
          type="button"
          data-testid="edit"
          onClick={() => code.setSource?.('const edited = 99;')}
        >
          edit
        </button>
      ) : null}
    </div>
  );
}

describe('CodeHighlighter rendering', () => {
  it('renders the selected variant of precomputed, highlighted code', () => {
    const code = {
      JavaScript: { fileName: 'app.js', source: highlighted('const answer = 42;') },
      TypeScript: { fileName: 'app.ts', source: highlighted('const answer: number = 42;') },
    } as unknown as Code;

    render(
      <CodeHighlighterClient
        variants={['JavaScript', 'TypeScript']}
        precompute={code}
        url="file:///app"
      >
        <Demo />
      </CodeHighlighterClient>,
    );

    expect(screen.getByTestId('variant').textContent).toBe('JavaScript');
    expect(screen.getByTestId('code').textContent).toContain('const answer = 42;');
  });

  it('switches the rendered code when the user selects another variant', async () => {
    const code = {
      JavaScript: { fileName: 'app.js', source: highlighted('const answer = 42;') },
      TypeScript: { fileName: 'app.ts', source: highlighted('const answer: number = 42;') },
    } as unknown as Code;

    render(
      <CodeHighlighterClient
        variants={['JavaScript', 'TypeScript']}
        precompute={code}
        url="file:///app"
      >
        <Demo />
      </CodeHighlighterClient>,
    );

    act(() => {
      screen.getByTestId('variant:TypeScript').click();
    });

    // The rendered code follows the committed swap (the label reflects intent
    // sooner); wait for the swap to land.
    await waitFor(() =>
      expect(screen.getByTestId('code').textContent).toContain('const answer: number = 42;'),
    );
  });

  it('switches the rendered file when the user selects another file in the variant', async () => {
    const code = {
      Default: {
        fileName: 'index.js',
        source: highlighted('export { run } from "./run";'),
        extraFiles: { 'run.js': { source: highlighted('export function run() {}') } },
      },
    } as unknown as Code;

    render(
      <CodeHighlighterClient variants={['Default']} precompute={code} url="file:///index.js">
        <Demo />
      </CodeHighlighterClient>,
    );

    expect(screen.getByTestId('file').textContent).toBe('index.js');
    expect(screen.getByTestId('code').textContent).toContain('export { run }');

    act(() => {
      screen.getByTestId('file:run.js').click();
    });

    await waitFor(() => expect(screen.getByTestId('file').textContent).toBe('run.js'));
    expect(screen.getByTestId('code').textContent).toContain('export function run()');
  });

  it('surfaces a declared transform and applies it when toggled', async () => {
    // The variant declares a `js` transform (manifest). Toggling it commits the
    // transform: `selectedTransform` flips and the file is renamed per the
    // manifest. (Applying the delta to the HAST is unit-tested in
    // `TransformEngine.test`; here we document the user-facing toggle + rename.)
    const code = {
      Default: {
        fileName: 'app.ts',
        source: highlighted('const answer: number = 42;'),
        transforms: { js: { fileName: 'app.js', hasDelta: true } },
      },
    } as unknown as Code;

    render(
      <CodeHighlighterClient variants={['Default']} precompute={code} url="file:///app.ts">
        <Demo />
      </CodeHighlighterClient>,
    );

    // The transform is offered to the user, and nothing is applied yet.
    expect(screen.getByTestId('transform:js')).toBeTruthy();
    expect(screen.getByTestId('transform').textContent).toBe('none');
    expect(screen.getByTestId('file').textContent).toBe('app.ts');

    act(() => {
      screen.getByTestId('transform:js').click();
    });

    // The toggle commits: the transform is selected and the file renamed.
    await waitFor(() => expect(screen.getByTestId('transform').textContent).toBe('js'));
    await waitFor(() => expect(screen.getByTestId('file').textContent).toBe('app.js'));
  });

  it('re-highlights a controlled file after the user edits it', async () => {
    const code = {
      Default: { fileName: 'app.js', source: highlighted('const answer = 42;') },
    } as unknown as Code;

    render(
      <CodeContext.Provider value={{ parseSource, parseControlledCode }}>
        <CodeController>
          <CodeHighlighterClient variants={['Default']} code={code} url="file:///app.js">
            <Demo />
          </CodeHighlighterClient>
        </CodeController>
      </CodeContext.Provider>,
    );

    // Editing is available (a controller with setCode is in scope) and the
    // original code renders.
    expect(screen.getByTestId('edit')).toBeTruthy();
    expect(screen.getByTestId('code').textContent).toContain('const answer = 42;');

    act(() => {
      screen.getByTestId('edit').click();
    });

    // The edit commits to the controller and re-highlights through the real
    // parser, so the rendered code reflects the new source.
    await waitFor(() =>
      expect(screen.getByTestId('code').textContent).toContain('const edited = 99;'),
    );
  });
});

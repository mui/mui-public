/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DemoRunner } from './CodeRunner';

describe('DemoRunner', () => {
  it('renders a compiled module stylesheet in its own output (not document.head) and scopes the class', () => {
    const extraFiles = { 'styles.module.css': { source: '.btn { color: rgb(1, 2, 3); }' } };
    const code =
      "import styles from './styles.module.css';\nexport default () => <button className={styles.btn}>Go</button>;";
    render(<DemoRunner code={code} extraFiles={extraFiles} />);

    const button = screen.getByRole('button');
    const style = document.querySelector('[data-demo-styles] style');
    expect(style).toBeTruthy();
    // The scoped class on the button matches the scoped selector in the <style>.
    expect(button.className.startsWith('btn-')).toBe(true);
    expect(style?.textContent).toContain(button.className);
    // The stylesheet lives in the component output, not the document head.
    expect(document.head.contains(style)).toBe(false);
  });

  it('reports null to onError for code that renders cleanly', () => {
    const onError = vi.fn();
    render(<DemoRunner code="<p>ok</p>" onError={onError} />);
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it('resolves relative imports across subdirectory extra files', () => {
    const extraFiles = {
      // A file in `lib/` consumed by a file in `widgets/` via `../lib/data`, then
      // the main source imports `./widgets/Badge` — none share a directory.
      'lib/data.ts': { source: 'export const label = "from-lib";' },
      'widgets/Badge.tsx': {
        source:
          "import { label } from '../lib/data';\nexport const Badge = () => <span>{label}</span>;",
      },
    };
    const code = "import { Badge } from './widgets/Badge';\nexport default () => <Badge />;";
    render(<DemoRunner code={code} extraFiles={extraFiles} />);
    expect(screen.getByText('from-lib')).toBeTruthy();
  });

  it('resolves a dynamic import() across subdirectory extra files', async () => {
    const extraFiles = {
      'lib/Heavy.tsx': { source: 'export default () => <span>heavy-loaded</span>;' },
      // Lazily imports a sibling in another directory via `import('../lib/Heavy')`.
      'widgets/Panel.tsx': {
        source:
          "import * as React from 'react';\n" +
          "const Heavy = React.lazy(() => import('../lib/Heavy'));\n" +
          'export const Panel = () => (\n' +
          '  <React.Suspense fallback={<span>loading</span>}>\n' +
          '    <Heavy />\n' +
          '  </React.Suspense>\n' +
          ');',
      },
    };
    const code = "import { Panel } from './widgets/Panel';\nexport default () => <Panel />;";
    render(<DemoRunner code={code} extraFiles={extraFiles} />);
    expect(await screen.findByText('heavy-loaded')).toBeTruthy();
  });

  it('lets an extra file import the main entry (circular)', () => {
    const extraFiles = {
      // Imports a shared value back from the main source (`./index`).
      'Tag.tsx': {
        source: "import { LABEL } from './index';\nexport const Tag = () => <span>{LABEL}</span>;",
      },
    };
    const code =
      "import { Tag } from './Tag';\nexport const LABEL = 'shared';\nexport default () => <Tag />;";
    render(<DemoRunner code={code} extraFiles={extraFiles} />);
    expect(screen.getByText('shared')).toBeTruthy();
  });

  it('reports the error message to onError for broken code', () => {
    const onError = vi.fn();
    render(<DemoRunner code="export default <div>" onError={onError} />);
    const lastArg = onError.mock.calls[onError.mock.calls.length - 1]?.[0];
    expect(typeof lastArg).toBe('string');
    expect((lastArg as string).length).toBeGreaterThan(0);
  });

  it('surfaces a broken sibling file through onError without crashing (error boundary)', () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const extraFiles = { 'broken.ts': { source: 'export const value =' } };
    const code = "import { value } from './broken';\nexport default () => <div>{value}</div>;";

    expect(() =>
      render(<DemoRunner code={code} extraFiles={extraFiles} onError={onError} />),
    ).not.toThrow();
    const lastArg = onError.mock.calls[onError.mock.calls.length - 1]?.[0];
    expect(typeof lastArg).toBe('string');
    expect((lastArg as string).length).toBeGreaterThan(0);
    consoleError.mockRestore();
  });

  it('clears the host error after ONE good edit following a render-time error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // `s` is undefined inside the render function, so it throws when React renders
    // the component (not at eval time).
    const broken = 'export default function App() { return <div>{s}</div>; }';
    const valid = 'export default function App() { return <div>ok</div>; }';

    function Host({ code }: { code: string }) {
      const [error, setError] = React.useState<string | null>(null);
      return (
        <React.Fragment>
          <div data-testid="host-error">{error ?? ''}</div>
          <DemoRunner code={code} onError={setError} />
        </React.Fragment>
      );
    }

    const { rerender } = render(<Host code={broken} />);
    await waitFor(() => {
      expect(screen.getByTestId('host-error').textContent).not.toBe('');
    });

    rerender(<Host code={valid} />);
    await waitFor(() => {
      expect(screen.getByTestId('host-error').textContent).toBe('');
    });
    consoleError.mockRestore();
  });

  it('clears the host error after ONE good edit under StrictMode', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = 'export default function App() { return <div>{s}</div>; }';
    const valid = 'export default function App() { return <div>ok</div>; }';

    function Host({ code }: { code: string }) {
      const [error, setError] = React.useState<string | null>(null);
      return (
        <React.Fragment>
          <div data-testid="host-error">{error ?? ''}</div>
          <DemoRunner code={code} onError={setError} />
        </React.Fragment>
      );
    }

    const { rerender } = render(
      <React.StrictMode>
        <Host code={broken} />
      </React.StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('host-error').textContent).not.toBe('');
    });

    rerender(
      <React.StrictMode>
        <Host code={valid} />
      </React.StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('host-error').textContent).toBe('');
    });
    consoleError.mockRestore();
  });
});

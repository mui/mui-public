import { readFile, readdir } from 'node:fs/promises';
import * as React from 'react';
import * as ReactDOM from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Externals } from '../../CodeHighlighter/types';
import { createLoadServerCodeSource } from '../loadServerCodeSource';
import { loadIsomorphicCodeVariant } from '../loadIsomorphicCodeVariant';
import { processRelativeImports } from '../loaderUtils';
import { findServerOnlyExternals } from '../loadPrecomputedCodeHighlighterClient/findServerOnlyExternals';
// The generated `.js` sibling holds JSX, like Material UI's, so the authored
// entry is imported explicitly rather than through extension resolution.
import BasicButtons from './fixtures/material-demo/BasicButtons.tsx';

const MATERIAL_DEMO_URL = new URL('./fixtures/material-demo/', import.meta.url);
const MATERIAL_DEMO_FOCUS_URL = new URL('./fixtures/material-demo-focus/', import.meta.url);

/** Reads a source file from a demo fixture. */
async function readFixture(relativePath: string, fixtureUrl = MATERIAL_DEMO_URL) {
  return readFile(new URL(relativePath, fixtureUrl), 'utf8');
}

describe('Material demo fixtures', () => {
  it('renders the bundled component without source processing', () => {
    expect(ReactDOM.renderToStaticMarkup(<BasicButtons />)).toContain('Primary action');
  });

  it('provides exact TypeScript, JavaScript, and preview sources', async () => {
    const [typescript, javascript, preview] = await Promise.all([
      readFixture('BasicButtons.tsx'),
      readFixture('BasicButtons.js'),
      readFixture('BasicButtons.tsx.preview'),
    ]);

    expect({ typescript, javascript, preview }).toMatchInlineSnapshot(`
      {
        "javascript": "import * as React from 'react';
      import { getButtonLabel } from './helper';

      export default function BasicButtons() {
        const id = React.useId();

        return (
          <button id={id} type="button">
            {getButtonLabel()}
          </button>
        );
      }
      ",
        "preview": "<button id={id} type="button">
        {getButtonLabel()}
      </button>
      ",
        "typescript": "import * as React from 'react';
      import { getButtonLabel } from './helper';

      export default function BasicButtons() {
        const id: string = React.useId();

        return (
          <button id={id} type="button">
            {getButtonLabel()}
          </button>
        );
      }
      ",
      }
    `);
  });

  it('loads relative files recursively and preserves their paths', async () => {
    const entryUrl = new URL('BasicButtons.tsx', MATERIAL_DEMO_URL).href;
    const result = await loadIsomorphicCodeVariant(
      entryUrl,
      'Default',
      { fileName: 'BasicButtons.tsx', url: entryUrl },
      {
        disableParsing: true,
        loadSource: createLoadServerCodeSource({ storeAt: 'canonical' }),
        maxDepth: 5,
      },
    );

    expect(Object.keys(result.code.extraFiles ?? {})).toEqual(['helper.ts', 'nested/data.ts']);
    expect(result.externals).toEqual({
      react: [{ isType: undefined, name: 'React', type: 'namespace' }],
    });
    expect(result.dependencies.map((dependency) => new URL(dependency).pathname)).toEqual([
      new URL('BasicButtons.tsx', MATERIAL_DEMO_URL).pathname,
      new URL('helper.ts', MATERIAL_DEMO_URL).pathname,
      new URL('nested/data.ts', MATERIAL_DEMO_URL).pathname,
    ]);
  });

  it('reports filename collisions', () => {
    const imports = {
      './first': { url: 'file:///src/first', names: ['first'] },
      './second': { url: 'file:///src/second', names: ['second'] },
    };
    const resolvedPaths = new Map([
      ['file:///src/first', 'file:///src/shared.ts'],
      ['file:///src/second', 'file:///src/shared.ts'],
    ]);

    expect(() => processRelativeImports('', imports, 'flat', true, resolvedPaths)).toThrow(
      'Cannot find distinguishing segment for files: /src/shared.ts, /src/shared.ts',
    );
  });

  it('identifies dependencies that prevent live execution', () => {
    const externals: Externals = {
      react: [{ name: 'React', type: 'namespace' }],
      'server-only': [],
    };

    expect(findServerOnlyExternals(externals)).toEqual(['server-only']);
  });

  it('can load source without live-edit metadata', async () => {
    const entryUrl = new URL('BasicButtons.tsx', MATERIAL_DEMO_URL).href;
    const result = await loadIsomorphicCodeVariant(entryUrl, 'Default', entryUrl, {
      disableParsing: true,
      disableTransforms: true,
      loadSource: createLoadServerCodeSource({ includeDependencies: false }),
    });

    expect(result.code.extraFiles).toBeUndefined();
    expect(result.code.transforms).toBeUndefined();
    expect(result.dependencies).toEqual([entryUrl]);
  });

  it('does not require factory or client entry files', async () => {
    const files = await readdir(MATERIAL_DEMO_URL);

    expect(files).not.toContain('index.ts');
    expect(files).not.toContain('client.ts');
    expect(files).not.toContain('createDemo.ts');
    expect(files).not.toContain('createDemoWithVariants.ts');
  });

  it('includes a one-file target fixture with focus markers', async () => {
    const files = await readdir(MATERIAL_DEMO_FOCUS_URL);
    const source = await readFixture('BasicButtons.tsx', MATERIAL_DEMO_FOCUS_URL);

    expect(files).toEqual(['BasicButtons.tsx', 'helper.ts', 'nested']);
    expect(source).toContain('{/* @focus-start */}');
    expect(source).toContain('{/* @focus-end */}');
  });
});

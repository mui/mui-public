import { describe, expect, it } from 'vitest';
import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { createDemoFactory, createDemoWithVariantsFactory } from './abstractCreateDemo';
import type { ContentProps } from './types';

function DemoContent(props: ContentProps<{ preloadSources?: boolean }>) {
  return (
    <section
      data-name={props.name}
      data-slug={props.slug}
      data-url={props.url}
      data-preload={props.preloadSources || undefined}
    >
      {Object.values(props.components)}
    </section>
  );
}

const precompute = {
  variants: {
    Default: {
      fileName: 'Demo.tsx',
      exportName: 'default',
      html: '<span>demo</span>',
      language: 'tsx',
      totalLines: 1,
    },
  },
};

describe('createDemoFactory', () => {
  it('derives identity from import.meta.url and renders DemoContent directly', () => {
    const createDemo = createDemoFactory({ DemoContent });
    const Demo = createDemo('file:///project/demos/button-group/index.ts', () => <button />);
    // The loader attaches this static after the factory call is evaluated.
    // eslint-disable-next-line no-underscore-dangle
    Demo.__docsInfraPrecompute = precompute;

    expect(ReactDOMServer.renderToStaticMarkup(<Demo />)).toBe(
      '<section data-name="Button Group" data-slug="button-group" data-url="file:///project/demos/button-group/index.ts"><button></button></section>',
    );
  });

  it('throws at render when the loader did not attach precompute data', () => {
    const createDemo = createDemoFactory({ DemoContent });
    const Demo = createDemo('file:///project/demos/basic/index.ts', () => null);

    expect(() => ReactDOMServer.renderToStaticMarkup(<Demo />)).toThrow(
      'did not attach __docsInfraPrecompute',
    );
  });

  it('forwards the source preload marker to DemoContent', () => {
    const createDemo = createDemoFactory({ DemoContent });
    const Demo = createDemo('file:///project/demos/basic/index.ts', () => null);
    // eslint-disable-next-line no-underscore-dangle
    Demo.__docsInfraPrecompute = precompute;

    expect(ReactDOMServer.renderToStaticMarkup(<Demo preloadSources />)).toContain(
      'data-preload="true"',
    );
  });

  it('rejects malformed source URLs', () => {
    const createDemo = createDemoFactory({ DemoContent });

    expect(() => createDemo('index.ts', () => null)).toThrow('requires import.meta.url');
  });
});

describe('createDemoWithVariantsFactory', () => {
  it('renders every variant component', () => {
    const createDemoWithVariants = createDemoWithVariantsFactory({ DemoContent });
    const Demo = createDemoWithVariants('file:///project/demos/basic/index.ts', {
      Default: () => <span>default</span>,
      Alternate: () => <span>alternate</span>,
    });
    // eslint-disable-next-line no-underscore-dangle
    Demo.__docsInfraPrecompute = {
      variants: {
        ...precompute.variants,
        Alternate: {
          fileName: 'Alternate.tsx',
          exportName: 'default',
          html: '<span>alternate</span>',
          language: 'tsx',
          totalLines: 1,
        },
      },
    };

    expect(ReactDOMServer.renderToStaticMarkup(<Demo />)).toContain(
      '<span>default</span><span>alternate</span>',
    );
  });
});

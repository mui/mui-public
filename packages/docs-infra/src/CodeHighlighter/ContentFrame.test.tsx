/** @vitest-environment jsdom */
/* eslint-disable testing-library/render-result-naming-convention -- ReactDOMServer returns HTML. */
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
// eslint-disable-next-line import/extensions
import { cleanup } from '@testing-library/react/pure.js';
import * as ReactDOMServer from 'react-dom/server';
import { CodeHighlighter } from './CodeHighlighter';
import { CodeHighlighterClient } from './CodeHighlighterClient';
import { CodeHighlighterChunk } from './CodeHighlighterChunk';
import { createClientProps } from './createClientProps';
import * as Errors from './errors';
import { useCodeFallback } from './useCodeFallback';
import { useContentFrame } from './useContentFrame';
import {
  useCodeHighlighterContext,
  useCodeHighlighterContextOptional,
} from './CodeHighlighterContext';
import { LazyContent } from '../CoordinatedLazy/LazyContent';
import { createDemoFactory } from '../abstractCreateDemo/abstractCreateDemo';
import type { Code, ContentFrameProps, ContentLoadingProps } from './types';

const code: Code = {
  Default: {
    fileName: 'Demo.tsx',
    source: { type: 'root', children: [{ type: 'text', value: 'demo' }] },
  },
};

function Loading(props: ContentLoadingProps<{}>) {
  useCodeFallback(props);
  return <span>Loading chrome</span>;
}

function FramedLoading(props: ContentLoadingProps<{}>) {
  useCodeFallback(props);
  const { framed } = useContentFrame();
  return <span>{framed ? 'Framed loading chrome' : 'Unframed loading chrome'}</span>;
}

function Chrome() {
  return <button type="button">Live chrome</button>;
}

describe('CodeHighlighter persistent frame', () => {
  afterEach(() => {
    cleanup();
  });

  it('forwards the frame and initial loading metadata from demo factories', () => {
    function Frame(props: ContentFrameProps<{}>) {
      useCodeFallback(props);
      return (
        <section aria-label={props.initialFilename}>
          {props.component}
          {props.children}
        </section>
      );
    }
    function Preview() {
      return <span>Factory preview</span>;
    }
    const createDemo = createDemoFactory({
      DemoContent: Chrome,
      DemoContentLoading: Loading,
      DemoContentFrame: Frame,
    });
    const Demo = createDemo('file:///demo/index.ts', Preview, { precompute: code });
    const markup = ReactDOMServer.renderToString(<Demo />);
    expect(markup).toContain('aria-label="Demo.tsx"');
    expect(markup).toContain('Factory preview');
    expect(markup).toContain('Loading chrome');
  });

  it('preserves direct content rendering without a loading component', () => {
    function Frame(props: ContentFrameProps<{}>) {
      useCodeFallback(props);
      return (
        <section aria-label={props.initialFilename}>
          {props.component}
          {props.children}
        </section>
      );
    }
    const markup = ReactDOMServer.renderToString(
      <CodeHighlighter
        precompute={code}
        components={{ Default: <span>Preview</span> }}
        Content={Chrome}
        ContentFrame={Frame}
      />,
    );
    expect(markup).toBe('<button type="button">Live chrome</button>');
  });

  it('preserves ready server content when the fallback is skipped', () => {
    function Frame(props: ContentFrameProps<{}>) {
      return (
        <section>
          {props.component}
          {props.children}
        </section>
      );
    }
    const props = createClientProps({
      precompute: code,
      Content: Chrome,
      ContentFrame: Frame,
      fallback: <Loading component={<span>Preview</span>} />,
      skipFallback: true,
    });
    const markup = ReactDOMServer.renderToString(<CodeHighlighterClient {...props} />);
    expect(markup).toBe('<button type="button">Live chrome</button>');
  });

  it('preserves the streamed placeholder when the client fallback is skipped', () => {
    function Frame(props: ContentFrameProps<{}>) {
      return (
        <section>
          {props.component}
          {props.children}
        </section>
      );
    }
    const initialCode: Code = {
      Default: { fileName: 'Demo.tsx', source: 'const demo = 1;' },
    };
    const markup = ReactDOMServer.renderToString(
      <CodeHighlighterChunk
        preloaded={initialCode}
        controlled={false}
        isInitial
        forceClient={false}
        awaitServerLoad={false}
        userProps={{
          Content: Chrome,
          ContentFrame: Frame,
          initialVariant: 'Default',
          code: initialCode,
          skipFallback: true,
          fallback: <Loading component={null} />,
        }}
      />,
    );
    expect(markup).toContain('Loading chrome');
    expect(markup).not.toContain('Live chrome');
  });

  it('renders the frame around a server-streamed loading fallback', () => {
    function Frame(props: ContentFrameProps<{}>) {
      useCodeFallback(props);
      return (
        <section aria-label="Streamed frame">
          {props.component}
          {props.children}
        </section>
      );
    }
    const markup = ReactDOMServer.renderToString(
      <CodeHighlighter
        precompute={{ Default: { fileName: 'Demo.tsx', source: 'const demo = 1;' } }}
        components={{ Default: <span>Streamed preview</span> }}
        Content={Chrome}
        ContentLoading={Loading}
        ContentFrame={Frame}
        highlightAfter="stream"
        loadSource={async () => ({ source: 'const demo = 1;' })}
      />,
    );
    expect(markup).toContain('Streamed frame');
    expect(markup).toContain('Streamed preview');
  });

  it('does not repaint static fallback markup when deferred source becomes ready', async () => {
    let renders = 0;
    let finishSource: (value: Code) => void = () => {};
    const source = new Promise<Code>((resolve) => {
      finishSource = resolve;
    });
    const onRender = () => {
      renders += 1;
    };
    const StaticCode = React.memo(function StaticCode({ children }: React.PropsWithChildren) {
      return (
        <React.Profiler id="fallback" onRender={onRender}>
          <pre>{children}</pre>
        </React.Profiler>
      );
    });
    function Frame(props: ContentFrameProps<{}>) {
      const fallback = useCodeFallback(props);
      return <StaticCode>{fallback.code}</StaticCode>;
    }
    const initialCode: Code = {
      Default: {
        fileName: 'Demo.tsx',
        source: { type: 'root', children: [{ type: 'text', value: 'demo' }] },
        fallback: [['span', 'frame', 'demo']],
      },
    };
    render(
      <CodeHighlighter
        precompute={initialCode}
        loadPrecompute={() => source}
        Content={Chrome}
        ContentLoading={Loading}
        ContentFrame={Frame}
        enhanceAfter="hydration"
      />,
    );
    expect(renders).toBe(1);
    await act(async () => {
      finishSource(initialCode);
    });
    expect(renders).toBe(1);
  });

  it('keeps preview state through source readiness and a delayed chrome import', async () => {
    let mounts = 0;
    let unmounts = 0;
    let finishSource: (value: Code) => void = () => {};
    let finishChrome: (value: { default: typeof LiveChrome }) => void = () => {};
    const source = new Promise<Code>((resolve) => {
      finishSource = resolve;
    });
    const chrome = new Promise<{ default: typeof LiveChrome }>((resolve) => {
      finishChrome = resolve;
    });

    function Preview() {
      React.useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);
      return <input aria-label="Demo value" defaultValue="initial" />;
    }

    function LoadingChrome(props: ContentLoadingProps<{}>) {
      useCodeFallback(props);
      const { framed } = useContentFrame();
      return (
        <React.Fragment>
          {!framed && props.component}
          <span>Loading chrome</span>
        </React.Fragment>
      );
    }

    function LiveChrome() {
      const { framed } = useContentFrame();
      return (
        <React.Fragment>
          {!framed && <Preview />}
          <Chrome />
        </React.Fragment>
      );
    }

    function Frame(props: ContentFrameProps<{}>) {
      useCodeFallback(props);
      const { component, children } = props;
      return (
        <section aria-label={props.name}>
          {component}
          {children}
        </section>
      );
    }

    function Content() {
      return <LazyContent content={() => chrome} />;
    }

    const props = {
      precompute: code,
      loadPrecompute: () => source,
      components: { Default: <Preview /> },
      Content,
      ContentLoading: LoadingChrome,
      ContentFrame: Frame,
      enhanceAfter: 'hydration' as const,
    };
    const markup = ReactDOMServer.renderToString(<CodeHighlighter {...props} />);
    expect(markup).toContain('Demo value');
    const container = document.createElement('div');
    container.innerHTML = markup;
    document.body.appendChild(container);
    const view = render(<CodeHighlighter {...props} />, { container, hydrate: true });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'retained' } });
    expect(mounts).toBe(1);

    await act(async () => {
      finishSource(code);
    });
    expect(await screen.findByText('Loading chrome')).toBeTruthy();
    expect(screen.getByRole('textbox')).toBe(input);

    await act(async () => {
      finishChrome({ default: LiveChrome });
    });
    expect(await screen.findByRole('button', { name: 'Live chrome' })).toBeTruthy();
    expect(screen.getByRole('textbox')).toBe(input);
    expect((input as HTMLInputElement).value).toBe('retained');
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    view.rerender(<CodeHighlighter {...props} name="Updated demo" />);
    expect(screen.getByRole('region', { name: 'Updated demo' })).toBeTruthy();
    expect(screen.getByRole('textbox')).toBe(input);
    expect(mounts).toBe(1);
    view.rerender(
      <CodeHighlighter {...props} components={{ Default: <span>Replacement preview</span> }} />,
    );
    expect(screen.getByText('Replacement preview')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(unmounts).toBe(1);
    view.unmount();
    container.remove();
  });

  it('renders only the frame and loading element in the streamed placeholder', () => {
    function Frame(props: ContentFrameProps<{}>) {
      const highlighter = useCodeHighlighterContextOptional();
      return (
        <section aria-label="Streamed frame" data-highlighter={highlighter ? '' : undefined}>
          {props.component}
          {props.children}
        </section>
      );
    }
    const markup = ReactDOMServer.renderToString(
      <CodeHighlighter
        precompute={{ Default: { fileName: 'Demo.tsx', source: 'const demo = 1;' } }}
        components={{ Default: <span>Streamed preview</span> }}
        Content={Chrome}
        ContentLoading={FramedLoading}
        ContentFrame={Frame}
        highlightAfter="stream"
        loadSource={async () => ({ source: 'const demo = 1;' })}
      />,
    );
    expect(markup).toContain('Streamed preview');
    expect(markup).toContain('Framed loading chrome');
    expect(markup).not.toContain('data-highlighter');
  });

  it('renders the selected variant preview from a server-built frame', async () => {
    const variants: Code = {
      Default: code.Default,
      Other: {
        fileName: 'Other.tsx',
        source: { type: 'root', children: [{ type: 'text', value: 'other' }] },
      },
    };
    function Frame(props: ContentFrameProps<{}>) {
      return (
        <section>
          {props.component}
          {props.children}
        </section>
      );
    }
    function SwitchChrome() {
      const { setSelection } = useCodeHighlighterContext();
      return (
        <button type="button" onClick={() => setSelection?.({ variant: 'Other' })}>
          Switch
        </button>
      );
    }
    const props = createClientProps({
      precompute: variants,
      components: { Default: <span>Default preview</span>, Other: <span>Other preview</span> },
      Content: SwitchChrome,
      ContentFrame: Frame,
      fallback: <Loading component={<span>Default preview</span>} initialVariant="Default" />,
      initialVariant: 'Default',
    });
    render(<CodeHighlighterClient {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch' }));
    expect(screen.getByText('Other preview')).toBeTruthy();
    expect(screen.queryByText('Default preview')).toBeNull();
  });

  it('tells content and loading components whether a frame renders the preview', async () => {
    function FramedChrome() {
      const { framed } = useContentFrame();
      return <button type="button">{framed ? 'Framed chrome' : 'Unframed chrome'}</button>;
    }
    function Frame(props: ContentFrameProps<{}>) {
      return <section>{props.children}</section>;
    }
    const markup = ReactDOMServer.renderToString(
      <CodeHighlighter
        precompute={code}
        components={{ Default: <span>Preview</span> }}
        Content={FramedChrome}
        ContentLoading={FramedLoading}
        ContentFrame={Frame}
      />,
    );
    expect(markup).toContain('Framed loading chrome');
    render(
      <CodeHighlighter
        precompute={code}
        components={{ Default: <span>Preview</span> }}
        Content={FramedChrome}
        ContentLoading={FramedLoading}
        ContentFrame={Frame}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Framed chrome' })).toBeTruthy();
    cleanup();
    render(
      <CodeHighlighter
        precompute={code}
        components={{ Default: <span>Preview</span> }}
        Content={FramedChrome}
        ContentLoading={FramedLoading}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Unframed chrome' })).toBeTruthy();
  });

  it('does not mark a nested highlighter as framed', async () => {
    function NestedChrome() {
      const { framed } = useContentFrame();
      return <button type="button">{framed ? 'Nested framed' : 'Nested unframed'}</button>;
    }
    function OuterChrome() {
      return (
        <CodeHighlighter
          precompute={code}
          components={{ Default: <span>Nested preview</span> }}
          Content={NestedChrome}
        />
      );
    }
    function Frame(props: ContentFrameProps<{}>) {
      return <section>{props.children}</section>;
    }
    render(
      <CodeHighlighter
        precompute={code}
        components={{ Default: <span>Preview</span> }}
        Content={OuterChrome}
        ContentLoading={FramedLoading}
        ContentFrame={Frame}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Nested unframed' })).toBeTruthy();
  });

  it('rejects a frame that arrives already rendered', () => {
    const props = createClientProps({
      precompute: code,
      Content: Chrome,
      fallback: <Loading component={null} />,
    });
    expect(() =>
      ReactDOMServer.renderToString(
        <CodeHighlighterClient {...props} frame={<section>{null}</section>} />,
      ),
    ).toThrow(Errors.ErrorCodeHighlighterClientServerContentFrame);
  });
});

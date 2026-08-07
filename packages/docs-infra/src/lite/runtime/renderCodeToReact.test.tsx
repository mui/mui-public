import { describe, expect, it } from 'vitest';
import * as ReactDOMServer from 'react-dom/server';
import { renderCodeToReact } from './renderCodeToReact';

describe('renderCodeToReact', () => {
  it('renders variant html inside pre > code with the language class', () => {
    expect(
      ReactDOMServer.renderToStaticMarkup(
        renderCodeToReact('<span>hello</span>', 'ts', { preClassName: 'my-pre' }),
      ),
    ).toMatchInlineSnapshot(
      `"<pre class="my-pre"><code class="language-ts"><span>hello</span></code></pre>"`,
    );
  });
});

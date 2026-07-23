import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import type { Root } from 'mdast';
import transformMarkdownDemosPlugin from './transformMarkdownDemos';
import type { TransformMarkdownDemosOptions } from './transformMarkdownDemos';

interface MdxAttribute {
  name?: string;
}

interface MdxNode {
  type: string;
  name?: string | null;
  attributes?: MdxAttribute[];
  children?: MdxNode[];
}

function transform(mdx: string, options?: TransformMarkdownDemosOptions): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(transformMarkdownDemosPlugin, options);
  return processor.runSync(processor.parse(mdx)) as Root;
}

function jsxElements(tree: Root): Array<[string | null, boolean]> {
  const elements: Array<[string | null, boolean]> = [];
  const visit = (node: MdxNode) => {
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      elements.push([
        node.name ?? null,
        (node.attributes ?? []).some((attribute) => attribute.name === 'preloadSources'),
      ]);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(tree as unknown as MdxNode);
  return elements;
}

describe('transformMarkdownDemos', () => {
  it('marks the first N imported demo components in document order', () => {
    const tree = transform(
      [
        "import { AlphaDemo } from './demos/alpha';",
        "import { BetaDemo } from './demos/beta';",
        "import { Callout } from '../components/Callout';",
        '',
        '<Callout><AlphaDemo /></Callout>',
        '',
        '<BetaDemo />',
      ].join('\n'),
      { preloadSources: 1 },
    );
    expect(jsxElements(tree)).toEqual([
      ['Callout', false],
      ['AlphaDemo', true],
      ['BetaDemo', false],
    ]);
  });

  it('supports default imports and does not duplicate the attribute', () => {
    const tree = transform(
      ["import AlphaDemo from './demos/alpha';", '', '<AlphaDemo preloadSources />'].join('\n'),
      { preloadSources: 2 },
    );
    expect(jsxElements(tree)).toEqual([['AlphaDemo', true]]);
    const demo = (tree.children as unknown as MdxNode[]).find(
      (node) => node.type === 'mdxJsxFlowElement',
    );
    expect(
      demo?.attributes?.filter((attribute) => attribute.name === 'preloadSources'),
    ).toHaveLength(1);
  });

  it('leaves the tree untouched when preloading is disabled', () => {
    const mdx = ["import { AlphaDemo } from './demos/alpha';", '', '<AlphaDemo />'].join('\n');
    expect(jsxElements(transform(mdx))).toEqual([['AlphaDemo', false]]);
    expect(jsxElements(transform(mdx, { preloadSources: 0 }))).toEqual([['AlphaDemo', false]]);
  });
});

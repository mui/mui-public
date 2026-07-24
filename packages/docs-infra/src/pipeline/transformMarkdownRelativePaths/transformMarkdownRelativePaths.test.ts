import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import type { Link } from 'mdast';
import { transformMarkdownRelativePaths } from './transformMarkdownRelativePaths';

const processor = unified().use(remarkParse).use(transformMarkdownRelativePaths);

/**
 * Runs the plugin over a single link and returns the rewritten URL. `filePath` is the source
 * file the (relative) link is resolved against; omit it for links that need no resolution. The URL
 * is angle-bracketed so parentheses in route-group paths don't confuse the link parser.
 */
function rewriteLinkUrl(url: string, filePath?: string): string {
  const tree = processor.runSync(processor.parse(`[link](<${url}>)`), { path: filePath });
  let result = '';
  visit(tree, 'link', (node: Link) => {
    result = node.url;
  });
  return result;
}

describe('transformMarkdownRelativePaths', () => {
  it('strips the page file extension', () => {
    expect(rewriteLinkUrl('/components/page.mdx')).toBe('/components');
  });

  it('leaves an external URL untouched', () => {
    expect(rewriteLinkUrl('https://example.com/(x)/page.mdx')).toBe(
      'https://example.com/(x)/page.mdx',
    );
  });

  describe('route groups', () => {
    it('drops a leading whole route-group segment', () => {
      expect(rewriteLinkUrl('/(public)/components/page.tsx')).toBe('/components');
    });

    it('drops a whole route-group segment mid-path', () => {
      expect(rewriteLinkUrl('/components/(inputs)/checkbox')).toBe('/components/checkbox');
    });

    it('drops multiple consecutive route-group segments', () => {
      expect(rewriteLinkUrl('/(components)/(inputs)/checkbox')).toBe('/checkbox');
    });

    it('keeps a segment that merely contains parentheses (not a whole route group)', () => {
      // `(draft)notes` is a real folder, not a route group, so it must stay in the URL — matching
      // how the grouped index and search resolve the same page (whole-segment `isRouteGroup`).
      expect(rewriteLinkUrl('/(draft)notes/guide')).toBe('/(draft)notes/guide');
    });
  });

  describe('relative resolution', () => {
    it('resolves a ./ link against the current app directory and strips route groups', () => {
      expect(
        rewriteLinkUrl('./code-highlighter/page.mdx', '/repo/app/(public)/components/page.mdx'),
      ).toBe('/components/code-highlighter');
    });
  });
});

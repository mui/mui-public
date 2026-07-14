import { describe, it, expect } from 'vitest';
import type { Root } from 'mdast';
import { transformMarkdownRelativePaths } from './transformMarkdownRelativePaths';

// The plugin is a unified `Plugin` whose `this`/argument types (Processor, 3-arg transformer)
// don't fit a hand-built mdast tree; treat it as the synchronous tree transformer it is.
type LinkTransformer = () => (tree: Root, file: { path?: string }) => void;

/**
 * Runs the plugin over a single link and returns the rewritten URL. `filePath` is the source
 * file the (relative) link is resolved against; omit it for links that need no resolution.
 */
function rewriteLinkUrl(url: string, filePath?: string): string {
  const tree: Root = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'link', url, children: [{ type: 'text', value: 'link' }] }],
      },
    ],
  };
  (transformMarkdownRelativePaths as unknown as LinkTransformer)()(tree, { path: filePath });
  const paragraph = tree.children[0];
  const link = paragraph.type === 'paragraph' ? paragraph.children[0] : undefined;
  return link && link.type === 'link' ? link.url : '';
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

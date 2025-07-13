import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Link } from 'mdast';
import path from 'path';

/**
 * Remark plugin that strips page file extensions from URLs.
 * Removes /page.tsx, /page.jsx, /page.js, /page.mdx, /page.md from both absolute and relative URLs.
 * For relative URLs, converts them to absolute paths based on the current file's location.
 *
 * Examples:
 * - /components/page.tsx -> /components
 * - ./code-highlighter/page.mdx -> /components/code-highlighter (when processed from /components/page.mdx)
 * This allows URLs to resolve when reading in VSCode and Github
 */
export const remarkRelativeUrls: Plugin = () => {
  return (tree, file) => {
    visit(tree, 'link', (node: Link) => {
      if (node.url) {
        node.url = node.url.replace(/\/page\.(tsx|jsx|js|mdx|md)$/g, '');
        node.url = node.url.replace(/\/page\.(tsx|jsx|js|mdx|md)(\?[^#]*)?(#.*)?$/g, '$2$3');

        if (node.url.startsWith('./') && file.path) {
          const currentDir = path.dirname(file.path);
          const appIndex = currentDir.indexOf('/app/');
          const baseDir = appIndex !== -1 ? currentDir.substring(appIndex + 4) : '/';

          node.url = path.join('/', baseDir, node.url.replace(/^\.\//, ''));
        }

        node.url = node.url.replace(/\/$/, '');
      }
    });
  };
};

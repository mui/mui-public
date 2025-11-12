// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';

import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Link } from 'mdast';

/**
 * Remark plugin that strips page file extensions from URLs.
 * Removes /page.tsx, /page.jsx, /page.js, /page.mdx, /page.md from both absolute and relative URLs.
 * For relative URLs (both ./ and ../), converts them to absolute paths based on the current file's location.
 * Also removes Next.js route group segments (parenthesis) from URLs.
 *
 * Examples:
 * - /components/page.tsx -> /components
 * - ./code-highlighter/page.mdx -> /components/code-highlighter (when processed from /components/page.mdx)
 * - ../code-highlighter/page.tsx -> /code-highlighter (when processed from /components/button/page.mdx)
 * - /(public)/components/page.tsx -> /components
 * This allows URLs to resolve when reading in VSCode and Github
 */
export const transformMarkdownRelativePaths: Plugin = () => {
  return (tree, file) => {
    visit(tree, 'link', (node: Link) => {
      if (node.url) {
        node.url = node.url.replace(/\/page\.(tsx|jsx|js|mdx|md)$/g, '');
        node.url = node.url.replace(/\/page\.(tsx|jsx|js|mdx|md)(\?[^#]*)?(#.*)?$/g, '$2$3');

        if ((node.url.startsWith('./') || node.url.startsWith('../')) && file.path) {
          const currentDir = path.dirname(file.path);
          const appIndex = currentDir.indexOf('/app/');
          const baseDir = appIndex !== -1 ? currentDir.substring(appIndex + 4) : '/';

          // Resolve the relative path from the current directory
          const resolvedPath = path.resolve('/', baseDir, node.url);
          node.url = resolvedPath;
        }

        // Remove Next.js route group segments (parenthesis)
        node.url = node.url.replace(/\/\([^)]+\)/g, '');

        node.url = node.url.replace(/\/$/, '');
      }
    });
  };
};

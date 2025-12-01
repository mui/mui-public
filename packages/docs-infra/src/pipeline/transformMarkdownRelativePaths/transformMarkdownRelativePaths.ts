// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';

import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Link } from 'mdast';

/**
 * Normalizes a file path by converting Windows-style backslashes to forward slashes.
 * This ensures consistent path handling when converting filesystem paths to URLs.
 */
function normalizePathSeparators(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Remark plugin that strips page file extensions from URLs.
 * Removes /page.tsx, /page.jsx, /page.js, /page.mdx, /page.md from both absolute and relative URLs.
 * For relative URLs (both ./ and ../), converts them to absolute paths based on the current file's location.
 *
 * Examples:
 * - /components/page.tsx -> /components
 * - ./code-highlighter/page.mdx -> /components/code-highlighter (when processed from /components/page.mdx)
 * - ../code-highlighter/page.tsx -> /code-highlighter (when processed from /components/button/page.mdx)
 * This allows URLs to resolve when reading in VSCode and Github
 */
export const transformMarkdownRelativePaths: Plugin = () => {
  return (tree, file) => {
    visit(tree, 'link', (node: Link) => {
      if (node.url) {
        node.url = node.url.replace(/\/page\.(tsx|jsx|js|mdx|md)$/g, '');
        node.url = node.url.replace(/\/page\.(tsx|jsx|js|mdx|md)(\?[^#]*)?(#.*)?$/g, '$2$3');

        if ((node.url.startsWith('./') || node.url.startsWith('../')) && file.path) {
          // Normalize path separators for cross-platform compatibility (Windows uses backslashes)
          const normalizedFilePath = normalizePathSeparators(file.path);
          const currentDir = path.posix.dirname(normalizedFilePath);
          const appIndex = currentDir.indexOf('/app/');
          const baseDir = appIndex !== -1 ? currentDir.substring(appIndex + 4) : '/';

          // Resolve the relative path from the current directory using POSIX paths for URLs
          const resolvedPath = path.posix.resolve('/', baseDir, node.url);
          node.url = resolvedPath;
        }

        node.url = node.url.replace(/\/$/, '');
      }
    });
  };
};

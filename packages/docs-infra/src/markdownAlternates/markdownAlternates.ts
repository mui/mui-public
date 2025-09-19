import fs from 'node:fs/promises';

import { collectKnownPages } from './collectKnownPages';
import { transformHtmlToMarkdown } from '../pipeline/transformHtmlToMarkdown';

export async function generateMarkdownAlternates(packageDir: string, outDir: string) {
  // we should align with what we produce in development mode
  const knownPages = await collectKnownPages(packageDir);

  await Promise.all(
    knownPages.map(async (segments) => {
      const path = `${packageDir}/${outDir}/${segments.join('/') || 'index'}`;
      const html = await fs.readFile(`${path}.html`, 'utf8');

      const markdown = await transformHtmlToMarkdown(html).catch((error) => {
        const message = typeof error === 'object' && error && 'message' in error && error.message;
        throw new Error(`Markdown Alternate Generation Failed for ${path}.html\n\n${message}`);
      });

      await fs.writeFile(`${path}.md`, markdown);
    }),
  );

  return { knownPagesCount: knownPages.length };
}

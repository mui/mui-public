import { describe, it, expect } from 'vitest';
import { enrichPageIndex } from './enrichPageIndex';
import type { PagesMetadata } from '../syncPageIndex/metadataToMarkdown';

const root = '/root';

function sampleMetadata(): PagesMetadata {
  return {
    title: 'Ignored Markdown H1',
    pages: [
      {
        slug: 'button',
        path: './button/page.mdx',
        title: 'Button',
        description: 'A button.',
        descriptionMarkdown: [{ type: 'text', value: 'A button.' }],
        sections: {
          usage: {
            title: 'Usage',
            titleMarkdown: [{ type: 'text', value: 'Usage' }],
            children: {},
          },
        },
      },
    ],
  };
}

describe('enrichPageIndex', () => {
  it('derives prefix and title from the path, overriding the markdown title', () => {
    const result = enrichPageIndex(sampleMetadata(), '/root/src/app/components/page.mdx', root);
    expect(result.prefix).toBe('/components/');
    expect(result.title).toBe('Components');
  });

  it('joins all route segments into the title', () => {
    const result = enrichPageIndex(sampleMetadata(), '/root/app/utilities/parsing/page.mdx', root);
    expect(result.prefix).toBe('/utilities/parsing/');
    expect(result.title).toBe('Utilities Parsing');
  });

  it('strips descriptionMarkdown and section titleMarkdown from pages', () => {
    const result = enrichPageIndex(sampleMetadata(), '/root/src/app/components/page.mdx', root);
    const page = result.pages[0];
    expect(page).not.toHaveProperty('descriptionMarkdown');
    expect(page.sections).toEqual({ usage: { title: 'Usage', children: undefined } });
  });
});

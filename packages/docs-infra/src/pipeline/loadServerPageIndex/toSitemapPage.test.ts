import { describe, it, expect } from 'vitest';
import { toSitemapPage } from './toSitemapPage';
import type { PageMetadata } from '../syncPageIndex/metadataToMarkdown';

function samplePage(overrides: Partial<PageMetadata> = {}): PageMetadata {
  return {
    slug: 'button',
    path: './button/page.mdx',
    title: 'Button',
    description: 'A  clickable\nbutton.',
    descriptionMarkdown: [{ type: 'text', value: 'A clickable button.' }],
    keywords: ['click  action'],
    types: ['Button\nProps'],
    sections: {
      usage: {
        title: 'Usage',
        titleMarkdown: [{ type: 'text', value: 'Usage' }],
        children: {},
      },
    },
    ...overrides,
  };
}

describe('toSitemapPage', () => {
  it('uses the list item label as the title when it differs from the heading', () => {
    const page = toSitemapPage(
      samplePage({ title: 'Button Component', displayTitle: 'Button' }),
      null,
    );
    expect(page.title).toBe('Button');
    expect(page).not.toHaveProperty('displayTitle');
  });

  it('uses the heading as the title without a list item label', () => {
    expect(toSitemapPage(samplePage(), null).title).toBe('Button');
  });

  it('strips the markdown AST fields', () => {
    const page = toSitemapPage(samplePage({ sectionGroup: '(overview)' }), null);
    expect(page).not.toHaveProperty('descriptionMarkdown');
    expect(page).not.toHaveProperty('sectionGroup');
    expect(page.sections).toEqual({ usage: { title: 'Usage', children: undefined } });
  });

  it('normalizes whitespace and keeps the types', () => {
    const page = toSitemapPage(samplePage(), null);
    expect(page.description).toBe('A clickable button.');
    expect(page.keywords).toEqual(['click action']);
    expect(page.types).toEqual(['Button Props']);
  });

  it('sets the section it is given', () => {
    expect(toSitemapPage(samplePage(), 'Components').section).toBe('Components');
    expect(toSitemapPage(samplePage(), null).section).toBeNull();
  });
});

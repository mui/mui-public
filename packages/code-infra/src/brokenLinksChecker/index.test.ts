import path from 'node:path';
import getPort from 'get-port';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line import/extensions
import { crawl, Issue, Link } from './index.mjs';

type ExpectedIssue = Omit<Partial<Issue>, 'link'> & { link?: Partial<Link> };

function objectMatchingIssue(expectedIssue: ExpectedIssue) {
  return expect.objectContaining({
    ...expectedIssue,
    ...(expectedIssue.link ? { link: expect.objectContaining(expectedIssue.link) } : {}),
  });
}

/**
 * Helper to assert that an issue with matching properties exists in the issues array
 */
function expectIssue(issues: Issue[], expectedIssue: ExpectedIssue) {
  expect(issues).toEqual(expect.arrayContaining([objectMatchingIssue(expectedIssue)]));
}

/**
 * Helper to assert that no issue with matching properties exists in the issues array
 */
function expectNotIssue(issues: Issue[], notExpectedIssue: ExpectedIssue) {
  expect(issues).not.toEqual(expect.arrayContaining([objectMatchingIssue(notExpectedIssue)]));
}

describe('Broken Links Checker', () => {
  const fixtureDir = path.join(import.meta.dirname, '__fixtures__', 'static-site');
  const servePath = path.join(import.meta.dirname, '..', '..', 'node_modules', '.bin', 'serve');

  it('should detect all broken links and targets across the entire site', async () => {
    const port = await getPort();
    const host = `http://localhost:${port}`;

    const result = await crawl({
      startCommand: `${servePath} ${fixtureDir} -p ${port}`,
      host,
      ignoredPaths: [/ignored-page\.html$/],
      ignoredContent: ['.sidebar'],
      ignoredTargets: new Set(['__should-be-ignored']),
      knownTargets: new Map([['/external-page.html', new Set(['#valid-target'])]]),
      knownTargetsDownloadUrl: [`${host}/known-targets.json`],
      seedUrls: ['/', '/orphaned-page.html'],
      // Test ignores with new array syntax and various property combinations
      ignores: [
        // Backward compatible: single values still work
        { path: '/broken-links.html', href: '/does-not-exist.html' },
        // Test array syntax: multiple hrefs in one rule (OR logic within property)
        { path: '/broken-links.html', href: [/another-missing/, '../broken-relative-html.html'] },
        // Test contentType: ignore broken links from markdown files
        { contentType: 'text/markdown', href: '/broken-from-markdown.html' },
        // Test href-only rule (matches from any page) - note: matches the actual href value
        { href: 'broken-relative.html' },
      ],
    });

    expect(result.links).toHaveLength(66);
    // Issue count: original 11, minus ignored ones (broken-from-markdown via contentType,
    // broken-relative via href-only rule)
    expect(result.issues).toHaveLength(9);

    // Test ignores: these broken links should be ignored (not in issues)
    expectNotIssue(result.issues, {
      type: 'broken-link',
      link: {
        src: '/broken-links.html',
        href: '/does-not-exist.html',
      },
    });

    expectNotIssue(result.issues, {
      type: 'broken-link',
      link: {
        src: '/broken-links.html',
        href: '/another-missing-page.html',
      },
    });

    // Check broken-target type issues
    expectIssue(result.issues, {
      type: 'broken-target',
      link: {
        src: '/broken-targets.html',
        href: '/with-anchors.html#nonexistent',
        text: 'Non-existent anchor',
      },
    });

    expectIssue(result.issues, {
      type: 'broken-target',
      link: {
        src: '/broken-targets.html',
        href: '/valid.html#missing-target',
        text: 'Valid page, missing target',
      },
    });

    expectIssue(result.issues, {
      type: 'broken-target',
      link: {
        src: '/broken-targets.html',
        href: '/with-anchors.html#also-missing',
        text: 'Also missing',
      },
    });

    // Verify that valid links are not reported
    expectNotIssue(result.issues, { link: { href: '/' } });
    expectNotIssue(result.issues, { link: { href: '/valid.html' } });
    expectNotIssue(result.issues, { link: { href: '/with-anchors.html' } });
    expectNotIssue(result.issues, { link: { href: '/with-anchors.html#section1' } });
    expectNotIssue(result.issues, { link: { href: '/with-anchors.html#section2' } });
    expectNotIssue(result.issues, { link: { href: '/with-anchors.html#section3' } });
    expectNotIssue(result.issues, { link: { href: '/nested/page.html' } });

    // Verify that external links are not reported
    expectNotIssue(result.issues, { link: { href: 'https://example.com' } });
    expectNotIssue(result.issues, { link: { href: 'https://github.com/mui' } });

    // Test ignoredPaths: ignored-page.html should not be crawled
    expectNotIssue(result.issues, { link: { src: '/ignored-page.html' } });
    expectNotIssue(result.issues, { link: { href: '/this-link-should-not-be-checked.html' } });

    // Test ignoredContent: links in .sidebar should be ignored
    expectNotIssue(result.issues, { link: { href: '/sidebar-broken-link.html' } });

    // Test ignoredTargets: IDs that shouldn't be tracked as valid link destinations
    // (e.g., framework-specific IDs like '__next'). Links to these should be reported as broken.
    expectIssue(result.issues, {
      type: 'broken-target',
      link: {
        src: '/page-with-custom-targets.html',
        href: '#__should-be-ignored',
        text: 'Link to ignored ID',
      },
    });

    // Test that non-ignored custom target is valid
    expectNotIssue(result.issues, { link: { href: '/page-with-custom-targets.html#custom-id' } });

    // Test knownTargets: valid-target is known and should not cause issues
    expectNotIssue(result.issues, { link: { href: '/external-page.html#valid-target' } });

    // Test knownTargets: invalid-target is not in knownTargets and should cause an issue
    expectIssue(result.issues, {
      type: 'broken-target',
      link: {
        src: '/page-with-known-target-links.html',
        href: '/external-page.html#invalid-target',
        text: 'Invalid external target',
      },
    });

    // Test knownTargetsDownloadUrl: method1 and method2 are in downloaded known targets
    expectNotIssue(result.issues, { link: { href: '/api-page.html#method1' } });
    expectNotIssue(result.issues, { link: { href: '/api-page.html#method2' } });

    // Test knownTargetsDownloadUrl: unknown-method is not in downloaded known targets and should cause an issue
    expectIssue(result.issues, {
      type: 'broken-target',
      link: {
        src: '/page-with-api-links.html',
        href: '/api-page.html#unknown-method',
        text: 'Unknown API method',
      },
    });

    // Test seedUrls: orphaned-page.html should be crawled even though it's not linked from anywhere
    expect(result.pages.has('/orphaned-page.html')).toBe(true);

    // Test seedUrls: broken link from orphaned page should be detected
    expectIssue(result.issues, {
      type: 'broken-link',
      link: {
        src: '/orphaned-page.html',
        href: '/orphaned-broken-link.html',
        text: 'Broken link from orphaned page',
      },
    });

    // Test trailing slash normalization: /valid.html and /valid.html/ should be treated as the same page
    // The orphaned page has both links, but they should not cause duplicate page crawls
    expectNotIssue(result.issues, { link: { href: '/valid.html/' } });

    // Test contentType ignores: broken link from markdown should be ignored via contentType rule
    expectNotIssue(result.issues, {
      type: 'broken-link',
      link: {
        src: '/example.md',
        href: '/broken-from-markdown.html',
      },
    });

    // Valid links from markdown should not cause issues
    expectNotIssue(result.issues, { link: { href: '/valid.html', src: '/example.md' } });
    expectNotIssue(result.issues, {
      link: { href: '/with-anchors.html#section1', src: '/example.md' },
    });

    // Links inside code blocks should NOT be extracted (they're text, not <a> tags)
    expectNotIssue(result.issues, { link: { href: '/this-should-not-be-checked.html' } });

    // Markdown file itself should be crawlable without issues
    expectNotIssue(result.issues, { link: { href: '/example.md' } });

    // Test that markdown heading anchors are discovered (rehype-slug)
    expect(result.pages.get('/example.md')?.targets.has('#example-markdown-file')).toBe(true);
    expect(result.pages.get('/example.md')?.targets.has('#markdown-section')).toBe(true);

    // Test href-only ignores: broken-relative.html should be ignored from any page via href-only rule
    expectNotIssue(result.issues, {
      type: 'broken-link',
      link: {
        href: 'broken-relative.html',
      },
    });

    // Valid relative links from markdown should not cause issues
    expectNotIssue(result.issues, { link: { href: 'valid.html', src: '/example.md' } });
    expectNotIssue(result.issues, { link: { href: './with-anchors.html', src: '/example.md' } });

    // Test relative links in HTML
    // Also verifies that the ignore pattern { path: /^\/broken-links\.html$/, href: '../broken-relative-html.html' }
    // does NOT match this link since the path regex doesn't match /nested/page.html
    expectIssue(result.issues, {
      type: 'broken-link',
      link: {
        src: '/nested/page.html',
        href: '../broken-relative-html.html',
        text: 'Relative broken link from HTML',
      },
    });

    // Valid relative links from HTML should not cause issues
    expectNotIssue(result.issues, { link: { href: '../valid.html', src: '/nested/page.html' } });

    // Test unclosed tags: links inside unclosed <main> tags should still be detected
    // (regression test for node-html-parser parseNoneClosedTags option)
    expectIssue(result.issues, {
      type: 'broken-link',
      link: {
        src: '/unclosed-tags.html',
        href: '/broken-inside-unclosed-main.html',
        text: 'Broken link inside unclosed main',
      },
    });

    // Valid links inside unclosed tags should not cause issues
    expectNotIssue(result.issues, {
      link: { href: '/valid.html', src: '/unclosed-tags.html' },
    });

    // Test contentType is stored on pageData
    expect(result.pages.get('/example.md')?.contentType).toBe('text/markdown');
    expect(result.pages.get('/')?.contentType).toBe('text/html');
  }, 30000);
});

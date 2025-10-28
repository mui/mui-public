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
    });

    expect(result.links).toHaveLength(53);
    expect(result.issues).toHaveLength(8);

    // Check broken-link type issues
    expectIssue(result.issues, {
      type: 'broken-link',
      link: {
        src: '/broken-links.html',
        href: '/does-not-exist.html',
        text: 'This page does not exist',
      },
    });

    expectIssue(result.issues, {
      type: 'broken-link',
      link: {
        src: '/broken-links.html',
        href: '/another-missing-page.html',
        text: 'Another missing page',
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

    // Test ignoredTargets: __should-be-ignored target should not cause issues
    expectNotIssue(result.issues, {
      link: { href: '/page-with-custom-targets.html#__should-be-ignored' },
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
  }, 30000);
});

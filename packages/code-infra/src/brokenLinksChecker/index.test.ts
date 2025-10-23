import path from 'node:path';

import getPort from 'get-port';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line import/extensions
import { crawl, Issue } from './index.mjs';

/**
 * Helper to assert that an issue with matching properties exists in the issues array
 */
function expectIssue(issues: Issue[], expectedIssue: Partial<Issue>) {
  expect(issues).toEqual(expect.arrayContaining([expect.objectContaining(expectedIssue)]));
}

/**
 * Helper to assert that no issue with matching properties exists in the issues array
 */
function expectNotIssue(issues: Issue[], notExpectedIssue: Partial<Issue>) {
  expect(issues).not.toEqual(expect.arrayContaining([expect.objectContaining(notExpectedIssue)]));
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
    });

    // Total: 2 broken-link + 5 broken-target = 7 issues
    expect(result.issues).toHaveLength(7);

    // Check broken-link type issues
    expectIssue(result.issues, {
      type: 'broken-link',
      sourceUrl: '/broken-links.html',
      targetUrl: '/does-not-exist.html',
      sourceName: 'This page does not exist',
    });

    expectIssue(result.issues, {
      type: 'broken-link',
      sourceUrl: '/broken-links.html',
      targetUrl: '/another-missing-page.html',
      sourceName: 'Another missing page',
    });

    // Check broken-target type issues
    expectIssue(result.issues, {
      type: 'broken-target',
      sourceUrl: '/broken-targets.html',
      targetUrl: '/with-anchors.html#nonexistent',
      sourceName: 'Non-existent anchor',
    });

    expectIssue(result.issues, {
      type: 'broken-target',
      sourceUrl: '/broken-targets.html',
      targetUrl: '/valid.html#missing-target',
      sourceName: 'Valid page, missing target',
    });

    expectIssue(result.issues, {
      type: 'broken-target',
      sourceUrl: '/broken-targets.html',
      targetUrl: '/with-anchors.html#also-missing',
      sourceName: 'Also missing',
    });

    // Verify that valid links are not reported
    expectNotIssue(result.issues, { targetUrl: '/' });
    expectNotIssue(result.issues, { targetUrl: '/valid.html' });
    expectNotIssue(result.issues, { targetUrl: '/with-anchors.html' });
    expectNotIssue(result.issues, { targetUrl: '/with-anchors.html#section1' });
    expectNotIssue(result.issues, { targetUrl: '/with-anchors.html#section2' });
    expectNotIssue(result.issues, { targetUrl: '/with-anchors.html#section3' });
    expectNotIssue(result.issues, { targetUrl: '/nested/page.html' });

    // Verify that external links are not reported
    expectNotIssue(result.issues, { targetUrl: 'https://example.com' });
    expectNotIssue(result.issues, { targetUrl: 'https://github.com/mui' });

    // Test ignoredPaths: ignored-page.html should not be crawled
    expectNotIssue(result.issues, { sourceUrl: '/ignored-page.html' });
    expectNotIssue(result.issues, { targetUrl: '/this-link-should-not-be-checked.html' });

    // Test ignoredContent: links in .sidebar should be ignored
    expectNotIssue(result.issues, { targetUrl: '/sidebar-broken-link.html' });

    // Test ignoredTargets: __should-be-ignored target should not cause issues
    expectNotIssue(result.issues, {
      targetUrl: '/page-with-custom-targets.html#__should-be-ignored',
    });

    // Test that non-ignored custom target is valid
    expectNotIssue(result.issues, { targetUrl: '/page-with-custom-targets.html#custom-id' });

    // Test knownTargets: valid-target is known and should not cause issues
    expectNotIssue(result.issues, { targetUrl: '/external-page.html#valid-target' });

    // Test knownTargets: invalid-target is not in knownTargets and should cause an issue
    expectIssue(result.issues, {
      type: 'broken-target',
      sourceUrl: '/page-with-known-target-links.html',
      targetUrl: '/external-page.html#invalid-target',
      sourceName: 'Invalid external target',
    });

    // Test knownTargetsDownloadUrl: method1 and method2 are in downloaded known targets
    expectNotIssue(result.issues, { targetUrl: '/api-page.html#method1' });
    expectNotIssue(result.issues, { targetUrl: '/api-page.html#method2' });

    // Test knownTargetsDownloadUrl: unknown-method is not in downloaded known targets and should cause an issue
    expectIssue(result.issues, {
      type: 'broken-target',
      sourceUrl: '/page-with-api-links.html',
      targetUrl: '/api-page.html#unknown-method',
      sourceName: 'Unknown API method',
    });
  }, 30000);
});

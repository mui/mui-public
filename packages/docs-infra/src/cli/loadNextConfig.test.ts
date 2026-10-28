import { describe, it, expect } from 'vitest';
import type { NextConfig } from 'next';
import { withDocsInfra } from '../withDocsInfra/withDocsInfra';
import {
  extractDemoPageRequirementsFromTurbopack,
  extractDemoPageRequirementsFromWebpackResult,
  extractOptionsFromTurbopack,
} from './loadNextConfig';

type WebpackConfigContext = Parameters<NonNullable<NextConfig['webpack']>>[1];

const mockWebpackOptions = {
  buildId: 'test-build',
  dev: false,
  isServer: false,
  config: {},
  defaultLoaders: {
    babel: {
      test: /\.(js|jsx|ts|tsx)$/,
      use: 'babel-loader',
    },
  },
  dir: '/tmp',
  totalPages: 10,
} as unknown as WebpackConfigContext;

describe('extractDemoPageRequirementsFromTurbopack', () => {
  it('collects the demo index pattern when requireDemoPage is set', () => {
    const config = withDocsInfra({ requireDemoPage: true })({});
    const patterns = extractDemoPageRequirementsFromTurbopack(config).map((entry) => entry.pattern);

    expect(patterns).toContain('./app/**/demos/*/index.ts');
    // The demo-data rule shares the loader but does not opt into page generation.
    expect(patterns).not.toContain('./demo-data/*/index.ts');
  });

  it('includes additional demo index patterns', () => {
    const config = withDocsInfra({
      requireDemoPage: true,
      additionalDemoPatterns: { index: ['./app/**/demos/*/demo-*/index.ts'] },
    })({});
    const patterns = extractDemoPageRequirementsFromTurbopack(config).map((entry) => entry.pattern);

    expect(patterns).toContain('./app/**/demos/*/index.ts');
    expect(patterns).toContain('./app/**/demos/*/demo-*/index.ts');
  });

  it('returns nothing when requireDemoPage is not set', () => {
    const config = withDocsInfra()({});
    expect(extractDemoPageRequirementsFromTurbopack(config)).toEqual([]);
  });
});

describe('extractDemoPageRequirementsFromWebpackResult', () => {
  it('collects the demo index test regex when requireDemoPage is set', () => {
    const config = withDocsInfra({ requireDemoPage: true })({});
    const result = config.webpack!({ module: { rules: [] } }, mockWebpackOptions);
    const requirements = extractDemoPageRequirementsFromWebpackResult(result);

    expect(requirements.length).toBeGreaterThan(0);
    // Some requirement matches a demo index.ts path...
    const matchesDemo = requirements.some((entry) =>
      (entry.pattern as RegExp).test('/repo/app/x/demos/button/index.ts'),
    );
    expect(matchesDemo).toBe(true);
    // ...but none matches a demo-data index.ts path.
    const matchesData = requirements.some((entry) =>
      (entry.pattern as RegExp).test('/repo/demo-data/button/index.ts'),
    );
    expect(matchesData).toBe(false);
  });

  it('returns nothing when requireDemoPage is not set', () => {
    const config = withDocsInfra()({});
    const result = config.webpack!({ module: { rules: [] } }, mockWebpackOptions);
    expect(extractDemoPageRequirementsFromWebpackResult(result)).toEqual([]);
  });
});

describe('extractOptionsFromTurbopack', () => {
  it('reads cacheDir from the sitemap loader options', () => {
    const config = withDocsInfra({ cacheDir: '/custom/cache' })({});
    expect(extractOptionsFromTurbopack(config).cacheDir).toBe('/custom/cache');
  });

  it('defaults cacheDir to .next/cache/docs-infra', () => {
    const config = withDocsInfra()({});
    expect(extractOptionsFromTurbopack(config).cacheDir).toBe('.next/cache/docs-infra');
  });
});

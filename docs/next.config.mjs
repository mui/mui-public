import createMDX from '@next/mdx';
import { withDocsInfra, getDocsInfraMdxOptions } from '@mui/internal-docs-infra/withDocsInfra';
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// Create MDX with docs-infra configuration
const withMDX = createMDX({
  options: getDocsInfraMdxOptions({
    additionalRemarkPlugins: [],
    additionalRehypePlugins: [],
    extractToIndex: {
      indexWrapperComponent: 'PagesIndex',
      include: [
        'app/docs-infra/components',
        'app/docs-infra/hooks',
        'app/docs-infra/commands',
        'app/docs-infra/factories',
        'app/docs-infra/patterns',
        'app/docs-infra/pipeline',
        'app/docs-infra/conventions',
        'app/code-infra',
      ],
    },
  }),
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Your custom configuration here
  // The withDocsInfra plugin will add the necessary docs infrastructure setup
  distDir: 'export',
  devIndicators: {
    position: 'bottom-right',
  },
  images: { unoptimized: true },
};

export default withBundleAnalyzer(
  withDocsInfra({
    // Add demo-* patterns specific to this docs site
    additionalDemoPatterns: {
      // Note: The demo-* pattern below is specific to our internal docs structure
      // where we create "demos of demos". This is not a typical use case.
      index: ['./app/**/demos/*/demo-*/index.ts'],
      client: ['./app/**/demos/*/demo-*/client.ts'],
    },
  })(withMDX(nextConfig)),
);

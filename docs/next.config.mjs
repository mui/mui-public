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
  }),
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Your custom configuration here
  // The withDocsInfra plugin will add the necessary docs infrastructure setup
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

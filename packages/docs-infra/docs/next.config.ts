import type { NextConfig } from 'next';
import createMDX from '@next/mdx';

const nextConfig: NextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  output: 'export',
};

const withMDX = createMDX({
  options: {
    remarkPlugins: [['remark-gfm'], ['@mui/internal-docs-infra/remarkRelativeUrls/esm']],
    rehypePlugins: [],
  },
});

export default withMDX(nextConfig);

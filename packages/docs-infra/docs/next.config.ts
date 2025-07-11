import type { NextConfig } from 'next';
import createMDX from '@next/mdx';

const nextConfig: NextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  output: 'export',
  experimental: {
    mdxRs: {
      // https://nextjs.org/docs/app/guides/mdx#using-the-rust-based-mdx-compiler-experimental
      mdxType: 'gfm',
    },
  },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);

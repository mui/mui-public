import createMDX from '@next/mdx';

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  output: 'export',
  turbopack: {
    rules: {
      './app/**/demos/*/index.ts': {
        as: '*.ts',
        loaders: ['@mui/internal-docs-infra/loadPrecomputedCodeHighlighter'],
      },
      // Note: The demo-* pattern below is specific to our internal docs structure
      // where we create "demos of demos". This is not a typical use case.
      './app/**/demos/*/demo-*/index.ts': {
        as: '*.ts',
        loaders: ['@mui/internal-docs-infra/loadPrecomputedCodeHighlighter'],
      },
    },
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: [
      ['remark-gfm'],
      ['@mui/internal-docs-infra/transformRelativeMarkdownPaths'],
      ['@mui/internal-docs-infra/transformMarkdownBlockquoteCallouts'],
    ],
    rehypePlugins: [['@mui/internal-docs-infra/transformHtmlCode']],
  },
});

export default withMDX(nextConfig);

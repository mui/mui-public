import createMDX from '@next/mdx';

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  output: 'export',
  turbopack: {
    rules: {
      './app/**/demos/*/index.ts': {
        as: '*.ts',
        loaders: ['@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter'],
      },
      // Note: The demo-* pattern below is specific to our internal docs structure
      // where we create "demos of demos". This is not a typical use case.
      './app/**/demos/*/demo-*/index.ts': {
        as: '*.ts',
        loaders: ['@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter'],
      },
    },
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: [
      ['remark-gfm'],
      ['@mui/internal-docs-infra/pipeline/transformMarkdownRelativePaths'],
      ['@mui/internal-docs-infra/pipeline/transformMarkdownBlockquoteCallouts'],
      ['@mui/internal-docs-infra/pipeline/transformMarkdownCode'],
    ],
    rehypePlugins: [['@mui/internal-docs-infra/pipeline/transformHtmlCode']],
  },
});

export default withMDX(nextConfig);

import { createRemarkConfig } from '@mui/internal-code-infra/remark';

export default createRemarkConfig({
  // Preserve existing link-reference metadata markers read by the docs generators.
  allowDefinitionComments: true,
  overrides: [
    {
      // These APIs export both a function and a callable type with case-distinct names
      // (loadServerPageIndex / LoadServerPageIndex, loadServerSitemap / LoadServerSitemap).
      // The generated headings preserve those names for the types Markdown parser.
      files: [
        'docs/app/docs-infra/pipeline/load-server-page-index/types.md',
        'docs/app/docs-infra/pipeline/load-server-sitemap/types.md',
      ],
      rules: { 'no-duplicate-headings': false },
    },
    {
      // Shared fragments render inside pages that supply their own top-level heading.
      files: 'docs/app/_partials/**/*.mdx',
      rules: { 'mui-first-block-heading': false },
    },
  ],
});

import { createRemarkConfig } from '@mui/internal-code-infra/remark';

export default createRemarkConfig({
  overrides: [
    {
      files: 'docs/app/docs-infra/pipeline/*/types.md',
      rules: { 'no-duplicate-headings': false },
    },
    {
      // TODO @dav-is: replace `[//]: # 'comment'` idiom with `<!-- comment -->`
      // and drop these overrides.
      files: 'docs/app/docs-infra/**',
      rules: { 'no-empty-url': false, 'no-unused-definitions': false },
    },
    {
      // Include partials (re-export wrappers, banners) intentionally have no
      // h1.
      files: ['docs/app/notice.mdx', 'docs/app/**/bench/page.mdx'],
      rules: { 'mui-first-block-heading': false, 'first-heading-level': false },
    },
  ],
});

import { createRemarkConfig } from '@mui/internal-code-infra/remark';

export default createRemarkConfig({
  overrides: [
    {
      // TODO @dav-is: Fix duplicate headings in the types.md generation output and drop this override.
      files: 'docs/app/docs-infra/pipeline/*/types.md',
      rules: { 'no-duplicate-headings': false },
    },
    {
      // TODO @dav-is: replace `[//]: # 'comment'` idiom with `<!-- comment -->` and drop these overrides.
      files: 'docs/app/docs-infra/**',
      rules: { 'no-empty-url': false, 'no-unused-definitions': false },
    },
    {
      // Include partials (re-export wrappers, banners) intentionally have no h1.
      // TODO: can we find better pattern for this that doesn't require either disabling
      // for each individual files or a very wide pattern.
      // QUESTION @dav-is:
      // * Can't we support just page.tsx files for the re-export of bench/page.mdx? It doesn't do anything
      //   that requires it to be page.mdx, and it would allow us to drop this override.
      // * Can we designate a single subfolder for partials that we can exclude from the heading rules,
      //   and move all the partials there?
      files: ['docs/app/notice.mdx', 'docs/app/**/bench/page.mdx'],
      rules: { 'mui-first-block-heading': false },
    },
  ],
});

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
  ],
});

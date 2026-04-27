import { createRemarkConfig } from '@mui/internal-code-infra/remark';

export default createRemarkConfig({
  overrides: [
    {
      files: 'docs/app/docs-infra/pipeline/*/types.md',
      rules: { 'no-duplicate-headings': false },
    },
  ],
});

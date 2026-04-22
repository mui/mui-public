import { createRemarkConfig } from '@mui/internal-code-infra/remark';

// TODO @dav-is: re-enable and fix violations under docs/app/docs-infra.
export default createRemarkConfig({
  disable: ['no-heading-punctuation', 'no-duplicate-headings'],
});

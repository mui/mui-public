import { createRemarkConfig } from '@mui/internal-code-infra/remark';

export default createRemarkConfig({
  // TODO @dav-is: re-enable and fix violations under docs/app/docs-infra.
  disable: ['no-duplicate-headings'],
});

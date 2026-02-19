import { createTypes } from '@/functions/createTypes';
import enhanceCodeExportLinks from '@mui/internal-docs-infra/pipeline/enhanceCodeExportLinks';

export const TypesEnhanceCodeExportLinks = createTypes(import.meta.url, enhanceCodeExportLinks);

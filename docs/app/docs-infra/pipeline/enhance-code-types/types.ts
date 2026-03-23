import { createTypes } from '@/functions/createTypes';
import enhanceCodeTypes from '@mui/internal-docs-infra/pipeline/enhanceCodeTypes';

export const TypesEnhanceCodeTypes = createTypes(import.meta.url, enhanceCodeTypes);

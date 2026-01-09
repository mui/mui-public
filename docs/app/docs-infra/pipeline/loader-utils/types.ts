import { createTypes } from '@/functions/createTypes';
import * as loaderUtils from '@mui/internal-docs-infra/pipeline/loaderUtils';

export const TypesLoaderUtils = createTypes(import.meta.url, loaderUtils);

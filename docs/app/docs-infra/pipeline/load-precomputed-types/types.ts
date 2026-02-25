import { createTypes } from '@/functions/createTypes';
import loadPrecomputedTypes from '@mui/internal-docs-infra/pipeline/loadPrecomputedTypes';

export const TypesLoadPrecomputedTypes = createTypes(import.meta.url, loadPrecomputedTypes);

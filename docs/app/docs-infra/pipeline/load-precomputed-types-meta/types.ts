import { createTypes } from '@/functions/createTypes';
import loadPrecomputedTypesMeta from '@mui/internal-docs-infra/pipeline/loadPrecomputedTypesMeta';

export const TypesLoadPrecomputedTypesMeta = createTypes(import.meta.url, loadPrecomputedTypesMeta);

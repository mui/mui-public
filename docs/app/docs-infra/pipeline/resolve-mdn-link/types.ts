import { createTypes } from '@/functions/createTypes';
import { resolveMdnLink } from '@mui/internal-docs-infra/pipeline/resolveMdnLink';

export const TypesResolveMdnLink = createTypes(import.meta.url, resolveMdnLink);

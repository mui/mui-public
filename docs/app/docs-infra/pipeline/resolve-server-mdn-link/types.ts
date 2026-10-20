import { createTypes } from '@/functions/createTypes';
import { resolveServerMdnLink } from '@mui/internal-docs-infra/pipeline/resolveServerMdnLink';

export const TypesResolveServerMdnLink = createTypes(import.meta.url, resolveServerMdnLink);

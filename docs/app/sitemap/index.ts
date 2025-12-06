import { createSitemap } from '@mui/internal-docs-infra/createSitemap';
import DocsInfraComponents from '../docs-infra/components/page.mdx';
import DocsInfraPatterns from '../docs-infra/patterns/page.mdx';
import DocsInfraFunctions from '../docs-infra/functions/page.mdx';
import DocsInfraHooks from '../docs-infra/hooks/page.mdx';
import DocsInfraConventions from '../docs-infra/conventions/page.mdx';

export const sitemap = createSitemap(import.meta.url, {
  DocsInfraComponents,
  DocsInfraPatterns,
  DocsInfraFunctions,
  DocsInfraHooks,
  DocsInfraConventions,
});

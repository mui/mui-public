import { createSitemap } from '@mui/internal-docs-infra/createSitemap';
import DocsInfraComponents from '../docs-infra/components/page.mdx';
import DocsInfraPatterns from '../docs-infra/patterns/page.mdx';
import DocsInfraHooks from '../docs-infra/hooks/page.mdx';
import DocsInfraPipeline from '../docs-infra/pipeline/page.mdx';
import DocsInfraFactories from '../docs-infra/factories/page.mdx';
import DocsInfraCommands from '../docs-infra/commands/page.mdx';
import DocsInfraConventions from '../docs-infra/conventions/page.mdx';

export const sitemap = createSitemap(import.meta.url, {
  DocsInfraComponents,
  DocsInfraPatterns,
  DocsInfraHooks,
  DocsInfraPipeline,
  DocsInfraFactories,
  DocsInfraCommands,
  DocsInfraConventions,
});

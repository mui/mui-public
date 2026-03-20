import { createSitemap } from '@mui/internal-docs-infra/createSitemap';
import DocsInfraGuides from '../docs-infra/guides/page.mdx';
import DocsInfraComponents from '../docs-infra/components/page.mdx';
import DocsInfraHooks from '../docs-infra/hooks/page.mdx';
import DocsInfraCommands from '../docs-infra/commands/page.mdx';
import DocsInfraFactories from '../docs-infra/factories/page.mdx';
import DocsInfraPatterns from '../docs-infra/patterns/page.mdx';
import DocsInfraPipeline from '../docs-infra/pipeline/page.mdx';
import DocsInfraConventions from '../docs-infra/conventions/page.mdx';

export const sitemap = createSitemap(import.meta.url, {
  DocsInfraGuides,
  DocsInfraComponents,
  DocsInfraHooks,
  DocsInfraCommands,
  DocsInfraFactories,
  DocsInfraPatterns,
  DocsInfraPipeline,
  DocsInfraConventions,
});

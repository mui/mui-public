import { getOctokit } from '@/lib/github';
import { repositories } from '@/constants';
import type { ReportOptions, ReportResult } from './types';

export const DEPLOY_PREVIEW_SECTION_TITLE = 'Deploy preview';

const MAX_DOC_LINKS = 5;

export async function generateDeployPreviewReport(
  options: ReportOptions,
): Promise<ReportResult | null> {
  const { repo, prNumber } = options;

  const rawConfig = repositories.get(repo)?.prComment?.netlifyDocs;

  if (!rawConfig) {
    return null;
  }

  const repoName = repo.split('/')[1];
  const siteId = (typeof rawConfig === 'object' && rawConfig.siteId) || repoName;
  const formatDocPath = typeof rawConfig === 'object' ? rawConfig.formatDocPath : undefined;

  const previewUrl = `https://deploy-preview-${prNumber}--${siteId}.netlify.app/`;

  if (!formatDocPath) {
    return { content: `## ${DEPLOY_PREVIEW_SECTION_TITLE}\n\n${previewUrl}` };
  }

  const [owner, repoSegment] = repo.split('/');
  const octokit = getOctokit();

  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo: repoSegment,
    pull_number: prNumber,
    per_page: 100,
  });

  const docLinks: { filePath: string; url: string }[] = [];
  for (const file of files) {
    if (file.status === 'removed') {
      continue;
    }
    const docPath = formatDocPath(file.filename);
    if (docPath) {
      docLinks.push({ filePath: file.filename, url: `${previewUrl}${docPath}` });
      if (docLinks.length >= MAX_DOC_LINKS) {
        break;
      }
    }
  }

  let markdown = `## ${DEPLOY_PREVIEW_SECTION_TITLE}\n\n`;

  if (docLinks.length > 0) {
    markdown += docLinks.map((link) => `- [${link.filePath}](${link.url})`).join('\n');
  } else {
    markdown += previewUrl;
  }

  return { content: markdown };
}

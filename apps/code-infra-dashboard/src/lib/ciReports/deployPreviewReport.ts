import { getOctokit } from '@/lib/github';
import { repositories } from '@/constants';

export const DEPLOY_PREVIEW_SECTION_TITLE = 'Deploy preview';

const MAX_DOC_LINKS = 5;

interface DeployPreviewReportOptions {
  repo: string;
  prNumber: number;
}

export async function generateDeployPreviewReport(
  options: DeployPreviewReportOptions,
): Promise<{ content: string } | null> {
  const { repo, prNumber } = options;

  const config = repositories.get(repo)?.prComment?.netlifyDocs;
  if (!config) {
    return null;
  }

  const previewUrl = `https://deploy-preview-${prNumber}--${config.siteId}.netlify.app/`;

  const [owner, repoName] = repo.split('/');
  const octokit = getOctokit();

  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo: repoName,
    pull_number: prNumber,
    per_page: 100,
  });

  const docLinks: { filePath: string; url: string }[] = [];
  for (const file of files) {
    if (file.status === 'removed') {
      continue;
    }
    const docPath = config.formatDocPath(file.filename);
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

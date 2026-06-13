import { getOctokit } from '@/lib/github';
import { repositories } from '@/constants';
import { signQrCodeUrl } from '@/lib/qrCode';
import { escapeHtml } from '@/utils/dom';
import type { ReportOptions, ReportResult } from './types';

export const DEPLOY_PREVIEW_SECTION_TITLE = 'Deploy preview';

const MAX_DOC_LINKS = 5;

/**
 * Formats a link with a collapsible QR code for opening it on a phone.
 * Falls back to a plain markdown link when no signing key is configured.
 * Single-line HTML so it renders correctly inside markdown list items.
 */
function formatLinkWithQr(label: string, url: string): string {
  const qrCodeUrl = signQrCodeUrl(url);
  if (!qrCodeUrl) {
    return `[${label}](${url})`;
  }
  const safeLabel = escapeHtml(label);
  return `<details><summary><a href="${escapeHtml(url)}">${safeLabel}</a></summary><img src="${escapeHtml(qrCodeUrl)}" width="150" alt="QR code for ${safeLabel}"></details>`;
}

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
    return {
      content: `## ${DEPLOY_PREVIEW_SECTION_TITLE}\n\n${formatLinkWithQr(previewUrl, previewUrl)}`,
    };
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
      docLinks.push({ filePath: file.filename, url: new URL(docPath, previewUrl).toString() });
      if (docLinks.length >= MAX_DOC_LINKS) {
        break;
      }
    }
  }

  let markdown = `## ${DEPLOY_PREVIEW_SECTION_TITLE}\n\n`;

  if (docLinks.length > 0) {
    markdown += docLinks.map((link) => `- ${formatLinkWithQr(link.filePath, link.url)}`).join('\n');
  } else {
    markdown += formatLinkWithQr(previewUrl, previewUrl);
  }

  return { content: markdown };
}

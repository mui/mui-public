import { getOctokit } from '@/lib/github';
import { repositories } from '@/constants';
import { signQrCodeUrl } from '@/lib/qrCode';
import { escapeHtml } from '@/utils/dom';
import type { ReportOptions, ReportResult } from './types';

export const DEPLOY_PREVIEW_SECTION_TITLE = 'Deploy preview';

const MAX_DOC_FILES = 20;

/**
 * Formats a link with a collapsible QR code for opening it on a phone.
 * Falls back to a plain HTML link when no signing key is configured.
 * Single-line HTML so it renders correctly inside markdown list items.
 */
function formatLinkWithQr(label: string, url: string): string {
  const safeLabel = escapeHtml(label);
  const safeUrl = escapeHtml(url);
  const qrCodeUrl = signQrCodeUrl(url);
  if (!qrCodeUrl) {
    return `<a href="${safeUrl}">${safeLabel}</a>`;
  }
  return `<details><summary><a href="${safeUrl}">${safeLabel}</a></summary><br><img src="${escapeHtml(qrCodeUrl)}" width="150" alt="QR code for ${safeLabel}"></details>`;
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
  const docsPath = typeof rawConfig === 'object' ? rawConfig.docsPath : undefined;

  const previewUrl = `https://deploy-preview-${prNumber}--${siteId}.netlify.app/`;

  // The deploy-preview root is the only URL we can build reliably: a documentation
  // source path (e.g. docs/data/material/components/buttons/buttons.md) does not map
  // to its published URL (/material-ui/react-button) by any string rule, so we always
  // link the homepage and merely list the changed doc files as plain text.
  let markdown = `## ${DEPLOY_PREVIEW_SECTION_TITLE}\n\n${formatLinkWithQr(previewUrl, previewUrl)}`;

  if (!docsPath) {
    return { content: markdown };
  }

  const [owner, repoSegment] = repo.split('/');
  const octokit = getOctokit();

  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo: repoSegment,
    pull_number: prNumber,
    per_page: 100,
  });

  const changedDocs = files
    .filter((file) => file.status !== 'removed' && file.filename.startsWith(docsPath))
    .map((file) => file.filename);

  if (changedDocs.length > 0) {
    const shown = changedDocs.slice(0, MAX_DOC_FILES);
    markdown += `\n\nChanged docs:\n${shown.map((filePath) => `- ${escapeHtml(filePath)}`).join('\n')}`;
    if (changedDocs.length > shown.length) {
      markdown += `\n- …and ${changedDocs.length - shown.length} more`;
    }
  }

  return { content: markdown };
}

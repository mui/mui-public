import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getOctokit } from '@/lib/github';
import { verifyQrCodeSignature } from '@/lib/qrCode';
import { generateDeployPreviewReport } from './deployPreviewReport';
import type { ReportOptions } from './types';

vi.mock('@/lib/github', () => ({
  getOctokit: vi.fn(),
}));

const mockGetOctokit = vi.mocked(getOctokit);

const mockOctokit = {
  pulls: {
    listFiles: vi.fn(),
  },
};

function reportOptions(repo: string, prNumber: number): ReportOptions {
  return {
    repo,
    prNumber,
    commitSha: 'abc123',
    pr: { base: { sha: 'def456', ref: 'master' } },
    baseCandidates: ['def456'],
  };
}

describe('generateDeployPreviewReport', () => {
  beforeEach(() => {
    vi.stubEnv('QR_CODE_SECRET', 'test-secret');
    mockGetOctokit.mockReturnValue(mockOctokit as any);
    mockOctokit.pulls.listFiles.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('should return null for repos without netlify docs config', async () => {
    const report = await generateDeployPreviewReport(reportOptions('mui/base-ui', 1));

    expect(report).toBeNull();
  });

  it('should link the preview root with a QR code when no doc files changed', async () => {
    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    const previewUrl = 'https://deploy-preview-42--material-ui.netlify.app/';
    expect(report?.content).toContain('## Deploy preview');
    expect(report?.content).toContain(
      `<details><summary><a href="${previewUrl}">${previewUrl}</a></summary>`,
    );
  });

  it('should wrap each changed doc page in a collapsible QR code link', async () => {
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [
        { filename: 'docs/data/material/components/buttons/buttons.md', status: 'modified' },
        { filename: 'packages/mui-material/src/Button/Button.tsx', status: 'modified' },
      ],
    });

    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    const pageUrl =
      'https://deploy-preview-42--material-ui.netlify.app/material-ui/components/buttons';
    expect(report?.content).toContain(
      `- <details><summary><a href="${pageUrl}">docs/data/material/components/buttons/buttons.md</a></summary>`,
    );
    expect(report?.content).not.toContain('Button.tsx');
  });

  it('should embed a verifiable signed QR code URL', async () => {
    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    const imgSrc = report?.content.match(/<img src="([^"]+)"/)?.[1];
    expect(imgSrc).toBeTruthy();
    // The src is HTML-escaped in the markup; a browser decodes &amp; before fetching.
    const qrCodeUrl = new URL(imgSrc!.replace(/&amp;/g, '&'));
    expect(qrCodeUrl.pathname).toBe('/api/qr-code');
    const url = qrCodeUrl.searchParams.get('url')!;
    const signature = qrCodeUrl.searchParams.get('sig')!;
    expect(url).toBe('https://deploy-preview-42--material-ui.netlify.app/');
    expect(verifyQrCodeSignature(url, signature)).toBe(true);
  });

  it('should skip removed files', async () => {
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'docs/data/material/components/buttons/buttons.md', status: 'removed' }],
    });

    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    expect(report?.content).not.toContain('buttons.md');
  });

  it('should cap the number of doc links', async () => {
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: Array.from({ length: 10 }, (unused, index) => ({
        filename: `docs/data/material/components/page-${index}/page-${index}.md`,
        status: 'modified',
      })),
    });

    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    expect(report?.content.match(/<details>/g)).toHaveLength(5);
  });

  it('should escape HTML-special characters in the file path', async () => {
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'docs/data/material/components/a<b>&"c/page.md', status: 'modified' }],
    });

    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    expect(report?.content).toContain('a&lt;b&gt;&amp;&quot;c');
    expect(report?.content).not.toContain('a<b>');
  });

  it('should fall back to plain links when no signing key is configured', async () => {
    vi.stubEnv('QR_CODE_SECRET', '');
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'docs/data/material/components/buttons/buttons.md', status: 'modified' }],
    });

    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    expect(report?.content).toContain(
      '- <a href="https://deploy-preview-42--material-ui.netlify.app/material-ui/components/buttons">docs/data/material/components/buttons/buttons.md</a>',
    );
    expect(report?.content).not.toContain('<details>');
  });
});

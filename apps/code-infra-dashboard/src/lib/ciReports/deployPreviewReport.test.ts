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

  it('should always link the preview homepage with a QR code', async () => {
    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    const previewUrl = 'https://deploy-preview-42--material-ui.netlify.app/';
    expect(report?.content).toContain('## Deploy preview');
    expect(report?.content).toContain(
      `<details><summary><a href="${previewUrl}">${previewUrl}</a></summary>`,
    );
  });

  it('should still show the homepage link when doc files changed', async () => {
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'docs/data/material/components/buttons/buttons.md', status: 'modified' }],
    });

    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    const previewUrl = 'https://deploy-preview-42--material-ui.netlify.app/';
    expect(report?.content).toContain(`<a href="${previewUrl}">${previewUrl}</a>`);
  });

  it('should list changed doc files as plain text, not links', async () => {
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [
        { filename: 'docs/data/about/teamMembers.json', status: 'modified' },
        { filename: 'docs/data/material/components/buttons/BasicButtons.tsx', status: 'modified' },
        { filename: 'packages/mui-material/src/Button/Button.tsx', status: 'modified' },
      ],
    });

    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    expect(report?.content).toContain('Changed docs:');
    // Listed as plain text (a leading "- " with no anchor), never a per-page link.
    expect(report?.content).toContain('- docs/data/about/teamMembers.json');
    expect(report?.content).toContain('- docs/data/material/components/buttons/BasicButtons.tsx');
    // Non-doc source files are not listed.
    expect(report?.content).not.toContain('packages/mui-material');
    // The only anchor to the preview site is the homepage root link.
    const anchors = report?.content.match(/<a href="(https:\/\/deploy-preview-42[^"]*)"/g) ?? [];
    expect(anchors).toEqual(['<a href="https://deploy-preview-42--material-ui.netlify.app/"']);
  });

  it('should skip removed doc files', async () => {
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'docs/data/material/components/buttons/buttons.md', status: 'removed' }],
    });

    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    expect(report?.content).not.toContain('buttons.md');
    expect(report?.content).not.toContain('Changed docs:');
  });

  it('should cap the number of listed doc files and note the remainder', async () => {
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: Array.from({ length: 25 }, (unused, index) => ({
        filename: `docs/data/material/components/page-${index}/page-${index}.md`,
        status: 'modified',
      })),
    });

    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    expect(report?.content.match(/- docs\/data\//g)).toHaveLength(20);
    expect(report?.content).toContain('…and 5 more');
  });

  it('should escape HTML-special characters in the file path', async () => {
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'docs/data/material/components/a<b>&"c/page.md', status: 'modified' }],
    });

    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    expect(report?.content).toContain('a&lt;b&gt;&amp;&quot;c');
    expect(report?.content).not.toContain('a<b>');
  });

  it('should list docs-infra changes for mui-public', async () => {
    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [
        { filename: 'docs/app/docs-infra/pipeline/load-code/page.mdx', status: 'modified' },
        { filename: 'docs/app/other/page.mdx', status: 'modified' },
      ],
    });

    const report = await generateDeployPreviewReport(reportOptions('mui/mui-public', 42));

    expect(report?.content).toContain(
      '<a href="https://deploy-preview-42--mui-internal.netlify.app/">',
    );
    expect(report?.content).toContain('- docs/app/docs-infra/pipeline/load-code/page.mdx');
    expect(report?.content).not.toContain('docs/app/other');
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

  it('should fall back to a plain homepage link when no signing key is configured', async () => {
    vi.stubEnv('QR_CODE_SECRET', '');

    const report = await generateDeployPreviewReport(reportOptions('mui/material-ui', 42));

    expect(report?.content).toContain(
      '<a href="https://deploy-preview-42--material-ui.netlify.app/">https://deploy-preview-42--material-ui.netlify.app/</a>',
    );
    expect(report?.content).not.toContain('<details>');
  });
});

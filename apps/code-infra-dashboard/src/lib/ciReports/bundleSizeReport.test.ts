import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/bundleSize/fetchSnapshot', () => ({
  fetchSnapshot: vi.fn(),
}));

vi.mock('@/lib/github', () => ({
  getOctokit: vi.fn(),
}));

vi.mock('@/constants', () => ({
  DASHBOARD_ORIGIN: 'https://frontend-public.mui.com',
}));

// eslint-disable-next-line import/first -- vi.mock calls must precede imports
import { fetchSnapshot } from '@/lib/bundleSize/fetchSnapshot';
// eslint-disable-next-line import/first
import { getOctokit } from '@/lib/github';
// eslint-disable-next-line import/first
import { generateBundleSizeReport, generatePendingBundleSizeReport } from './bundleSizeReport';

const mockFetchSnapshot = vi.mocked(fetchSnapshot);
const mockGetOctokit = vi.mocked(getOctokit);

function createMockOctokit(overrides: {
  compareCommits?: (args: unknown) => unknown;
  listCommits?: (args: unknown) => unknown;
}) {
  return {
    repos: {
      compareCommits: vi.fn(
        overrides.compareCommits ??
          (() => ({
            data: { merge_base_commit: { sha: 'mergebase123' } },
          })),
      ),
      listCommits: vi.fn(
        overrides.listCommits ??
          (() => ({
            data: [
              { sha: 'mergebase123' },
              { sha: 'parent1' },
              { sha: 'parent2' },
              { sha: 'parent3' },
            ],
          })),
      ),
    },
  };
}

const defaultPr = {
  base: { sha: 'abc123', ref: 'master' },
};

describe('generatePendingBundleSizeReport', () => {
  it('should return a pending report', () => {
    const result = generatePendingBundleSizeReport();
    expect(result).toContain('Processing...');
    expect(result).toContain('Bundle size report');
  });
});

describe('generateBundleSizeReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate a report with size increases', async () => {
    const octokit = createMockOctokit({});
    mockGetOctokit.mockReturnValue(octokit as never);

    mockFetchSnapshot
      .mockResolvedValueOnce({
        'Button/index.js': { parsed: 15000, gzip: 4500 },
      })
      .mockResolvedValueOnce({
        'Button/index.js': { parsed: 15400, gzip: 4600 },
      });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('🔺+400B');
    expect(result!.content).toContain('Bundle size report');
    expect(result!.content).toContain('Details of bundle changes');
    expect(result!.content).toContain('prNumber=42');
  });

  it('should return null when head snapshot is missing', async () => {
    const octokit = createMockOctokit({});
    mockGetOctokit.mockReturnValue(octokit as never);

    mockFetchSnapshot
      .mockResolvedValueOnce({
        'Button/index.js': { parsed: 15000, gzip: 4500 },
      })
      .mockRejectedValueOnce(new Error('not found'));

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
    });

    expect(result).toBeNull();
  });

  it('should show fallback message when using parent commit snapshot', async () => {
    const octokit = createMockOctokit({});
    mockGetOctokit.mockReturnValue(octokit as never);

    // First fetch (merge base) fails, then parent1 succeeds
    mockFetchSnapshot
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({
        'Button/index.js': { parsed: 15000, gzip: 4500 },
      })
      .mockResolvedValueOnce({
        'Button/index.js': { parsed: 15400, gzip: 4600 },
      });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('Using snapshot from parent commit');
    expect(result!.content).toContain('baseCommit=parent1');
  });

  it('should show missing snapshot message when all fallbacks fail', async () => {
    const octokit = createMockOctokit({});
    mockGetOctokit.mockReturnValue(octokit as never);

    // All base fetches fail, head succeeds
    mockFetchSnapshot.mockImplementation((_repo: string, commit: string) => {
      if (commit === 'def456') {
        return Promise.resolve({ 'Button/index.js': { parsed: 15000, gzip: 4500 } });
      }
      return Promise.reject(new Error('not found'));
    });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('No bundle size snapshot found');
  });

  it('should generate report with tracked bundles', async () => {
    const octokit = createMockOctokit({});
    mockGetOctokit.mockReturnValue(octokit as never);

    mockFetchSnapshot
      .mockResolvedValueOnce({
        'Button/index.js': { parsed: 15000, gzip: 4500 },
        'TextField/index.js': { parsed: 22000, gzip: 6500 },
      })
      .mockResolvedValueOnce({
        'Button/index.js': { parsed: 15400, gzip: 4600 },
        'TextField/index.js': { parsed: 22200, gzip: 6600 },
      });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
      trackedBundles: ['Button/index.js'],
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('| Button/index.js |');
    expect(result!.content).toContain('| Bundle |');
  });

  it('should include details URL with correct parameters', async () => {
    const octokit = createMockOctokit({});
    mockGetOctokit.mockReturnValue(octokit as never);

    mockFetchSnapshot
      .mockResolvedValueOnce({
        'Button/index.js': { parsed: 15000, gzip: 4500 },
      })
      .mockResolvedValueOnce({
        'Button/index.js': { parsed: 15000, gzip: 4500 },
      });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain(
      'frontend-public.mui.com/size-comparison/mui/material-ui/diff',
    );
    expect(result!.content).toContain('prNumber=42');
    expect(result!.content).toContain('baseRef=master');
    expect(result!.content).toContain('headCommit=def456');
  });

  it('should fall back to base sha when merge base API fails', async () => {
    const octokit = createMockOctokit({
      compareCommits: () => {
        throw new Error('API error');
      },
    });
    mockGetOctokit.mockReturnValue(octokit as never);

    mockFetchSnapshot
      .mockResolvedValueOnce({
        'Button/index.js': { parsed: 15000, gzip: 4500 },
      })
      .mockResolvedValueOnce({
        'Button/index.js': { parsed: 15400, gzip: 4600 },
      });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('baseCommit=abc123');
  });
});

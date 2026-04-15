import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/utils/fetchCiReport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/fetchCiReport')>();
  return {
    ...actual,
    fetchCiReport: vi.fn(),
  };
});

vi.mock('@/constants', () => ({
  DASHBOARD_ORIGIN: 'https://frontend-public.mui.com',
}));

// eslint-disable-next-line import/first -- vi.mock calls must precede imports
import { fetchCiReport } from '@/utils/fetchCiReport';
// eslint-disable-next-line import/first
import { generateBundleSizeReport } from './bundleSizeReport';

const mockFetchCiReport = vi.mocked(fetchCiReport);

const defaultPr = {
  base: { sha: 'abc123', ref: 'master' },
};

const defaultBaseCandidates = ['mergebase123', 'parent1', 'parent2', 'parent3'];

describe('generateBundleSizeReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate a report with size increases', async () => {
    mockFetchCiReport.mockImplementation((_repo, sha) => {
      if (sha === 'mergebase123') {
        return Promise.resolve({ 'Button/index.js': { parsed: 15000, gzip: 4500 } });
      }
      if (sha === 'def456') {
        return Promise.resolve({ 'Button/index.js': { parsed: 15400, gzip: 4600 } });
      }
      return Promise.resolve(null);
    });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
      baseCandidates: defaultBaseCandidates,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('🔺+400B');
    expect(result!.content).toContain('## Bundle size');
    expect(result!.content).toContain('Details of bundle changes');
    expect(result!.content).toContain('prNumber=42');
  });

  it('should return null when head snapshot is missing', async () => {
    mockFetchCiReport.mockImplementation((_repo, sha) => {
      if (sha === 'mergebase123') {
        return Promise.resolve({ 'Button/index.js': { parsed: 15000, gzip: 4500 } });
      }
      return Promise.resolve(null);
    });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
      baseCandidates: defaultBaseCandidates,
    });

    expect(result).toBeNull();
  });

  it('should show fallback message when using parent commit snapshot', async () => {
    mockFetchCiReport.mockImplementation((_repo, sha) => {
      if (sha === 'parent1') {
        return Promise.resolve({ 'Button/index.js': { parsed: 15000, gzip: 4500 } });
      }
      if (sha === 'def456') {
        return Promise.resolve({ 'Button/index.js': { parsed: 15400, gzip: 4600 } });
      }
      return Promise.resolve(null);
    });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
      baseCandidates: defaultBaseCandidates,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('Using snapshot from parent commit');
    expect(result!.content).toContain('base=parent1');
  });

  it('should show missing snapshot message when all fallbacks fail', async () => {
    mockFetchCiReport.mockImplementation((_repo, sha) => {
      if (sha === 'def456') {
        return Promise.resolve({ 'Button/index.js': { parsed: 15000, gzip: 4500 } });
      }
      return Promise.resolve(null);
    });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
      baseCandidates: defaultBaseCandidates,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('No bundle size snapshot found');
  });

  it('should generate report with tracked bundles from _metadata', async () => {
    mockFetchCiReport.mockImplementation((_repo, sha) => {
      if (sha === 'mergebase123') {
        return Promise.resolve({
          'Button/index.js': { parsed: 15000, gzip: 4500 },
          'TextField/index.js': { parsed: 22000, gzip: 6500 },
        });
      }
      if (sha === 'def456') {
        return Promise.resolve({
          'Button/index.js': { parsed: 15400, gzip: 4600 },
          'TextField/index.js': { parsed: 22200, gzip: 6600 },
          _metadata: { trackedBundles: ['Button/index.js'] },
        });
      }
      return Promise.resolve(null);
    });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
      baseCandidates: defaultBaseCandidates,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('| Button/index.js |');
    expect(result!.content).toContain('| Bundle |');
  });

  it('should include details URL with correct parameters', async () => {
    mockFetchCiReport.mockImplementation((_repo, sha) => {
      if (sha === 'mergebase123') {
        return Promise.resolve({ 'Button/index.js': { parsed: 15000, gzip: 4500 } });
      }
      if (sha === 'def456') {
        return Promise.resolve({ 'Button/index.js': { parsed: 15000, gzip: 4500 } });
      }
      return Promise.resolve(null);
    });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
      baseCandidates: defaultBaseCandidates,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain(
      'frontend-public.mui.com/size-comparison/mui/material-ui/diff',
    );
    expect(result!.content).toContain('prNumber=42');
    expect(result!.content).toContain('baseRef=master');
    expect(result!.content).toContain('sha=def456');
  });

  it('should use first candidate as merge base in URL when base snapshot found', async () => {
    mockFetchCiReport.mockImplementation((_repo, sha) => {
      if (sha === 'mergebase123') {
        return Promise.resolve({ 'Button/index.js': { parsed: 15000, gzip: 4500 } });
      }
      if (sha === 'def456') {
        return Promise.resolve({ 'Button/index.js': { parsed: 15400, gzip: 4600 } });
      }
      return Promise.resolve(null);
    });

    const result = await generateBundleSizeReport({
      repo: 'mui/material-ui',
      prNumber: 42,
      commitSha: 'def456',
      pr: defaultPr,
      baseCandidates: ['abc123'],
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('base=abc123');
  });
});

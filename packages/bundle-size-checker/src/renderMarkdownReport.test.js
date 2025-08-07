/* eslint-disable testing-library/render-result-naming-convention */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderMarkdownReport } from './renderMarkdownReport.js';
import * as fetchSnapshotModule from './fetchSnapshot.js';

// Mock the fetchSnapshot module
vi.mock('./fetchSnapshot.js');
// Mock the @octokit/rest module
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(() => ({
    repos: {
      compareCommits: vi.fn(),
      listCommits: vi.fn(),
    },
    pulls: {
      get: vi.fn(),
    },
  })),
}));

describe('renderMarkdownReport', () => {
  const mockFetchSnapshot = vi.mocked(fetchSnapshotModule.fetchSnapshot);
  const mockFetchSnapshotWithFallback = vi.mocked(fetchSnapshotModule.fetchSnapshotWithFallback);

  /** @type {PrInfo} */
  const mockPrInfo = {
    number: 42,
    base: {
      ref: 'master',
      sha: 'abc123',
      repo: { full_name: 'mui/material-ui' },
    },
    head: {
      ref: 'feature-branch',
      sha: 'def456',
    },
  };

  beforeEach(async () => {
    mockFetchSnapshot.mockClear();
    mockFetchSnapshotWithFallback.mockClear();

    // Import and mock the octokit instance after mocking the module
    const { octokit } = await import('./github.js');

    // Set up default mock for compareCommits to return the base commit SHA
    vi.mocked(octokit.repos.compareCommits).mockResolvedValue(
      /** @type {any} */ ({
        data: {
          merge_base_commit: {
            sha: mockPrInfo.base.sha,
          },
        },
      }),
    );

    // Clear any previous mock calls
    vi.mocked(octokit.repos.compareCommits).mockClear();
  });

  it('should generate markdown report with size increases', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
      '@mui/material/TextField/index.js': { parsed: 22000, gzip: 6500 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15400, gzip: 4600 }, // +400/+100
      '@mui/material/TextField/index.js': { parsed: 22000, gzip: 6500 }, // no change
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** 🔺+400B<sup>(+1.08%)</sup> - **Total Gzip Change:** 🔺+100B<sup>(+0.91%)</sup>
      Files: 2 total (0 added, 0 removed, 1 changed)

      <details>
      <summary>Show details for 2 more bundles</summary>

      **@mui/material/Button/index.js**&emsp;**parsed:** 🔺+400B<sup>(+2.67%)</sup> **gzip:** 🔺+100B<sup>(+2.22%)</sup>
      **@mui/material/TextField/index.js**&emsp;**parsed:**  0B<sup>(0.00%)</sup> **gzip:**  0B<sup>(0.00%)</sup>

      </details>

      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should handle new files added in PR', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
      '@mui/material/Chip/index.js': { parsed: 3500, gzip: 1200 }, // new file
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** 🔺+3.5KB<sup>(+23.33%)</sup> - **Total Gzip Change:** 🔺+1.2KB<sup>(+26.67%)</sup>
      Files: 2 total (1 added, 0 removed, 0 changed)

      <details>
      <summary>Show details for 2 more bundles</summary>

      **@mui/material/Chip/index.js**&emsp;**parsed:** 🔺+3.5KB<sup>(new)</sup> **gzip:** 🔺+1.2KB<sup>(new)</sup>
      **@mui/material/Button/index.js**&emsp;**parsed:**  0B<sup>(0.00%)</sup> **gzip:**  0B<sup>(0.00%)</sup>

      </details>

      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should handle missing base snapshot when GitHub API also fails', async () => {
    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({ snapshot: null, actualCommit: null });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toContain(
      'No bundle size snapshot found for merge base abc123 or any of its 3 parent commits.',
    );
  });

  it('should handle size decreases', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 14500, gzip: 4300 }, // -500/-200
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** ▼-500B<sup>(-3.33%)</sup> - **Total Gzip Change:** ▼-200B<sup>(-4.44%)</sup>
      Files: 1 total (0 added, 0 removed, 1 changed)

      <details>
      <summary>Show details for 1 more bundle</summary>

      **@mui/material/Button/index.js**&emsp;**parsed:** ▼-500B<sup>(-3.33%)</sup> **gzip:** ▼-200B<sup>(-4.44%)</sup>

      </details>

      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should handle removed files', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
      '@mui/material/TextField/index.js': { parsed: 22000, gzip: 6500 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
      // TextField removed
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** ▼-22KB<sup>(-59.46%)</sup> - **Total Gzip Change:** ▼-6.5KB<sup>(-59.09%)</sup>
      Files: 2 total (0 added, 1 removed, 0 changed)

      <details>
      <summary>Show details for 2 more bundles</summary>

      **@mui/material/TextField/index.js**&emsp;**parsed:** ▼-22KB<sup>(removed)</sup> **gzip:** ▼-6.5KB<sup>(removed)</sup>
      **@mui/material/Button/index.js**&emsp;**parsed:**  0B<sup>(0.00%)</sup> **gzip:**  0B<sup>(0.00%)</sup>

      </details>

      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should show collapsible section for many small changes', async () => {
    /** @type {import('./sizeDiff.js').SizeSnapshot} */
    const baseSnapshot = {};
    /** @type {import('./sizeDiff.js').SizeSnapshot} */
    const prSnapshot = {};

    // Create many small changes (under threshold)
    for (let i = 1; i <= 15; i += 1) {
      const filename = `@mui/icons-material/Icon${i}.js`;
      baseSnapshot[filename] = { parsed: 1000, gzip: 300 };
      prSnapshot[filename] = { parsed: 1050, gzip: 310 }; // +50/+10 (under threshold)
    }

    // Add one significant change
    baseSnapshot['@mui/material/Button/index.js'] = { parsed: 15000, gzip: 4500 };
    prSnapshot['@mui/material/Button/index.js'] = { parsed: 15400, gzip: 4600 }; // +400/+100 (over threshold)

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** 🔺+1.15KB<sup>(+3.83%)</sup> - **Total Gzip Change:** 🔺+250B<sup>(+2.78%)</sup>
      Files: 16 total (0 added, 0 removed, 16 changed)

      <details>
      <summary>Show details for 16 more bundles</summary>

      **@mui/material/Button/index.js**&emsp;**parsed:** 🔺+400B<sup>(+2.67%)</sup> **gzip:** 🔺+100B<sup>(+2.22%)</sup>
      **@mui/icons-material/Icon1.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon10.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon11.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon12.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon13.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon14.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon15.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon2.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon3.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon4.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon5.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon6.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon7.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon8.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon9.js**&emsp;**parsed:** 🔺+50B<sup>(+5.00%)</sup> **gzip:** 🔺+10B<sup>(+3.33%)</sup>

      </details>

      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should include CircleCI build number in details URL', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo, '12345');

    expect(result).toContain('circleCIBuildNumber=12345');
    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:**  0B<sup>(0.00%)</sup> - **Total Gzip Change:**  0B<sup>(0.00%)</sup>
      Files: 1 total (0 added, 0 removed, 0 changed)

      <details>
      <summary>Show details for 1 more bundle</summary>

      **@mui/material/Button/index.js**&emsp;**parsed:**  0B<sup>(0.00%)</sup> **gzip:**  0B<sup>(0.00%)</sup>

      </details>

      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456&circleCIBuildNumber=12345)"
    `);
  });

  it('should handle no changes', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:**  0B<sup>(0.00%)</sup> - **Total Gzip Change:**  0B<sup>(0.00%)</sup>
      Files: 1 total (0 added, 0 removed, 0 changed)

      <details>
      <summary>Show details for 1 more bundle</summary>

      **@mui/material/Button/index.js**&emsp;**parsed:**  0B<sup>(0.00%)</sup> **gzip:**  0B<sup>(0.00%)</sup>

      </details>

      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should handle track option with tracked bundles shown prominently', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
      '@mui/material/TextField/index.js': { parsed: 22000, gzip: 6500 },
      '@mui/icons-material/Add.js': { parsed: 1000, gzip: 300 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15400, gzip: 4600 }, // +400/+100
      '@mui/material/TextField/index.js': { parsed: 22200, gzip: 6600 }, // +200/+100
      '@mui/icons-material/Add.js': { parsed: 1100, gzip: 350 }, // +100/+50
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo, undefined, {
      track: ['@mui/material/Button/index.js', '@mui/material/TextField/index.js'],
    });

    expect(result).toMatchInlineSnapshot(`
      "| Bundle | Parsed size | Gzip size |
      |:---------|----------:|----------:|
      | @mui/material/Button/index.js | 🔺+400B<sup>(+2.67%)</sup> | 🔺+100B<sup>(+2.22%)</sup> |
      | @mui/material/TextField/index.js | 🔺+200B<sup>(+0.91%)</sup> | 🔺+100B<sup>(+1.54%)</sup> |



      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should calculate totals only for tracked bundles', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
      '@mui/material/TextField/index.js': { parsed: 22000, gzip: 6500 },
      '@mui/icons-material/Add.js': { parsed: 1000, gzip: 300 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15500, gzip: 4650 }, // +500/+150
      '@mui/material/TextField/index.js': { parsed: 22300, gzip: 6650 }, // +300/+150
      '@mui/icons-material/Add.js': { parsed: 2000, gzip: 600 }, // +1000/+300 (not tracked)
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo, undefined, {
      track: ['@mui/material/Button/index.js', '@mui/material/TextField/index.js'],
    });

    expect(result).toMatchInlineSnapshot(`
      "| Bundle | Parsed size | Gzip size |
      |:---------|----------:|----------:|
      | @mui/material/Button/index.js | 🔺+500B<sup>(+3.33%)</sup> | 🔺+150B<sup>(+3.33%)</sup> |
      | @mui/material/TextField/index.js | 🔺+300B<sup>(+1.36%)</sup> | 🔺+150B<sup>(+2.31%)</sup> |



      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should put non-tracked bundles in details when track is specified', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
      '@mui/icons-material/Add.js': { parsed: 1000, gzip: 300 },
      '@mui/icons-material/Delete.js': { parsed: 1200, gzip: 350 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15400, gzip: 4600 }, // +400/+100 (tracked)
      '@mui/icons-material/Add.js': { parsed: 1100, gzip: 350 }, // +100/+50 (not tracked)
      '@mui/icons-material/Delete.js': { parsed: 1300, gzip: 400 }, // +100/+50 (not tracked)
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo, undefined, {
      track: ['@mui/material/Button/index.js'],
    });

    expect(result).toMatchInlineSnapshot(`
      "| Bundle | Parsed size | Gzip size |
      |:---------|----------:|----------:|
      | @mui/material/Button/index.js | 🔺+400B<sup>(+2.67%)</sup> | 🔺+100B<sup>(+2.22%)</sup> |



      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should show tracked bundles prominently even when they have no changes', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
      '@mui/material/TextField/index.js': { parsed: 22000, gzip: 6500 },
      '@mui/material/Icon/index.js': { parsed: 8000, gzip: 2500 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 }, // tracked, no change
      '@mui/material/TextField/index.js': { parsed: 22000, gzip: 6500 }, // tracked, no change
      '@mui/material/Icon/index.js': { parsed: 8100, gzip: 2550 }, // untracked, has change
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo, undefined, {
      track: ['@mui/material/Button/index.js', '@mui/material/TextField/index.js'],
    });

    expect(result).toMatchInlineSnapshot(`
      "| Bundle | Parsed size | Gzip size |
      |:---------|----------:|----------:|
      | @mui/material/Button/index.js |  0B<sup>(0.00%)</sup> |  0B<sup>(0.00%)</sup> |
      | @mui/material/TextField/index.js |  0B<sup>(0.00%)</sup> |  0B<sup>(0.00%)</sup> |



      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should show message when tracking is enabled but no untracked bundles have changes', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
      '@mui/material/TextField/index.js': { parsed: 22000, gzip: 6500 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15400, gzip: 4600 }, // tracked, has change
      '@mui/material/TextField/index.js': { parsed: 22000, gzip: 6500 }, // untracked, no change
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo, undefined, {
      track: ['@mui/material/Button/index.js'],
    });

    expect(result).toMatchInlineSnapshot(`
      "| Bundle | Parsed size | Gzip size |
      |:---------|----------:|----------:|
      | @mui/material/Button/index.js | 🔺+400B<sup>(+2.67%)</sup> | 🔺+100B<sup>(+2.22%)</sup> |



      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should throw error when tracked bundle is missing from head snapshot', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15400, gzip: 4600 },
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: baseSnapshot,
      actualCommit: 'abc123',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    await expect(
      renderMarkdownReport(mockPrInfo, undefined, {
        track: ['@mui/material/Button/index.js', '@mui/material/NonExistent/index.js'],
      }),
    ).rejects.toThrow(
      'Tracked bundle not found in head snapshot: @mui/material/NonExistent/index.js',
    );
  });

  it('should fallback to parent commit when base snapshot is missing', async () => {
    const parentSnapshot = {
      '@mui/material/Button/index.js': { parsed: 14500, gzip: 4300 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: parentSnapshot,
      actualCommit: 'parent1',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toContain(
      'Using snapshot from parent commit parent1 (fallback from merge base abc123)',
    );
    expect(result).toContain('baseCommit=parent1');
  });

  it('should show no snapshot message when fallback fails', async () => {
    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({ snapshot: null, actualCommit: null });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toContain(
      'No bundle size snapshot found for merge base abc123 or any of its 3 parent commits.',
    );
  });

  it('should respect custom fallbackDepth option', async () => {
    const parentSnapshot = {
      '@mui/material/Button/index.js': { parsed: 14500, gzip: 4300 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    mockFetchSnapshotWithFallback.mockResolvedValueOnce({
      snapshot: parentSnapshot,
      actualCommit: 'parent1',
    });
    mockFetchSnapshot.mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo, undefined, { fallbackDepth: 1 });

    expect(result).toContain(
      'Using snapshot from parent commit parent1 (fallback from merge base abc123)',
    );
    expect(mockFetchSnapshotWithFallback).toHaveBeenCalledWith('mui/material-ui', 'abc123', 1);
  });
});

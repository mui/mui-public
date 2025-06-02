import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderMarkdownReport } from './renderMarkdownReport.js';
import * as fetchSnapshotModule from './fetchSnapshot.js';

// Mock the fetchSnapshot module
vi.mock('./fetchSnapshot.js');

describe('renderMarkdownReport', () => {
  const mockFetchSnapshot = vi.mocked(fetchSnapshotModule.fetchSnapshot);

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

  beforeEach(() => {
    mockFetchSnapshot.mockClear();
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

    mockFetchSnapshot.mockResolvedValueOnce(baseSnapshot).mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** 🔺+400B<sup>(+1.08%)</sup> - **Total Gzip Change:** 🔺+100B<sup>(+0.91%)</sup>
      Files: 2 total (0 added, 0 removed, 1 changed)

      <details>
      <summary>Show 1 bundle changes</summary>

      **@mui/material/Button/index.js**&emsp;**parsed:** 🔺+400B<sup>(+2.67%)</sup> **gzip:** 🔺+100B<sup>(+2.22%)</sup>

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

    mockFetchSnapshot.mockResolvedValueOnce(baseSnapshot).mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** 🔺+3.5KB<sup>(+23.33%)</sup> - **Total Gzip Change:** 🔺+1.2KB<sup>(+26.67%)</sup>
      Files: 2 total (1 added, 0 removed, 0 changed)

      <details>
      <summary>Show 1 bundle changes</summary>

      **@mui/material/Chip/index.js**&emsp;**parsed:** 🔺+3.5KB<sup>(new)</sup> **gzip:** 🔺+1.2KB<sup>(new)</sup>

      </details>

      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should handle missing base snapshot', async () => {
    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    mockFetchSnapshot
      .mockRejectedValueOnce(new Error('Not found'))
      .mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "_:no_entry_sign: No bundle size snapshot found for base commit abc123._

      **Total Size Change:**  +15KB<sup>(0.00%)</sup> - **Total Gzip Change:**  +4.5KB<sup>(0.00%)</sup>
      Files: 1 total (1 added, 0 removed, 0 changed)

      <details>
      <summary>Show 1 bundle changes</summary>

      **@mui/material/Button/index.js**&emsp;**parsed:** 🔺+15KB<sup>(new)</sup> **gzip:** 🔺+4.5KB<sup>(new)</sup>

      </details>

      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });

  it('should handle size decreases', async () => {
    const baseSnapshot = {
      '@mui/material/Button/index.js': { parsed: 15000, gzip: 4500 },
    };

    const prSnapshot = {
      '@mui/material/Button/index.js': { parsed: 14500, gzip: 4300 }, // -500/-200
    };

    mockFetchSnapshot.mockResolvedValueOnce(baseSnapshot).mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** ▼-500B<sup>(-3.33%)</sup> - **Total Gzip Change:** ▼-200B<sup>(-4.44%)</sup>
      Files: 1 total (0 added, 0 removed, 1 changed)

      <details>
      <summary>Show 1 bundle changes</summary>

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

    mockFetchSnapshot.mockResolvedValueOnce(baseSnapshot).mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** ▼-22KB<sup>(-59.46%)</sup> - **Total Gzip Change:** ▼-6.5KB<sup>(-59.09%)</sup>
      Files: 2 total (0 added, 1 removed, 0 changed)

      <details>
      <summary>Show 1 bundle changes</summary>

      **@mui/material/TextField/index.js**&emsp;**parsed:** ▼-22KB<sup>(removed)</sup> **gzip:** ▼-6.5KB<sup>(removed)</sup>

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

    mockFetchSnapshot.mockResolvedValueOnce(baseSnapshot).mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toContain('**@mui/material/Button/index.js**'); // All bundles are shown
    expect(result).toContain('<details>'); // Collapsible section
    expect(result).toContain('Show 16 bundle changes'); // All changes in details
    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** 🔺+1.15KB<sup>(+3.83%)</sup> - **Total Gzip Change:** 🔺+250B<sup>(+2.78%)</sup>
      Files: 16 total (0 added, 0 removed, 16 changed)

      <details>
      <summary>Show 16 bundle changes</summary>

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

    mockFetchSnapshot.mockResolvedValueOnce(baseSnapshot).mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo, '12345');

    expect(result).toContain('circleCIBuildNumber=12345');
    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:**  0B<sup>(0.00%)</sup> - **Total Gzip Change:**  0B<sup>(0.00%)</sup>
      Files: 1 total (0 added, 0 removed, 0 changed)



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

    mockFetchSnapshot.mockResolvedValueOnce(baseSnapshot).mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo);

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:**  0B<sup>(0.00%)</sup> - **Total Gzip Change:**  0B<sup>(0.00%)</sup>
      Files: 1 total (0 added, 0 removed, 0 changed)



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

    mockFetchSnapshot.mockResolvedValueOnce(baseSnapshot).mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo, undefined, {
      track: ['@mui/material/Button/index.js', '@mui/material/TextField/index.js'],
    });

    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** 🔺+600B<sup>(+1.62%)</sup> - **Total Gzip Change:** 🔺+200B<sup>(+1.82%)</sup>
      Files: 2 total (0 added, 0 removed, 2 changed)

      **@mui/material/Button/index.js**&emsp;**parsed:** 🔺+400B<sup>(+2.67%)</sup> **gzip:** 🔺+100B<sup>(+2.22%)</sup>
      **@mui/material/TextField/index.js**&emsp;**parsed:** 🔺+200B<sup>(+0.91%)</sup> **gzip:** 🔺+100B<sup>(+1.54%)</sup>
      <details>
      <summary>Show 1 other bundle changes</summary>

      **@mui/icons-material/Add.js**&emsp;**parsed:** 🔺+100B<sup>(+10.00%)</sup> **gzip:** 🔺+50B<sup>(+16.67%)</sup>

      </details>

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

    mockFetchSnapshot.mockResolvedValueOnce(baseSnapshot).mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo, undefined, {
      track: ['@mui/material/Button/index.js', '@mui/material/TextField/index.js'],
    });

    // Should show totals as +800/+300 (only tracked bundles), not +1800/+600 (all bundles)
    expect(result).toContain('+800B');
    expect(result).toContain('+300B');
    expect(result).not.toContain('+1.8KB');
    expect(result).not.toContain('+600B');
    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** 🔺+800B<sup>(+2.16%)</sup> - **Total Gzip Change:** 🔺+300B<sup>(+2.73%)</sup>
      Files: 2 total (0 added, 0 removed, 2 changed)

      **@mui/material/Button/index.js**&emsp;**parsed:** 🔺+500B<sup>(+3.33%)</sup> **gzip:** 🔺+150B<sup>(+3.33%)</sup>
      **@mui/material/TextField/index.js**&emsp;**parsed:** 🔺+300B<sup>(+1.36%)</sup> **gzip:** 🔺+150B<sup>(+2.31%)</sup>
      <details>
      <summary>Show 1 other bundle changes</summary>

      **@mui/icons-material/Add.js**&emsp;**parsed:** 🔺+1KB<sup>(+100.00%)</sup> **gzip:** 🔺+300B<sup>(+100.00%)</sup>

      </details>

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

    mockFetchSnapshot.mockResolvedValueOnce(baseSnapshot).mockResolvedValueOnce(prSnapshot);

    const result = await renderMarkdownReport(mockPrInfo, undefined, {
      track: ['@mui/material/Button/index.js'],
    });

    expect(result).toContain('Show 2 other bundle changes');
    expect(result).toContain('<details>');
    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:** 🔺+400B<sup>(+2.67%)</sup> - **Total Gzip Change:** 🔺+100B<sup>(+2.22%)</sup>
      Files: 1 total (0 added, 0 removed, 1 changed)

      **@mui/material/Button/index.js**&emsp;**parsed:** 🔺+400B<sup>(+2.67%)</sup> **gzip:** 🔺+100B<sup>(+2.22%)</sup>
      <details>
      <summary>Show 2 other bundle changes</summary>

      **@mui/icons-material/Add.js**&emsp;**parsed:** 🔺+100B<sup>(+10.00%)</sup> **gzip:** 🔺+50B<sup>(+16.67%)</sup>
      **@mui/icons-material/Delete.js**&emsp;**parsed:** 🔺+100B<sup>(+8.33%)</sup> **gzip:** 🔺+50B<sup>(+14.29%)</sup>

      </details>

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

    mockFetchSnapshot.mockResolvedValueOnce(baseSnapshot).mockResolvedValueOnce(prSnapshot);

    await expect(
      renderMarkdownReport(mockPrInfo, undefined, {
        track: ['@mui/material/Button/index.js', '@mui/material/NonExistent/index.js'],
      }),
    ).rejects.toThrow(
      'Tracked bundle not found in head snapshot: @mui/material/NonExistent/index.js',
    );
  });
});

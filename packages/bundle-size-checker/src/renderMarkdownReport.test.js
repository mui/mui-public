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
      "**Total Size Change:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+400B<sup>(+1.08%)</sup> - **Total Gzip Change:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+100B<sup>(+0.91%)</sup>
      Files: 2 total (0 added, 0 removed, 1 changed)

      **@mui/material/Button/index.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+400B<sup>(+2.67%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+100B<sup>(+2.22%)</sup>

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
      "**Total Size Change:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+3.5KB<sup>(+23.33%)</sup> - **Total Gzip Change:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+1.2KB<sup>(+26.67%)</sup>
      Files: 2 total (1 added, 0 removed, 0 changed)

      **@mui/material/Chip/index.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{orangered}▲}}$</sup>+3.5KB<sup>(new)</sup> **gzip:**<sup>\${\\tiny{\\color{orangered}▲}}$</sup>+1.2KB<sup>(new)</sup>

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

      **Total Size Change:** +15KB<sup>(0.00%)</sup> - **Total Gzip Change:** +4.5KB<sup>(0.00%)</sup>
      Files: 1 total (1 added, 0 removed, 0 changed)

      **@mui/material/Button/index.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{orangered}▲}}$</sup>+15KB<sup>(new)</sup> **gzip:**<sup>\${\\tiny{\\color{orangered}▲}}$</sup>+4.5KB<sup>(new)</sup>

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
      "**Total Size Change:**<sup>\${\\tiny{\\color{green}▼}}$</sup>-500B<sup>(-3.33%)</sup> - **Total Gzip Change:**<sup>\${\\tiny{\\color{green}▼}}$</sup>-200B<sup>(-4.44%)</sup>
      Files: 1 total (0 added, 0 removed, 1 changed)

      **@mui/material/Button/index.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{green}▼}}$</sup>-500B<sup>(-3.33%)</sup> **gzip:**<sup>\${\\tiny{\\color{green}▼}}$</sup>-200B<sup>(-4.44%)</sup>

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
      "**Total Size Change:**<sup>\${\\tiny{\\color{green}▼}}$</sup>-22KB<sup>(-59.46%)</sup> - **Total Gzip Change:**<sup>\${\\tiny{\\color{green}▼}}$</sup>-6.5KB<sup>(-59.09%)</sup>
      Files: 2 total (0 added, 1 removed, 0 changed)

      **@mui/material/TextField/index.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{cornflowerblue}▼}}$</sup>-22KB<sup>(removed)</sup> **gzip:**<sup>\${\\tiny{\\color{cornflowerblue}▼}}$</sup>-6.5KB<sup>(removed)</sup>

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

    expect(result).toContain('**@mui/material/Button/index.js**'); // Visible change
    expect(result).toContain('<details>'); // Collapsible section
    expect(result).toContain('Show 15 more bundle changes'); // Hidden changes
    expect(result).toMatchInlineSnapshot(`
      "**Total Size Change:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+1.15KB<sup>(+3.83%)</sup> - **Total Gzip Change:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+250B<sup>(+2.78%)</sup>
      Files: 16 total (0 added, 0 removed, 16 changed)

      **@mui/material/Button/index.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+400B<sup>(+2.67%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+100B<sup>(+2.22%)</sup>
      <details>
      <summary>Show 15 more bundle changes</summary>

      **@mui/icons-material/Icon1.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon10.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon11.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon12.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon13.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon14.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon15.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon2.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon3.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon4.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon5.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon6.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon7.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon8.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>
      **@mui/icons-material/Icon9.js**&emsp;**parsed:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+50B<sup>(+5.00%)</sup> **gzip:**<sup>\${\\tiny{\\color{red}▲}}$</sup>+10B<sup>(+3.33%)</sup>

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
      "**Total Size Change:** 0B<sup>(0.00%)</sup> - **Total Gzip Change:** 0B<sup>(0.00%)</sup>
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
      "**Total Size Change:** 0B<sup>(0.00%)</sup> - **Total Gzip Change:** 0B<sup>(0.00%)</sup>
      Files: 1 total (0 added, 0 removed, 0 changed)



      [Details of bundle changes](https://frontend-public.mui.com/size-comparison/mui/material-ui/diff?prNumber=42&baseRef=master&baseCommit=abc123&headCommit=def456)"
    `);
  });
});

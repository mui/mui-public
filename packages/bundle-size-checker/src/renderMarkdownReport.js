/**
 * @typedef {import('./sizeDiff.js').Size} Size
 * @typedef {import('./sizeDiff.js').SizeSnapshot} SizeSnapshot
 * @typedef {import('./sizeDiff.js').ComparisonResult} ComparisonResult
 */

import { calculateSizeDiff } from './sizeDiff.js';
import { fetchSnapshot } from './fetchSnapshot.js';
import { displayPercentFormatter, byteSizeChangeFormatter } from './formatUtils.js';
import { getMergeBase } from './git.js';
import { fetchSnapshotWithFallback } from './fetchSnapshotWithFallback.js';

/**
 * Generates a symbol based on the relative change value.
 * @param {number|null} relative - The relative change as a Number
 * @returns {string} Formatted size change string with symbol
 */
function getChangeIcon(relative) {
  if (relative === null) {
    return '🔺';
  }
  if (relative === -1) {
    return '▼';
  }
  if (relative < 0) {
    return '▼';
  }
  if (relative > 0) {
    return '🔺';
  }
  return ' ';
}

/**
 * Formats the relative change value for display.
 * @param {number|null} value - The relative change as a Number
 * @returns {string} Formatted relative change string
 */
function formatRelativeChange(value) {
  if (value === null) {
    return 'new';
  }
  if (value === -1) {
    return 'removed';
  }
  return displayPercentFormatter.format(value);
}

/**
 * Generates a user-readable string from a percentage change.
 * @param {number} absolute - The absolute change as a Number
 * @param {number|null} relative - The relative change as a Number
 * @returns {string} Formatted percentage string with emoji
 */
function formatChange(absolute, relative) {
  const formattedAbsolute = byteSizeChangeFormatter.format(absolute);
  const formattedChange = formatRelativeChange(relative);
  return `${getChangeIcon(relative)}${formattedAbsolute}<sup>(${formattedChange})</sup>`;
}

/**
 * Generates emphasized change text for a single bundle
 * @param {Size} entry - Bundle entry
 * @returns {string} Formatted change text
 */
function generateEmphasizedChange({ id: bundle, parsed, gzip }) {
  // increase might be a bug fix which is a nice thing. reductions are always nice
  const changeParsed = formatChange(parsed.absoluteDiff, parsed.relativeDiff);
  const changeGzip = formatChange(gzip.absoluteDiff, gzip.relativeDiff);

  return `**${bundle}**&emsp;**parsed:** ${changeParsed} **gzip:** ${changeGzip}`;
}

/**
 * @typedef {Object} ColumnDefinition
 * @property {string} field - The property key to extract from data objects
 * @property {string} [header] - Column header (defaults to field name)
 * @property {'left'|'center'|'right'} [align='left'] - Column alignment
 */

/**
 * Formats data as a markdown table
 * @param {ColumnDefinition[]} columns - Column definitions
 * @param {Partial<Record<string, unknown>>[]} data - Array of data objects
 * @returns {string} Formatted markdown table
 */
function formatMarkdownTable(columns, data) {
  let table = '';

  // Extract headers and alignments from column definitions
  const headers = columns.map((col) => col.header || col.field);
  const alignments = columns.map((col) => col.align || 'left');

  // Header row
  table += `| ${headers.join(' | ')} |\n`;

  // Separator row with alignment
  const separators = alignments.map((align) => {
    switch (align) {
      case 'center':
        return ':---------:';
      case 'right':
        return '----------:';
      case 'left':
        return ':----------';
      default:
        return '-----------';
    }
  });
  table += `|${separators.join('|')}|\n`;

  // Data rows
  data.forEach((row) => {
    const cells = columns.map((col) => row[col.field] ?? '');
    table += `| ${cells.join(' | ')} |\n`;
  });

  return table;
}

/**
 * Generates a Markdown report for bundle size changes
 * @param {ComparisonResult} comparison - Comparison result from calculateSizeDiff
 * @param {Object} [options] - Additional options
 * @param {string[]} [options.track] - Array of bundle IDs to track. If specified, totals will only include tracked bundles and all tracked bundles will be shown prominently
 * @param {number} [options.maxDetailsLines=100] - Maximum number of bundles to show in details section
 * @returns {string} Markdown report
 */
export function renderMarkdownReportContent(
  comparison,
  { track = [], maxDetailsLines = 100 } = {},
) {
  let markdownContent = '';

  if (track.length > 0) {
    const entryMap = new Map(comparison.entries.map((entry) => [entry.id, entry]));
    const trackedEntries = track.map((bundleId) => {
      const trackedEntry = entryMap.get(bundleId);
      if (!trackedEntry) {
        throw new Error(`Tracked bundle not found in head snapshot: ${bundleId}`);
      }
      return trackedEntry;
    });

    markdownContent += formatMarkdownTable(
      [
        { field: 'id', header: 'Bundle', align: 'left' },
        { field: 'parsed', header: 'Parsed size', align: 'right' },
        { field: 'gzip', header: 'Gzip size', align: 'right' },
      ],
      trackedEntries.map(({ id, parsed, gzip }) => ({
        id,
        parsed: formatChange(parsed.absoluteDiff, parsed.relativeDiff),
        gzip: formatChange(gzip.absoluteDiff, gzip.relativeDiff),
      })),
    );
    markdownContent += '\n';
  } else {
    markdownContent += `**Total Size Change:** ${formatChange(
      comparison.totals.totalParsed,
      comparison.totals.totalParsedPercent,
    )} - **Total Gzip Change:** ${formatChange(
      comparison.totals.totalGzip,
      comparison.totals.totalGzipPercent,
    )}\n`;

    markdownContent += `Files: ${comparison.fileCounts.total} total (${
      comparison.fileCounts.added
    } added, ${comparison.fileCounts.removed} removed, ${comparison.fileCounts.changed} changed)\n\n`;

    // Show all entries in details section, not just changed ones
    // Filter out tracked bundles to avoid duplication
    const trackedIdSet = new Set(track);
    const detailsEntries = comparison.entries.filter((entry) => !trackedIdSet.has(entry.id));

    // Cap at maxDetailsLines bundles to avoid overly large reports
    const cappedEntries = detailsEntries.slice(0, maxDetailsLines);
    const hasMore = detailsEntries.length > maxDetailsLines;

    if (cappedEntries.length > 0) {
      const allChanges = cappedEntries.map(generateEmphasizedChange);
      const bundleWord = cappedEntries.length === 1 ? 'bundle' : 'bundles';
      const summaryText = hasMore
        ? `Show details for ${cappedEntries.length} more ${bundleWord} (${detailsEntries.length - maxDetailsLines} more not shown)`
        : `Show details for ${cappedEntries.length} more ${bundleWord}`;
      markdownContent += `<details>\n<summary>${summaryText}</summary>\n\n`;
      markdownContent += `${allChanges.join('\n')}\n\n`;
      markdownContent += `</details>`;
    }
  }

  return markdownContent;
}

/**
 *
 * @param {PrInfo} prInfo
 * @param {Object} [options] - Optional parameters
 * @param {string | null} [options.actualBaseCommit] - The actual commit SHA used for comparison (may differ from prInfo.base.sha)
 * @returns {URL}
 */
function getDetailsUrl(prInfo, options = {}) {
  const { actualBaseCommit } = options;
  const detailedComparisonUrl = new URL(
    `https://frontend-public.mui.com/size-comparison/${prInfo.base.repo.full_name}/diff`,
  );
  detailedComparisonUrl.searchParams.set('prNumber', String(prInfo.number));
  detailedComparisonUrl.searchParams.set('baseRef', prInfo.base.ref);
  detailedComparisonUrl.searchParams.set('baseCommit', actualBaseCommit || prInfo.base.sha);
  detailedComparisonUrl.searchParams.set('headCommit', prInfo.head.sha);
  return detailedComparisonUrl;
}

/**
 *
 * @param {PrInfo} prInfo
 * @param {Object} [options] - Additional options
 * @param {string[]} [options.track] - Array of bundle IDs to track
 * @param {number} [options.fallbackDepth=3] - How many parent commits to try as fallback when base snapshot is missing
 * @param {number} [options.maxDetailsLines=100] - Maximum number of bundles to show in details section
 * @param {(base: string, head: string) => Promise<string>} [options.getMergeBase] - Custom function to get merge base commit
 * @returns {Promise<string>} Markdown report
 */
export async function renderMarkdownReport(prInfo, options = {}) {
  let markdownContent = '';

  const prCommit = prInfo.head.sha;
  const repo = prInfo.base.repo.full_name;
  const { fallbackDepth = 3 } = options;

  const getMergeBaseFn = options.getMergeBase || getMergeBase;
  const baseCommit = await getMergeBaseFn(prInfo.base.sha, prCommit);

  const [baseResult, prSnapshot] = await Promise.all([
    fetchSnapshotWithFallback(repo, baseCommit, fallbackDepth),
    fetchSnapshot(repo, prCommit),
  ]);

  const { snapshot: baseSnapshot, actualCommit: actualBaseCommit } = baseResult;

  if (!baseSnapshot) {
    markdownContent += `_:no_entry_sign: No bundle size snapshot found for merge base ${baseCommit} or any of its ${fallbackDepth} parent commits._\n\n`;
  } else if (actualBaseCommit !== baseCommit) {
    markdownContent += `_:information_source: Using snapshot from parent commit ${actualBaseCommit} (fallback from merge base ${baseCommit})._\n\n`;
  }

  const sizeDiff = calculateSizeDiff(baseSnapshot ?? {}, prSnapshot);

  const report = renderMarkdownReportContent(sizeDiff, options);

  markdownContent += report;

  markdownContent += `\n\n[Details of bundle changes](${getDetailsUrl(prInfo, { actualBaseCommit })})`;

  return markdownContent;
}

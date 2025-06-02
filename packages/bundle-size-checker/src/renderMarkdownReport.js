/**
 * @typedef {import('./sizeDiff.js').Size} Size
 * @typedef {import('./sizeDiff.js').SizeSnapshot} SizeSnapshot
 * @typedef {import('./sizeDiff.js').ComparisonResult} ComparisonResult
 */

import { calculateSizeDiff } from './sizeDiff.js';
import { fetchSnapshot } from './fetchSnapshot.js';
import { displayPercentFormatter, byteSizeChangeFormatter } from './formatUtils.js';

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

  return `**${bundle}**&emsp;**parsed:**${changeParsed} **gzip:**${changeGzip}`;
}

/**
 * Generates a Markdown report for bundle size changes
 * @param {ComparisonResult} comparison - Comparison result from calculateSizeDiff
 * @param {Object} [options] - Additional options
 * @param {string[]} [options.track] - Array of bundle IDs to track. If specified, totals will only include tracked bundles and all tracked bundles will be shown prominently
 * @returns {string} Markdown report
 */
export function renderMarkdownReportContent(comparison, { track } = {}) {
  let markdownContent = '';

  // If track is specified, calculate totals only for tracked bundles
  let displayTotals = comparison.totals;
  let displayFileCounts = comparison.fileCounts;

  if (track && track.length > 0) {
    const trackedEntries = comparison.entries.filter((entry) => track.includes(entry.id));

    // Calculate totals only for tracked bundles
    const trackedTotalParsed = trackedEntries.reduce(
      (sum, entry) => sum + entry.parsed.absoluteDiff,
      0,
    );
    const trackedTotalGzip = trackedEntries.reduce(
      (sum, entry) => sum + entry.gzip.absoluteDiff,
      0,
    );

    // Calculate percentages based on tracked bundles only
    const trackedBaseParsed = trackedEntries.reduce((sum, entry) => sum + entry.parsed.previous, 0);
    const trackedBaseGzip = trackedEntries.reduce((sum, entry) => sum + entry.gzip.previous, 0);

    const trackedTotalParsedPercent =
      trackedBaseParsed > 0 ? trackedTotalParsed / trackedBaseParsed : 0;
    const trackedTotalGzipPercent = trackedBaseGzip > 0 ? trackedTotalGzip / trackedBaseGzip : 0;

    displayTotals = {
      totalParsed: trackedTotalParsed,
      totalGzip: trackedTotalGzip,
      totalParsedPercent: trackedTotalParsedPercent,
      totalGzipPercent: trackedTotalGzipPercent,
    };

    // Count files only for tracked bundles
    const trackedAdded = trackedEntries.filter(
      (entry) => entry.parsed.relativeDiff === null,
    ).length;
    const trackedRemoved = trackedEntries.filter(
      (entry) => entry.parsed.relativeDiff === -1,
    ).length;
    const trackedChanged = trackedEntries.filter(
      (entry) =>
        entry.parsed.relativeDiff !== null &&
        entry.parsed.relativeDiff !== -1 &&
        (Math.abs(entry.parsed.absoluteDiff) > 0 || Math.abs(entry.gzip.absoluteDiff) > 0),
    ).length;

    displayFileCounts = {
      total: trackedEntries.length,
      added: trackedAdded,
      removed: trackedRemoved,
      changed: trackedChanged,
    };
  }

  markdownContent += `**Total Size Change:**${formatChange(
    displayTotals.totalParsed,
    displayTotals.totalParsedPercent,
  )} - **Total Gzip Change:**${formatChange(
    displayTotals.totalGzip,
    displayTotals.totalGzipPercent,
  )}\n`;

  markdownContent += `Files: ${displayFileCounts.total} total (${
    displayFileCounts.added
  } added, ${displayFileCounts.removed} removed, ${displayFileCounts.changed} changed)\n\n`;

  // Filter entries with changes
  const changedEntries = comparison.entries.filter(
    (entry) => Math.abs(entry.parsed.absoluteDiff) > 0 || Math.abs(entry.gzip.absoluteDiff) > 0,
  );

  if (track && track.length > 0) {
    // When tracking is enabled, show tracked bundles prominently and others in details
    const trackedEntries = changedEntries.filter((entry) => track.includes(entry.id));
    const untrackedEntries = changedEntries.filter((entry) => !track.includes(entry.id));

    // Show all tracked bundles prominently
    const trackedChanges = trackedEntries.map(generateEmphasizedChange);
    if (trackedChanges.length > 0) {
      markdownContent += `${trackedChanges.join('\n')}`;
    }

    // Put untracked bundles in details section
    if (untrackedEntries.length > 0) {
      const untrackedChanges = untrackedEntries.map(generateEmphasizedChange);
      markdownContent += `\n<details>\n<summary>Show ${untrackedEntries.length} other bundle changes</summary>\n\n`;
      markdownContent += `${untrackedChanges.join('\n')}\n\n`;
      markdownContent += `</details>`;
    }
  } else if (changedEntries.length > 0) {
    const allChanges = changedEntries.map(generateEmphasizedChange);
    markdownContent += `<details>\n<summary>Show ${changedEntries.length} bundle changes</summary>\n\n`;
    markdownContent += `${allChanges.join('\n')}\n\n`;
    markdownContent += `</details>`;
  }

  return markdownContent;
}

/**
 *
 * @param {PrInfo} prInfo
 * @param {string} [circleciBuildNumber] - The CircleCI build number
 * @returns {URL}
 */
function getDetailsUrl(prInfo, circleciBuildNumber) {
  const detailedComparisonUrl = new URL(
    `https://frontend-public.mui.com/size-comparison/${prInfo.base.repo.full_name}/diff`,
  );
  detailedComparisonUrl.searchParams.set('prNumber', String(prInfo.number));
  detailedComparisonUrl.searchParams.set('baseRef', prInfo.base.ref);
  detailedComparisonUrl.searchParams.set('baseCommit', prInfo.base.sha);
  detailedComparisonUrl.searchParams.set('headCommit', prInfo.head.sha);
  if (circleciBuildNumber) {
    detailedComparisonUrl.searchParams.set('circleCIBuildNumber', circleciBuildNumber);
  }
  return detailedComparisonUrl;
}

/**
 *
 * @param {PrInfo} prInfo
 * @param {string} [circleciBuildNumber] - The CircleCI build number
 * @param {Object} [options] - Additional options
 * @param {string[]} [options.track] - Array of bundle IDs to track
 * @returns {Promise<string>} Markdown report
 */
export async function renderMarkdownReport(prInfo, circleciBuildNumber, options) {
  let markdownContent = '';

  const baseCommit = prInfo.base.sha;
  const prCommit = prInfo.head.sha;
  const repo = prInfo.base.repo.full_name;
  const [baseSnapshot, prSnapshot] = await Promise.all([
    fetchSnapshot(repo, baseCommit).catch((error) => {
      console.error(`Error fetching base snapshot: ${error}`);
      return null;
    }),
    fetchSnapshot(repo, prCommit),
  ]);

  if (!baseSnapshot) {
    markdownContent += `_:no_entry_sign: No bundle size snapshot found for base commit ${baseCommit}._\n\n`;
  }

  const sizeDiff = calculateSizeDiff(baseSnapshot ?? {}, prSnapshot);

  const report = renderMarkdownReportContent(sizeDiff, options);

  markdownContent += report;

  markdownContent += `\n\n[Details of bundle changes](${getDetailsUrl(prInfo, circleciBuildNumber)})`;

  return markdownContent;
}

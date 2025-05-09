/**
 * @typedef {import('./sizeDiff.js').Size} Size
 * @typedef {import('./sizeDiff.js').SizeSnapshot} SizeSnapshot
 * @typedef {import('./sizeDiff.js').ComparisonResult} ComparisonResult
 */

import { calculateSizeDiff } from './sizeDiff.js';
import { fetchSnapshot } from './fetchSnapshot.js';
import { displayPercentFormatter, byteSizeChangeFormatter } from './formatUtils.js';
/**
 *
 * @param {'▲' | '▼'} symbol
 * @param {'yellow'|'red'|'blue'|'green'} color
 * @returns
 */
function formatSymbol(symbol, color) {
  return `<sup>\${\\tiny{\\color{${color}}${symbol}}}$</sup>`;
}

/**
 * Generates a symbol based on the relative change value.
 * @param {number|null} relative - The relative change as a Number
 * @returns {string} Formatted size change string with symbol
 */
function getChangeIcon(relative) {
  if (relative === null) {
    return formatSymbol('▲', 'yellow');
  }
  if (relative === -1) {
    return formatSymbol('▼', 'blue');
  }
  if (relative < 0) {
    return formatSymbol('▼', 'green');
  }
  if (relative > 0) {
    return formatSymbol('▲', 'red');
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
 * @param {number} [options.visibleLimit=10] - Number of entries to show before collapsing
 * @param {number} [options.parsedSizeChangeThreshold=300] - Threshold for parsed size change by which to show the entry
 * @param {number} [options.gzipSizeChangeThreshold=100] - Threshold for gzipped size change by which to show the entry
 * @returns {string} Markdown report
 */
export function renderMarkdownReportContent(
  comparison,
  { visibleLimit = 10, parsedSizeChangeThreshold = 300, gzipSizeChangeThreshold = 100 } = {},
) {
  let markdownContent = '';

  markdownContent += `**Total Size Change:**${formatChange(
    comparison.totals.totalParsed,
    comparison.totals.totalParsedPercent,
  )} - **Total Gzip Change:**${formatChange(
    comparison.totals.totalGzip,
    comparison.totals.totalGzipPercent,
  )}\n`;

  markdownContent += `Files: ${comparison.fileCounts.total} total (${
    comparison.fileCounts.added
  } added, ${comparison.fileCounts.removed} removed, ${comparison.fileCounts.changed} changed)\n\n`;

  const changedEntries = comparison.entries.filter(
    (entry) => Math.abs(entry.parsed.absoluteDiff) > 0 || Math.abs(entry.gzip.absoluteDiff) > 0,
  );

  const visibleEntries = [];
  const hiddenEntries = [];

  for (const entry of changedEntries) {
    const { parsed, gzip } = entry;
    const isSignificantChange =
      Math.abs(parsed.absoluteDiff) > parsedSizeChangeThreshold ||
      Math.abs(gzip.absoluteDiff) > gzipSizeChangeThreshold;
    if (isSignificantChange && visibleEntries.length < visibleLimit) {
      visibleEntries.push(entry);
    } else {
      hiddenEntries.push(entry);
    }
  }

  const importantChanges = visibleEntries.map(generateEmphasizedChange);
  const hiddenChanges = hiddenEntries.map(generateEmphasizedChange);

  // Add important changes to markdown
  if (importantChanges.length > 0) {
    // Show the most significant changes first, up to the visible limit
    const visibleChanges = importantChanges.slice(0, visibleLimit);
    markdownContent += `${visibleChanges.join('\n')}`;
  }

  // If there are more changes, add them in a collapsible details section
  if (hiddenChanges.length > 0) {
    markdownContent += `\n<details>\n<summary>Show ${hiddenChanges.length} more bundle changes</summary>\n\n`;
    markdownContent += `${hiddenChanges.join('\n')}\n\n`;
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
 * @returns {Promise<string>} Markdown report
 */
export async function renderMarkdownReport(prInfo, circleciBuildNumber) {
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

  const report = renderMarkdownReportContent(sizeDiff);

  markdownContent += report;

  markdownContent += `\n\n[Details of bundle changes](${getDetailsUrl(prInfo, circleciBuildNumber)})`;

  return markdownContent;
}

import { formatMarkdownTable } from '@/utils/formatters';
import type { Size, ComparisonResult } from './calculateSizeDiff';

const byteSizeChangeFormatter = new Intl.NumberFormat(undefined, {
  style: 'unit',
  unit: 'byte',
  notation: 'compact',
  unitDisplay: 'narrow',
  maximumSignificantDigits: 3,
  minimumSignificantDigits: 1,
  signDisplay: 'exceptZero',
});

const displayPercentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

function getChangeIcon(relative: number | null): string {
  if (relative === null) {
    return '🔺';
  }
  if (relative <= 0) {
    return relative < 0 ? '▼' : ' ';
  }
  return '🔺';
}

function formatRelativeChange(value: number | null): string {
  if (value === null) {
    return 'new';
  }
  if (value === -1) {
    return 'removed';
  }
  return displayPercentFormatter.format(value);
}

function formatChange(absolute: number, relative: number | null): string {
  const formattedAbsolute = byteSizeChangeFormatter.format(absolute);
  const formattedChange = formatRelativeChange(relative);
  return `${getChangeIcon(relative)}${formattedAbsolute}<sup>(${formattedChange})</sup>`;
}

function generateEmphasizedChange({ id: bundle, parsed, gzip }: Size): string {
  const changeParsed = formatChange(parsed.absoluteDiff, parsed.relativeDiff);
  const changeGzip = formatChange(gzip.absoluteDiff, gzip.relativeDiff);
  return `**${bundle}**&emsp;**parsed:** ${changeParsed} **gzip:** ${changeGzip}`;
}

export interface BuildMarkdownReportOptions {
  track?: string[];
  maxDetailsLines?: number;
}

export function buildBundleSizeMarkdownReport(
  comparison: ComparisonResult,
  { track = [], maxDetailsLines = 100 }: BuildMarkdownReportOptions = {},
): string {
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

    const trackedIdSet = new Set(track);
    const detailsEntries = comparison.entries.filter((entry) => !trackedIdSet.has(entry.id));

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

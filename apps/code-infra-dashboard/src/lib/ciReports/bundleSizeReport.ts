import { fetchCiReport } from '@/utils/fetchCiReport';
import {
  calculateSizeDiff,
  type Size,
  type ComparisonResult,
} from '@/lib/bundleSize/calculateSizeDiff';
import type { SizeSnapshot } from '@/lib/bundleSize/fetchSnapshot';
import { fetchCiReportWithFallback } from '@/lib/ciReports/fetchWithFallback';
import { DASHBOARD_ORIGIN } from '@/constants';

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

interface ColumnDefinition {
  field: string;
  header?: string;
  align?: 'left' | 'center' | 'right';
}

function formatMarkdownTable(
  columns: ColumnDefinition[],
  data: Partial<Record<string, unknown>>[],
): string {
  let table = '';

  const headers = columns.map((col) => col.header || col.field);
  const alignments = columns.map((col) => col.align || 'left');

  table += `| ${headers.join(' | ')} |\n`;

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

  data.forEach((row) => {
    const cells = columns.map((col) => row[col.field] ?? '');
    table += `| ${cells.join(' | ')} |\n`;
  });

  return table;
}

function renderMarkdownReportContent(
  comparison: ComparisonResult,
  { track = [], maxDetailsLines = 100 }: { track?: string[]; maxDetailsLines?: number } = {},
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

function getDetailsUrl(
  repo: string,
  prNumber: number,
  baseRef: string,
  baseCommit: string,
  headCommit: string,
) {
  const url = new URL(`${DASHBOARD_ORIGIN}/size-comparison/${repo}/diff`);
  url.searchParams.set('prNumber', String(prNumber));
  url.searchParams.set('baseRef', baseRef);
  url.searchParams.set('baseCommit', baseCommit);
  url.searchParams.set('headCommit', headCommit);
  return url;
}

interface PrInfo {
  base: { sha: string; ref: string };
}

interface BundleSizeReportOptions {
  repo: string;
  prNumber: number;
  commitSha: string;
  pr: PrInfo;
  baseCandidates: string[];
}

export interface BundleSizeReportResult {
  content: string;
}

/**
 * Generates a complete bundle size report by fetching and comparing snapshots.
 * Returns null if the head snapshot is not available.
 */
export async function generateBundleSizeReport(
  options: BundleSizeReportOptions,
): Promise<BundleSizeReportResult | null> {
  const { repo, prNumber, commitSha, pr, baseCandidates } = options;

  const [baseResult, headSnapshot] = await Promise.all([
    fetchCiReportWithFallback<SizeSnapshot>(repo, baseCandidates, 'size-snapshot.json'),
    fetchCiReport<SizeSnapshot>(repo, commitSha, 'size-snapshot.json'),
  ]);

  if (!headSnapshot) {
    return null;
  }

  const { report: baseSnapshot, actualCommit: actualBaseCommit } = baseResult;
  const mergeBaseCommit = baseCandidates[0];

  // Extract tracked bundles from snapshot metadata
  // eslint-disable-next-line no-underscore-dangle
  const metadata = (headSnapshot as Record<string, unknown>)._metadata as
    | { trackedBundles?: string[] }
    | undefined;
  const trackedBundles = metadata?.trackedBundles;

  let markdownContent = '';

  if (!baseSnapshot) {
    markdownContent += `_:no_entry_sign: No bundle size snapshot found for merge base ${mergeBaseCommit} or any of its ${baseCandidates.length - 1} parent commits._\n\n`;
  } else if (actualBaseCommit !== mergeBaseCommit) {
    markdownContent += `_:information_source: Using snapshot from parent commit ${actualBaseCommit} (fallback from merge base ${mergeBaseCommit})._\n\n`;
  }

  const sizeDiff = calculateSizeDiff(baseSnapshot ?? {}, headSnapshot);
  const report = renderMarkdownReportContent(sizeDiff, {
    track: trackedBundles && trackedBundles.length > 0 ? trackedBundles : undefined,
  });

  markdownContent += report;

  const detailsUrl = getDetailsUrl(
    repo,
    prNumber,
    pr.base.ref,
    actualBaseCommit || mergeBaseCommit,
    commitSha,
  );
  markdownContent += `\n\n[Details of bundle changes](${detailsUrl})`;

  return { content: `## Bundle size report\n\n${markdownContent}` };
}

import type { SizeSnapshot } from './fetchSnapshot';

export interface SizeInfo {
  previous: number;
  current: number;
  absoluteDiff: number;
  relativeDiff: number | null;
}

export interface Size {
  id: string;
  parsed: SizeInfo;
  gzip: SizeInfo;
}

export interface ComparisonResult {
  entries: Size[];
  totals: {
    totalParsed: number;
    totalGzip: number;
    totalParsedPercent: number;
    totalGzipPercent: number;
  };
  fileCounts: {
    added: number;
    removed: number;
    changed: number;
    total: number;
  };
}

const nullSnapshot = { parsed: 0, gzip: 0 };

export function calculateSizeDiff(
  baseSnapshot: SizeSnapshot,
  targetSnapshot: SizeSnapshot,
): ComparisonResult {
  const bundleKeys = Object.keys({ ...baseSnapshot, ...targetSnapshot });
  const results: Size[] = [];

  let totalParsed = 0;
  let totalGzip = 0;
  let totalParsedPrevious = 0;
  let totalGzipPrevious = 0;

  let addedFiles = 0;
  let removedFiles = 0;
  let changedFiles = 0;

  bundleKeys.forEach((bundle) => {
    const isNewBundle = !baseSnapshot[bundle];
    const isRemovedBundle = !targetSnapshot[bundle];
    const currentSize = targetSnapshot[bundle] || nullSnapshot;
    const previousSize = baseSnapshot[bundle] || nullSnapshot;

    if (isNewBundle) {
      addedFiles += 1;
    } else if (isRemovedBundle) {
      removedFiles += 1;
    } else if (
      currentSize.parsed !== previousSize.parsed ||
      currentSize.gzip !== previousSize.gzip
    ) {
      changedFiles += 1;
    }

    const parsedDiff = currentSize.parsed - previousSize.parsed;
    const gzipDiff = currentSize.gzip - previousSize.gzip;

    let parsedRelativeDiff;
    if (isNewBundle) {
      parsedRelativeDiff = null;
    } else if (isRemovedBundle) {
      parsedRelativeDiff = -1;
    } else if (previousSize.parsed) {
      parsedRelativeDiff = currentSize.parsed / previousSize.parsed - 1;
    } else {
      parsedRelativeDiff = 0;
    }

    let gzipRelativeDiff;
    if (isNewBundle) {
      gzipRelativeDiff = null;
    } else if (isRemovedBundle) {
      gzipRelativeDiff = -1;
    } else if (previousSize.gzip) {
      gzipRelativeDiff = currentSize.gzip / previousSize.gzip - 1;
    } else {
      gzipRelativeDiff = 0;
    }

    results.push({
      id: bundle,
      parsed: {
        previous: previousSize.parsed,
        current: currentSize.parsed,
        absoluteDiff: parsedDiff,
        relativeDiff: parsedRelativeDiff,
      },
      gzip: {
        previous: previousSize.gzip,
        current: currentSize.gzip,
        absoluteDiff: gzipDiff,
        relativeDiff: gzipRelativeDiff,
      },
    });

    totalParsed += parsedDiff;
    totalGzip += gzipDiff;
    totalParsedPrevious += previousSize.parsed;
    totalGzipPrevious += previousSize.gzip;
  });

  const totalParsedPercent = totalParsedPrevious > 0 ? totalParsed / totalParsedPrevious : 0;
  const totalGzipPercent = totalGzipPrevious > 0 ? totalGzip / totalGzipPrevious : 0;

  results.sort((entryA, entryB) => {
    const getCategory = (entry: Size): number => {
      if (entry.parsed.relativeDiff === null) {
        return 2;
      }
      if (entry.parsed.relativeDiff === -1) {
        return 4;
      }
      if (entry.parsed.relativeDiff > 0) {
        return 1;
      }
      if (entry.parsed.relativeDiff < 0) {
        return 3;
      }
      return 5;
    };

    const categoryA = getCategory(entryA);
    const categoryB = getCategory(entryB);

    if (categoryA !== categoryB) {
      return categoryA - categoryB;
    }

    const diffA = Math.abs(entryA.parsed.absoluteDiff);
    const diffB = Math.abs(entryB.parsed.absoluteDiff);

    if (diffA !== diffB) {
      return diffB - diffA;
    }

    return entryA.id.localeCompare(entryB.id);
  });

  return {
    entries: results,
    totals: {
      totalParsed,
      totalGzip,
      totalParsedPercent,
      totalGzipPercent,
    },
    fileCounts: {
      added: addedFiles,
      removed: removedFiles,
      changed: changedFiles,
      total: bundleKeys.length,
    },
  };
}

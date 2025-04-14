/**
 * Interface representing a size snapshot from CircleCI or S3
 */
export interface SizeSnapshot {
  [bundleId: string]: { parsed: number; gzip: number };
}

/**
 * Interface representing a single bundle size comparison
 */
export interface Size {
  id: string;
  parsed: {
    previous: number;
    current: number;
    absoluteDiff: number;
    relativeDiff: number;
  };
  gzip: {
    previous: number;
    current: number;
    absoluteDiff: number;
    relativeDiff: number;
  };
}

/**
 * Interface representing the comparison results
 */
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

/**
 * Calculates size difference between two snapshots
 *
 * @param baseSnapshot - Base snapshot (previous)
 * @param targetSnapshot - Target snapshot (current)
 * @returns Comparison result with entries, totals, and file counts
 */
export function calculateSizeDiff(
  baseSnapshot: SizeSnapshot | null,
  targetSnapshot: SizeSnapshot | null,
): ComparisonResult {
  if (!baseSnapshot || !targetSnapshot) {
    return {
      entries: [],
      totals: {
        totalParsed: 0,
        totalGzip: 0,
        totalParsedPercent: 0,
        totalGzipPercent: 0,
      },
      fileCounts: {
        added: 0,
        removed: 0,
        changed: 0,
        total: 0,
      },
    };
  }

  const bundleKeys = Object.keys({ ...baseSnapshot, ...targetSnapshot });
  const results: Size[] = [];

  // Track totals
  let totalParsed = 0;
  let totalGzip = 0;
  let totalParsedPrevious = 0;
  let totalGzipPrevious = 0;

  // Track file counts
  let addedFiles = 0;
  let removedFiles = 0;
  let changedFiles = 0;

  bundleKeys.forEach((bundle) => {
    const isNewBundle = !baseSnapshot[bundle];
    const isRemovedBundle = !targetSnapshot[bundle];
    const currentSize = targetSnapshot[bundle] || nullSnapshot;
    const previousSize = baseSnapshot[bundle] || nullSnapshot;

    // Update file counts
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

    // Calculate relative diffs with appropriate handling of new/removed bundles
    let parsedRelativeDiff: number;
    if (isNewBundle) {
      parsedRelativeDiff = Infinity;
    } else if (isRemovedBundle) {
      parsedRelativeDiff = -Infinity;
    } else if (previousSize.parsed) {
      parsedRelativeDiff = currentSize.parsed / previousSize.parsed - 1;
    } else {
      parsedRelativeDiff = 0;
    }

    let gzipRelativeDiff: number;
    if (isNewBundle) {
      gzipRelativeDiff = Infinity;
    } else if (isRemovedBundle) {
      gzipRelativeDiff = -Infinity;
    } else if (previousSize.gzip) {
      gzipRelativeDiff = currentSize.gzip / previousSize.gzip - 1;
    } else {
      gzipRelativeDiff = 0;
    }

    const entry: Size = {
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
    };

    results.push(entry);

    // Update totals
    totalParsed += parsedDiff;
    totalGzip += gzipDiff;
    totalParsedPrevious += previousSize.parsed;
    totalGzipPrevious += previousSize.gzip;
  });

  // Calculate percentage changes
  const totalParsedPercent = totalParsedPrevious > 0 ? totalParsed / totalParsedPrevious : 0;
  const totalGzipPercent = totalGzipPrevious > 0 ? totalGzip / totalGzipPrevious : 0;

  // Sort the results
  // Custom sorting:
  // 1. Existing bundles that increased in size (larger increases first)
  // 2. New bundles (larger sizes first)
  // 3. Existing bundles that decreased in size (larger decreases first)
  // 4. Removed bundles (larger sizes first)
  // 5. Unchanged bundles (alphabetically)
  results.sort((entryA, entryB) => {
    // Helper function to determine bundle category (for sorting)
    const getCategory = (entry: Size): number => {
      if (entry.parsed.relativeDiff === Infinity) {
        return 2; // New bundle
      }
      if (entry.parsed.relativeDiff === -Infinity) {
        return 4; // Removed bundle
      }
      if (entry.parsed.relativeDiff > 0) {
        return 1; // Increased
      }
      if (entry.parsed.relativeDiff < 0) {
        return 3; // Decreased
      }
      return 5; // Unchanged
    };

    // Get categories for both bundles
    const categoryA = getCategory(entryA);
    const categoryB = getCategory(entryB);

    // Sort by category first
    if (categoryA !== categoryB) {
      return categoryA - categoryB;
    }

    // Within the same category, sort by absolute diff (largest first)
    const diffA = Math.abs(entryA.parsed.absoluteDiff);
    const diffB = Math.abs(entryB.parsed.absoluteDiff);

    if (diffA !== diffB) {
      return diffB - diffA;
    }

    // If diffs are the same, sort by name
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

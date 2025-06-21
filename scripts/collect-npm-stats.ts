#!/usr/bin/env tsx
/* eslint-disable no-console */

/**
 * Collect per-version npm download statistics for specified packages.
 * This script stores under a size efficient data structure as these files will
 * be loaded directly in the browser.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface NpmDownloadResponse {
  package: string;
  downloads: Record<string, number>;
}

interface HistoricalData {
  package: string;
  timestamps: number[];
  downloads: Record<string, number[]>;
}

async function fetchPackageStats(packageName: string): Promise<NpmDownloadResponse> {
  const encodedPackage = encodeURIComponent(packageName);
  const url = `https://api.npmjs.org/versions/${encodedPackage}/last-week`;

  console.log(`Fetching stats for ${packageName}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch stats for ${packageName}: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<NpmDownloadResponse>;
}

async function readExistingData(filePath: string): Promise<HistoricalData | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function updateHistoricalData(
  packageName: string,
  newDownloads: Record<string, number>,
  existingData: HistoricalData | null,
): Promise<HistoricalData> {
  const timestamp = Date.now();

  if (!existingData) {
    // Create new data structure
    const downloads: Record<string, number[]> = {};
    for (const [version, count] of Object.entries(newDownloads)) {
      downloads[version] = [count];
    }

    return {
      package: packageName,
      timestamps: [timestamp],
      downloads,
    };
  }

  // Update existing data
  const updatedData: HistoricalData = {
    ...existingData,
    timestamps: [...existingData.timestamps, timestamp],
    downloads: { ...existingData.downloads },
  };

  // Add new download counts
  for (const [version, count] of Object.entries(newDownloads)) {
    if (!updatedData.downloads[version]) {
      // New version - backfill with zeros for historical timestamps
      updatedData.downloads[version] = new Array(existingData.timestamps.length).fill(0);
    }
    updatedData.downloads[version].push(count);
  }

  // Ensure all existing versions have a new entry (fill with 0 if no downloads)
  for (const version of Object.keys(existingData.downloads)) {
    if (!newDownloads[version]) {
      updatedData.downloads[version].push(0);
    }
  }

  return updatedData;
}

async function processPackage(packageName: string): Promise<void> {
  // Fetch current stats
  const stats = await fetchPackageStats(packageName);

  // Check if package has any download statistics
  if (!stats.downloads || Object.keys(stats.downloads).length === 0) {
    throw new Error(
      `Package ${packageName} has no download statistics - it may not exist or have no downloads`,
    );
  }

  // Use all versions without aggregation
  const allVersionDownloads = stats.downloads;

  // Determine file path
  const dataDir = join(process.cwd(), 'data', 'npm-versions');
  const filePath = join(dataDir, `${packageName}.json`);

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Read existing data
  const existingData = await readExistingData(filePath);

  // Update historical data
  const updatedData = await updateHistoricalData(packageName, allVersionDownloads, existingData);

  // Write back to file
  await writeFile(filePath, JSON.stringify(updatedData));

  console.log(`✅ Updated stats for ${packageName}`);
}

async function main() {
  const packages = process.argv.slice(2);

  if (packages.length === 0) {
    console.error('Usage: tsx collect-npm-stats.ts <package1> [package2] ...');
    process.exit(1);
  }

  console.log(`Collecting npm stats for ${packages.length} package(s): ${packages.join(', ')}`);

  // Process all packages in parallel with individual error handling
  const results = await Promise.allSettled(
    packages.map(async (packageName) => {
      try {
        await processPackage(packageName);
        return { package: packageName, success: true };
      } catch (error) {
        console.error(
          `❌ Failed to process ${packageName}:`,
          error instanceof Error ? error.message : error,
        );
        return {
          package: packageName,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  // Summary report
  const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
  const failed = packages.length - successful;

  console.log(`\n📊 Summary: ${successful}/${packages.length} packages processed successfully`);
  if (failed > 0) {
    console.log(`⚠️  ${failed} package(s) failed`);
  } else {
    console.log('🎉 All packages processed successfully!');
  }
}

main();

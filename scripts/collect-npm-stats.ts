#!/usr/bin/env tsx
/* eslint-disable no-console */

/**
 * Collect per-version npm download statistics for specified packages.
 * This script stores under a size efficient data structure as these files will
 * be loaded directly in the browser.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

interface NpmDownloadResponse {
  package: string;
  downloads: Record<string, number>;
}

interface HistoricalData {
  package: string;
  timestamps: number[];
  downloads: Record<string, number[]>;
}

const PACKAGES = ['@mui/material', '@base-ui-components/react'];

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    // Network error - retry if retries left
    if (retries <= 0) {
      throw error;
    }
  }

  if (response) {
    // Handle successful responses
    if (response.ok) {
      return response;
    }

    // Don't retry on 4xx client errors or no retries left
    if ((response.status >= 400 && response.status < 500) || retries <= 0) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  // Retry after delay
  console.log(`Retrying in 1s (${retries} retries left)...`);
  await setTimeout(1000);
  return fetchWithRetry(url, retries - 1);
}

async function fetchPackageStats(packageName: string): Promise<NpmDownloadResponse> {
  const encodedPackage = encodeURIComponent(packageName);
  const url = `https://api.npmjs.org/versions/${encodedPackage}/last-week`;

  console.log(`Fetching stats for ${packageName}...`);

  const response = await fetchWithRetry(url);
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
  console.log(`Collecting npm stats for ${PACKAGES.length} package(s): ${PACKAGES.join(', ')}`);

  // Process all packages in parallel with individual error handling
  const results = await Promise.allSettled(
    PACKAGES.map(async (packageName) => {
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
  const failed = PACKAGES.length - successful;

  console.log(`\n📊 Summary: ${successful}/${PACKAGES.length} packages processed successfully`);
  if (failed > 0) {
    console.log(`⚠️  ${failed} package(s) failed`);
  } else {
    console.log('🎉 All packages processed successfully!');
  }
}

main();

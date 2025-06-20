#!/usr/bin/env tsx
/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as semver from 'semver';

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

function aggregateByMajorVersion(downloads: Record<string, number>): Record<string, number> {
  const majorVersions: Record<string, number> = {};

  for (const [version, count] of Object.entries(downloads)) {
    const major = semver.major(version);
    const majorKey = major.toString();

    if (!majorVersions[majorKey]) {
      majorVersions[majorKey] = 0;
    }
    majorVersions[majorKey] += count;
  }

  return majorVersions;
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
    for (const [major, count] of Object.entries(newDownloads)) {
      downloads[major] = [count];
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
  for (const [major, count] of Object.entries(newDownloads)) {
    if (!updatedData.downloads[major]) {
      // New major version - backfill with zeros for historical timestamps
      updatedData.downloads[major] = new Array(existingData.timestamps.length).fill(0);
    }
    updatedData.downloads[major].push(count);
  }

  // Ensure all existing major versions have a new entry (fill with 0 if no downloads)
  for (const major of Object.keys(existingData.downloads)) {
    if (!newDownloads[major]) {
      updatedData.downloads[major].push(0);
    }
  }

  return updatedData;
}

async function processPackage(packageName: string): Promise<void> {
  try {
    // Fetch current stats
    const stats = await fetchPackageStats(packageName);

    // Aggregate by major version
    const aggregatedDownloads = aggregateByMajorVersion(stats.downloads);

    // Determine file path
    const dataDir = join(process.cwd(), 'data', 'npm-versions');
    const filePath = join(dataDir, `${packageName}.json`);

    // Ensure directory exists
    await mkdir(dirname(filePath), { recursive: true });

    // Read existing data
    const existingData = await readExistingData(filePath);

    // Update historical data
    const updatedData = await updateHistoricalData(packageName, aggregatedDownloads, existingData);

    // Write back to file
    await writeFile(filePath, JSON.stringify(updatedData, null, 2));

    console.log(`✅ Updated stats for ${packageName}`);
    console.log(`   Major versions: ${Object.keys(aggregatedDownloads).join(', ')}`);
    console.log(
      `   Total downloads: ${Object.values(aggregatedDownloads).reduce((a, b) => a + b, 0)}`,
    );
  } catch (error) {
    console.error(`❌ Failed to process ${packageName}:`, error);
    throw error;
  }
}

async function main() {
  const packages = process.argv.slice(2);

  if (packages.length === 0) {
    console.error('Usage: tsx collect-npm-stats.ts <package1> [package2] ...');
    process.exit(1);
  }

  console.log(`Collecting npm stats for ${packages.length} package(s): ${packages.join(', ')}`);

  try {
    // Process all packages in parallel
    await Promise.all(packages.map(processPackage));

    console.log('🎉 All packages processed successfully!');
  } catch (error) {
    console.error('❌ Failed to collect npm stats:', error);
    process.exit(1);
  }
}

main();

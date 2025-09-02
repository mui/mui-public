const HISTORIC_DATA_BASE_URL =
  'https://raw.githubusercontent.com/Janpot/npm-versions-tracker/refs/heads/master';

export interface PackageDetails {
  name: string;
  description: string;
  version: string;
  author: string;
  link: string;
  versions: Record<string, PackageVersion>;
  timestamp: number;
  historyAvailable: boolean;
  timestamps: number[];
  globalTotalDownloads: number;
  historicalTotalGlobalDownloads: number[];
}

export interface SearchResult {
  name: string;
  description: string;
  version: string;
  author: string;
  link: string;
  score: number;
}

export interface PackageVersion {
  version: string;
  publishedAt: string | null;
  dependencies: Record<string, string>;
  downloads: number;
  history: number[];
}

export interface HistoricalData {
  package: string;
  timestamps: number[];
  downloads: Record<string, number[]>;
}

export interface TimeSeriesDataPoint {
  timestamp: string;
  value: number;
  version: string;
}

import { fetchJson } from '../utils/http';

export const fetchNpmPackageSearch = async (query: string): Promise<SearchResult[]> => {
  if (!query.trim()) {
    return [];
  }

  const data = await fetchJson<any>(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20`,
  );

  return data.objects.map((obj: any) => ({
    name: obj.package.name,
    description: obj.package.description,
    version: obj.package.version,
    author: obj.package.publisher?.username || 'Unknown',
    link: obj.package.links?.npm || `https://www.npmjs.com/package/${obj.package.name}`,
    score: obj.score.final,
  }));
};

export const fetchNpmPackageDetails = async (packageName: string): Promise<PackageDetails> => {
  const encodedPackageName = packageName.replace('/', '%2F');
  const fetchTimestamp = Date.now();

  // Fetch package data, download statistics, and history in parallel
  const [data, downloadsData, historyResult] = await Promise.all([
    fetchJson<any>(`https://registry.npmjs.org/${packageName}`),
    fetchJson<any>(`https://api.npmjs.org/versions/${encodedPackageName}/last-week`),
    // Gracefully handle history fetch failure
    fetchJson<any>(`${HISTORIC_DATA_BASE_URL}/data/${encodeURIComponent(packageName)}.json`, {
      ignoreHttpErrors: true,
    }).catch(() => null),
  ]);

  // Process historical data if available
  const historyAvailable = !!historyResult;
  const timestamps: number[] = historyResult?.timestamps || [];
  timestamps.push(fetchTimestamp); // Include current fetch timestamp

  const versions: Record<string, PackageVersion> = {};

  Object.keys(data.versions || {}).forEach((version) => {
    // Get historical download data for this version
    const downloads = downloadsData.downloads?.[version] || 0;

    let history: number[] = [];
    if (historyResult) {
      history = historyResult.downloads?.[version] || historyResult.timestamps.map(() => 0) || [];
      history = [...history, downloads]; // Append current downloads to history
    }

    versions[version] = {
      version,
      publishedAt: data.time?.[version] || null,
      dependencies: data.versions[version].dependencies || {},
      downloads,
      history,
    };
  });

  const globalTotalDownloads = Object.values(versions).reduce(
    (total, ver) => total + ver.downloads,
    0,
  );
  const historicalTotalGlobalDownloads = timestamps.map((_, index) => {
    return Object.values(versions).reduce((total, ver) => total + (ver.history[index] || 0), 0);
  });

  return {
    name: data.name,
    description: data.description,
    version: data['dist-tags']?.latest || 'unknown',
    author: typeof data.author === 'string' ? data.author : data.author?.name || 'Unknown',
    link: `https://www.npmjs.com/package/${data.name}`,
    versions,
    timestamp: fetchTimestamp,
    historyAvailable,
    timestamps,
    globalTotalDownloads,
    historicalTotalGlobalDownloads,
  };
};

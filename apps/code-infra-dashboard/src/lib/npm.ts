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

export const fetchNpmPackageSearch = async (query: string): Promise<SearchResult[]> => {
  if (!query.trim()) {
    return [];
  }

  const response = await fetch(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20`,
  );
  if (!response.ok) {
    throw new Error('Failed to fetch search results');
  }

  const data = await response.json();
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
  const [response, downloadsResponse, historyResult] = await Promise.all([
    fetch(`https://registry.npmjs.org/${packageName}`),
    fetch(`https://api.npmjs.org/versions/${encodedPackageName}/last-week`),
    // Gracefully handle history fetch failure
    fetch(`https://raw.githubusercontent.com/Janpot/npm-versions-tracker/refs/heads/master/data/${encodeURIComponent(packageName)}.json`)
      .then(res => res.ok ? res.json() : null)
      .catch(() => null),
  ]);

  if (!response.ok) {
    throw new Error('Failed to fetch package details');
  }

  if (!downloadsResponse.ok) {
    throw new Error('Failed to fetch download statistics');
  }

  const [data, downloadsData] = await Promise.all([response.json(), downloadsResponse.json()]);

  // Process historical data if available
  const historyAvailable = historyResult !== null;
  const timestamps: number[] = historyResult?.timestamps || [];
  
  const versions: Record<string, PackageVersion> = {};

  Object.keys(data.versions || {}).forEach((version) => {
    // Get historical download data for this version
    const history = historyResult?.downloads?.[version] || [];
    
    versions[version] = {
      version,
      publishedAt: data.time?.[version] || null,
      dependencies: data.versions[version].dependencies || {},
      downloads: 0, // Will be populated later with current download data
      history,
    };
  });

  // Map current download data to versions - the API returns { downloads: { "version": count } }
  if (downloadsData.downloads) {
    Object.keys(downloadsData.downloads).forEach((version) => {
      if (versions[version]) {
        versions[version].downloads = downloadsData.downloads[version] || 0;
      }
    });
  }

  // If we have historical data, add current downloads to history
  if (historyAvailable) {
    Object.keys(versions).forEach((version) => {
      if (versions[version].history.length > 0) {
        versions[version].history.push(versions[version].downloads);
      } else {
        // If no history exists for this version, create array with just current downloads
        versions[version].history = [versions[version].downloads];
      }
    });
  }

  return {
    name: data.name,
    description: data.description,
    version: data['dist-tags']?.latest || 'unknown',
    author: typeof data.author === 'string' ? data.author : data.author?.name || 'Unknown',
    link: `https://www.npmjs.com/package/${data.name}`,
    versions,
    timestamp: fetchTimestamp,
    historyAvailable,
    timestamps: historyAvailable ? [...timestamps, fetchTimestamp] : [],
  };
};

export const fetchNpmPackageHistory = async (packageName: string): Promise<HistoricalData> => {
  const encodedPackageName = encodeURIComponent(packageName);
  const response = await fetch(
    `https://raw.githubusercontent.com/Janpot/npm-versions-tracker/refs/heads/master/data/${encodedPackageName}.json`,
  );
  if (!response.ok) {
    throw new Error('Failed to fetch historical data');
  }

  const data = await response.json();
  return data;
};

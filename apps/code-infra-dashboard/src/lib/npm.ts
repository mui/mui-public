export interface Package {
  name: string;
  description: string;
  version: string;
  author: string;
  link: string;
  score: number;
  versions?: Record<string, PackageVersion>;
}

export interface PackageVersion {
  version: string;
  publishedAt: string | null;
  dependencies: Record<string, string>;
  downloads?: number;
}

export const fetchNpmPackageSearch = async (query: string): Promise<Package[]> => {
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

export const fetchNpmPackageDetails = async (
  packageName: string,
): Promise<Omit<Package, 'versions'>> => {
  const response = await fetch(`https://registry.npmjs.org/${packageName}`);
  if (!response.ok) {
    throw new Error('Failed to fetch package details');
  }

  const data = await response.json();

  return {
    name: data.name,
    description: data.description,
    version: data['dist-tags']?.latest || 'unknown',
    author: typeof data.author === 'string' ? data.author : data.author?.name || 'Unknown',
    link: `https://www.npmjs.com/package/${data.name}`,
    score: 0,
  };
};

export const fetchNpmPackageVersions = async (
  packageName: string,
): Promise<Record<string, PackageVersion>> => {
  const response = await fetch(`https://registry.npmjs.org/${packageName}`);
  if (!response.ok) {
    throw new Error('Failed to fetch package versions');
  }

  const data = await response.json();
  const versions: Record<string, PackageVersion> = {};

  Object.keys(data.versions || {}).forEach((version) => {
    versions[version] = {
      version,
      publishedAt: data.time?.[version] || null,
      dependencies: data.versions[version].dependencies || {},
    };
  });

  // Fetch per-version download statistics (last 7 days)
  const encodedPackageName = packageName.replace('/', '%2F');
  const downloadsResponse = await fetch(
    `https://api.npmjs.org/versions/${encodedPackageName}/last-week`,
  );

  if (!downloadsResponse.ok) {
    throw new Error('Failed to fetch download statistics');
  }

  const downloadsData = await downloadsResponse.json();

  // Map download data to versions - the API returns { downloads: { "version": count } }
  if (downloadsData.downloads) {
    Object.keys(downloadsData.downloads).forEach((version) => {
      if (versions[version]) {
        versions[version].downloads = downloadsData.downloads[version] || 0;
      }
    });
  }

  return versions;
};

import { useState, useCallback } from 'react';

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

export interface PackageSearchResult {
  packages: Package[];
  isLoading: boolean;
  error: string | null;
}

export interface PackageDetailsResult {
  package: Package | null;
  isLoading: boolean;
  error: string | null;
}

export function useNpmPackageSearch() {
  const [searchResults, setSearchResults] = useState<Package[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchPackages = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20`);
      if (!response.ok) {
        throw new Error('Failed to fetch search results');
      }
      
      const data = await response.json();
      const packages: Package[] = data.objects.map((obj: any) => ({
        name: obj.package.name,
        description: obj.package.description,
        version: obj.package.version,
        author: obj.package.publisher?.username || 'Unknown',
        link: obj.package.links?.npm || `https://www.npmjs.com/package/${obj.package.name}`,
        score: obj.score.final,
      }));
      
      setSearchResults(packages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    searchResults,
    isLoading,
    error,
    searchPackages,
  };
}

export function useNpmPackageDetails() {
  const [packageDetails, setPackageDetails] = useState<Package | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPackageDetails = useCallback(async (packageName: string) => {
    if (!packageName) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch package metadata
      const response = await fetch(`https://registry.npmjs.org/${packageName}`);
      if (!response.ok) {
        throw new Error('Failed to fetch package details');
      }
      
      const data = await response.json();
      const versions: Record<string, PackageVersion> = {};
      
      Object.keys(data.versions || {}).forEach(version => {
        versions[version] = {
          version,
          publishedAt: data.time?.[version] || null,
          dependencies: data.versions[version].dependencies || {},
        };
      });

      // Fetch per-version download statistics (last 7 days)
      try {
        const encodedPackageName = packageName.replace('/', '%2F');
        const downloadsResponse = await fetch(`https://api.npmjs.org/versions/${encodedPackageName}/last-week`);
        
        if (downloadsResponse.ok) {
          const downloadsData = await downloadsResponse.json();
          console.log('Downloads API response:', downloadsData); // Debug log
          
          // Map download data to versions - the API returns { downloads: { "version": count } }
          if (downloadsData.downloads) {
            Object.keys(downloadsData.downloads).forEach(version => {
              if (versions[version]) {
                versions[version].downloads = downloadsData.downloads[version] || 0;
              }
            });
          }
        } else {
          console.warn('Downloads API returned non-OK status:', downloadsResponse.status, downloadsResponse.statusText);
        }
      } catch (downloadError) {
        console.error('Failed to fetch download statistics:', downloadError);
        // Don't set error here, we'll handle it in the component
      }
      
      const packageInfo: Package = {
        name: data.name,
        description: data.description,
        version: data['dist-tags']?.latest || 'unknown',
        author: typeof data.author === 'string' ? data.author : data.author?.name || 'Unknown',
        link: `https://www.npmjs.com/package/${data.name}`,
        versions,
        score: 0,
      };
      
      setPackageDetails(packageInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      setPackageDetails(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    packageDetails,
    isLoading,
    error,
    fetchPackageDetails,
  };
}
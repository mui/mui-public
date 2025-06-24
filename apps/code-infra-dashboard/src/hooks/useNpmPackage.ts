import { useQuery } from '@tanstack/react-query';
import { fetchNpmPackageDetails, Package } from '../lib/npm';

export interface UseNpmPackage {
  packageDetails: Omit<Package, 'versions'> | null;
  isLoading: boolean;
  error: Error | null;
}

export function useNpmPackage(packageName: string | null): UseNpmPackage {
  const {
    data = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['npmPackageDetails', packageName],
    queryFn: () => fetchNpmPackageDetails(packageName!),
    enabled: !!packageName,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  return {
    packageDetails: data,
    isLoading,
    error: error as Error | null,
  };
}

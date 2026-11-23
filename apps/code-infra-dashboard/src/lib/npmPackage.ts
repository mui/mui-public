import { useQuery } from '@tanstack/react-query';
import { downloadAndExtractPackage } from './packageDownload';

export type { FileContent, PackageContents } from './packageDownload';

export function usePackageContent(packageSpec: string | null) {
  return useQuery({
    queryKey: ['package-download', packageSpec],
    queryFn: () => downloadAndExtractPackage(packageSpec!),
    enabled: Boolean(packageSpec?.trim()),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
